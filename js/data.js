// data.js - Automatic migration, no user action needed

import { 
    app, auth, db, signInAnonymously, onAuthStateChanged, 
    ref, set, get, update, push, serverTimestamp, onValue, off,
    runTransaction, onDisconnect,
    ADMIN_IDS, ALLOWED_USER_IDS, THEMES, State, APP_ID, getStorageKey, 
    checkUserRole, isAdmin, isAllowedUser, hasAccess 
} from '../config.js';

const Data = {
    
    listeners: {},
    isOnline: true,
    syncQueue: [],
    migrationDone: false,
    
    initAuth: async () => {
        console.log("🔥 Initializing Firebase Auth...");
        return Promise.resolve();
    },

    showFirebaseUid: () => {
        if (window.currentUser) {
            alert("🔥 Firebase UID:\n\n" + window.currentUser.uid + 
                  "\n\n📱 Telegram ID:\n\n" + (State.user.telegram_id || 'N/A'));
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
    
    getUserId: () => {
        const teleId = State.user.telegram_id || State.user.id;
        if (teleId && teleId !== 0 && teleId !== 'anonymous') {
            return teleId.toString();
        }
        return 'anonymous_' + (window.currentUser?.uid || 'guest');
    },
    
    /**
     * MAIN INIT - Auto-migration happens here
     */
    initSync: async () => {
        console.log("🔄 Starting data sync... App ID:", APP_ID);
        
        // 1. Load local data first
        const local = {
            mistakes: JSON.parse(localStorage.getItem(getStorageKey('mistakes')) || '[]'),
            archive: JSON.parse(localStorage.getItem(getStorageKey('archive')) || '[]'),
            fav: JSON.parse(localStorage.getItem(getStorageKey('fav')) || '[]'),
            settings: JSON.parse(localStorage.getItem(getStorageKey('settings')) || '{}'),
            sessions: JSON.parse(localStorage.getItem(getStorageKey('sessions')) || '[]'),
            last_sync: parseInt(localStorage.getItem(getStorageKey('last_sync')) || '0')
        };
        State.localData = local;
        
        // Apply settings immediately
        if (State.localData.settings.theme && window.UI) {
            UI.setTheme(State.localData.settings.theme);
        }
        if (State.localData.settings.anim === false && window.UI) {
            UI.toggleAnim(false);
        }
        
        // 2. AUTO-MIGRATION: Check and migrate old data silently
        if (window.currentUser) {
            await Data.autoMigrate();
        }
        
        // 3. Setup real-time sync
        if (window.currentUser) {
            await Data.setupRealtimeSync();
        }
        
        // 4. Setup connectivity monitoring
        Data.setupConnectivityMonitoring();
        
        console.log("🔍 User:", Data.getUserId(), "| Role:", window.userRole, "| App:", APP_ID);
    },
    
    /**
     * AUTO-MIGRATION: Runs silently on startup
     * Finds old per-device data and merges into new structure
     */
    autoMigrate: async () => {
        const myTelegramId = State.user.telegram_id || State.user.id;
        
        // Skip if no Telegram ID or already migrated this session
        if (!myTelegramId || myTelegramId === 0 || Data.migrationDone) {
            return;
        }
        
        const userId = myTelegramId.toString();
        
        try {
            console.log("🔍 Checking for old data to migrate...");
            
            // Check if already migrated (new structure exists)
            const newDataSnap = await get(ref(db, 'users/' + userId));
            if (newDataSnap.exists()) {
                console.log("✅ New structure already exists, skipping migration");
                Data.migrationDone = true;
                
                // Still create auth link for this device
                await set(ref(db, 'auth_links/' + window.currentUser.uid), {
                    telegram_id: myTelegramId,
                    linked_at: serverTimestamp()
                });
                return;
            }
            
            // Get all data to find old records
            const rootSnap = await get(ref(db, '/'));
            const allData = rootSnap.val() || {};
            
            const myOldRecords = [];
            
            // Find all old Firebase UID records for this Telegram ID
            Object.keys(allData).forEach(key => {
                // Skip new structure keys
                if (['users', 'auth_links', 'admins', 'analytics', 'leaderboards', 'presence'].includes(key)) {
                    return;
                }
                
                // Skip if not a Firebase UID (long random string)
                if (key.length < 20) return;
                
                const record = allData[key];
                if (record && record.telegram_id === myTelegramId) {
                    myOldRecords.push({ key: key, data: record });
                }
            });
            
            if (myOldRecords.length === 0) {
                console.log("ℹ️ No old data found, creating fresh record");
                
                // Create new record with current local data
                const freshData = {
                    mistakes: State.localData.mistakes || [],
                    archive: State.localData.archive || [],
                    fav: State.localData.fav || [],
                    settings: State.localData.settings || {},
                    telegram_id: myTelegramId,
                    user_name: State.user.first_name,
                    last_updated: serverTimestamp(),
                    client_timestamp: Date.now(),
                    app_id: APP_ID,
                    created_fresh: true
                };
                
                await set(ref(db, 'users/' + userId), freshData);
                
            } else {
                console.log("🔄 Migrating", myOldRecords.length, "old records:", myOldRecords.map(r => r.key));
                
                // Merge all old data
                const merged = {
                    mistakes: [...(State.localData.mistakes || [])],
                    archive: [...(State.localData.archive || [])],
                    fav: [...(State.localData.fav || [])],
                    settings: { ...(State.localData.settings || {}) },
                    telegram_id: myTelegramId,
                    user_name: State.user.first_name,
                    last_updated: serverTimestamp(),
                    client_timestamp: Date.now(),
                    app_id: APP_ID,
                    auto_migrated: true,
                    migrated_from: myOldRecords.map(r => r.key),
                    migration_count: myOldRecords.length
                };
                
                // Add all old data
                myOldRecords.forEach(record => {
                    const d = record.data;
                    if (d.mistakes) merged.mistakes.push(...d.mistakes);
                    if (d.archive) merged.archive.push(...d.archive);
                    if (d.fav) merged.fav.push(...d.fav);
                    if (d.settings) merged.settings = { ...merged.settings, ...d.settings };
                });
                
                // Deduplicate
                merged.mistakes = [...new Set(merged.mistakes)];
                merged.archive = [...new Set(merged.archive)];
                merged.fav = [...new Set(merged.fav)];
                
                // Save to new structure
                await set(ref(db, 'users/' + userId), merged);
                
                console.log("✅ Migration complete! Merged:", {
                    mistakes: merged.mistakes.length,
                    archive: merged.archive.length,
                    fav: merged.fav.length
                });
                
                // Update local with merged data
                State.localData.mistakes = merged.mistakes;
                State.localData.archive = merged.archive;
                State.localData.fav = merged.fav;
                State.localData.settings = merged.settings;
                Data.saveLocalOnly();
                
                if(window.UI && window.UI.updateHomeStats) {
                    UI.updateHomeStats();
                }
            }
            
            // Create auth link for this device
            await set(ref(db, 'auth_links/' + window.currentUser.uid), {
                telegram_id: myTelegramId,
                linked_at: serverTimestamp()
            });
            
            Data.migrationDone = true;
            
        } catch (e) {
            console.error("⚠️ Auto-migration failed:", e);
            // Don't block app startup - continue with local data
        }
    },
    
    /**
     * Optional: Cleanup old data after migration (runs silently later)
     */
    cleanupOldDataSilent: async () => {
        const myTelegramId = State.user.telegram_id || State.user.id;
        if (!myTelegramId || myTelegramId === 0) return;
        
        try {
            const rootSnap = await get(ref(db, '/'));
            const allData = rootSnap.val() || {};
            
            const deletions = [];
            
            Object.keys(allData).forEach(key => {
                if (['users', 'auth_links', 'admins', 'analytics', 'leaderboards', 'presence'].includes(key)) {
                    return;
                }
                if (key.length < 20) return;
                
                const record = allData[key];
                if (record && record.telegram_id === myTelegramId) {
                    deletions.push(set(ref(db, key), null));
                }
            });
            
            if (deletions.length > 0) {
                await Promise.all(deletions);
                console.log("🗑️ Cleaned up", deletions.length, "old records");
            }
            
        } catch (e) {
            console.log("⚠️ Cleanup failed (non-critical):", e.message);
        }
    },
    
    setupRealtimeSync: async () => {
        const userId = Data.getUserId();
        
        if (userId.startsWith('anonymous_')) {
            console.log("⚠️ No Telegram ID, operating in local-only mode");
            return;
        }
        
        const userRef = ref(db, 'users/' + userId);
        
        console.log("📡 Setting up real-time sync for:", userId);
        
        if (Data.listeners.userData) {
            off(Data.listeners.userData.ref, 'value', Data.listeners.userData.callback);
        }
        
        const handleDataChange = (snapshot) => {
            const cloudData = snapshot.val();
            
            if (!cloudData) {
                console.log("☁️ No cloud data yet");
                return;
            }
            
            const cloudTime = cloudData.last_updated || 0;
            const localTime = State.localData.last_updated || 
                             parseInt(localStorage.getItem(getStorageKey('last_sync')) || '0');
            
            if (cloudTime > localTime) {
                console.log("⬇️ Updating from cloud...");
                
                State.localData = {
                    mistakes: Data.mergeArrays(State.localData.mistakes, cloudData.mistakes),
                    archive: Data.mergeArrays(State.localData.archive, cloudData.archive),
                    fav: Data.mergeArrays(State.localData.fav, cloudData.fav),
                    settings: State.localData.settings, // Keep local settings!
                    last_updated: cloudTime
                };
                
                Data.saveLocalOnly();
                
                if(window.UI && window.UI.updateHomeStats) {
                    UI.updateHomeStats();
                }
                
                Data.showSyncIndicator();
            }
        };
        
        onValue(userRef, handleDataChange);
        
        Data.listeners.userData = {
            ref: userRef,
            callback: handleDataChange
        };
    },
    
    setupConnectivityMonitoring: () => {
        window.addEventListener('online', () => {
            Data.isOnline = true;
            Data.processSyncQueue();
        });
        
        window.addEventListener('offline', () => {
            Data.isOnline = false;
        });
        
        Data.isOnline = navigator.onLine;
    },
    
    showSyncIndicator: () => {
        const indicator = document.getElementById('sync-indicator') || Data.createSyncIndicator();
        indicator.style.opacity = '1';
        setTimeout(() => indicator.style.opacity = '0', 1500);
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
    
    mergeArrays: (local, cloud) => {
        if (!cloud) return local || [];
        if (!local) return cloud || [];
        return [...new Set([...local, ...cloud])];
    },

    saveData: async (options = {}) => {
        const userId = Data.getUserId();
        
        if (userId.startsWith('anonymous_')) {
            Data.saveLocalOnly();
            return;
        }
        
        const dataToSave = {
            mistakes: State.localData.mistakes || [],
            archive: State.localData.archive || [],
            fav: State.localData.fav || [],
            // settings EXCLUDED - keep per-app
            telegram_id: State.user.telegram_id || State.user.id,
            user_name: State.user.first_name,
            last_updated: serverTimestamp(),
            client_timestamp: Date.now(),
            app_id: APP_ID
        };
        
        Data.saveLocalOnly();
        
        if (window.currentUser && Data.isOnline && !options.localOnly) {
            try {
                await update(ref(db, 'users/' + userId), dataToSave);
                console.log("💾 Saved to Firebase for user:", userId);
            } catch (e) {
                console.log("⚠️ Firebase save failed:", e.message);
                Data.queueForSync(dataToSave);
            }
        } else if (!Data.isOnline) {
            Data.queueForSync(dataToSave);
        }
    },
    
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
    
    queueForSync: (data) => {
        Data.syncQueue.push({
            data: data,
            timestamp: Date.now(),
            retries: 0
        });
        localStorage.setItem(getStorageKey('sync_queue'), JSON.stringify(Data.syncQueue));
    },
    
    processSyncQueue: async () => {
        if (!Data.isOnline) return;
        
        const queue = JSON.parse(localStorage.getItem(getStorageKey('sync_queue')) || '[]');
        if (queue.length === 0) return;
        
        const userId = Data.getUserId();
        if (userId.startsWith('anonymous_')) return;
        
        const successful = [];
        
        for (const item of queue) {
            try {
                await update(ref(db, 'users/' + userId), {
                    ...item.data,
                    last_updated: serverTimestamp()
                });
                successful.push(item);
            } catch (e) {
                item.retries++;
                if (item.retries > 3) successful.push(item);
            }
        }
        
        Data.syncQueue = queue.filter(item => !successful.includes(item));
        localStorage.setItem(getStorageKey('sync_queue'), JSON.stringify(Data.syncQueue));
    },

    /**
     * Manual migration trigger (for debugging)
     */
    forceMigrate: async () => {
        Data.migrationDone = false;
        await Data.autoMigrate();
    },
    
    /**
     * Check migration status
     */
    getMigrationStatus: () => {
        const userId = Data.getUserId();
        return {
            telegramId: userId,
            migrationDone: Data.migrationDone,
            isAnonymous: userId.startsWith('anonymous_')
        };
    },

    cleanup: () => {
        if (Data.listeners.userData) {
            off(Data.listeners.userData.ref, 'value', Data.listeners.userData.callback);
        }
    }
};

window.Data = Data;

window.addEventListener('beforeunload', () => {
    Data.cleanup();
});
