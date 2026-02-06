// ============================================
// CONFIGURATION & FIREBASE SETUP
// ============================================

// APP IDENTIFIER - Change this for each app to isolate localStorage
const APP_ID = 'medquiz_v2';  // Change this for each app: 'medquiz_v1', 'medquiz_v2', etc.

// User Classification
const ADMIN_IDS = [5814737296];  // Full access including analytics
const ALLOWED_USER_IDS = [ 2004826495,];     // Access to all features except analytics

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

// Initialize Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { getDatabase, ref, set, get, update, push, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-database.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// Global State
let currentUser = null;
let userRole = 'none'; // 'admin', 'allowed', 'none'

// Theme Definitions
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

// Application State
const State = {
    user: { id: 0, first_name: "Guest", telegram_id: null },
    allQ: [], pool: [], quiz: [], qIdx: 0, score: 0, mode: 'normal',
    localData: { mistakes: [], archive: [], fav: [], settings: {}, sessions: [] },
    sel: { terms: [], subj: null, lessons: [], chapters: [], limit: 'All' },
    showIrrelevantOptions: false,
    firebaseUid: null,
    isAnonymous: true,
    sessionStartTime: null,
    answers: [],
    instantFeedback: true,
    filter: 'all',
    tempMode: 'normal',
    isRankMode: false
};

// User Role Functions
function checkUserRole(telegramId) {
    const id = Number(telegramId);
    if (ADMIN_IDS.includes(id)) {
        return 'admin';
    } else if (ALLOWED_USER_IDS.includes(id)) {
        return 'allowed';
    }
    return 'none';
}

function isAdmin() {
    return userRole === 'admin';
}

function isAllowedUser() {
    return userRole === 'admin' || userRole === 'allowed';
}

function hasAccess() {
    return userRole !== 'none';
}

// LocalStorage key helpers
function getStorageKey(key) {
    return `${APP_ID}_${key}`;
}

export { app, auth, db, signInAnonymously, onAuthStateChanged, ref, set, get, update, push, serverTimestamp,
         ADMIN_IDS, ALLOWED_USER_IDS, ENABLE_SECURITY, THEMES, State, APP_ID, getStorageKey,
         checkUserRole, isAdmin, isAllowedUser, hasAccess, userRole };
