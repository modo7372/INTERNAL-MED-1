// ============================================
// CONFIGURATION & FIREBASE SETUP
// ============================================

// APP IDENTIFIER - Change this for each app to isolate localStorage
const APP_ID = 'medquiz_v2';  // Change this for each app: 'medquiz_v1', 'medquiz_v2', etc.

// User Classification
const ADMIN_IDS = [5814737296];  // Full access including analytics
const ALLOWED_USER_IDS = [2004826495];     // Access to all features except analytics

const ENABLE_SECURITY = false;

// Firebase Configuration - New Project
const firebaseConfig = {
    apiKey: "AIzaSyCq-kT9ZVtt4H9uIgmaCgFfCCmVm-uZ5Jk",
    authDomain: "med-2-ceb9e.firebaseapp.com",
    databaseURL: "https://med-2-ceb9e-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "med-2-ceb9e",
    storageBucket: "med-2-ceb9e.firebasestorage.app",
    messagingSenderId: "321876645657",
    appId: "1:321876645657:web:4cfe8847da303908345788"
};

// ============================================
// FIREBASE IMPORTS - Modular SDK v10.7.0
// ============================================

// Core Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";

// Authentication
import { 
    getAuth, 
    signInAnonymously, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";

// Realtime Database - All necessary functions
import { 
    getDatabase, 
    ref, 
    set, 
    get, 
    update, 
    push, 
    serverTimestamp,
    onValue,           // NEW: Real-time listener
    off,               // NEW: Remove listener
    runTransaction,    // NEW: Atomic transactions
    onDisconnect       // NEW: Presence/connection handling
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-database.js";

// ============================================
// FIREBASE INITIALIZATION
// ============================================

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// ============================================
// GLOBAL STATE
// ============================================

let currentUser = null;
let userRole = 'none'; // 'admin', 'allowed', 'none'

// ============================================
// THEME DEFINITIONS
// ============================================

const THEMES = [
    { id: 'light', name: 'Light', color: '#f5f7fa' },
    { id: 'dark', name: 'Dark', color: '#232526' },
    { id: 'midnight', name: 'Midnight', color: '#0f2027' },
    { id: 'forest', name: 'Forest', color: '#134E5E' },
    { id: 'ocean', name: 'Ocean', color: '#4facfe' },
    { id: 'sunset', name: 'Sunset', color: '#fda085' },
    { id: 'lavender', name: 'Lavender', color: '#cd9cf2' },
    { id: 'coffee', name: 'Coffee', color: '#3e2b26' },
    { id: 'hacker', name: 'Hacker', color: '#000000' },
    { id: 'minimal', name: 'Minimal', color: '#ffffff' },
    { id: "crimson", name: "Crimson", color: "linear-gradient(135deg, #1f1c18 0%, #8a2323 100%)" },
    { id: "mint", name: "Mint", color: "linear-gradient(120deg, #e0f2f1 0%, #b2dfdb 100%)" },
    { id: "cyberpunk", name: "Cyberpunk", color: "linear-gradient(160deg, #0b0213 0%, #200d3d 100%)" }
];

// ============================================
// APPLICATION STATE
// ============================================

const State = {
    user: { id: 0, first_name: "Guest", telegram_id: null },
    allQ: [], 
    pool: [], 
    quiz: [], 
    qIdx: 0, 
    score: 0, 
    mode: 'normal',
    localData: { 
        mistakes: [], 
        archive: [], 
        fav: [], 
        settings: {}, 
        sessions: [],
        last_updated: 0
    },
    sel: { 
        terms: [], 
        subj: null, 
        lessons: [], 
        chapters: [], 
        limit: 'All' 
    },
    showIrrelevantOptions: false,
    firebaseUid: null,
    isAnonymous: true,
    sessionStartTime: null,
    answers: [],
    instantFeedback: true,
    filter: 'all',
    tempMode: 'normal',
    isRankMode: false,
    isOnline: true
};

// ============================================
// USER ROLE FUNCTIONS
// ============================================

/**
 * Check user role based on Telegram ID
 * @param {number} telegramId - Telegram user ID
 * @returns {string} 'admin', 'allowed', or 'none'
 */
function checkUserRole(telegramId) {
    const id = Number(telegramId);
    if (ADMIN_IDS.includes(id)) {
        return 'admin';
    } else if (ALLOWED_USER_IDS.includes(id)) {
        return 'allowed';
    }
    return 'none';
}

/**
 * Check if current user is admin
 * @returns {boolean}
 */
function isAdmin() {
    return userRole === 'admin';
}

/**
 * Check if current user is allowed (admin or allowed list)
 * @returns {boolean}
 */
function isAllowedUser() {
    return userRole === 'admin' || userRole === 'allowed';
}

/**
 * Check if user has any access
 * @returns {boolean}
 */
function hasAccess() {
    return userRole !== 'none';
}

// ============================================
// LOCALSTORAGE HELPER FUNCTIONS
// ============================================

/**
 * Generate per-app localStorage key
 * @param {string} key - Base key name
 * @returns {string} Prefixed key with APP_ID
 */
function getStorageKey(key) {
    return `${APP_ID}_${key}`;
}

/**
 * Clear all data for current app (useful for logout/reset)
 */
function clearAppData() {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(APP_ID + '_')) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
    console.log("🗑️ Cleared", keysToRemove.length, "app data keys");
}

/**
 * Get all app data as object (for export/backup)
 */
function getAllAppData() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(APP_ID + '_')) {
            const shortKey = key.replace(APP_ID + '_', '');
            try {
                data[shortKey] = JSON.parse(localStorage.getItem(key));
            } catch {
                data[shortKey] = localStorage.getItem(key);
            }
        }
    }
    return data;
}

/**
 * Restore app data from object (for import/restore)
 */
function setAllAppData(data) {
    Object.entries(data).forEach(([key, value]) => {
        const fullKey = getStorageKey(key);
        if (typeof value === 'object') {
            localStorage.setItem(fullKey, JSON.stringify(value));
        } else {
            localStorage.setItem(fullKey, value);
        }
    });
}

// ============================================
// FIREBASE CONNECTION MONITORING
// ============================================

/**
 * Setup global connection state monitoring
 */
function setupFirebaseMonitoring() {
    const connectedRef = ref(db, '.info/connected');
    onValue(connectedRef, (snap) => {
        State.isOnline = snap.val() === true;
        if (State.isOnline) {
            console.log("🟢 Firebase connected");
        } else {
            console.log("🔴 Firebase disconnected - operating offline");
        }
    });
}

// Initialize monitoring
setupFirebaseMonitoring();

// ============================================
// EXPORTS
// ============================================

export { 
    // Firebase instances
    app, 
    auth, 
    db,
    
    // Firebase Auth functions
    signInAnonymously, 
    onAuthStateChanged,
    
    // Firebase Database functions - Core
    ref, 
    set, 
    get, 
    update, 
    push, 
    serverTimestamp,
    
    // Firebase Database functions - Real-time & Advanced (NEW)
    onValue,           // Real-time data listener
    off,               // Remove listeners
    runTransaction,    // Atomic transactions
    onDisconnect,      // Presence/connection handling
    
    // App configuration
    APP_ID,
    
    // User management
    ADMIN_IDS, 
    ALLOWED_USER_IDS, 
    ENABLE_SECURITY,
    
    // UI/Theming
    THEMES,
    
    // Application state
    State,
    
    // Helper functions
    getStorageKey,
    clearAppData,
    getAllAppData,
    setAllAppData,
    
    // User role functions
    checkUserRole, 
    isAdmin, 
    isAllowedUser, 
    hasAccess,
    
    // Mutable exports (use with caution)
    userRole
};
