// data.js - Updated for ES modules and 3-tier user system

import { app, auth, db, signInAnonymously, onAuthStateChanged, ref, set, get, update, push, serverTimestamp,
         ADMIN_IDS, ALLOWED_USER_IDS, THEMES, State, checkUserRole, isAdmin, isAllowedUser, hasAccess } from '../config.js';

const Data = {
    
    initAuth: async () => {
        console.log("🔥 Initializing Firebase Auth from data.js...");
        // Auth is now handled in index.html main module
        return Promise.resolve();
    },

    showFirebaseUid: () => {
        if (window.currentUser) {
            alert("🔥 معرف المستخدم (Firebase UID):\n\n" + window.currentUser.uid);
        } else {
            alert("❌ لم يتم تسجيل الدخول بعد");
        }
    },

    loadQuestions: async () => {
        try {
            const list = await (await fetch('questions_list.json')).json();
            for(let f of list) {
                try {
                    let d = await (await fetch('Questions/' + f)).json();
                    State.allQ.push(...d.questions.map(q => ({
                        ...q, 
                        term: q.term || d.meta.source, 
                        subject: q.subject || d.meta.subject, 
                        lesson: q.lesson || d.meta.lesson, 
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
    
    initSync: async () => {
        console.log("🔄 Starting data sync...");
        
        // Load local data first
        const local = {
            mistakes: JSON.parse(localStorage.getItem('mistakes') || '[]'),
            archive: JSON.parse(localStorage.getItem('archive') || '[]'),
            fav: JSON.parse(localStorage.getItem('fav') || '[]'),
            settings: JSON.parse(localStorage.getItem('settings') || '{}'),
            sessions: JSON.parse(localStorage.getItem('sessions') || '[]')
        };
        State.localData = local;
        
        // Sync with Firebase
        if (window.currentUser) {
            try {
                const userRef = ref(db, 'user_progress/' + window.currentUser.uid);
                const snapshot = await get(userRef);
                const cloudData = snapshot.val();
                
                if (cloudData) {
                    State.localData = {
                        mistakes: Data.mergeArrays(local.mistakes, cloudData.mistakes),
                        archive: Data.mergeArrays(local.archive, cloudData.archive),
                        fav: Data.mergeArrays(local.fav, cloudData.fav),
                        settings: { ...local.settings, ...cloudData.settings },
                        sessions: cloudData.sessions || local.sessions
                    };
                    
                    if (State.localData.settings.theme && window.UI) UI.setTheme(State.localData.settings.theme);
                    if (State.localData.settings.anim === false && window.UI) UI.toggleAnim(false);
                }
                
                Data.saveData();
            } catch (e) {
                console.log("⚠️ Firebase sync failed:", e.message);
            }
        }
        
        console.log("🔍 User role:", window.userRole);
    },
    
    mergeArrays: (local, cloud) => {
        if (!cloud) return local;
        if (!local) return cloud;
        return [...new Set([...local, ...cloud])];
    },

    saveData: async () => {
        const dataToSave = {
            mistakes: State.localData.mistakes,
            archive: State.localData.archive,
            fav: State.localData.fav,
            settings: State.localData.settings,
            last_updated: serverTimestamp()
        };
        
        // LocalStorage
        localStorage.setItem('mistakes', JSON.stringify(State.localData.mistakes));
        localStorage.setItem('archive', JSON.stringify(State.localData.archive));
        localStorage.setItem('fav', JSON.stringify(State.localData.fav));
        localStorage.setItem('settings', JSON.stringify(State.localData.settings));
        
        // Firebase
        if (window.currentUser) {
            try {
                await update(ref(db, 'user_progress/' + window.currentUser.uid), dataToSave);
                console.log("💾 Saved to Firebase");
            } catch (e) {
                console.log("⚠️ Firebase save failed:", e.message);
            }
        }
    },

    saveSessionAnalytics: async () => {
        if (!State.quiz.length || State.mode === 'view_mode') {
            console.log("⏭️ Skipping analytics");
            return;
        }
        
        console.log("📊 Saving session analytics...");
        
        const sessionData = {
            user_id: window.currentUser ? window.currentUser.uid : 'anonymous',
            telegram_id: State.user.telegram_id || 0,
            user_name: State.user.first_name,
            timestamp: serverTimestamp(),
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
            // Save to leaderboard
            if (State.sel.subj) {
                const ctx = (State.sel.subj).replace(/[.#$/\[\]]/g, "_");
                await set(ref(db, 'leaderboards/' + ctx + '/' + window.currentUser.uid), {
                    score: sessionData.score,
                    accuracy: sessionData.accuracy,
                    total: sessionData.total_questions,
                    name: State.user.first_name,
                    timestamp: sessionData.timestamp
                });
                console.log("🏆 Leaderboard updated");
            }
            
            // Save detailed analytics
            const sessionKey = push(ref(db, 'analytics/sessions')).key;
            await set(ref(db, 'analytics/sessions/' + sessionKey), sessionData);
            console.log("✅ Analytics saved:", sessionKey);
            
            await Data.updateUserStats(sessionData);
            
        } catch (e) {
            console.error("❌ Analytics save failed:", e);
        }
    },

    updateUserStats: async (session) => {
        if (!window.currentUser) return;
        
        const statsRef = ref(db, 'analytics/user_stats/' + window.currentUser.uid);
        const snapshot = await get(statsRef);
        const current = snapshot.val() || {
            total_sessions: 0,
            total_questions: 0,
            total_correct: 0,
            subjects: {},
            weak_areas: [],
            strong_areas: []
        };
        
        current.total_sessions++;
        current.total_questions += session.total_questions;
        current.total_correct += session.score;
        current.last_active = session.timestamp;
        current.telegram_id = session.telegram_id;
        current.user_name = session.user_name;
        
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
        
        // Identify weak areas
        const weakAreas = [];
        const strongAreas = [];
        Object.entries(current.subjects).forEach(([subj, data]) => {
            const accuracy = data.correct / data.total;
            if (accuracy < 0.6) weakAreas.push(subj);
            else if (accuracy > 0.85) strongAreas.push(subj);
        });
        current.weak_areas = weakAreas;
        current.strong_areas = strongAreas;
        
        await set(statsRef, current);
        console.log("👤 User stats updated");
    },

    loadAnalytics: async () => {
        // Check if user is admin
        if (!isAdmin()) {
            alert("❌ غير مصرح: هذه الميزة متاحة للمسؤولين فقط");
            return;
        }
        
        console.log("📈 Loading analytics...");
        try {
            const [sessionsSnap, usersSnap] = await Promise.all([
                get(ref(db, 'analytics/sessions').limitToLast(100)),
                get(ref(db, 'analytics/user_stats'))
            ]);
            
            const sessions = sessionsSnap.val() || {};
            const users = usersSnap.val() || {};
            console.log("📊 Data:", Object.keys(sessions).length, "sessions,", Object.keys(users).length, "users");
            Data.renderAnalytics({ sessions, users });
        } catch (e) {
            console.error("Failed:", e);
            alert("خطأ في تحميل التحليلات: " + e.message);
        }
    },

    renderAnalytics: (data) => {
        const container = document.getElementById('analytics-content');
        if (!container) return;
        
        const sessions = Object.values(data.sessions || {});
        const users = Object.values(data.users || {});
        
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
                if (!subjectStats[m.subject]) subjectStats[m.subject] = { mistakes: 0 };
                subjectStats[m.subject].mistakes++;
            });
        });
        
        const topWeakSubjects = Object.entries(subjectStats)
            .sort((a, b) => b[1].mistakes - a[1].mistakes)
            .slice(0, 5);
        
        // Most active users
        const userActivity = {};
        sessions.forEach(s => {
            if (!userActivity[s.user_name]) userActivity[s.user_name] = { sessions: 0, questions: 0 };
            userActivity[s.user_name].sessions++;
            userActivity[s.user_name].questions += s.total_questions || 0;
        });
        
        const topUsers = Object.entries(userActivity)
            .sort((a, b) => b[1].questions - a[1].questions)
            .slice(0, 5);
        
        container.innerHTML = `
            <div class="stats-grid">
                <div class="stat-item"><h3>المستخدمين</h3><p>${totalUsers}</p></div>
                <div class="stat-item"><h3>الجلسات</h3><p>${totalSessions}</p></div>
                <div class="stat-item"><h3>الأسئلة</h3><p>${totalQuestions}</p></div>
                <div class="stat-item"><h3>متوسط الدقة</h3><p>${avgAccuracy}%</p></div>
            </div>
            
            <h4 style="margin:20px 0 10px; color:var(--primary)">📉 المواد الأكثر صعوبة</h4>
            ${topWeakSubjects.map(([subj, stats]) => 
                `<div style="padding:8px; background:rgba(0,0,0,0.05); margin:3px 0; border-radius:5px; text-align:left; direction:ltr;">
                    ${subj}: ${stats.mistakes} errors
                </div>`
            ).join('')}
            
            <h4 style="margin:20px 0 10px; color:var(--primary)">🔥 الأكثر نشاطاً</h4>
            ${topUsers.map(([name, stats]) => 
                `<div style="padding:8px; background:rgba(0,0,0,0.05); margin:3px 0; border-radius:5px; text-align:left; direction:ltr;">
                    ${name}: ${stats.questions} questions (${stats.sessions} sessions)
                </div>`
            ).join('')}
            
            <button class="btn btn-primary full-width" onclick="Data.exportAnalytics()" style="margin-top:20px;">
                📥 تصدير البيانات الكاملة (JSON)
            </button>
        `;
    },

    exportAnalytics: () => {
        get(ref(db, 'analytics')).then(snap => {
            const data = snap.val();
            const dataStr = JSON.stringify(data, null, 2);
            
            const modal = document.createElement('div');
            modal.innerHTML = `
                <div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:99999;display:flex;justify-content:center;align-items:center;padding:20px;">
                    <div style="background:#fff;padding:20px;border-radius:10px;width:100%;max-width:600px;max-height:90vh;display:flex;flex-direction:column;gap:15px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <h3 style="margin:0;color:#333">📊 Export Analytics</h3>
                            <button class="close-modal-btn" style="background:none;border:none;font-size:24px;cursor:pointer;">&times;</button>
                        </div>
                        <p style="margin:0;color:#666;font-size:14px;line-height:1.4;">
                            ⚠️ Downloads are disabled in this environment.<br>
                            Please copy the raw data below:
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
            
            const close = () => { if(document.body.contains(modal)) document.body.removeChild(modal); };
            modal.querySelector('.close-modal-btn').onclick = close;
            modal.querySelector('.close-modal-btn-main').onclick = close;
            
            document.getElementById('btn-copy').onclick = function() {
                const textArea = document.getElementById('export-area');
                textArea.select();
                
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(dataStr).then(() => {
                        this.innerText = "✅ Copied!";
                        setTimeout(() => this.innerText = "📋 Copy to Clipboard", 2000);
                    }).catch(err => {
                        document.execCommand('copy');
                        this.innerText = "✅ Copied (Manual)";
                    });
                } else {
                    document.execCommand('copy');
                    this.innerText = "✅ Copied (Legacy)";
                }
            };

        }).catch(err => {
             console.error("Firebase read error:", err);
             alert("Error fetching data: " + err.message);
        });
    }
};

// Make Data available globally
window.Data = Data;