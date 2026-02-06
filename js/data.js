// data.js - Complete Fixed Implementation for Cross-Device Sync
// Firebase data per USER (cross-device), localStorage per APP (isolated)

import { 
    app, auth, db, signInAnonymously, onAuthStateChanged, 
    ref, set, get, update, push, serverTimestamp, onValue, off,
    runTransaction, onDisconnect,
    ADMIN_IDS, ALLOWED_USER_IDS, THEMES, State, APP_ID, getStorageKey, 
    checkUserRole, isAdmin, isAllowedUser, hasAccess 
} from '../config.js';

const Data = {
    
    // Track real-time listeners for cleanup
    listeners: {},
    
    // Connection state
    isOnline: true,
    syncQueue: [],
    
    /**
     * Initialize Firebase anonymous authentication
     */
    initAuth: async () => {
        console.log("🔥 Initializing Firebase Auth...");
        return Promise.resolve();
    },

    /**
     * Show Firebase UID for debugging/admin purposes
     */
    showFirebaseUid: () => {
        if (window.currentUser) {
            alert("🔥 معرف المستخدم (Firebase UID):\n\n" + window.currentUser.uid);
        } else {
            alert("❌ لم يتم تسجيل الدخول بعد");
        }
    },

    /**
     * Load questions from JSON files
     */
    loadQuestions: async () => {
        try {
            const list = await (await fetch('questions_list.json')).json();
            for(let f of list) {
                try {
                    let d = await (await fetch('Questions/' + f)).json();
                    State.allQ.push(...d.questions.map(q => ({
                        ...q, 
                        term: q.term || d.meta?.source || 'General', 
                        subject: q.subject || d.meta?.subject || 'General', 
                        lesson: q.lesson || d.meta?.lesson || 'General', 
                        chapter: q.chapter || "General"
                    })));
                } catch(e) { 
                    console.warn('Failed to load:', f, e); 
                }
            }
            
            const dbStatus = document.getElementById('db-status');
            if(dbStatus) dbStatus.innerText = State.allQ.length + ' سؤال';
            if(window.UI && window.UI.updateHomeStats) window.UI.updateHomeStats();

        } catch(e) { 
            const dbStatus = document.getElementById('db-status');
            if(dbStatus) dbStatus.innerText = "خطأ في التحميل"; 
            console.error(e);
        }
    },
    
    /**
     * Initialize data synchronization with real-time listeners
     * This ensures immediate sync across all devices for the same user
     */
    initSync: async () => {
        console.log("🔄 Starting data sync... App ID:", APP_ID);
        
        // 1. Load local data first (per-app isolation using APP_ID prefix)
        const local = {
            mistakes: JSON.parse(localStorage.getItem(getStorageKey('mistakes')) || '[]'),
            archive: JSON.parse(localStorage.getItem(getStorageKey('archive')) || '[]'),
            fav: JSON.parse(localStorage.getItem(getStorageKey('fav')) || '[]'),
            settings: JSON.parse(localStorage.getItem(getStorageKey('settings')) || '{}'),
            sessions: JSON.parse(localStorage.getItem(getStorageKey('sessions')) || '[]'),
            last_sync: parseInt(localStorage.getItem(getStorageKey('last_sync')) || '0')
        };
        State.localData = local;
        
        // Apply settings immediately for better UX
        if (State.localData.settings.theme && window.UI) {
            UI.setTheme(State.localData.settings.theme);
        }
        if (State.localData.settings.anim === false && window.UI) {
            UI.toggleAnim(false);
        }
        
        // 2. Setup real-time sync with Firebase (per USER - cross-device)
        if (window.currentUser) {
            await Data.setupRealtimeSync();
        } else {
            console.log("⚠️ No Firebase user, operating in offline mode");
        }
        
        // 3. Setup online/offline detection
        Data.setupConnectivityMonitoring();
        
        console.log("🔍 User role:", window.userRole, "| App ID:", APP_ID);
    },
    
    /**
     * Setup real-time listeners for cross-device synchronization
     */
    setupRealtimeSync: async () => {
        const telegramId = State.user.telegram_id || State.user.id || 'anonymous';
        const userRef = ref(db, 'user_data/' + telegramId);
        
        console.log("📡 Setting up real-time sync for user:", telegramId);
        
        // Remove existing listener if any
        if (Data.listeners.userData) {
            off(Data.listeners.userData.ref, 'value', Data.listeners.userData.callback);
        }
        
        // Real-time listener for cross-device sync
        const handleDataChange = (snapshot) => {
            const cloudData = snapshot.val();
            
            if (!cloudData) {
                // No cloud data yet - push local data
                console.log("☁️ No cloud data found, pushing local data...");
                Data.saveData();
                return;
            }
            
            // Check if cloud data is newer
            const cloudTime = cloudData.last_updated || 0;
            const localTime = State.localData.last_updated || localStorage.getItem(getStorageKey('last_sync')) || 0;
            
            console.log("📊 Sync check - Cloud:", new Date(cloudTime), "| Local:", new Date(localTime));
            
            if (cloudTime > localTime) {
                console.log("⬇️ Cloud data is newer, updating local...");
                
                // Merge cloud data with local (smart merge)
                State.localData = {
                    mistakes: Data.mergeArraysSmart(State.localData.mistakes, cloudData.mistakes),
                    archive: Data.mergeArraysSmart(State.localData.archive, cloudData.archive),
                    fav: Data.mergeArraysSmart(State.localData.fav, cloudData.fav),
                    settings: { ...cloudData.settings, ...State.localData.settings }, // Local settings win
                    sessions: cloudData.sessions || State.localData.sessions,
                    last_updated: cloudTime
                };
                
                // Save to localStorage (per-app)
                Data.saveLocalOnly();
                
                // Refresh UI
                if(window.UI && window.UI.updateHomeStats) {
                    UI.updateHomeStats();
                }
                
                // Show sync indicator briefly
                Data.showSyncIndicator();
            } else if (cloudTime < localTime) {
                console.log("⬆️ Local data is newer, pushing to cloud...");
                Data.saveData();
            } else {
                console.log("✅ Data is in sync");
            }
        };
        
        // Subscribe to real-time updates
        onValue(userRef, handleDataChange);
        
        // Store listener reference for cleanup
        Data.listeners.userData = {
            ref: userRef,
            callback: handleDataChange
        };
        
        // Setup presence system (online/offline status)
        await Data.setupPresence(telegramId);
        
        // Initial one-time check to resolve any immediate conflicts
        try {
            const initialSnap = await get(userRef);
            if (!initialSnap.exists()) {
                console.log("🆕 New user - pushing initial data");
                await Data.saveData();
            }
        } catch (e) {
            console.log("⚠️ Initial sync check failed:", e.message);
        }
    },
    
    /**
     * Setup user presence (online/offline status)
     */
    setupPresence: async (telegramId) => {
        try {
            const presenceRef = ref(db, 'presence/' + telegramId);
            const connectedRef = ref(db, '.info/connected');
            
            onValue(connectedRef, (snap) => {
                if (snap.val() === true) {
                    // User is online
                    set(presenceRef, {
                        online: true,
                        last_seen: serverTimestamp(),
                        app_id: APP_ID,
                        user_name: State.user.first_name
                    });
                    
                    // Set disconnect handler
                    onDisconnect(presenceRef).set({
                        online: false,
                        last_seen: serverTimestamp(),
                        app_id: APP_ID
                    });
                }
            });
        } catch (e) {
            console.log("⚠️ Presence setup failed:", e.message);
        }
    },
    
    /**
     * Monitor online/offline status
     */
    setupConnectivityMonitoring: () => {
        window.addEventListener('online', () => {
            console.log("🌐 Back online");
            Data.isOnline = true;
            Data.processSyncQueue();
            if(window.UI && UI.showToast) UI.showToast("متصل بالإنترنت");
        });
        
        window.addEventListener('offline', () => {
            console.log("📴 Gone offline");
            Data.isOnline = false;
            if(window.UI && UI.showToast) UI.showToast("وضع عدم الاتصال - سيتم المزامنة لاحقاً");
        });
        
        Data.isOnline = navigator.onLine;
    },
    
    /**
     * Show brief sync indicator
     */
    showSyncIndicator: () => {
        const indicator = document.getElementById('sync-indicator') || Data.createSyncIndicator();
        indicator.style.opacity = '1';
        setTimeout(() => {
            indicator.style.opacity = '0';
        }, 1500);
    },
    
    createSyncIndicator: () => {
        const div = document.createElement('div');
        div.id = 'sync-indicator';
        div.innerHTML = '🔄 تم التزامن';
        div.style.cssText = `
            position: fixed;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--success, #00b894);
            color: white;
            padding: 5px 15px;
            border-radius: 20px;
            font-size: 12px;
            z-index: 10000;
            opacity: 0;
            transition: opacity 0.3s;
            pointer-events: none;
        `;
        document.body.appendChild(div);
        return div;
    },
    
    /**
     * Smart merge arrays - keeps unique items, preserves order
     */
    mergeArraysSmart: (local, cloud) => {
        if (!cloud) return local || [];
        if (!local) return cloud || [];
        // Use Set for uniqueness, convert back to array
        return [...new Set([...local, ...cloud])];
    },
    
    /**
     * Legacy merge function (for backwards compatibility)
     */
    mergeArrays: (local, cloud) => {
        return Data.mergeArraysSmart(local, cloud);
    },

    /**
     * Save data to Firebase (cross-device) and localStorage (per-app)
     */
    saveData: async (options = {}) => {
        const now = Date.now();
        const telegramId = State.user.telegram_id || State.user.id || 'anonymous';
        
        const dataToSave = {
            mistakes: State.localData.mistakes || [],
            archive: State.localData.archive || [],
            fav: State.localData.fav || [],
            settings: State.localData.settings || {},
            telegram_id: telegramId,
            user_name: State.user.first_name,
            last_updated: serverTimestamp(),
            client_timestamp: now,
            app_id: APP_ID // Track which app last updated
        };
        
        // 1. Always save to localStorage first (per-app isolation)
        Data.saveLocalOnly();
        
        // 2. Save to Firebase if online (cross-device sync)
        if (window.currentUser && Data.isOnline && !options.localOnly) {
            try {
                // Use update() to merge with existing data rather than overwrite
                await update(ref(db, 'user_data/' + telegramId), dataToSave);
                console.log("💾 Saved to Firebase for user:", telegramId, "from app:", APP_ID);
                
                // Update last sync timestamp
                localStorage.setItem(getStorageKey('last_sync'), now.toString());
                State.localData.last_updated = now;
                
            } catch (e) {
                console.log("⚠️ Firebase save failed:", e.message);
                // Queue for later sync
                Data.queueForSync(dataToSave);
            }
        } else if (!Data.isOnline) {
            console.log("📴 Offline - data queued for sync");
            Data.queueForSync(dataToSave);
        }
    },
    
    /**
     * Save to localStorage only (per-app isolation)
     */
    saveLocalOnly: () => {
        const now = Date.now();
        
        localStorage.setItem(getStorageKey('mistakes'), JSON.stringify(State.localData.mistakes || []));
        localStorage.setItem(getStorageKey('archive'), JSON.stringify(State.localData.archive || []));
        localStorage.setItem(getStorageKey('fav'), JSON.stringify(State.localData.fav || []));
        localStorage.setItem(getStorageKey('settings'), JSON.stringify(State.localData.settings || {}));
        localStorage.setItem(getStorageKey('sessions'), JSON.stringify(State.localData.sessions || []));
        localStorage.setItem(getStorageKey('last_sync'), now.toString());
        
        State.localData.last_updated = now;
    },
    
    /**
     * Queue data for later sync when back online
     */
    queueForSync: (data) => {
        Data.syncQueue.push({
            data: data,
            timestamp: Date.now(),
            retries: 0
        });
        
        // Persist queue to localStorage
        localStorage.setItem(getStorageKey('sync_queue'), JSON.stringify(Data.syncQueue));
    },
    
    /**
     * Process queued sync operations
     */
    processSyncQueue: async () => {
        if (!Data.isOnline || !window.currentUser) return;
        
        const queue = JSON.parse(localStorage.getItem(getStorageKey('sync_queue')) || '[]');
        if (queue.length === 0) return;
        
        console.log("🔄 Processing sync queue:", queue.length, "items");
        
        const telegramId = State.user.telegram_id || State.user.id || 'anonymous';
        const successful = [];
        
        for (const item of queue) {
            try {
                await update(ref(db, 'user_data/' + telegramId), {
                    ...item.data,
                    last_updated: serverTimestamp(),
                    queued_at: item.timestamp
                });
                successful.push(item);
            } catch (e) {
                console.log("❌ Failed to sync queued item:", e.message);
                item.retries++;
                if (item.retries > 3) {
                    successful.push(item); // Remove after 3 retries
                }
            }
        }
        
        // Remove successful items from queue
        Data.syncQueue = queue.filter(item => !successful.includes(item));
        localStorage.setItem(getStorageKey('sync_queue'), JSON.stringify(Data.syncQueue));
        
        if (successful.length > 0) {
            console.log("✅ Synced", successful.length, "queued items");
            Data.showSyncIndicator();
        }
    },

    /**
     * Save session analytics after quiz completion
     */
    saveSessionAnalytics: async () => {
        if (!State.quiz.length || State.mode === 'view_mode') {
            console.log("⏭️ Skipping analytics - no quiz or view mode");
            return;
        }
        
        console.log("📊 Saving session analytics...");
        
        const telegramId = State.user.telegram_id || State.user.id || 'anonymous';
        
        const sessionData = {
            user_id: window.currentUser ? window.currentUser.uid : 'anonymous',
            telegram_id: telegramId,
            user_name: State.user.first_name,
            app_id: APP_ID, // Per-app analytics
            timestamp: serverTimestamp(),
            client_timestamp: Date.now(),
            mode: State.mode,
            term: State.sel.terms[0] || 'all',
            subject: State.sel.subj || 'mixed',
            lessons: State.sel.lessons || [],
            total_questions: State.quiz.length,
            score: State.score,
            accuracy: Math.round((State.score / State.quiz.length) * 100),
            time_spent: State.sessionStartTime ? Date.now() - State.sessionStartTime : 0,
            answers: State.answers.map((a, idx) => ({
                question_id: State.quiz[idx].id,
                subject: State.quiz[idx].subject,
                lesson: State.quiz[idx].lesson,
                chapter: State.quiz[idx].chapter,
                is_correct: a.isCorrect,
                selected_option: a.selectedIdx,
                correct_option: State.quiz[idx].correct_option_id
            })),
            mistakes_made: State.answers.filter(a => !a.isCorrect).map((a, idx) => ({
                question_id: State.quiz[idx].id,
                subject: State.quiz[idx].subject,
                lesson: State.quiz[idx].lesson,
                chapter: State.quiz[idx].chapter
            }))
        };
        
        try {
            // Save to leaderboard (per user, cross-device)
            if (State.sel.subj) {
                const ctx = (State.sel.subj).replace(/[.#$\[\]]/g, "_");
                await set(ref(db, 'leaderboards/' + ctx + '/' + telegramId), {
                    score: sessionData.score,
                    accuracy: sessionData.accuracy,
                    total: sessionData.total_questions,
                    name: State.user.first_name,
                    timestamp: sessionData.timestamp,
                    app_id: APP_ID
                });
                console.log("🏆 Leaderboard updated for user:", telegramId);
            }
            
            // Save detailed analytics (per app for analytics aggregation)
            const sessionKey = push(ref(db, 'analytics/' + APP_ID + '/sessions')).key;
            await set(ref(db, 'analytics/' + APP_ID + '/sessions/' + sessionKey), sessionData);
            console.log("✅ Analytics saved:", sessionKey, "for app:", APP_ID);
            
            // Update user stats (per user, cross-device)
            await Data.updateUserStats(sessionData);
            
        } catch (e) {
            console.error("❌ Analytics save failed:", e);
            // Don't throw - analytics shouldn't break the app
        }
    },

    /**
     * Update aggregated user statistics
     */
    updateUserStats: async (session) => {
        const telegramId = State.user.telegram_id || State.user.id || 'anonymous';
        if (!telegramId || telegramId === 'anonymous') return;
        
        // Use transaction to prevent race conditions
        const statsRef = ref(db, 'user_stats/' + telegramId);
        
        try {
            await runTransaction(statsRef, (current) => {
                if (!current) {
                    current = {
                        total_sessions: 0,
                        total_questions: 0,
                        total_correct: 0,
                        subjects: {},
                        weak_areas: [],
                        strong_areas: [],
                        apps_used: [],
                        first_seen: serverTimestamp(),
                        telegram_id: telegramId,
                        user_name: session.user_name
                    };
                }
                
                current.total_sessions++;
                current.total_questions += session.total_questions;
                current.total_correct += session.score;
                current.last_active = serverTimestamp();
                current.last_app_used = APP_ID;
                
                // Track which apps this user has used
                if (!current.apps_used.includes(APP_ID)) {
                    current.apps_used.push(APP_ID);
                }
                
                // Subject breakdown
                session.answers.forEach(ans => {
                    if (!current.subjects[ans.subject]) {
                        current.subjects[ans.subject] = { total: 0, correct: 0, chapters: {} };
                    }
                    current.subjects[ans.subject].total++;
                    if (ans.is_correct) current.subjects[ans.subject].correct++;
                    
                    if (!current.subjects[ans.subject].chapters[ans.chapter]) {
                        current.subjects[ans.subject].chapters[ans.chapter] = { total: 0, correct: 0 };
                    }
                    current.subjects[ans.subject].chapters[ans.chapter].total++;
                    if (ans.is_correct) current.subjects[ans.subject].chapters[ans.chapter].correct++;
                });
                
                // Identify weak and strong areas
                const weakAreas = [];
                const strongAreas = [];
                Object.entries(current.subjects).forEach(([subj, data]) => {
                    const accuracy = data.total > 0 ? data.correct / data.total : 0;
                    if (accuracy < 0.6 && data.total >= 5) weakAreas.push(subj);
                    else if (accuracy > 0.85 && data.total >= 10) strongAreas.push(subj);
                });
                current.weak_areas = weakAreas;
                current.strong_areas = strongAreas;
                
                return current;
            });
            
            console.log("👤 User stats updated for:", telegramId);
        } catch (e) {
            console.error("❌ Failed to update user stats:", e);
        }
    },

    /**
     * Load analytics (Admin only)
     */
    loadAnalytics: async () => {
        if (!isAdmin()) {
            alert("❌ غير مصرح: هذه الميزة متاحة للمسؤولين فقط");
            return;
        }
        
        console.log("📈 Loading analytics for app:", APP_ID);
        try {
            const [sessionsSnap, usersSnap, allAppsSnap] = await Promise.all([
                get(ref(db, 'analytics/' + APP_ID + '/sessions').limitToLast(100)),
                get(ref(db, 'user_stats')),
                get(ref(db, 'analytics')) // Get all apps analytics
            ]);
            
            const sessions = sessionsSnap.val() || {};
            const users = usersSnap.val() || {};
            const allApps = allAppsSnap.val() || {};
            
            console.log("📊 Data:", Object.keys(sessions).length, "sessions,", Object.keys(users).length, "users");
            Data.renderAnalytics({ sessions, users, allApps });
        } catch (e) {
            console.error("Failed to load analytics:", e);
            alert("خطأ في تحميل التحليلات: " + e.message);
        }
    },

    /**
     * Render analytics dashboard
     */
    renderAnalytics: (data) => {
        const container = document.getElementById('analytics-content');
        if (!container) return;
        
        const sessions = Object.values(data.sessions || {});
        const users = Object.values(data.users || {});
        const allApps = data.allApps || {};
        
        // Calculate stats
        const totalUsers = users.length;
        const totalSessions = sessions.length;
        const totalQuestions = sessions.reduce((sum, s) => sum + (s.total_questions || 0), 0);
        const avgAccuracy = sessions.length > 0 
            ? Math.round(sessions.reduce((sum, s) => sum + (s.accuracy || 0), 0) / sessions.length)
            : 0;
        
        // Find weak subjects
        const subjectStats = {};
        sessions.forEach(s => {
            (s.mistakes_made || []).forEach(m => {
                if (!subjectStats[m.subject]) subjectStats[m.subject] = { mistakes: 0, total: 0 };
                subjectStats[m.subject].mistakes++;
            });
            (s.answers || []).forEach(a => {
                if (!subjectStats[a.subject]) subjectStats[a.subject] = { mistakes: 0, total: 0 };
                subjectStats[a.subject].total++;
            });
        });
        
        const topWeakSubjects = Object.entries(subjectStats)
            .map(([subj, stats]) => ({
                subject: subj,
                mistakeRate: stats.total > 0 ? (stats.mistakes / stats.total) : 0,
                mistakes: stats.mistakes,
                total: stats.total
            }))
            .sort((a, b) => b.mistakeRate - a.mistakeRate)
            .slice(0, 5);
        
        // Most active users
        const userActivity = {};
        sessions.forEach(s => {
            if (!userActivity[s.user_name]) {
                userActivity[s.user_name] = { 
                    sessions: 0, 
                    questions: 0,
                    telegram_id: s.telegram_id,
                    apps: new Set()
                };
            }
            userActivity[s.user_name].sessions++;
            userActivity[s.user_name].questions += s.total_questions || 0;
            userActivity[s.user_name].apps.add(s.app_id);
        });
        
        const topUsers = Object.entries(userActivity)
            .sort((a, b) => b[1].questions - a[1].questions)
            .slice(0, 5);
        
        // Apps usage
        const appUsage = {};
        Object.values(allApps).forEach(appData => {
            const appSessions = appData.sessions ? Object.keys(appData.sessions).length : 0;
            appUsage[appData.app_id || 'unknown'] = (appUsage[appData.app_id || 'unknown'] || 0) + appSessions;
        });
        
        container.innerHTML = `
            <div style="margin-bottom:15px; padding:10px; background:rgba(0,0,0,0.05); border-radius:8px;">
                <strong>Current App ID:</strong> ${APP_ID}
            </div>
            
            <div class="stats-grid">
                <div class="stat-item"><h3>المستخدمين</h3><p>${totalUsers}</p></div>
                <div class="stat-item"><h3>الجلسات</h3><p>${totalSessions}</p></div>
                <div class="stat-item"><h3>الأسئلة</h3><p>${totalQuestions}</p></div>
                <div class="stat-item"><h3>متوسط الدقة</h3><p>${avgAccuracy}%</p></div>
            </div>
            
            <h4 style="margin:20px 0 10px; color:var(--primary)">📉 المواد الأكثر صعوبة</h4>
            ${topWeakSubjects.length > 0 ? topWeakSubjects.map(s => 
                `<div style="padding:8px; background:rgba(0,0,0,0.05); margin:3px 0; border-radius:5px; text-align:left; direction:ltr;">
                    ${s.subject}: ${Math.round(s.mistakeRate * 100)}% error rate (${s.mistakes}/${s.total})
                </div>`
            ).join('') : '<p style="color:var(--txt-sec)">لا توجد بيانات كافية</p>'}
            
            <h4 style="margin:20px 0 10px; color:var(--primary)">🔥 الأكثر نشاطاً</h4>
            ${topUsers.map(([name, stats]) => 
                `<div style="padding:8px; background:rgba(0,0,0,0.05); margin:3px 0; border-radius:5px; text-align:left; direction:ltr;">
                    ${name}: ${stats.questions} questions (${stats.sessions} sessions)
                    ${stats.apps.size > 1 ? `<span style="color:var(--success)">📱 ${stats.apps.size} apps</span>` : ''}
                </div>`
            ).join('')}
            
            <h4 style="margin:20px 0 10px; color:var(--primary)">📱 استخدام التطبيقات</h4>
            ${Object.entries(appUsage).map(([appId, count]) => 
                `<div style="padding:8px; background:rgba(0,0,0,0.05); margin:3px 0; border-radius:5px; text-align:left; direction:ltr;">
                    ${appId}: ${count} sessions ${appId === APP_ID ? '<span style="color:var(--primary)">(current)</span>' : ''}
                </div>`
            ).join('')}
            
            <button class="btn btn-primary full-width" onclick="Data.exportAnalytics()" style="margin-top:20px;">
                📥 تصدير البيانات الكاملة (JSON)
            </button>
            
            <button class="btn btn-sec full-width" onclick="Data.exportUserData()" style="margin-top:10px;">
                👤 تصدير بيانات المستخدمين (JSON)
            </button>
        `;
    },

    /**
     * Export analytics data
     */
    exportAnalytics: () => {
        get(ref(db, 'analytics/' + APP_ID)).then(snap => {
            const data = snap.val();
            Data.showExportModal(data, 'Analytics - ' + APP_ID);
        }).catch(err => {
            console.error("Firebase read error:", err);
            alert("Error fetching data: " + err.message);
        });
    },
    
    /**
     * Export all user data (admin only)
     */
    exportUserData: () => {
        get(ref(db, 'user_data')).then(snap => {
            const data = snap.val();
            Data.showExportModal(data, 'All Users Data');
        }).catch(err => {
            console.error("Firebase read error:", err);
            alert("Error fetching data: " + err.message);
        });
    },
    
    /**
     * Show export modal with data
     */
    showExportModal: (data, title) => {
        const dataStr = JSON.stringify(data, null, 2);
        
        const modal = document.createElement('div');
        modal.innerHTML = `
            <div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:99999;display:flex;justify-content:center;align-items:center;padding:20px;">
                <div style="background:#fff;padding:20px;border-radius:10px;width:100%;max-width:600px;max-height:90vh;display:flex;flex-direction:column;gap:15px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <h3 style="margin:0;color:#333">📊 Export: ${title}</h3>
                        <button class="close-modal-btn" style="background:none;border:none;font-size:24px;cursor:pointer;">&times;</button>
                    </div>
                    <p style="margin:0;color:#666;font-size:14px;line-height:1.4;">
                        ⚠️ Copy the raw data below:
                    </p>
                    <textarea id="export-area" style="width:100%;height:300px;font-family:monospace;border:1px solid #ccc;border-radius:5px;padding:10px;font-size:12px;resize:none;" readonly>${dataStr}</textarea>
                    <div style="display:flex;gap:10px;">
                        <button id="btn-copy" style="flex:1;padding:12px;background:#4CAF50;color:white;border:none;border-radius:5px;cursor:pointer;font-weight:bold;font-size:16px;">
                            📋 Copy to Clipboard
                        </button>
                        <button class="close-modal-btn-main" style="flex:1;padding:12px;background:#f44336;color:white;border:none;border-radius:5px;cursor:pointer;font-weight:bold;font-size:16px;">
                            Close
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        const close = () => { 
            if(document.body.contains(modal)) document.body.removeChild(modal); 
        };
        modal.querySelector('.close-modal-btn').onclick = close;
        modal.querySelector('.close-modal-btn-main').onclick = close;
        
        document.getElementById('btn-copy').onclick = function() {
            const textArea = document.getElementById('export-area');
            textArea.select();
            
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(dataStr).then(() => {
                    this.innerText = "✅ Copied!";
                    setTimeout(() => this.innerText = "📋 Copy to Clipboard", 2000);
                }).catch(() => {
                    document.execCommand('copy');
                    this.innerText = "✅ Copied!";
                });
            } else {
                document.execCommand('copy');
                this.innerText = "✅ Copied!";
            }
        };
    },
    
    /**
     * Force manual sync (for debugging)
     */
    forceSync: async () => {
        console.log("🔄 Manual sync triggered...");
        await Data.saveData();
        await Data.setupRealtimeSync();
        Data.showSyncIndicator();
    },
    
    /**
     * Cleanup listeners when app unloads
     */
    cleanup: () => {
        if (Data.listeners.userData) {
            off(Data.listeners.userData.ref, 'value', Data.listeners.userData.callback);
        }
    }
};

// Make Data available globally
window.Data = Data;

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    Data.cleanup();
});
