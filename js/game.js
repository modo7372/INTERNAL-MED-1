/* --- START OF FILE game.js --- */

let tInt; let cStep = ''; let autoNavTimer = null;
let navHistory = [];

const Game = {
    triggerHaptic: (type) => {
        if(State.localData.settings?.haptic === false) return;
        if (window.Telegram.WebApp.isVersionAtLeast && window.Telegram.WebApp.isVersionAtLeast('6.1')) {
            try {
                if(type === 'success') Telegram.WebApp.HapticFeedback.notificationOccurred('success');
                else if(type === 'error') Telegram.WebApp.HapticFeedback.notificationOccurred('error');
                else Telegram.WebApp.HapticFeedback.selectionChanged();
            } catch(e){}
        }
    },
    
    shareApp: () => {
        Game.triggerHaptic('selection');
        const botLink = "https://t.me/YourBotName/app"; 
        const msg = "تطبيق ممتاز لأسئلة الجراحة والميدكال، جربه الآن! 🔥👨‍⚕️";
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(botLink)}&text=${encodeURIComponent(msg)}`;
        if (window.Telegram && window.Telegram.WebApp) Telegram.WebApp.openTelegramLink(shareUrl);
        else window.open(shareUrl, '_blank');
    },
    
    randomizeUI: () => {
        Game.triggerHaptic('selection');
        const rndTheme = THEMES[Math.floor(Math.random() * THEMES.length)];
        UI.setTheme(rndTheme.id);
        UI.initAnim(true); 
    },
    
    toggleInstant: (val) => { State.instantFeedback = val; },
    
    confirmExit: () => { 
        if(document.getElementById('app-wrap').classList.contains('zen-mode-active')) {
            Game.toggleZenMode(false);
        }
        if(confirm('هل تريد الخروج والعودة للقائمة الرئيسية؟')) UI.goHome(); 
    },

    toggleZenMode: (force) => {
        const container = document.getElementById('app-wrap'); 
        const button = document.getElementById('btn-zen-mode');
        
        let shouldActivate;
        if (typeof force === 'boolean') {
            shouldActivate = force;
        } else {
            shouldActivate = !container.classList.contains('zen-mode-active');
        }

        container.classList.toggle('zen-mode-active', shouldActivate);
        
        if (shouldActivate) {
            button.innerHTML = '🧘‍♀️ الخروج من وضع زين';
            button.classList.add('zen-active-btn');
            Game.triggerHaptic('success');
        } else {
            button.innerHTML = '🧘 وضع زين';
            button.classList.remove('zen-active-btn');
            Game.triggerHaptic('selection');
        }
    },

    setFilter: (f, el) => {
        State.filter = f;
        document.querySelectorAll('#filter-opts .chip').forEach(c => c.classList.remove('selected'));
        el.classList.add('selected');
    },

    getFilteredPool: () => {
        let p = [...State.allQ];
        const mist = State.localData.mistakes;
        const arch = State.localData.archive;
        if(State.filter === 'new') p = p.filter(q => !arch.includes(q.id));
        else if(State.filter === 'wrong') p = p.filter(q => mist.includes(q.id));
        else if(State.filter === 'answered') p = p.filter(q => arch.includes(q.id));
        return p;
    },

    luckyShot: () => {
        let pool = Game.getFilteredPool();
        if(!pool.length) return alert('لا توجد أسئلة متاحة حسب الفلتر المختار.');
        const q = pool[Math.floor(Math.random() * pool.length)];
        Game.startQuizSession([q], 'lucky');
    },
    
    startGlobalRandom: () => {
        let sub = Game.getFilteredPool();
        if(!sub.length) return alert('القائمة فارغة حسب الفلتر المختار.');
        sub.sort(() => 0.5 - Math.random());
        const count = Math.floor(Math.random() * 50) + 1;
        Game.startQuizSession(sub.slice(0, count), 'normal');
    },
    
    startFavMode: () => {
        const favs = State.localData.fav;
        if(!favs.length) return alert('قائمة المفضلة فارغة!');
        const pool = State.allQ.filter(q => favs.includes(q.id));
        Game.startQuizSession(pool, 'normal');
    },
    
    // SIMPLIFIED: Skip term selection, go directly to subjects
    startFlow: (m) => {
        State.tempMode = m; 
        State.isRankMode = false;
        State.pool = Game.getFilteredPool();
        if(m === 'mistakes') State.pool = State.pool.filter(q => State.localData.mistakes.includes(q.id));
        if(!State.pool.length) return alert('لا توجد أسئلة متاحة.');
        
        // Reset state - no term selection needed
        State.sel = {terms: [], subj: null, lessons: [], chapters: [], limit: 'All'};
        navHistory = []; 
        
        // Skip term, go directly to subject selection
        Game.renderSel('subj');
    },
    
    startRankMode: () => {
        State.isRankMode = true; 
        State.pool = State.allQ; 
        // For rank mode, we still need to select term and subject
        State.sel = {terms: [], subj: null, lessons: [], chapters: [], limit: 'All'}; 
        navHistory = [];
        Game.renderSel('term');
    },
    
    startRandomInMode: () => {
        let sub = State.pool;
        // No term filtering needed anymore
        if(State.sel.subj) sub = sub.filter(q => q.subject === State.sel.subj);
        if(State.sel.lessons.length) sub = sub.filter(q => State.sel.lessons.includes(q.lesson));
        
        if(!sub.length) return alert('لا توجد أسئلة هنا');
        sub.sort(() => 0.5 - Math.random());
        const count = Math.floor(Math.random() * 50) + 1;
        Game.startQuizSession(sub.slice(0, count), State.tempMode || 'normal');
    },

    renderSel: (step) => {
        // Record navigation step
        if (cStep && cStep !== step && !navHistory.includes(cStep)) { 
             navHistory.push(cStep);
        }
        
        cStep = step; 
        UI.showView('v-select');
        const list = document.getElementById('sel-body'); 
        list.innerHTML='';
        
        const titleMap = {'term':'الترم','subj':'المادة','lesson':'المحاضرة','chapter':'الفصل','limit':'العدد'};
        
        const prefix = State.isRankMode ? "ترتيب: " : "اختر ";
        document.getElementById('sel-head').innerText = `${prefix} ${titleMap[step] || step}`;
        
        const btnRnd = document.getElementById('btn-mode-random');
        const btnAll = document.getElementById('btn-all');

        if (btnRnd) btnRnd.classList.add('hidden');
        if (btnAll) btnAll.classList.add('hidden');

        let sub = [...State.pool];
        
        // Filter by selected subject if any
        if(State.sel.subj) sub = sub.filter(q => q.subject === State.sel.subj);
        if(State.sel.lessons.length) sub = sub.filter(q => State.sel.lessons.includes(q.lesson));
        
        if(!State.isRankMode && step !== 'limit' && step !== 'subj' && btnRnd) {
             btnRnd.classList.remove('hidden');
             btnRnd.innerText = `🎲 امتحان عشوائي من الـ ${titleMap[step] || step} الحالية`;
        }

        let items=[], isMulti=false;

        if(step==='term') {
            // Only for rank mode
            items=[...new Set(sub.map(q=>q.term))]; 
            isMulti = false; 
        }
        else if(step==='subj') {
            // Get all subjects from all terms (no term filtering)
            items=[...new Set(sub.map(q=>q.subject))];
            isMulti = false;
            
            // If only one subject, auto-select and go to lessons
            if(items.length === 1 && !State.isRankMode) { 
                State.sel.subj = items[0];
                navHistory.push(cStep);
                return Game.renderSel('lesson');
            }
        }
        else if(step==='lesson') { 
            if(State.isRankMode) return Game.showRank(); 
            items=[...new Set(sub.map(q=>q.lesson))]; 
            isMulti=true;
            
            // If only one lesson, auto-select and skip to limit (auto-select all chapters)
            if(items.length === 1) {
                State.sel.lessons = [items[0]];
                // Auto-select all chapters for this lesson
                const allChapters = [...new Set(sub.filter(q=>q.lesson===items[0]).map(q=>q.chapter))];
                State.sel.chapters = allChapters;
                navHistory.push(cStep);
                return Game.renderSel('limit');
            }
            
            State.sel.lessons = []; 
            if (btnAll) btnAll.classList.remove('hidden');
        }
        else if(step==='chapter') {
            // This step is now skipped - chapters are auto-selected
            isMulti=true;
            
            const currentLessons = State.sel.lessons;
            State.sel.chapters = []; 
            
            currentLessons.forEach(l => {
                const lDiv = document.createElement('div');
                lDiv.innerHTML = `<div style="position:sticky; top:0; background:var(--glass-bg); padding:5px; z-index:2; font-weight:bold; color:var(--primary); border-bottom:1px solid #ccc;">📂 ${l}</div>`;
                const g = document.createElement('div'); g.className='chip-grid'; g.style.padding='5px';
                [...new Set(sub.filter(q=>q.lesson===l).map(q=>q.chapter))].forEach(ch => {
                    const c = Game.createChip(ch, true);
                    g.appendChild(c);
                });
                lDiv.appendChild(g);
                list.appendChild(lDiv);
            });
            if (btnAll) btnAll.classList.remove('hidden');
            return;
        }
        
        else if(step==='limit') {
            ['10','20','30','50','All'].forEach(l => {
                const b = document.createElement('div'); 
                b.className='chip'; 
                b.innerText=l;
                b.dataset.val = l;
        
                b.onclick = () => { 
                    document.querySelectorAll('.chip').forEach(c=>c.classList.remove('selected'));
                    b.classList.add('selected');
                    State.sel.limit=l; 
                };
                if (State.sel.limit === 'All' && l === 'All') b.classList.add('selected');
                list.appendChild(b);
            });
            return;
        }

        // Render generic chips
        const g = document.createElement('div'); g.className='chip-grid';
        items.sort().forEach(i => {
            const chip = Game.createChip(i, isMulti);
            if (!isMulti) {
                if (step === 'term' && State.sel.terms.includes(i)) chip.classList.add('selected');
                else if (step === 'subj' && State.sel.subj === i) chip.classList.add('selected');
                else if (State.isRankMode && State.sel.terms[0] === i) chip.classList.add('selected');
            }
            g.appendChild(chip);
        });
        list.appendChild(g);
    },

    createChip: (val, multi) => {
        const c = document.createElement('div'); c.className='chip'; c.innerText=val; c.dataset.val=val;
        c.onclick = () => {
            Game.triggerHaptic('selection');
            if(multi) {
                c.classList.toggle('selected');
            } else {
                document.querySelectorAll('.chip').forEach(ch=>ch.classList.remove('selected'));
                c.classList.add('selected');
            }
        };
        return c;
    },

    nextSel: () => {
        const picked = Array.from(document.querySelectorAll('#sel-body .chip.selected')).map(c=>c.dataset.val);
        
        if(cStep === 'term') {
             if(picked.length !== 1) return alert('الرجاء اختيار ترم واحد');
             
             State.sel.subj = null;
             State.sel.lessons = [];
             State.sel.chapters = [];
             
             if (State.isRankMode) {
                 State.sel.terms = picked;
             } else {
                 State.sel.terms = picked;
             }
             Game.renderSel('subj');
             
        } else if(cStep === 'subj') { 
             if(picked.length !== 1) return alert('الرجاء اختيار مادة واحدة فقط');
             
             State.sel.lessons = [];
             State.sel.chapters = [];
             
             State.sel.subj = picked[0];
             Game.renderSel('lesson');

        } else if(cStep === 'lesson') { 
            if(!picked.length) return alert('اختر محاضرة واحدة على الأقل'); 
            
            State.sel.chapters = [];
            State.sel.lessons=picked; 
            
            // Auto-select all chapters for selected lessons
            let sub = [...State.pool];
            if(State.sel.subj) sub = sub.filter(q => q.subject === State.sel.subj);
            
            const allChapters = [];
            picked.forEach(lesson => {
                const lessonChapters = [...new Set(sub.filter(q=>q.lesson===lesson).map(q=>q.chapter))];
                allChapters.push(...lessonChapters);
            });
            State.sel.chapters = [...new Set(allChapters)]; // Remove duplicates
            
            // Skip chapter selection, go directly to limit
            Game.renderSel('limit'); 
            
        } else if(cStep === 'chapter') { 
            if(!picked.length) return alert('اختر فصلاً واحداً على الأقل'); 
            State.sel.chapters=picked; 
            Game.renderSel('limit'); 
            
        } else if(cStep === 'limit') {
            let limit = State.sel.limit;
            if (limit !== 'All' && picked.length === 1) {
                limit = picked[0];
                State.sel.limit = limit;
            }
            
            Game.initQuiz();
        }
    },
    
    prevSel: () => {
        if (navHistory.length === 0) {
            return UI.goHome();
        }

        const currentStep = cStep;
        const previousStepInHistory = navHistory.pop();

        // Clear current step data
        if (currentStep === 'limit') State.sel.limit = 'All';
        else if (currentStep === 'chapter') State.sel.chapters = [];
        else if (currentStep === 'lesson') State.sel.lessons = [];
        else if (currentStep === 'subj') State.sel.subj = null;
        else if (currentStep === 'term') State.sel.terms = [];

        Game.renderSel(previousStepInHistory);
    },

    toggleAll: () => document.querySelectorAll('.chip').forEach(c => c.classList.toggle('selected')),

    initQuiz: () => {
        // Filter pool based on selections (no term filtering)
        let filteredPool = State.pool.filter(q => 
            State.sel.subj === q.subject && 
            State.sel.lessons.some(l => q.lesson === l) && 
            State.sel.chapters.some(c => q.chapter === c)
        );

        // Shuffle
        filteredPool.sort(() => 0.5 - Math.random());

        // Apply limit
        let quizQuestions;
        if (State.sel.limit !== 'All') {
            const limit = parseInt(State.sel.limit, 10);
            quizQuestions = filteredPool.slice(0, limit);
        } else {
            quizQuestions = filteredPool;
        }

        Game.startQuizSession(quizQuestions, State.tempMode || 'normal');
    },

    startQuizSession: (questions, mode) => {
        if (!questions || questions.length === 0) {
            alert('لا توجد أسئلة تطابق معايير البحث. ستتم إعادتك للقائمة الرئيسية.');
            return UI.goHome();
        }

        State.quiz = questions;
        State.qIdx = 0;
        State.score = 0;
        State.answers = new Array(questions.length).fill(null).map(() => ({ answered: false, selectedIdx: null, isCorrect: false }));
        State.instantFeedback = document.getElementById('chk-instant').checked;
        State.showIrrelevantOptions = !(State.localData.settings?.hideIrrelevant === true);

        UI.showView('v-quiz');
        UI.initAnim(true);
        if(mode === 'timeAttack') Game.startTimer();
        else document.getElementById('timer-bar').style.display='none';

        const isSearchOrView = (mode === 'view_mode' || mode === 'search_mode');
        document.getElementById('btn-finish').style.display = isSearchOrView ? 'none' : 'inline-block';
        document.getElementById('archive-controls').classList.toggle('hidden', !isSearchOrView);
        document.getElementById('btn-toggle-options').classList.add('hidden');
        
        const navContainer = document.getElementById('quiz-navigator');
        const navToggle = document.getElementById('btn-nav-toggle');
        if(isSearchOrView) {
            navToggle.classList.remove('hidden');
            Game.renderNavigator();
        } else {
            navToggle.classList.add('hidden');
            navContainer.classList.remove('open');
        }

        Game.renderQ();
    },

    renderNavigator: () => {
        const grid = document.getElementById('nav-grid-content');
        grid.innerHTML = '';
        State.quiz.forEach((q, i) => {
            const btn = document.createElement('button');
            btn.className = 'nav-btn';
            btn.innerText = q.id;
            btn.onclick = () => { State.qIdx = i; Game.renderQ(); Game.toggleNavigator(false); };
            grid.appendChild(btn);
        });
    },
    
    toggleNavigator: (force) => {
        const el = document.getElementById('quiz-navigator');
        if(typeof force === 'boolean') { if(force) el.classList.add('open'); else el.classList.remove('open'); } 
        else { el.classList.toggle('open'); }
        document.querySelectorAll('.nav-btn').forEach((b, i) => {
             if(i === State.qIdx) b.classList.add('current'); else b.classList.remove('current');
        });
    },

    startArchive: (type) => { 
        const p = State.allQ.filter(q=>State.localData.archive.includes(q.id));
        if(!p.length) return alert('الأرشيف فارغ');
        UI.closeModal('m-archive');
        if (type === 'pdf') {
             Game.startPDFMode(p);
        } else {
             Game.startQuizSession(p, type==='view'?'view_mode':'normal');
        }
    },

    startPDFMode: (questions) => {
        UI.showView('v-pdf');
        const list = document.getElementById('pdf-list');
        list.innerHTML = '';
        
        const shouldHideIrrelevant = State.localData.settings?.hideIrrelevant === true;

        questions.forEach((q, i) => {
            const d = document.createElement('div');
            d.className = 'pdf-item';
            let optsHtml = '';
            
            q.options.forEach((o, idx) => {
                const isCorrect = (idx === q.correct_option_id);
                if (!shouldHideIrrelevant || (shouldHideIrrelevant && isCorrect)) {
                    optsHtml += `<div class="pdf-opt ${isCorrect ? 'is-correct' : ''}">${o}</div>`;
                }
            });

            d.innerHTML = `
                <div class="pdf-q-txt"><small style="color:var(--primary)">#${q.id}</small><br>${q.question}</div>
                <div>${optsHtml}</div>
                ${q.explanation ? `<div class="pdf-exp"><b>💡 توضيح:</b> ${q.explanation}</div>` : ''}
            `;
            list.appendChild(d);
        });
    },

    execSearch: (mode = 'quiz') => {
        const idVal = document.getElementById('inp-search-id').value;
        const txtVal = document.getElementById('inp-search-txt').value.toLowerCase();
        let found = [];
    
        if(idVal) {
            const q = State.allQ.find(x => x.id == idVal);
            if(q) found.push(q);
        } else if (txtVal && txtVal.length > 2) {
            found = State.allQ.filter(q => q.question.toLowerCase().includes(txtVal));
        }

        if(found.length) {
            UI.closeModal('m-search');
            if(mode === 'pdf') {
                Game.startPDFMode(found);
            } else {
                Game.startQuizSession(found, 'search_mode');
            }
        } else { 
            alert('لم يتم العثور على نتائج.'); 
        }
    },

    searchWrong: (mode = 'quiz') => {
        const mistakes = State.localData.mistakes;
        if(!mistakes.length) return alert('لا يوجد سجل أخطاء.');
        const found = State.allQ.filter(q => mistakes.includes(q.id));
        UI.closeModal('m-search');
    
        if(mode === 'pdf') {
            Game.startPDFMode(found);
        } else {
            Game.startQuizSession(found, 'search_mode');
        }
    },
    
    toggleAnswerView: () => {
        const qState = State.answers[State.qIdx];
        const q = State.quiz[State.qIdx];
        if(qState.answered) {
            qState.answered = false; 
            State.showIrrelevantOptions = true;
            Game.renderQ();
        } else {
            Game.answer(q.correct_option_id, true); 
        }
    },
    
    toggleIrrelevantOptionsDisplay: () => {
        State.showIrrelevantOptions = !State.showIrrelevantOptions;
        Game.renderOptions();
        Game.triggerHaptic('selection');
    },
    
    renderQ: () => {
        clearTimeout(autoNavTimer);
        const q = State.quiz[State.qIdx];
        const qState = State.answers[State.qIdx]; 

        document.getElementById('q-id').innerText = q.id;
        document.getElementById('q-idx').innerText = `${State.qIdx+1}/${State.quiz.length}`;
        document.getElementById('q-path').innerText = `${q.subject} > ${q.lesson}`;
        document.getElementById('q-txt').innerText = q.question;
        
        Game.updateFavUI();

        document.getElementById('btn-prev').disabled = (State.qIdx === 0);
        document.getElementById('btn-next').disabled = (State.qIdx === State.quiz.length - 1);

        const expBox = document.getElementById('q-exp');
        const btnCheck = document.getElementById('btn-check');
        const btnToggleOptions = document.getElementById('btn-toggle-options');

        expBox.classList.add('hidden');
        btnCheck.classList.add('hidden');
        btnToggleOptions.classList.add('hidden');

        Game.renderOptions();

        if(qState.answered && q.explanation) {
            expBox.innerHTML = `<b>توضيح:</b> ${q.explanation}`;
            expBox.classList.remove('hidden');
        }

        if(!State.instantFeedback && qState.selectedIdx !== null && !qState.answered) {
            btnCheck.classList.remove('hidden');
        }
    },
    
    renderOptions: () => {
        const q = State.quiz[State.qIdx];
        const qState = State.answers[State.qIdx]; 
        const optsContainer = document.getElementById('q-opts'); 
        optsContainer.innerHTML='';
        const btnToggleOptions = document.getElementById('btn-toggle-options');

        q.options.forEach((o, i) => {
            const d = document.createElement('div'); d.className='opt';
            d.innerHTML = `<span>${o}</span>`;
            
            if(qState.answered) {
                if(i === q.correct_option_id) d.classList.add('correct');
                else if(i === qState.selectedIdx) d.classList.add('wrong');
                d.style.pointerEvents = 'none';

                const isRelevant = (i === q.correct_option_id || i === qState.selectedIdx);
                if (!isRelevant && !State.showIrrelevantOptions) d.classList.add('irrelevant-hidden');
                else if (!isRelevant && State.showIrrelevantOptions) d.classList.remove('irrelevant-hidden');

            } else if (qState.selectedIdx === i) {
                d.classList.add('selected-temp');
            }

            d.onclick = () => Game.handleOptionClick(i, d);
            optsContainer.appendChild(d);
        });

        if (qState.answered && q.options.length > 2) { 
            btnToggleOptions.classList.remove('hidden');
            btnToggleOptions.innerText = State.showIrrelevantOptions ? '👇 إخفاء الخيارات الأخرى' : '👆 إظهار الخيارات الأخرى';
        } else {
             btnToggleOptions.classList.add('hidden');
        }
    },
    
    handleOptionClick: (idx, el) => {
        const qState = State.answers[State.qIdx];
        if(qState.answered) return; 
        qState.selectedIdx = idx;
        if(State.instantFeedback || State.mode === 'lucky') Game.confirmAnswer(idx);
        else {
            document.querySelectorAll('.opt').forEach(o => o.classList.remove('selected-temp'));
            el.classList.add('selected-temp');
            document.getElementById('btn-check').classList.remove('hidden');
        }
    },
    
    checkManual: () => {
        const qState = State.answers[State.qIdx];
        if(qState.selectedIdx !== null) Game.confirmAnswer(qState.selectedIdx);
    },

    confirmAnswer: (idx, isSim = false) => {
        const q = State.quiz[State.qIdx];
        const qState = State.answers[State.qIdx];
        if (qState.answered) return;
        qState.answered = true; 
        qState.selectedIdx = idx;
        const isCorrect = (idx === q.correct_option_id);
        qState.isCorrect = isCorrect;

        const shouldHide = State.localData.settings?.hideIrrelevant === true;
        if(shouldHide) State.showIrrelevantOptions = false;

        Game.renderOptions(); 
        
        const divs = document.querySelectorAll('.opt');
        divs.forEach(d => d.classList.remove('selected-temp')); 
        divs[q.correct_option_id].classList.add('correct');

        if(isCorrect) {
            if(!isSim) {
                State.score++;
                if(window.AudioSys && window.AudioSys.playSuccess) AudioSys.playSuccess();
                Game.triggerHaptic('success');
                State.localData.mistakes = State.localData.mistakes.filter(x=>x!==q.id);
            }
        } else {
            divs[idx].classList.add('wrong');
            if(!isSim) {
                if(window.AudioSys && window.AudioSys.playError) AudioSys.playError();
                Game.triggerHaptic('error');
                if(!State.localData.mistakes.includes(q.id)) State.localData.mistakes.push(q.id);
                if (State.mode === 'survival') {
                    setTimeout(() => {
                        alert('🔥 Game Over');
                        Game.finishQuiz();
                    }, 500);
                    return;
                }
            }
        }

        if(!State.localData.archive.includes(q.id)) State.localData.archive.push(q.id);
        if(window.Data && window.Data.saveData) Data.saveData();

        if(q.explanation) {
            const expBox = document.getElementById('q-exp');
            expBox.innerHTML = `<b>توضيح:</b> ${q.explanation}`;
            expBox.classList.remove('hidden');
        }

        document.getElementById('btn-check').classList.add('hidden'); 

        if(shouldHide || !State.showIrrelevantOptions) {
            setTimeout(() => {
                const footer = document.querySelector('.quiz-footer');
                if(footer) footer.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }, 100);
        }
        
        if (State.mode === 'lucky') {
            setTimeout(() => Game.finishQuiz(), 500);
            return;
        }

        if(State.instantFeedback && !isSim && isCorrect && State.mode !== 'view_mode' && State.mode !== 'search_mode') {
            const delay = 1000;
            autoNavTimer = setTimeout(() => {
                if(State.qIdx < State.quiz.length - 1) Game.nextQ();
                else Game.finishQuiz();
            }, delay);
        }
    },

    answer: (idx, sim=true) => {
        const qState = State.answers[State.qIdx];
        if (qState.answered) return;
        qState.selectedIdx = idx; 
        Game.confirmAnswer(idx, sim);
    },

    navQ: (dir) => {
        const newIdx = State.qIdx + dir;
        if(newIdx >= 0 && newIdx < State.quiz.length) {
            State.qIdx = newIdx;
            State.showIrrelevantOptions = !(State.localData.settings?.hideIrrelevant === true);
            
            Game.renderQ();
            Game.triggerHaptic('selection');
        } else if (newIdx >= State.quiz.length && State.mode !== 'view_mode') {
            Game.finishQuiz();
        }
    },
    
    nextQ: () => Game.navQ(1),
    
    startTimer: () => {
        let t = 60; const b = document.getElementById('timer-bar'); b.style.display='block';
        clearInterval(tInt);
        tInt = setInterval(()=>{
            t--; b.style.width = (t/60*100)+'%';
            if(t<=0) { clearInterval(tInt); alert('⏰ Time Up'); Game.finishQuiz(); }
        },1000);
    },
    
    stopTimer: () => clearInterval(tInt),
    
    finishQuiz: () => {
        if(document.getElementById('app-wrap').classList.contains('zen-mode-active')) {
            Game.toggleZenMode(false);
        }

        Game.stopTimer();
        clearTimeout(autoNavTimer);
    
        let finalScore = State.answers.filter(a => a.isCorrect).length;
        State.score = finalScore;
    
        if (State.mode !== 'view_mode' && State.mode !== 'search_mode' && State.quiz.length > 0) {
            if(window.Data && window.Data.saveSessionAnalytics) {
                Data.saveSessionAnalytics();
            }
        }
    
        if(window.AudioSys && window.AudioSys.playSuccess) AudioSys.playSuccess();
        const pct = State.quiz.length > 0 ? Math.round((State.score / State.quiz.length) * 100) : 0;
        document.getElementById('sc-val').innerText = pct + '%';
        document.getElementById('sc-txt').innerText = State.score + ' / ' + State.quiz.length;
        UI.openModal('m-score');
    },    
    
    toggleFav: () => {
        const id = State.quiz[State.qIdx].id;
        if(State.localData.fav.includes(id)) State.localData.fav = State.localData.fav.filter(x=>x!==id);
        else State.localData.fav.push(id);
        if(window.Data && window.Data.saveData) Data.saveData();
        Game.updateFavUI();
        Game.triggerHaptic('selection');
    },
    
    updateFavUI: () => {
        const el = document.getElementById('btn-fav-big');
        const isFav = State.localData.fav.includes(State.quiz[State.qIdx].id);
        el.innerText = isFav ? "★ في المفضلة (S)" : "☆ أضف للمفضلة (S)";
        el.style.backgroundColor = isFav ? "var(--primary)" : "transparent";
        el.style.color = isFav ? "#fff" : "var(--txt-sec)";
    },
    
    showRank: () => {
        if(!State.sel || !State.sel.terms.length || !State.sel.subj) return alert('يجب اختيار مادة وترم واحد لعرض ترتيبها');
        const ctx = `${State.sel.terms[0]}_${State.sel.subj}`.replace(/[.#$/\[\]]/g, "_");
        document.getElementById('rank-topic').innerText = ctx.replace('_', ' > ');
        document.getElementById('rank-val').innerText = '...';
        UI.openModal('m-rank');
        
        if(window.firebaseDb) {
            const { ref, get } = window;
            get(ref(window.firebaseDb, `ranks/${ctx}`)).then(snap => {
                const data = snap.val();
                if(!data) { document.getElementById('rank-val').innerText = 'No Data'; return; }
                let arr = Object.keys(data).map(k => {
                    let v = data[k]; return { id: k, score: (v.score||v), name: (v.name||"User") };
                });
                arr.sort((a,b) => b.score - a.score);
                const myRank = arr.findIndex(x => x.id == State.user.id) + 1;
                document.getElementById('rank-val').innerText = myRank>0 ? `#${myRank}` : 'Unranked';
                document.getElementById('rank-user-name').innerText = State.user.first_name;
                document.getElementById('rank-total').innerText = `${arr.length} Players`;
            });
        }
    },
    
    resetProgress: () => {
        Game.triggerHaptic('error');
        if (confirm('هل أنت متأكد من مسح جميع بيانات تقدمك (الأخطاء، الأرشيف، المفضلة)؟ لا يمكن التراجع عن هذا الإجراء.')) {
            State.localData.mistakes = [];
            State.localData.archive = [];
            State.localData.fav = [];
            if(window.Data && window.Data.saveData) Data.saveData();
            if(window.UI && window.UI.updateHomeStats) UI.updateHomeStats();
            UI.closeModal('m-set');
            alert('تم مسح التقدم بنجاح.');
        }
    }
};

// Make Game available globally
window.Game = Game;