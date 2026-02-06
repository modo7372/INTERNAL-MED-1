/* --- START OF FILE ui.js --- */

import { State, THEMES } from '../config.js';

const AVATARS = ["👨‍⚕️","👩‍⚕️","👨‍🔬","👩‍🔬","👨‍💻","👩‍💻","🦸‍♂️","🦸‍♀️","🧑‍🚀","🧙‍♂️","🧙‍♀️","👨‍🎓","👩‍🎓","👨‍⚖️","👩‍⚖️","🧠","🤖","👻","👽","🦁","🦊","🐸","🐺","🐯","🐵","🌞","🌚","🌝","😎","🤓","🕶️","🎮"];

const AudioSys = {
    ctx: null, enabled: false,
    init: () => {
        window.AudioContext = window.AudioContext || window.webkitAudioContext;
        AudioSys.ctx = new AudioContext();
    },
    playTone: (freq, type, duration) => {
        if (!AudioSys.enabled || !AudioSys.ctx) return;
        try {
            const osc = AudioSys.ctx.createOscillator();
            const gain = AudioSys.ctx.createGain();
            osc.type = type; osc.frequency.value = freq;
            osc.connect(gain); gain.connect(AudioSys.ctx.destination);
            osc.start();
            gain.gain.exponentialRampToValueAtTime(0.00001, AudioSys.ctx.currentTime + duration);
            osc.stop(AudioSys.ctx.currentTime + duration);
        } catch(e) {}
    },
    playSuccess: () => { AudioSys.playTone(600, 'sine', 0.1); setTimeout(()=>AudioSys.playTone(800, 'sine', 0.2), 100); },
    playError: () => { AudioSys.playTone(300, 'sawtooth', 0.1); setTimeout(()=>AudioSys.playTone(200, 'sawtooth', 0.2), 100); },
    playClick: () => { AudioSys.playTone(1200, 'triangle', 0.05); }
};

const UI = {
    init: () => {
        if(document.getElementById('theme-list')) UI.renderThemes();
        if(document.getElementById('avatar-list')) UI.renderAvatars();
        
        const s = State.localData.settings || {};
        UI.setTheme(s.theme || 'light');
        if(s.fontFam) UI.updateStyleVar('--font-fam', s.fontFam);
        if(s.fontSize) UI.updateStyleVar('--font-size', s.fontSize);
        
        const setCheck = (id, val) => { const el = document.getElementById(id); if(el) el.checked = val; };
        
        setCheck('chk-sound', s.sound !== false);
        setCheck('chk-haptic', s.haptic !== false);
        setCheck('chk-anim', s.anim !== false);
        
        const isAutoHideActive = (s.hideIrrelevant === undefined) ? true : s.hideIrrelevant;
        setCheck('chk-auto-hide-main', isAutoHideActive);
        State.showIrrelevantOptions = !isAutoHideActive;

        const genderEl = document.getElementById('set-gender');
        if(genderEl) genderEl.value = s.gender || 'male';
        
        UI.updateProfileDisplay();
        AudioSys.enabled = s.sound !== false;
        UI.initAnim();
        if(s.anim === false) UI.toggleAnim(false);

        document.body.addEventListener('click', () => {
            if(AudioSys.ctx && AudioSys.ctx.state === 'suspended') AudioSys.ctx.resume();
            if(!AudioSys.ctx) AudioSys.init();
        }, {once:true});
    },

    updateHomeStats: () => {
        const total = State.allQ.length;
        if (total === 0) return;
        const solved = State.localData.archive.length;
        const mistakesCnt = State.localData.archive.filter(id => State.localData.mistakes.includes(id)).length;
        const correct = solved - mistakesCnt;
        const pct = Math.round((correct / total) * 100) || 0;
        const degrees = (pct / 100) * 360;
        const elTotal = document.getElementById('home-total');
        const elCorrect = document.getElementById('home-correct');
        const elPct = document.getElementById('home-pct');
        const elRing = document.getElementById('home-progress-ring');
        if(elTotal) elTotal.innerText = total;
        if(elCorrect) elCorrect.innerText = correct;
        if(elPct) elPct.innerText = `${pct}%`;
        if(elRing) elRing.style.background = `conic-gradient(var(--success) ${degrees}deg, rgba(0,0,0,0.1) 0deg)`;
    },

    renderThemes: () => {
        const c = document.getElementById('theme-list');
        if(!c) return;
        c.innerHTML = '';
        THEMES.forEach(t => {
            const d = document.createElement('div');
            d.className = 'theme-preview';
            d.style.background = t.color;
            d.onclick = () => UI.setTheme(t.id);
            c.appendChild(d);
        });
    },

    renderAvatars: () => {
        const c = document.getElementById('avatar-list');
        if(!c) return;
        c.innerHTML = '';
        AVATARS.forEach(a => {
            const d = document.createElement('div');
            d.className = 'avatar-opt';
            d.innerText = a;
            d.onclick = () => {
                document.querySelectorAll('.avatar-opt').forEach(x=>x.classList.remove('selected'));
                d.classList.add('selected');
                UI.saveSetting('avatar', a);
                UI.updateProfileDisplay();
            };
            c.appendChild(d);
        });
    },

    updateProfileDisplay: () => {
        const s = State.localData.settings || {};
        const av = s.avatar || (s.gender === 'female' ? "👩‍⚕️" : "👨‍⚕️");
        const elAv = document.getElementById('u-avatar');
        const elName = document.getElementById('u-name');
        if(elAv) elAv.innerText = av;
        if(elName) elName.innerText = State.user.first_name || "Guest";
    },

    saveProfile: () => {
        const genderEl = document.getElementById('set-gender');
        if(genderEl) {
            UI.saveSetting('gender', genderEl.value);
            UI.updateProfileDisplay();
        }
    },

    showTotalStats: () => {
        const total = State.allQ.length;
        if(total === 0) return alert('البيانات غير محملة');
        const solved = State.localData.archive.length;
        const wrongCnt = State.localData.archive.filter(id => State.localData.mistakes.includes(id)).length;
        const correctCnt = solved - wrongCnt;
        document.getElementById('st-total').innerText = total;
        document.getElementById('st-solved').innerText = Math.round((solved/total)*100) + '%';
        document.getElementById('st-correct').innerText = correctCnt;
        document.getElementById('st-wrong').innerText = wrongCnt;
        const acc = solved > 0 ? Math.round((correctCnt/solved)*100) : 0;
        document.getElementById('st-acc').innerText = acc + '%';
        const bar = document.getElementById('st-bar');
        if(bar) bar.style.width = acc + '%';
        UI.openModal('m-stats');
    },

    showView: (id) => {
        ['v-home','v-select','v-quiz','v-pdf'].forEach(v => {
            const el = document.getElementById(v);
            if(el) el.classList.add('hidden');
        });
        const el = document.getElementById(id);
        if(el) {
            el.classList.remove('hidden');
            el.style.display = (id === 'v-home') ? 'grid' : 'flex';
        }
    },

    goHome: () => { 
        if(window.Game && window.Game.stopTimer) Game.stopTimer(); 
        UI.showView('v-home'); 
        UI.closeModal('m-score'); 
        UI.updateHomeStats(); 
    },
    
    openModal: (id) => { 
        const el = document.getElementById(id); 
        if(el) el.style.display = 'flex'; 
    },
    
    closeModal: (id) => { 
        const el = document.getElementById(id); 
        if(el) el.style.display = 'none'; 
    },

    setTheme: (t) => {
        document.body.setAttribute('data-theme', t);
        document.querySelectorAll('.theme-preview').forEach(e => e.classList.remove('active'));
        const active = document.querySelector(`.theme-preview[style*="${THEMES.find(x=>x.id==t)?.color}"]`);
        if(active) active.classList.add('active');
        UI.saveSetting('theme', t);
    },

    toggleSound: (v) => { AudioSys.enabled = v; UI.saveSetting('sound', v); },
    toggleHaptic: (v) => { UI.saveSetting('haptic', v); },
    
    toggleAutoHide: (v) => { 
        UI.saveSetting('hideIrrelevant', v); 
        State.showIrrelevantOptions = !v; 
    },
    
    toggleAnim: (v) => { 
        const cvs = document.getElementById('bg-canvas');
        if(v && cvs) cvs.classList.remove('hidden'); 
        else if(cvs) cvs.classList.add('hidden');
        UI.saveSetting('anim', v); 
    },

    updateStyleVar: (key, val) => {
        document.documentElement.style.setProperty(key, val);
        if(key === '--font-fam') UI.saveSetting('fontFam', val);
        if(key === '--font-size') UI.saveSetting('fontSize', val);
    },

    saveSetting: (key, val) => {
        State.localData.settings = State.localData.settings || {};
        State.localData.settings[key] = val;
        if(window.Data && window.Data.saveData) window.Data.saveData(); 
    },

    initAnim: (randomize = false) => {
        const c=document.getElementById('bg-canvas');
        if(!c) return;
        const x=c.getContext('2d');
        let w,h,p=[]; 
        const r=()=>{w=c.width=window.innerWidth;h=c.height=window.innerHeight;}; 
        window.onresize=r; r();
        class P{
            constructor(){this.i();} 
            i(){
                this.x=Math.random()*w;
                this.y=h+Math.random()*100; 
                this.r=Math.random()*15 + 5; 
                this.vx=(Math.random()-.5)*1; 
                this.vy=-(Math.random()*1 + 0.5); 
                this.a = Math.random() * 0.3;
                this.type = randomize ? Math.floor(Math.random()*3) : 0; 
            } 
            u(){ this.x+=this.vx; this.y+=this.vy; if(this.y < -50) this.i(); } 
            d(){
                x.fillStyle=`rgba(120,120,120,${this.a})`;
                x.beginPath();
                if(this.type === 0) x.arc(this.x,this.y,this.r,0,Math.PI*2);
                else if (this.type === 1) x.fillRect(this.x, this.y, this.r*1.5, this.r*1.5);
                else { x.moveTo(this.x, this.y); x.lineTo(this.x+this.r, this.y+this.r*2); x.lineTo(this.x-this.r, this.y+this.r*2); }
                x.fill();
            }
        }
        p=Array(25).fill().map(()=>new P()); 
        function a(){ x.clearRect(0,0,w,h); p.forEach(n=>{n.u();n.d()}); requestAnimationFrame(a); } 
        a();
    }
};

// Make UI and AudioSys available globally
window.UI = UI;
window.AudioSys = AudioSys;