// data.js - Telegram ID only, no Firebase UID storage

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
            alert("🔥 Firebase UID (for debug only):\n\n" + window.currentUser.uid + 
                  "\n\n📱 Telegram ID (actual user ID):\n\n" + (State.user.telegram_id || 'N/A'));
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
    
    // ALWAYS use Telegram ID, never Firebase UID for data storage
    getUserId: () => {
        const teleId = State.user.telegram_id || State.user.id;
        if (teleId && teleId !== 0) {
            return teleId.toString();
        }
        // If somehow no Telegram ID, use Firebase UID temporarily but warn
        console.warn("⚠️ No Telegram ID found, using Firebase UID temporarily");
        return window.currentUser?.uid || null;
    },
    
    /**
     * MAIN INIT
     */
    initSync: async () => {
        console.log("🔄 Starting data sync... App ID:", APP_ID);
        
        // Check if we have Telegram ID
        const teleId = State.user.telegram_id || State.user.id;
        if (!teleId || teleId === 0) {
            console.log("⚠️ No Telegram ID - operating in local-only mode");
            // Still load local data
            const local = {
                mistakes: JSON.parse(localStorage.getItem(getStorageKey('mistakes')) || '[]'),
                archive: JSON.parse(localStorage.getItem(getStorageKey('archive')) || '[]'),
                fav: JSON.parse(localStorage.getItem(getStorageKey('fav')) || '[]'),
                settings: JSON.parse(localStorage.getItem(getStorageKey('settings')) || '{}'),
                sessions: JSON.parse(localStorage.getItem(getStorageKey('sessions')) || '[]'),
                last_sync: parseInt(localStorage.getItem(getStorageKey('last_sync')) || '0')
            };
            State.localData = local;
            
            if (State.localData.settings.theme && window.UI) {
                UI.setTheme(State.localData.settings.theme);
            }
            return;
        }
        
        // Load local data first
        const local = {
            mistakes: JSON.parse(localStorage.getItem(getStorageKey('mistakes')) || '[]'),
            archive: JSON.parse(localStorage.getItem(getStorageKey('archive')) || '[]'),
            fav: JSON.parse(localStorage.getItem(getStorageKey('fav')) || '[]'),
            settings: JSON.parse(localStorage.getItem(getStorageKey('settings')) || '{}'),
            sessions: JSON.parse(localStorage.getItem(getStorageKey('sessions')) || '[]'),
            last_sync: parseInt(localStorage.getItem(getStorageKey('last_sync')) || '0')
        };
        State.localData = local;
        
        // Apply settings
        if (State.localData.settings.theme && window.UI) {
            UI.setTheme(State.localData.settings.theme);
        }
        if (State.localData.settings.anim === false && window.UI) {
            UI.toggleAnim(false);
        }
        
        // Migrate old Firebase UID data to Telegram ID
        if (window.currentUser) {
            await Data.migrateFromUidToTelegramId();
        }
        
        // Setup sync
        if (window.currentUser) {
            await Data.setupRealtimeSync();
        }
        
        Data.setupConnectivityMonitoring();
        
        console.log("🔍 Telegram ID:", Data.getUserId(), "| Role:", window.userRole);
    },
    
    /**
     * MIGRATE: Move data from old Firebase UID path to Telegram ID path
     */
    migrateFromUidToTelegramId: async () => {
        const teleId = State.user.telegram_id || State.user.id;
        if (!teleId || teleId === 0) return;
        
        const userId = teleId.toString();
        const firebaseUid = window.currentUser?.uid;
        
        if (!firebaseUid) return;
        
        try {
            // Check if Telegram ID path already has data
            const teleRef = ref(db, 'users/' + userId);
            const teleSnap = await get(teleRef);
            
            if (teleSnap.exists()) {
                console.log("✅ Telegram ID path already exists, no migration needed");
                Data.migrationDone = true;
                return;
            }
            
            // Check if old Firebase UID path has data
            const uidRef = ref(db, firebaseUid); // Old flat structure
            const uidSnap = await get(uidRef);
            
            if (uidSnap.exists()) {
                const oldData = uidSnap.val();
                console.log("🔄 Migrating from Firebase UID to Telegram ID:", oldData);
                
                // Migrate to new path
                const migratedData = {
                    mistakes: oldData.mistakes || [],
                    archive: oldData.archive || [],
                    fav: oldData.fav || [],
                    settings: oldData.settings || {},
                    telegram_id: teleId,
                    user_name: State.user.first_name || oldData.user_name || "User",
                    last_updated: serverTimestamp(),
                    client_timestamp: Date.now(),
                    app_id: APP_ID,
                    migrated_from_uid: firebaseUid
                };
                
                await set(teleRef, migratedData);
                console.log("✅ Migrated to Telegram ID path");
                
                // Delete old path
                await set(uidRef, null);
                console.log("🗑️ Deleted old Firebase UID path");
                
                // Update local data
                State.localData.mistakes = migratedData.mistakes;
                State.localData.archive = migratedData.archive;
                State.localData.fav = migratedData.fav;
                State.localData.settings = migratedData.settings;
                Data.saveLocalOnly();
                
                if(window.UI && window.UI.updateHomeStats) {
                    UI.updateHomeStats();
                }
            } else {
                // No old data found, check if there are other old entries with this telegram_id
                const rootSnap = await get(ref(db, '/'));
                const allData = rootSnap.val() || {};
                
                let foundOldData = null;
                let foundKey = null;
                
                Object.keys(allData).forEach(key => {
                    // Skip known new structure keys
                    if (['users', 'auth_links', 'admins', 'analytics', 'leaderboards', 'presence'].includes(key)) {
                        return;
                    }
                    
                    const record = allData[key];
                    if (record && record.telegram_id === teleId) {
                        foundOldData = record;
                        foundKey = key;
                    }
                });
                
                if (foundOldData && foundKey) {
                    console.log("🔄 Found old data at key:", foundKey);
                    
                    const migratedData = {
                        mistakes: foundOldData.mistakes || [],
                        archive: foundOldData.archive || [],
                        fav: foundOldData.fav || [],
                        settings: foundOldData.settings || {},
                        telegram_id: teleId,
                        user_name: State.user.first_name || foundOldData.user_name || "User",
                        last_updated: serverTimestamp(),
                        client_timestamp: Date.now(),
                        app_id: APP_ID,
                        migrated_from: foundKey
                    };
                    
                    await set(teleRef, migratedData);
                    await set(ref(db, foundKey), null);
                    
                    console.log("✅ Migrated and cleaned up old key");
                    
                    State.localData.mistakes = migratedData.mistakes;
                    State.localData.archive = migratedData.archive;
                    State.localData.fav = migratedData.fav;
                    State.localData.settings = migratedData.settings;
                    Data.saveLocalOnly();
                } else {
                    console.log("ℹ️ No old data to migrate, creating fresh record");
                }
            }
            
            Data.migrationDone = true;
            
        } catch (e) {
            console.error("⚠️ Migration failed:", e);
        }
    },
    
    setupRealtimeSync: async () => {
        const userId = Data.getUserId();
        
        // Don't sync if no valid Telegram ID
        if (!userId || userId === 'null') {
            console.log("⚠️ No valid user ID, skipping cloud sync");
            return;
        }
        
        const userRef = ref(db, 'users/' + userId);
        
        console.log("📡 Setting up real-time sync for Telegram ID:", userId);
        
        if (Data.listeners.userData) {
            off(Data.listeners.userData.ref, 'value', Data.listeners.userData.callback);
        }
        
        const handleDataChange = (snapshot) => {
            const cloudData = snapshot.val();
            
            if (!cloudData) {
                console.log("☁️ No cloud data yet for this user");
                // Push local data to cloud if we have local data
                if (State.localData.archive.length > 0 || State.localData.mistakes.length > 0) {
                    console.log("📤 Pushing local data to cloud...");
                    Data.saveData();
                }
                return;
            }
            
            const cloudTime = cloudData.last_updated || 0;
            const localTime = State.localData.last_updated || 
                             parseInt(localStorage.getItem(getStorageKey('last_sync')) || '0');
            
            // Merge cloud data with local (cloud wins for arrays, local wins for settings)
            if (cloudTime > localTime || cloudTime === localTime) {
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
            } else {
                console.log("📤 Local is newer, pushing to cloud...");
                Data.saveData();
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

    // ============================================
    // FIXED saveData - Telegram ID ONLY
    // ============================================
    saveData: async (options = {}) => {
        const teleId = State.user.telegram_id || State.user.id;
        
        // ALWAYS save locally first
        Data.saveLocalOnly();
        
        // Only sync if we have Telegram ID
        if (!teleId || teleId === 0) {
            console.log("⚠️ No Telegram ID, skipping cloud sync");
            return;
        }
        
        const userId = teleId.toString();
        
        // Prepare data - telegram_id MUST match the path key
        const dataToSave = {
            mistakes: State.localData.mistakes || [],
            archive: State.localData.archive || [],
            fav: State.localData.fav || [],
            telegram_id: teleId, // This MUST equal userId (the path key)
            user_name: State.user.first_name || "User",
            last_updated: serverTimestamp(),
            client_timestamp: Date.now(),
            app_id: APP_ID
            // Settings are per-device, don't sync
        };
        
        // Check Firebase auth
        if (!window.currentUser) {
            console.log("⚠️ No Firebase auth, queuing for later");
            Data.queueForSync(dataToSave);
            return;
        }
        
        // Check online
        if (!Data.isOnline) {
            console.log("📴 Offline, queuing for later");
            Data.queueForSync(dataToSave);
            return;
        }
        
        try {
            // Use SET to ensure atomic write with all required fields
            await set(ref(db, 'users/' + userId), dataToSave);
            console.log("✅ Saved to Firebase for Telegram ID:", userId);
            
            // Clear from queue
            Data.syncQueue = Data.syncQueue.filter(item => 
                item.data.telegram_id !== teleId
            );
            localStorage.setItem(getStorageKey('sync_queue'), JSON.stringify(Data.syncQueue));
            
        } catch (e) {
            console.error("❌ Firebase save failed:", e.message);
            
            if (e.message.includes('permission_denied') || e.code === 'PERMISSION_DENIED') {
                console.error("🔒 Permission denied - check Firebase Rules");
                console.error("Path: users/" + userId);
                console.error("Data telegram_id:", dataToSave.telegram_id);
            }
            
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
        
        const teleId = State.user.telegram_id || State.user.id;
        if (!teleId || teleId === 0) return;
        
        const userId = teleId.toString();
        const successful = [];
        
        for (const item of queue) {
            try {
                await set(ref(db, 'users/' + userId), {
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

    forceMigrate: async () => {
        Data.migrationDone = false;
        await Data.migrateFromUidToTelegramId();
    },
    
    getMigrationStatus: () => {
        const teleId = State.user.telegram_id || State.user.id;
        return {
            telegramId: teleId,
            migrationDone: Data.migrationDone,
            hasFirebaseAuth: !!window.currentUser
        };
    },

    cleanup: () => {
        if (Data.listeners.userData) {
            off(Data.listeners.userData.ref, 'value', Data.listeners.userData.callback);
        }
    }
};

window.Data = Data;

// ============================================
// DEBUG FUNCTION
// ============================================
Data.debugAuth = async () => {
    console.log("=== DEBUG AUTH STATE ===");
    console.log("Telegram ID:", State.user.telegram_id);
    console.log("Computed UserId:", Data.getUserId());
    console.log("Firebase Auth:", window.currentUser ? "✅ Yes" : "❌ No");
    console.log("Firebase UID (auth only):", window.currentUser?.uid);
    console.log("Is Online:", Data.isOnline);
    console.log("Local Data:", {
        mistakes: State.localData.mistakes.length,
        archive: State.localData.archive.length,
        fav: State.localData.fav.length
    });
    
    const teleId = State.user.telegram_id || State.user.id;
    if (teleId && window.currentUser) {
        const testRef = ref(db, 'users/' + teleId);
        try {
            const snap = await get(testRef);
            console.log("Cloud data exists:", snap.exists() ? "✅ Yes" : "❌ No");
            if (snap.exists()) {
                console.log("Cloud data:", snap.val());
            }
        } catch (e) {
            console.error("❌ Read failed:", e.message);
        }
        
        try {
            await set(testRef, {
                telegram_id: teleId,
                user_name: State.user.first_name || "Test",
                last_updated: serverTimestamp(),
                test: true
            });
            console.log("✅ Write test passed");
            // Cleanup
            await update(testRef, { test: null });
        } catch (e) {
            console.error("❌ Write failed:", e.message);
        }
    }
    console.log("========================");
};

window.addEventListener('beforeunload', () => {
    Data.cleanup();
});
