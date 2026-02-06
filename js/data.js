// data.js - Fixed: Use Telegram ID as primary key for cross-device sync
// Firebase data per TELEGRAM ID (not Firebase Auth UID), localStorage per APP

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
    
    /**
     * Initialize Firebase anonymous authentication
     */
    initAuth: async () => {
        console.log("🔥 Initializing Firebase Auth...");
        return Promise.resolve();
    },

    /**
     * Show Firebase UID for debugging (optional)
     */
    showFirebaseUid: () => {
        if (window.currentUser) {
            alert("🔥 Firebase UID:\n\n" + window.currentUser.uid + 
                  "\n\n📱 Telegram ID:\n\n" + (State.user.telegram_id || 'N/A'));
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
     * Get consistent user ID (Telegram ID only, never Firebase Auth UID)
     */
    getUserId: () => {
        // ALWAYS use Telegram ID as the primary identifier
        const teleId = State.user.telegram_id || State.user.id;
        if (teleId && teleId !== 0 && teleId !== 'anonymous') {
            return teleId.toString();
        }
        // Fallback only for anonymous users without Telegram
        return 'anonymous_' + (window.currentUser?.uid || 'guest');
    },
    
    /**
     * Initialize data synchronization
     */
    initSync: async () => {
        console.log("🔄 Starting data sync... App ID:", APP_ID);
        
        // 1. Load local data first (per-app isolation)
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
        
        // 2. Setup real-time sync with Firebase (by TELEGRAM ID)
        if (window.currentUser) {
            await Data.setupRealtimeSync();
        }
        
        // 3. Setup connectivity monitoring
        Data.setupConnectivityMonitoring();
        
        console.log("🔍 User:", Data.getUserId(), "| Role:", window.userRole, "| App:", APP_ID);
    },
    
    /**
     * Setup real-time listeners - KEY FIX: Use Telegram ID as path
     */
    setupRealtimeSync: async () => {
        const userId = Data.getUserId();
        
        // CRITICAL: Skip if we don't have a real Telegram ID
        if (userId.startsWith('anonymous_')) {
            console.log("⚠️ No Telegram ID, operating in local-only mode");
            return;
        }
        
        const userRef = ref(db, 'users/' + userId);  // FIXED: Telegram ID as key
        
        console.log("📡 Setting up real-time sync for Telegram user:", userId);
        
        // Remove existing listener
        if (Data.listeners.userData) {
            off(Data.listeners.userData.ref, 'value', Data.listeners.userData.callback);
        }
        
        // Real-time listener
        const handleDataChange = (snapshot) => {
            const cloudData = snapshot.val();
            
            if (!cloudData) {
                console.log("☁️ No cloud data, pushing local...");
                Data.saveData();
                return;
            }
            
            const cloudTime = cloudData.last_updated || 0;
            const localTime = State.localData.last_updated || 
                             parseInt(localStorage.getItem(getStorageKey('last_sync')) || '0');
            
            console.log("📊 Sync - Cloud:", new Date(cloudTime), "| Local:", new Date(localTime));
            
            if (cloudTime > localTime) {
                console.log("⬇️ Updating from cloud...");
                
                State.localData = {
                    mistakes: Data.mergeArrays(State.localData.mistakes, cloudData.mistakes),
                    archive: Data.mergeArrays(State.localData.archive, cloudData.archive),
                    fav: Data.mergeArrays(State.localData.fav, cloudData.fav),
                    settings: { ...cloudData.settings, ...State.localData.settings },
                    sessions: cloudData.sessions || State.localData.sessions,
                    last_updated: cloudTime
                };
                
                Data.saveLocalOnly();
                
                if(window.UI && window.UI.updateHomeStats) {
                    UI.updateHomeStats();
                }
                
                Data.showSyncIndicator();
            } else if (cloudTime < localTime) {
                console.log("⬆️ Pushing local to cloud...");
                Data.saveData();
            }
        };
        
        onValue(userRef, handleDataChange);
        
        Data.listeners.userData = {
            ref: userRef,
            callback: handleDataChange
        };
        
        // Link Firebase Auth UID to Telegram ID for reference (optional)
        if (window.currentUser) {
            await set(ref(db, 'auth_links/' + window.currentUser.uid), {
                telegram_id: State.user.telegram_id || State.user.id,
                name: State.user.first_name,
                linked_at: serverTimestamp()
            });
        }
    },
    
    /**
     * Setup connectivity monitoring
     */
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

    /**
     * Save data - KEY FIX: Use Telegram ID as path
     */
    saveData: async (options = {}) => {
        const userId = Data.getUserId();
        
        // Skip Firebase save if no real Telegram ID
        if (userId.startsWith('anonymous_')) {
            console.log("📴 Anonymous user, saving local only");
            Data.saveLocalOnly();
            return;
        }
        
        const now = Date.now();
        
        const dataToSave = {
            mistakes: State.localData.mistakes || [],
            archive: State.localData.archive || [],
            fav: State.localData.fav || [],
            settings: State.localData.settings || {},
            telegram_id: State.user.telegram_id || State.user.id,
            user_name: State.user.first_name,
            last_updated: serverTimestamp(),
            client_timestamp: now,
            app_id: APP_ID,
            firebase_uid: window.currentUser?.uid || null  // Reference only
        };
        
        // 1. Always save to localStorage (per-app)
        Data.saveLocalOnly();
        
        // 2. Save to Firebase by TELEGRAM ID (cross-device)
        if (window.currentUser && Data.isOnline && !options.localOnly) {
            try {
                await update(ref(db, 'users/' + userId), dataToSave);  // FIXED: Telegram ID path
                
                console.log("💾 Saved to Firebase for Telegram user:", userId);
                localStorage.setItem(getStorageKey('last_sync'), now.toString());
                State.localData.last_updated = now;
                
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
        
        console.log("🔄 Processing queue:", queue.length, "items");
        
        const successful = [];
        
        for (const item of queue) {
            try {
                await update(ref(db, 'users/' + userId), {  // FIXED: Telegram ID path
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
     * Cleanup listeners
     */
    cleanup: () => {
        if (Data.listeners.userData) {
            off(Data.listeners.userData.ref, 'value', Data.listeners.userData.callback);
        }
    }
};

// Make Data available globally
window.Data = Data;

window.addEventListener('beforeunload', () => {
    Data.cleanup();
});
