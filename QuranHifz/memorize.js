/* ===========================================================================
 * memorize.js — the "الحفظ" (memorisation) view.
 *
 * The user picks a surah and an ayah range, presses the microphone and
 * recites from memory. Words reveal one by one as the recognizer matches
 * them against the known text (memorize-core.js does the matching); mistakes
 * are highlighted and corrected. Without a speech engine (Firefox, offline)
 * the same page becomes a tap-to-reveal practice board.
 * =========================================================================== */

(function () {
    'use strict';

    const Core = window.QuranMemorizeCore;
    const SOURCE = '../QuranText/Quran/quran-uthmani.xml';
    const STORAGE_KEY = 'quran-memorize';
    const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    const MAX_RANGE = 60;          // verses per session
    const HINT_REVEAL_DELAY_MS = 4500; // legacy constant; reveal is manual only now
    const MODEL_FLAG = 'quran-memorize-model'; // set once the model is cached
    const WORD_AUDIO_BASE = 'https://verses.quran.com/'; // word-by-word recitation

    /* -----------------------------------------------------------------------
     * Elements + state
     * -------------------------------------------------------------------- */

    let els = {};
    let suras = null;              // <sura> nodes from quran-uthmani.xml
    let items = [];                // core items for the current range
    let spans = [];                // item index -> span element (null for meta)
    let wordState = [];            // UI state per item
    let tracker = null;
    let verses = [];               // [{s, a, text, firstItem, lastItem}]
    let currentRange = null;
    let currentItem = -1;
    let toastTimer = null;

    let settings = loadSettings();

    /* On-device speech engine (created lazily; see the speech section) */
    let asr = null;
    let running = false;
    let modelReady = false;
    const revealTimers = {};       // item index -> timeout id (hint-first)

    /* -----------------------------------------------------------------------
     * Small helpers
     * -------------------------------------------------------------------- */

    function toArabicDigits(value) {
        return String(value).replace(/[0-9]/g, function (digit) {
            return ARABIC_DIGITS[Number(digit)];
        });
    }

    function toLatinDigits(value) {
        return String(value == null ? '' : value).replace(/[٠-٩]/g, function (digit) {
            return String(ARABIC_DIGITS.indexOf(digit));
        });
    }

    function showToast(message) {
        let toast = document.getElementById('toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast';
            toast.className = 'toast';
            toast.setAttribute('role', 'status');
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.classList.add('is-visible');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            toast.classList.remove('is-visible');
        }, 4000);
    }

    function setStatus(text) {
        if (els.statusText) {
            els.statusText.textContent = text;
        }
    }

    /* Shows the words the recognizer is actually hearing — the quickest way
       to tell "nothing arrives" apart from "arrives but matches nothing". */
    function setHeard(text) {
        if (!els.heardText) {
            return;
        }
        if (text) {
            els.heardText.textContent = 'سُمع: ' + text;
            els.heardText.hidden = false;
        } else {
            els.heardText.textContent = '';
            els.heardText.hidden = true;
        }
    }

    function flashStatus(text) {
        const base = baseStatus();
        setStatus(text);
        clearTimeout(flashStatus.timer);
        flashStatus.timer = setTimeout(function () {
            if (running) {
                setStatus(base);
            }
        }, 2600);
    }

    function baseStatus() {
        return running ? 'أستمع إليك… تابع التلاوة' : 'اضغط الميكروفون للاستماع، أو اضغط أي كلمة للتدريب';
    }

    function loadSettings() {
        const defaults = {
            feedback: 'hint',
            hideMode: 'blur',
            autoScroll: true,
            model: 'int8',
            engine: 'phoneme',
            /* which phoneme export the checker loads: 'v31-int8' (default)
               or 'v31-fp32' — the Quran-Lab zipformer_p-arabic-v3.1 pair */
            phonemeModel: 'v31-int8',
            viewVersion: 2,
            range: null
        };
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const data = JSON.parse(raw);
                if (data && typeof data === 'object') {
                    const merged = Object.assign(defaults, data.settings || {}, { range: data.range || null });
                    /* one-time upgrade: 'hidden' used to be the default view —
                       existing sessions switch to the blurry view once; after
                       that the setting is respected as-is. */
                    if ((data.settings || {}).viewVersion !== 2) {
                        merged.hideMode = 'blur';
                        merged.viewVersion = 2;
                    }
                    /* one-time upgrade: the correction style default is now
                       «تلميح أولًا» — existing sessions switch to it once. */
                    if ((data.settings || {}).feedbackVersion !== 2) {
                        merged.feedback = 'hint';
                        merged.feedbackVersion = 2;
                    }
                    /* the phoneme checker ships the Quran-Lab v3.1 exports
                       only now; any older saved choice maps to int8 */
                    merged.phonemeModel = (data.settings || {}).phonemeModel === 'v31-fp32'
                        ? 'v31-fp32' : 'v31-int8';
                    /* the engine choice is phoneme (default) or int8 only now;
                       a saved v8/v8fp32 (or anything else) becomes phoneme */
                    merged.engine = merged.engine === 'int8' ? 'int8' : 'phoneme';
                    return merged;
                }
            }
        } catch (error) { /* storage unavailable */ }
        return defaults;
    }

    function saveState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                settings: {
                    feedback: settings.feedback,
                    feedbackVersion: 2,
                    hideMode: settings.hideMode,
                    autoScroll: settings.autoScroll,
                    model: settings.model,
                    engine: settings.engine,
                    phonemeModel: settings.phonemeModel === 'v31-fp32' ? 'v31-fp32' : 'v31-int8',
                    viewVersion: 2
                },
                range: currentRange
            }));
        } catch (error) { /* storage unavailable */ }
    }

    function loadXml(path) {
        return fetch(path)
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('Could not fetch ' + path + ' (HTTP ' + response.status + ')');
                }
                return response.text();
            })
            .then(function (xml) {
                const parser = new DOMParser();
                const xmlDOM = parser.parseFromString(xml, 'application/xml');
                if (xmlDOM.querySelector('parsererror')) {
                    throw new Error('Invalid XML in ' + path);
                }
                return xmlDOM.querySelectorAll('sura');
            });
    }

    function isSpeechAvailable() {
        return Boolean(window.QuranASR);
    }

    /* -----------------------------------------------------------------------
     * Word states
     * -------------------------------------------------------------------- */

    /* Classes setWordState manages. The caret (is-current) and the flash are
       add-ons applied elsewhere and survive a state change. */
    const WORD_CLASSES = [
        'is-hidden', 'is-blur', 'is-hint', 'is-peek', 'is-ok', 'is-soft',
        'is-unclear', 'is-manual', 'is-skip', 'is-err', 'is-err-hint', 'is-wait', 'is-pronounce', 'is-flash'
    ];

    function setWordState(index, state, heard) {
        const item = items[index];
        const span = spans[index];
        if (!item || !span || item.meta) {
            return;
        }
        wordState[index] = state;
        WORD_CLASSES.forEach(function (name) { span.classList.remove(name); });

        let chip = span.querySelector('.mw__heard');
        if (chip) {
            chip.remove();
        }
        span.title = '';

        switch (state) {
            case 'pending':
                span.textContent = item.raw;
                span.classList.add('is-hidden');
                if (settings.hideMode === 'blur') {
                    span.classList.add('is-blur');
                }
                break;
            case 'hint':
                span.textContent = hintText(item);
                span.classList.add('is-hint');
                span.title = 'اضغط لإظهار الكلمة كاملة';
                break;
            case 'peek':
                span.textContent = item.raw;
                span.classList.add('is-peek');
                break;
            case 'ok':
                span.textContent = item.raw;
                span.classList.add('is-ok');
                break;
            case 'soft':
                span.textContent = item.raw;
                span.classList.add('is-soft');
                span.title = 'حروف مقطعة — تُتجاوز دون خطأ';
                break;
            case 'unclear':
                span.textContent = item.raw;
                span.classList.add('is-unclear');
                span.title = 'لم أتأكد من هذه الكلمة — راجعها';
                break;
            case 'manual':
                span.textContent = item.raw;
                span.classList.add('is-manual');
                span.title = 'أظهرتها يدويًا';
                break;
            case 'skip':
                span.textContent = item.raw;
                span.classList.add('is-skip');
                span.title = 'تجاوزتها — يمكنك العودة إليها';
                break;
            case 'err':
                span.textContent = item.raw;
                span.classList.add('is-err');
                span.title = 'خطأ في هذه الكلمة';
                if (heard) {
                    chip = document.createElement('span');
                    chip.className = 'mw__heard';
                    chip.textContent = 'سُمع: ' + heard;
                    span.appendChild(chip);
                }
                break;
            case 'errHint':
                span.textContent = hintText(item);
                span.classList.add('is-err-hint');
                span.title = 'خطأ — أعد المحاولة، أو اضغط لإظهار الكلمة';
                break;
            case 'wait':
                /* a mistake in the word under the caret: the box turns red
                   but the word stays hidden — retry it correctly, or tap
                   the box to reveal the word yourself */
                span.textContent = item.raw;
                span.classList.add('is-wait');
                span.title = 'أعد المحاولة — أو اضغط لإظهار الكلمة';
                break;
        }

        /* a pronunciation note that waited for the word to become visible */
        if (state !== 'pending' && pronNotes[index]) {
            const pendingNotes = pronNotes[index];
            delete pronNotes[index];
            markCheckerNote(index, pendingNotes);
        }
    }

    function hintText(item) {
        const raw = item.raw || item.norm;
        const first = Array.from(raw)[0] || '';
        return first + '…';
    }

    /* A failed attempt at the word under the caret: the box turns red but the
       word stays hidden. The reciter either fixes the mistake or taps the
       word to reveal it — the app never reveals it by itself. */
    function markMistake(index) {
        if (!tracker || index === undefined || index === null || index < 0 || index >= items.length) {
            return;
        }
        if (items[index].meta) {
            return;
        }
        const current = wordState[index];
        if (current === 'pending' || current === 'hint' || current === 'wait'
            || current === 'errHint' || current === 'peek') {
            setWordState(index, settings.feedback === 'hint' ? 'errHint' : 'wait');
        }
    }

    function clearRevealTimer(index) {
        if (revealTimers[index]) {
            clearTimeout(revealTimers[index]);
            delete revealTimers[index];
        }
    }

    function flashWord(index) {
        const span = spans[index];
        if (!span) {
            return;
        }
        span.classList.remove('is-flash');
        void span.offsetWidth; // restart the animation
        span.classList.add('is-flash');
    }

    /* The word is right but the harakat are not: a hint, not an error. The
       tooltip names the expected and the heard vowel marks. */
    function markPronunciation(index, expected, heard) {
        const span = spans[index];
        if (!span) {
            return;
        }
        const names = {
            '\u064E': 'فتحة',
            '\u064F': 'ضمة',
            '\u0650': 'كسرة',
            '\u0652': 'سكون'
        };
        const describe = function (signature) {
            return Array.from(signature).map(function (ch) {
                return names[ch] || ch;
            }).join(' ');
        };
        span.classList.add('is-pronounce');
        span.title = 'راجع النطق — المتوقع: «' + describe(expected) + '»، المسموع: «' + describe(heard) + '»';
    }

    /* The word is right but the recognizer wrote a different ending or left
       the article out («الصالحين»، «صالحه» for «الصالحات»): the word settles,
       with the same dotted underline and a tooltip to check the ending. */
    function markEnding(index, heard) {
        const span = spans[index];
        if (!span) {
            return;
        }
        span.classList.add('is-pronounce');
        span.title = 'راجع نهاية الكلمة — المتوقع: «' + (items[index].norm || items[index].raw)
            + '»، والمُتعرَّف عليه: «' + (heard || '') + '»';
    }

    /* -----------------------------------------------------------------------
     * Pronunciation checker (phoneme zipformer — optional, off by default)
     * -------------------------------------------------------------------- */

    /* The phoneme model renders the recited speech as vowel-carrying units
       («مَ اا لِ كِ…»). They are aligned with the canonical units of the aya
       under the caret (QuranText/QuranPhonemes via QuranPhonemeCheck) and the
       deviations become notes on the words. The int8 tracker stays the
       source of truth for progress — the checker only annotates. */

    const PRON_SCRIPT_SRC = (document.currentScript && document.currentScript.src) || location.href;
    let pronWorker = null;
    let pronReady = null;
    let pronLoadResolve = null;
    let pronLoadReject = null;
    let pronBusy = false;
    let pronLoaded = false;   // true once the worker reported 'ready'
    let pronModelActive = null;   // which export the worker actually loaded
    const pronNotes = {};   // item index -> notes waiting for the word to show

    /* The worker hosts one export at a time; the page picks which. */
    function phonemeModelId() {
        return settings.phonemeModel === 'v31-fp32' ? 'arabic-v3-fp32' : 'arabic-v3';
    }

    function setPronStatus(text) {
        if (els.pronStatus) {
            els.pronStatus.textContent = text;
        }
    }

    function ensurePronWorker() {
        if (pronWorker) {
            return pronWorker;
        }
        if (!window.QuranPhonemeCheck || typeof Worker === 'undefined') {
            return null;
        }
        try {
            pronWorker = new Worker(new URL('phoneme-asr-worker.js', PRON_SCRIPT_SRC));
        } catch (error) {
            setPronStatus('تعذّر تشغيل مدقّق النطق');
            return null;
        }
        pronWorker.onmessage = onPronMessage;
        pronWorker.onerror = function () {
            setPronStatus('تعذّر تشغيل مدقّق النطق');
            pronReady = null;
            pronLoaded = false;
        };
        return pronWorker;
    }

    /* Loads the model once (~75 MB int8 — cached by the browser afterwards). */
    function ensurePronModel() {
        if (settings.engine !== 'phoneme') {
            return null;
        }
        const worker = ensurePronWorker();
        if (!worker) {
            return null;
        }
        if (pronReady) {
            return pronReady;
        }
        setPronStatus('…جارٍ تحميل نموذج الفونيمات (٧٢ م.ب — مرة واحدة)');
        pronReady = new Promise(function (resolve, reject) {
            pronLoadResolve = resolve;
            pronLoadReject = reject;
            worker.postMessage({ type: 'load', model: phonemeModelId() });
        });
        pronReady.catch(function () {
            pronReady = null;
            pronLoadResolve = null;
            pronLoadReject = null;
        });
        return pronReady;
    }

    /** Drops the loaded phoneme export and loads the chosen one. The worker
     *  hosts a single model per worker, so a switch restarts it — the weights
     *  are cached by the browser, so this costs a second or two. */
    function switchPhonemeModel(value) {
        const next = value === 'v31-fp32' ? 'v31-fp32' : 'v31-int8';
        const wanted = next === 'v31-fp32' ? 'arabic-v3-fp32' : 'arabic-v3';
        settings.phonemeModel = next;
        if (pronWorker && pronModelActive === wanted) {
            return;   /* the worker already hosts the chosen export */
        }
        if (pronWorker) {
            pronWorker.terminate();
            pronWorker = null;
        }
        pronReady = null;
        pronLoaded = false;
        pronModelActive = null;
        pronLoadResolve = null;
        pronLoadReject = null;
        if (settings.engine === 'phoneme') {
            ensurePronModel();
        }
    }

    function onPronMessage(event) {
        const message = event.data || {};
        if (message.type === 'status') {
            setPronStatus(message.message);
        } else if (message.type === 'ready') {
            pronLoaded = true;
            pronModelActive = message.model || null;
            if (pronLoadResolve) {
                pronLoadResolve(true);
                pronLoadResolve = null;
                pronLoadReject = null;
            }
            setPronStatus(pronModelActive === 'arabic-v3-fp32'
                ? 'مدقّق التجويد جاهز — نموذج v3.1 fp32: يتحقق من الحركات والمدود مع التلاوة'
                : 'مدقّق التجويد جاهز — نموذج v3.1 int8: يتحقق من الحركات والمدود مع التلاوة');
        } else if (message.type === 'error') {
            if (pronLoadReject) {
                pronLoadReject(new Error(message.message || 'phoneme error'));
                pronLoadResolve = null;
                pronLoadReject = null;
            }
            setPronStatus('تعذّر مدقّق النطق: ' + (message.message || ''));
        } else if (message.type === 'phonemes') {
            pronBusy = false;
            try {
                handlePhonemes(message);
            } catch (error) { /* التحليل اختياري */ }
        } else if (message.type === 'stream-units') {
            try {
                streamUnitsReceived(message);
            } catch (error) { /* التحليل اختياري */ }
        } else if (message.type === 'stream-end') {
            phonStreamStarted = false;
        }
    }

    /* Aligns the heard units with the canonical units of the aya under the
       caret (plus the next one, for recitation that runs on). */
    function handlePhonemes(message) {
        if (settings.engine !== 'phoneme' || !tracker || !suras || !window.QuranPhonemeCheck) {
            return;
        }
        const units = message.units || [];
        if (!units.length) {
            return;
        }
        if (settings.engine === 'phoneme') {
            /* show what the phoneme engine heard */
            setHeard(units.join(' '));
        }
        analyzeAndApply(units);
    }

    /* Aligns one unit sequence with the aya under the caret (plus the next
       one) and applies settlements + notes. Resolves {consumed, settled} —
       how many heard units belong to settled words (the stream trims those). */
    function analyzeAndApply(units) {
        if (!tracker || !suras || !window.QuranPhonemeCheck) {
            return Promise.resolve(null);
        }
        let index = tracker.cursor;
        while (index < items.length && items[index].meta) {
            index += 1;
        }
        const item = items[index];
        if (!item) {
            return Promise.resolve(null);
        }
        const sura = item.s;
        const wanted = [item.a];
        if (item.a + 1 <= verseCount(sura)) {
            wanted.push(item.a + 1);
        }
        return Promise.all(wanted.map(function (aya) {
            return QuranPhonemeCheck.canonFor(sura, aya);
        })).then(function (canons) {
            const entries = [];
            canons.forEach(function (canon, i) {
                if (!canon) {
                    return;
                }
                if (i === 0 && item.wi > 0 && canon.lens && canon.lens[item.wi] !== undefined) {
                    /* start the alignment at the word under the caret: keeping
                       the earlier words let a repeated word (e.g. the second
                       «عَلَيْهِمْ» of 1:7) tie with its EARLIER occurrence,
                       and the earliest-position preference then stole its
                       units — the frontier word never saw them */
                    const skip = canon.lens.slice(0, item.wi).reduce(function (a, b) { return a + b; }, 0);
                    entries.push({
                        s: sura,
                        a: wanted[i],
                        canon: {
                            clusters: canon.clusters.slice(skip),
                            lens: canon.lens.slice(item.wi),
                            bismillah: canon.bismillah
                        },
                        wiOffset: item.wi
                    });
                    return;
                }
                entries.push({ s: sura, a: wanted[i], canon: canon });
            });
            if (!entries.length) {
                return null;
            }
            const sequence = QuranPhonemeCheck.buildSequence(entries);
            const result = QuranPhonemeCheck.analyzeSequence(sequence, units);
            if (!result) {
                return null;
            }
            const settled = settlePhonemeWords(result);
            if (result.flags.length) {
                applyPronunciationFlags(result.flags, settled);
            }
            logPhonemeSession(units, result, settled);
            return { consumed: consumedUnits(result), settled: settled };
        }).catch(function () { return null; /* المقارنة اختيارية */ });
    }

    /* How many leading heard units can be dropped: everything up to the last
       unit that aligned to an ALREADY-PASSED word (before the cursor). The
       word under the cursor and everything after keep their units — those
       are the evidence for settling. Without this, repeating an already
       settled phrase leaves duplicate units that jam every later alignment. */
    function consumedUnits(result) {
        if (!result || !result.words || !tracker) {
            return 0;
        }
        let consumed = 0;
        result.words.forEach(function (word) {
            if (word.hTo === undefined || word.hTo === null) {
                return;
            }
            let index = -1;
            for (let i = 0; i < items.length; i += 1) {
                const candidate = items[i];
                if (!candidate.meta && candidate.s === word.ref.s &&
                    candidate.a === word.ref.a && candidate.wi === word.ref.wi) {
                    index = i;
                    break;
                }
            }
            if (index >= 0 && index < tracker.cursor) {
                consumed = Math.max(consumed, word.hTo + 1);
            }
        });
        return consumed;
    }

    /* ---- continuous stream (phoneme-only engine) ------------------------- */

    let phonStreamStarted = false;
    let phonStreamUnits = [];
    let phonStreamAligning = false;

    /* Every raw mic frame goes straight to the worker; the model decodes it
       as it arrives (streaming zipformer), so words settle while reciting —
       no utterance segmentation, no lost word starts. */
    function maybeStreamFrame(frame) {
        if (settings.engine !== 'phoneme' || !tracker) {
            return;
        }
        if (!pronReady) {
            ensurePronModel();   // kick the load; frames are skipped meanwhile
            return;
        }
        if (!pronWorker) {
            return;
        }
        if (!phonStreamStarted) {
            phonStreamStarted = true;
            phonStreamUnits = [];
            phonStreamAligning = false;
            setHeard('');
            pronWorker.postMessage({ type: 'stream', action: 'start' });
        }
        const copy = frame.slice();
        pronWorker.postMessage({ type: 'stream', action: 'audio', audio: copy }, [copy.buffer]);
    }

    function streamUnitsReceived(message) {
        phonStreamUnits = phonStreamUnits.concat(message.units || []);
        setHeard(phonStreamUnits.slice(-12).join(' '));
        if (phonStreamAligning) {
            return;
        }
        phonStreamAligning = true;
        analyzeAndApply(phonStreamUnits).then(function (outcome) {
            phonStreamAligning = false;
            if (!outcome) {
                return;
            }
            if (outcome.consumed > 0) {
                phonStreamUnits.splice(0, outcome.consumed);
            }
            if (phonStreamUnits.length > 80) {
                /* safety cap — junk that never aligns must not grow forever */
                phonStreamUnits.splice(0, phonStreamUnits.length - 80);
            }
        }).catch(function () {
            phonStreamAligning = false;
        });
    }

    function stopPhonemeStream() {
        if (phonStreamStarted && pronWorker) {
            pronWorker.postMessage({ type: 'stream', action: 'end' });
        }
        phonStreamStarted = false;
        phonStreamUnits = [];
        phonStreamAligning = false;
    }

    /* Decode the pending tail right away — called when the VAD hears the end
       of speech, so the last word of an utterance (often its final letters,
       e.g. «…م دُ») shows up the moment the reciter pauses instead of
       waiting for the next audio to fill a decode window. */
    function flushPhonemeStream() {
        if (phonStreamStarted && pronWorker) {
            pronWorker.postMessage({ type: 'stream', action: 'flush' });
        }
    }

    /* Session trail for the phoneme engine (dev): the last 60 utterances —
       what it heard, which words settled, and where the cursor is. Inspect
       with JSON.parse(localStorage.getItem('quran-phoneme-log')). */
    function logPhonemeSession(units, result, settled) {
        try {
            const trail = JSON.parse(localStorage.getItem('quran-phoneme-log') || '[]');
            trail.push({
                at: new Date().toISOString(),
                units: units.join(' '),
                stats: result ? result.stats : null,
                words: result ? result.words.map(function (word) {
                    const key = word.ref.s + ':' + word.ref.a + ':' + word.ref.wi;
                    const errors = word.bad + word.miss;
                    return key + (settled[key] ? (errors ? '=ok(' + errors + ')' : '=ok') : '!' + errors);
                }) : null,
                cursor: tracker ? tracker.cursor : null
            });
            while (trail.length > 60) {
                trail.shift();
            }
            localStorage.setItem('quran-phoneme-log', JSON.stringify(trail));
        } catch (error) { /* storage unavailable */ }
    }

    const PRON_LABELS = {
        letter: 'حرف مخالف',
        vowel: 'حركة مخالفة',
        shadda: 'شدة ناقصة',
        missing: 'حرف لم يُسمع',
        confidence: 'نطق غير واضح (ثقة منخفضة)'
    };

    function describePronNote(note) {
        const label = PRON_LABELS[note.kind] || note.kind;
        if (note.heard) {
            return label + ' (المتوقع «' + note.expected + '» — سُمع «' + note.heard + '»)';
        }
        return label + ' (المتوقع «' + note.expected + '»)';
    }

    function markCheckerNote(index, notes) {
        const span = spans[index];
        if (!span) {
            return;
        }
        span.classList.add('is-pronounce');
        const text = 'مدقّق النطق — ' + notes.map(describePronNote).join('؛ ');
        span.title = span.title ? span.title + '\n' + text : text;
    }

    /* Phoneme-only mode: a word every unit of which was heard — cleanly or
       with minor notes — settles the tracker (the chain rule lives in
       core.settleWords). Guards: at least HALF the word's units must have
       matched exactly (weak sound-alikes must not carry the recitation
       forward), and small deviations settle WITH a note only when they add
       up; a single blurred unit settles quietly. Returns the set of words
       the TRACKER actually settled (chain-limited!) — the stream trims
       only those units. */
    function settlePhonemeWords(result) {
        if (settings.engine !== 'phoneme' || !tracker || !result || !result.words) {
            return {};
        }
        /* evaluate every aligned word */
        const evals = [];
        result.words.forEach(function (word) {
            const accounted = word.seen + (word.lead || 0) >= word.total;
            const halfExact = word.exact * 2 >= word.total;
            const errors = word.bad + word.miss;
            const allowed = word.total <= 2 ? 0 : (word.total <= 4 ? 1 : 2);
            let state = 'fail';
            if (accounted && halfExact) {
                state = errors <= allowed ? 'clean' : (errors <= allowed + 1 ? 'near' : 'fail');
            }
            if (state === 'fail') {
                return;
            }
            for (let i = 0; i < items.length; i += 1) {
                const candidate = items[i];
                if (!candidate.meta && candidate.s === word.ref.s &&
                    candidate.a === word.ref.a && candidate.wi === word.ref.wi) {
                    evals.push({ index: i, state: state });
                    break;
                }
            }
        });
        if (!evals.length) {
            return {};
        }
        evals.sort(function (a, b) { return a - b.index; });
        /* a near-miss word (the model blurred one unit too many) rides on the
           clean run after it — evidence that the reciter is really here —
           instead of freezing the whole recitation. Its notes stay visible. */
        const pass = [];
        for (let i = evals.length - 1; i >= 0; i -= 1) {
            const entry = evals[i];
            let qualifies = entry.state === 'clean';
            if (!qualifies && entry.state === 'near' && i + 1 < evals.length) {
                const next = evals[i + 1];
                const adjacent = next.index === entry.index + 1
                    || (next.index === entry.index + 2 && items[entry.index + 1] && items[entry.index + 1].meta);
                if (adjacent && pass[i + 1]) {
                    qualifies = true;
                }
            }
            pass[i] = qualifies;
        }
        const wanted = [];
        evals.forEach(function (entry, i) {
            if (pass[i]) {
                wanted.push(entry.index);
            }
        });
        if (!wanted.length) {
            return {};
        }
        wanted.sort(function (a, b) { return a - b; });
        const outcome = tracker.settleWords(wanted);
        applyOps(outcome.ops);
        const settled = {};
        outcome.settled.forEach(function (index) {
            const item = items[index];
            settled[item.s + ':' + item.a + ':' + item.wi] = true;
        });
        return settled;
    }

    function applyPronunciationFlags(flags, settled) {
        const marked = [];
        flags.forEach(function (flag) {
            const notes = flag.notes.filter(function (note) {
                return QuranPhonemeCheck.MARK_KINDS[note.kind];
            });
            if (!notes.length) {
                return;
            }
            let index = -1;
            for (let i = 0; i < items.length; i += 1) {
                const candidate = items[i];
                if (!candidate.meta && candidate.s === flag.ref.s &&
                    candidate.a === flag.ref.a && candidate.wi === flag.ref.wi) {
                    index = i;
                    break;
                }
            }
            if (index < 0) {
                return;
            }
            if (index > tracker.cursor) {
                /* a word PAST the one the reciter is working on: the tail of
                   the alignment often grazes later words (the next verse
                   repeats endings like «عَلَيْهِمْ» or «ٱلَّذِينَ»), and
                   annotating them points at a verse not reached yet */
                return;
            }
            const key = flag.ref.s + ':' + flag.ref.a + ':' + flag.ref.wi;
            const blocking = settings.engine === 'phoneme'
                && !(settled && settled[key])
                && notes.some(function (note) {
                    return note.kind === 'letter' || note.kind === 'missing';
                });
            if (blocking) {
                /* phoneme-only: a wrong letter keeps the word unresolved —
                   show it as a mistake so the retry is obvious */
                markMistake(index);
            } else if (notes.length < 2) {
                /* one minor deviation (a vowel the model blurred) — settle
                   quietly instead of dotting correctly recited words */
                return;
            }
            if (wordState[index] === 'pending') {
                /* the word is still hidden: hold the note until it shows */
                pronNotes[index] = notes;
            } else {
                markCheckerNote(index, notes);
            }
            marked.push(items[index].raw);
        });
        if (marked.length) {
            const head = marked.slice(0, 2).map(function (word) {
                return '«' + word + '»';
            }).join(' و');
            flashStatus('مدقّق النطق: راجع ' + head + (marked.length > 2 ? ' وغيرها' : ''));
        }
    }

    /* -----------------------------------------------------------------------
     * Ops from the tracker
     * -------------------------------------------------------------------- */

    function applyOps(ops) {
        ops.forEach(function (op) {
            switch (op.op) {
                case 'peek':
                    setWordState(op.i, 'peek');
                    break;
                case 'ok':
                case 'fixed':
                    clearRevealTimer(op.i);
                    setWordState(op.i, 'ok');
                    break;
                case 'weak':
                    setWordState(op.i, 'unclear');
                    break;
                case 'sub':
                    /* the tracker never settles this word: red box, keep
                       waiting (hint mode shows the first letter only) */
                    markMistake(op.i);
                    break;
                case 'miss':
                    markMistake(op.i);
                    break;
                case 'soft':
                    setWordState(op.i, 'soft');
                    break;
                case 'repeat':
                    flashWord(op.i);
                    break;
                case 'pronounce':
                    markPronunciation(op.i, op.expected, op.heard);
                    break;
                case 'ending':
                    /* a right word with a misheard ending («الصالحين» for
                       «الصالحات»): settle it, but point at the ending */
                    markEnding(op.i, op.heard);
                    break;
                case 'extra':
                    break;
                case 'cursor':
                    moveCaret(op.i);
                    break;
                case 'skip':
                    for (let i = op.from; i <= op.to; i += 1) {
                        if (wordState[i] === 'pending' || wordState[i] === 'peek' || wordState[i] === 'hint') {
                            setWordState(i, 'skip');
                        }
                    }
                    break;
                case 'reset':
                    resetStatesFrom(op.from);
                    break;
                case 'relocate':
                    moveCaret(op.i);
                    flashStatus('وجدت موضع التلاوة — تابع');
                    break;
                case 'manual':
                    setWordState(op.i, 'manual');
                    break;
                case 'lowconf':
                    flashStatus('لم أفهم — أعد الآية من فضلك');
                    /* the attempt belongs to the word under the caret */
                    markMistake(tracker ? tracker.cursor : -1);
                    break;
                case 'hold':
                    /* the tracker refused to move past the current word */
                    flashStatus('ابقَ على الكلمة الحالية حتى تنطقها صحيحة — ثم تابع');
                    markMistake(tracker ? tracker.cursor : -1);
                    break;
                case 'complete':
                    handleComplete();
                    break;
            }
        });
        refreshVerseCompletion();
    }

    function resetStatesFrom(fromIndex) {
        for (let i = fromIndex; i < items.length; i += 1) {
            clearRevealTimer(i);
            if (!items[i].meta && wordState[i] !== 'pending') {
                setWordState(i, 'pending');
            }
        }
    }

    function clearPeekMarks() {
        for (let i = 0; i < wordState.length; i += 1) {
            if (wordState[i] === 'peek') {
                setWordState(i, 'pending');
            }
        }
    }

    function moveCaret(index) {
        if (currentItem >= 0 && spans[currentItem]) {
            spans[currentItem].classList.remove('is-current');
        }
        currentItem = index;
        if (spans[index]) {
            spans[index].classList.add('is-current');
            maybeAutoScroll(spans[index]);
        }
    }

    function maybeAutoScroll(span) {
        if (!settings.autoScroll) {
            return;
        }
        const rect = span.getBoundingClientRect();
        const view = window.innerHeight || 800;
        if (rect.top >= 120 && rect.bottom <= view - 140) {
            return; // already comfortably on screen
        }
        const top = window.scrollY + rect.top - Math.max(150, view * 0.34);
        window.scrollTo({ top: top, behavior: 'instant' });
    }

    function refreshVerseCompletion() {
        verses.forEach(function (verse) {
            const element = document.getElementById('ayah-' + verse.s + '-' + verse.a);
            if (!element) {
                return;
            }
            let complete = true;
            for (let i = verse.firstItem; i <= verse.lastItem; i += 1) {
                const state = wordState[i];
                if (items[i].meta) {
                    continue;
                }
                if (state === 'pending' || state === 'hint' || state === 'peek' || state === 'errHint') {
                    complete = false;
                    break;
                }
            }
            element.classList.toggle('is-complete', complete);
        });
    }

    function handleComplete() {
        stopListening();
        setStatus('أتممت المقطع — أحسنت! يعيدك زر «من جديد» للبدء من أول آية.');
        const summary = tracker.summary();
        showToast('المقطع مكتمل: ' + toArabicDigits(summary.total) + ' كلمة، منها '
            + toArabicDigits(summary.strong) + ' بثقة عالية');
    }

    /* -----------------------------------------------------------------------
     * Rendering
     * -------------------------------------------------------------------- */

    function resolveRange() {
        const params = new URLSearchParams(window.location.search);
        const surah = parseInt(toLatinDigits(params.get('surah')), 10);
        const ayah = parseInt(toLatinDigits(params.get('ayah')), 10);
        const to = parseInt(toLatinDigits(params.get('to')), 10);
        if (surah >= 1 && surah <= 114) {
            return normalizeRange({
                surah: surah,
                from: ayah >= 1 ? ayah : 1,
                to: to >= 1 ? to : (ayah >= 1 ? ayah : 1)
            });
        }
        if (settings.range && settings.range.surah) {
            return normalizeRange(settings.range);
        }
        return normalizeRange({ surah: 1, from: 1, to: 7 });
    }

    function verseCount(surah) {
        return suras[surah - 1].children.length;
    }

    function normalizeRange(range) {
        const surah = Math.min(114, Math.max(1, range.surah | 0));
        const count = verseCount(surah);
        let from = Math.min(count, Math.max(1, range.from | 0 || 1));
        let to = Math.min(count, Math.max(from, range.to | 0 || from));
        if (to - from + 1 > MAX_RANGE) {
            to = Math.min(count, from + MAX_RANGE - 1);
            showToast('تم تحديد أول ' + toArabicDigits(MAX_RANGE) + ' آية من النطاق');
        }
        return { surah: surah, from: from, to: to };
    }

    function renderRange(range) {
        stopListening();
        currentRange = range;
        verses = [];
        const sura = suras[range.surah - 1];
        for (let a = range.from; a <= range.to; a += 1) {
            verses.push({ s: range.surah, a: a, text: sura.children[a - 1].getAttribute('text') || '' });
        }
        items = Core.buildItems(verses);

        // Link verse ranges to the flat item list.
        let cursor = 0;
        verses.forEach(function (verse) {
            verse.firstItem = cursor;
            while (cursor < items.length && items[cursor].a === verse.a) {
                cursor += 1;
            }
            verse.lastItem = cursor - 1;
        });

        spans = new Array(items.length).fill(null);
        wordState = new Array(items.length).fill('pending');
        tracker = Core.createTracker(items);
        currentItem = -1;
        Object.keys(pronNotes).forEach(function (key) {
            delete pronNotes[key];
        });

        buildDom(range);
        setStatus(baseStatus());
        els.revealAll.disabled = false;
        els.resetButton.disabled = false;
        els.micToggle.disabled = false;
        if (!isSpeechAvailable()) {
            els.micToggle.disabled = true;
            els.micToggle.title = 'محرّك التعرّف المحلي غير متاح (تعذّر تحميل memorize-asr.js)';
        }
        moveCaret(tracker.cursor);
        saveState();
    }

    function buildDom(range) {
        const main = els.maincontent;
        main.textContent = '';

        const head = document.createElement('header');
        head.className = 'surah-head';
        const badge = document.createElement('span');
        badge.className = 'surah-head__badge';
        badge.textContent = toArabicDigits(range.surah);
        const name = document.createElement('h2');
        name.className = 'surah-head__name';
        name.textContent = suras[range.surah - 1].getAttribute('name') || '';
        head.appendChild(badge);
        head.appendChild(name);
        main.appendChild(head);

        if (range.from === 1 && range.surah !== 1 && range.surah !== 9) {
            const basmalaRow = document.createElement('div');
            basmalaRow.className = 'basmala-row';
            const basmala = document.createElement('p');
            basmala.className = 'basmala';
            basmala.textContent = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ';
            basmalaRow.appendChild(basmala);
            main.appendChild(basmalaRow);
        }

        const note = document.createElement('p');
        note.className = 'range-note';
        note.textContent = 'الآيات من ' + toArabicDigits(range.from) + ' إلى ' + toArabicDigits(range.to)
            + ' — الكلمات المخفية تُكتشف أثناء تلاوتك';
        main.appendChild(note);

        let article = null;
        let paragraph = null;
        let lastA = -1;
        items.forEach(function (item, index) {
            if (item.a !== lastA) {
                article = document.createElement('article');
                article.className = 'ayah';
                article.id = 'ayah-' + item.s + '-' + item.a;
                const ayahHead = document.createElement('div');
                ayahHead.className = 'ayah__head';
                const num = document.createElement('span');
                num.className = 'ayah__num';
                num.textContent = toArabicDigits(item.a);
                const rule = document.createElement('span');
                rule.className = 'ayah__rule';
                ayahHead.appendChild(num);
                ayahHead.appendChild(rule);
                article.appendChild(ayahHead);
                paragraph = document.createElement('p');
                paragraph.className = 'ayah__text';
                paragraph.setAttribute('lang', 'ar');
                article.appendChild(paragraph);
                main.appendChild(article);
                lastA = item.a;
            }
            const span = document.createElement('span');
            if (item.meta) {
                span.className = 'mw-meta';
                span.textContent = item.raw;
            } else {
                span.className = 'mw is-hidden' + (settings.hideMode === 'blur' ? ' is-blur' : '');
                span.dataset.i = String(index);
                span.textContent = item.raw;
                spans[index] = span;
            }
            if (paragraph.childNodes.length) {
                paragraph.appendChild(document.createTextNode(' '));
            }
            paragraph.appendChild(span);
        });
    }

    /* -----------------------------------------------------------------------
     * Word pronunciation (one tap on a revealed word)
     * -------------------------------------------------------------------- */

    let wordAudio = null;

    /* quran.com's word-by-word files merge a few printed word pairs into a
       single file («بَعْدَ مَا» in 2:181, 8:6 and 13:37, «إِلْ يَاسِينَ» in
       37:130 — the only merges in the whole Quran, verified against the
       mushaf page data for all 6,236 verses). Both words of a pair play the
       merged file, and every word after the pair shifts back by one number. */
    const WBW_MERGES = {
        '2:181': [[3, 4]],
        '8:6': [[4, 5]],
        '13:37': [[8, 9]],
        '37:130': [[3, 4]]
    };

    function pad3(value) {
        return String(value).padStart(3, '0');
    }

    /* The quran.com file number of an item (item.wbw adjusted for merges). */
    function wordAudioNumber(item) {
        const merges = WBW_MERGES[item.s + ':' + item.a];
        if (!merges) {
            return item.wbw;
        }
        let extra = 0;
        for (let i = 0; i < merges.length; i += 1) {
            const first = merges[i][0];
            const last = merges[i][1];
            if (item.wbw > last) {
                extra += last - first;      // the pair collapsed one number
            } else if (item.wbw >= first) {
                return first - extra;       // inside the pair → the merged file
            } else {
                break;
            }
        }
        return item.wbw - extra;
    }

    /* Plays the word's pronunciation from the same files the mushaf view
       uses («سماع الكلمة»). Returns false when there is no file (standalone
       waqf signs, which are never clickable anyway). */
    function playWordAudio(index) {
        const item = items[index];
        if (!item || item.meta || !item.wbw) {
            return false;
        }
        const file = 'wbw/' + pad3(item.s) + '_' + pad3(item.a) + '_'
            + pad3(wordAudioNumber(item)) + '.mp3';
        if (!wordAudio) {
            wordAudio = new Audio();
        }
        wordAudio.src = WORD_AUDIO_BASE + file;
        wordAudio.play().catch(function () {
            showToast('تعذّر تشغيل تلاوة الكلمة.');
        });
        return true;
    }

    /* -----------------------------------------------------------------------
     * Practice interactions (tap to reveal / hint / listen)
     * -------------------------------------------------------------------- */

    function onMainClick(event) {
        const span = event.target.closest ? event.target.closest('.mw') : null;
        if (!span || !span.dataset.i) {
            return;
        }
        const index = Number(span.dataset.i);
        const state = wordState[index];
        if (state === 'wait') {
            /* a word marked as a mistake: the user asked to reveal it
               themselves — one tap does it */
            manualReveal(index);
        } else if (state === 'pending') {
            setWordState(index, 'hint');
        } else if (state === 'hint' || state === 'errHint' || state === 'err-hint') {
            clearRevealTimer(index);
            manualReveal(index);
        } else if (playWordAudio(index)) {
            /* a revealed word: one more tap plays its pronunciation */
            flashWord(index);
        }
    }

    function manualReveal(index) {
        if (tracker && !items[index].meta) {
            applyOps(tracker.manualReveal(index));
        }
        if (wordState[index] !== 'manual') {
            // Already committed (ok/unclear/err): leave the committed visual.
            if (wordState[index] === 'pending' || wordState[index] === 'hint'
                || wordState[index] === 'errHint' || wordState[index] === 'err-hint' || wordState[index] === 'wait') {
                setWordState(index, 'manual');
            }
        }
    }

    function revealAll() {
        if (!tracker) {
            return;
        }
        for (let i = 0; i < items.length; i += 1) {
            if (items[i].meta) {
                continue;
            }
            const state = wordState[i];
            if (state === 'pending' || state === 'hint' || state === 'errHint' || state === 'err-hint'
                || state === 'peek' || state === 'wait') {
                clearRevealTimer(i);
                tracker.manualReveal(i);
                setWordState(i, 'manual');
            }
        }
        refreshVerseCompletion();
        showToast('أظهرت كل الكلمات — استخدم «من جديد» للبدء مجددًا');
    }

    function resetAll() {
        if (!tracker) {
            return;
        }
        clearTimeout(flashStatus.timer);
        Object.keys(revealTimers).forEach(function (key) {
            clearTimeout(revealTimers[key]);
            delete revealTimers[key];
        });
        setHeard('');
        applyOps(tracker.reset());
        moveCaret(tracker.cursor);
        setStatus(baseStatus());
    }

    /* -----------------------------------------------------------------------
     * Speech engine (on-device)
     *
     * All recognition runs inside the browser through window.QuranASR: the
     * FastConformer Quran int8 model (ort-nemo-asr-worker.js). The first use
     * downloads the model once; afterwards everything works offline and no
     * audio ever leaves the device.
     * -------------------------------------------------------------------- */

    function modelCached() {
        try {
            return localStorage.getItem(MODEL_FLAG) === '1';
        } catch (error) {
            return false;
        }
    }

    function markModelReady() {
        try {
            localStorage.setItem(MODEL_FLAG, '1');
        } catch (error) { /* storage unavailable */ }
    }

    function deviceLabel(info) {
        if (info && info.dtype === 'v8fp32') {
            return 'FastConformer v8 fp32';
        }
        if (info && info.dtype === 'v8') {
            return 'FastConformer v8';
        }
        if (info && info.dtype === 'int8') {
            return 'FastConformer int8';
        }
        if (info && info.device === 'webgpu') {
            return 'GPU';
        }
        return 'CPU';
    }

    function updateSupportNotice() {
        if (els.supportNotice) {
            els.supportNotice.hidden = modelReady || modelCached();
        }
    }

    function ensureAsr() {
        if (!asr && window.QuranASR) {
            asr = window.QuranASR.createEngine({
                level: function (value) {
                    if (els.meterFill) {
                        els.meterFill.style.width = Math.round(Math.min(1, value) * 100) + '%';
                    }
                },
                status: function (stage) {
                    if (stage === 'requesting-mic') {
                        setStatus('جارٍ طلب إذن الميكروفون…');
                    } else if (stage === 'listening') {
                        setStatus('أستمع إليك… ابدأ التلاوة');
                    } else if (stage === 'transcribing') {
                        setStatus('يفرّغ الكلام…');
                    } else if (stage === 'engine-restart') {
                        setStatus('أُعيد تشغيل محرّك التعرّف بعد توقف طويل — أعد المحاولة');
                    } else if (typeof stage === 'string' && stage.indexOf('int8 ') === 0) {
                        /* messages from the in-page FastConformer engine */
                        setStatus(stage.slice(5));
                    } else if (typeof stage === 'string' && stage.indexOf('loading ') === 0) {
                        setStatus('تهيئة محرّك التعرّف (' + stage.slice(8) + ')…');
                    } else if (typeof stage === 'string' && stage.indexOf('failed ') === 0) {
                        setStatus('تعذّر مسار (' + stage.slice(7) + ') — أجرّب بديلًا…');
                    }
                },
                progress: function (info) {
                    if (info && typeof info.progress === 'number' && isFinite(info.progress) && info.progress < 100) {
                        setStatus('تنزيل نموذج التعرّف… ' + toArabicDigits(Math.round(info.progress)) + '٪ — مرة واحدة فقط');
                        if (els.meterFill) {
                            els.meterFill.style.width = Math.min(100, Math.round(info.progress)) + '%';
                        }
                    }
                },
                ready: function (info) {
                    modelReady = true;
                    markModelReady();
                    updateSupportNotice();
                    if (els.meterFill) {
                        els.meterFill.style.width = '0%';
                    }
                    setStatus('النموذج جاهز (' + deviceLabel(info) + ') — اضغط الميكروفون للتلاوة');
                },
                transcript: function (text, meta) {
                    commitTranscript(text, meta);
                },
                utterance: function (samples) {
                    if (settings.engine === 'phoneme') {
                        flushPhonemeStream();
                    }
                },
                frame: function (frame) {
                    maybeStreamFrame(frame);
                },
                error: function (message) {
                    running = false;
                    updateMicUI();
                    const text = String(message || '');
                    if (text.indexOf('could not load the speech model') === 0 || text.indexOf('Failed to fetch') === 0) {
                        setStatus('تعذّر تحميل نموذج التعرّف — تحقّق من الاتصال بالإنترنت (يُحمَّل مرة واحدة ثم يعمل دون اتصال)');
                    } else {
                        setStatus('تعذّر تشغيل محرّك التعرّف: ' + text);
                    }
                }
            });
            /* the v8 engines also grade the expected words against the audio
               (tajweed GOP) — feed them the upcoming reference text */
            asr.setReferenceProvider(buildReference);
        }
        return asr;
    }

    function startListening() {
        if (!tracker || running) {
            return;
        }
        const engineInstance = ensureAsr();
        if (!engineInstance) {
            setStatus('محرّك التعرّف المحلي غير متاح');
            return;
        }
        if (settings.engine === 'phoneme') {
            /* phoneme-only: mic + VAD here, units decoded by the checker
               worker; the int8 model never loads in this mode */
            engineInstance.setCaptureOnly(true);
            /* raw capture — the model is trained on clean audio and the
               browser's noise suppression/AGC mangle the phonemes */
            engineInstance.setMicClean(true);
            ensurePronModel();
            setStatus('جارٍ تشغيل الميكروفون…');
        } else {
            engineInstance.setCaptureOnly(false);
            engineInstance.setMicClean(false);
            /* keep the live engine in step with the chosen recognizer */
            engineInstance.setEngineKind(asrKind()).catch(function () { });
            setStatus(modelCached() || modelReady
                ? 'جارٍ تشغيل الميكروفون…'
                : 'جارٍ تجهيز المحرّك (التنزيل يحدث مرة واحدة فقط)…');
        }
        /* start() loads the recognizer first (int8) and then asks for the
           microphone — no separate ensureModel call is needed. */
        engineInstance.start().then(function () {
            return engineInstance.start();
        }).then(function () {
            running = true;
            updateMicUI();
        }).catch(function (error) {
            running = false;
            updateMicUI();
            if (els.meterFill) {
                els.meterFill.style.width = '0%';
            }
            const name = error && error.name;
            if (name === 'NotAllowedError' || name === 'SecurityError') {
                setStatus('لم يُسمح باستخدام الميكروفون — يمكنك التدريب باللمس');
                showToast('يمكنك منح الإذن من أيقونة القفل في شريط العنوان');
            } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
                setStatus('لم أجد ميكروفونًا متصلًا');
            } else {
                setStatus('تعذّر بدء الاستماع: ' + ((error && error.message) || 'خطأ غير معروف'));
            }
        });
    }

    function stopListening() {
        running = false;
        stopPhonemeStream();
        if (asr) {
            asr.stop();
        }
        setHeard('');
        if (els.meterFill) {
            els.meterFill.style.width = '0%';
        }
        updateMicUI();
    }

    /* Session trail for diagnosing recognition behaviour (dev): keeps the
       last 120 utterances — what was heard, the resulting ops, and where
       the cursor ended up. Inspect with
       JSON.parse(localStorage.getItem('quran-memorize-log')). */
    function logSession(text, ops) {
        try {
            const trail = JSON.parse(localStorage.getItem('quran-memorize-log') || '[]');
            trail.push({
                at: new Date().toISOString(),
                heard: text,
                ops: ops.map(function (op) {
                    return op.op + (op.i !== undefined ? ':' + op.i : '');
                }).slice(0, 60),
                cursor: tracker ? tracker.cursor : null
            });
            while (trail.length > 120) {
                trail.shift();
            }
            localStorage.setItem('quran-memorize-log', JSON.stringify(trail));
        } catch (error) { /* storage unavailable */ }
    }

    /* v8 engines: the CTC worker force-aligns the EXPECTED text against its
       own log-probabilities and reports per reference word the worst token
       margin (tajweed GOP semantics). MEASURED LIMIT (2026-09-18): on clean
       reciter audio the reference tokenization often differs from the
       model's natural piece segmentation («َّ» vs «ّ»+«َحْ» …), so perfect
       recitation still produces −20-size margins on some words — the metric
       has no separation yet. The values still travel in the transcript meta
       (meta.gopWords) for future calibration; the dotting threshold stays
       unreachable on purpose so no correct word is ever flagged. */
    const V8_GOP_WRONG = -1e9;

    let lastReference = null;      /* { text, startIndex, counts } for the in-flight decode */

    /** Expected words for the next utterance: from the tracker cursor up to a
        sensible horizon. The recognizer needs the same text the reciter is
        about to say — words already settled are left out. */
    function buildReference() {
        if (!tracker) {
            return null;
        }
        const start = tracker.cursor;
        const words = [];
        const counts = [];
        for (let i = start; i < items.length && words.length < 60; i += 1) {
            const parts = String(items[i].raw || '').split(' ').filter(Boolean);
            counts.push(parts.length);
            parts.forEach(function (part) {
                if (words.length < 60) {
                    words.push(part);
                }
            });
        }
        if (!words.length) {
            return null;
        }
        return { text: words.join(' '), startIndex: start, counts: counts };
    }

    /** Dots the words whose GOP fell into the «wrong» band. */
    function applyGopNotes(meta) {
        if (settings.engine !== 'v8' && settings.engine !== 'v8fp32') {
            return;
        }
        if (!meta || !meta.gopWords || !meta.gopWords.length || !lastReference) {
            return;
        }
        const ref = lastReference;
        const flagged = [];
        let index = ref.startIndex;
        let within = 0;
        for (let i = 0; i < meta.gopWords.length && index < items.length; i += 1) {
            while (index < items.length && within >= ref.counts[index - ref.startIndex]) {
                index += 1;
                within = 0;
            }
            if (index >= items.length) {
                break;
            }
            const entry = meta.gopWords[i];
            const item = items[index];
            within += 1;
            if (!item || item.meta || !entry || !(entry.frames > 0)) {
                continue;
            }
            if (typeof entry.min === 'number' && entry.min < V8_GOP_WRONG) {
                flagged.push({ index: index, gop: entry.min });
            }
        }
        if (!flagged.length) {
            return;
        }
        flagged.forEach(function (entry) {
            const notes = [{ kind: 'confidence' }];
            if (wordState[entry.index] === 'pending') {
                pronNotes[entry.index] = notes;
            } else {
                markCheckerNote(entry.index, notes);
            }
        });
        const head = flagged.slice(0, 2).map(function (entry) {
            return '«' + items[entry.index].raw + '»';
        }).join(' و');
        flashStatus('مدقّق النطق: نطق غير واضح في ' + head + (flagged.length > 2 ? ' وغيرها' : ''));
    }

    function commitTranscript(text, meta) {
        if (!tracker) {
            return;
        }
        if (!text || !text.trim()) {
            /* the engine heard something but recognised nothing: keep the
               session trail complete and say so instead of failing silently */
            logSession('', []);
            flashStatus('لم أتعرّف على كلام في هذا المقطع — اقترب من الميكروفون وتكلّم بوضوح');
            return;
        }
        clearPeekMarks();
        const ops = tracker.finalize(text);
        applyOps(ops);
        logSession(text, ops);
        applyGopNotes(meta);
        const words = Core.tokenize(text);
        if (ops.some(function (op) { return op.op === 'lowconf'; })) {
            // Say back what was actually heard — the clearest way to explain
            // why nothing matched.
            const tail = words.slice(-6).join(' ');
            flashStatus('سمعت: «' + tail + '» — لا تُطابق الآيات المحددة؛ أعد من أول الآية أو قل الكلمة مع ما قبلها');
            setHeard(tail);
        } else if (words.length) {
            setHeard(words.slice(-8).join(' '));
        }
    }

    function updateMicUI() {
        if (!els.micToggle) {
            return;
        }
        els.micToggle.classList.toggle('is-listening', running);
        els.micToggle.setAttribute('aria-pressed', running ? 'true' : 'false');
        els.micToggle.setAttribute('aria-label', running ? 'إيقاف الاستماع' : 'بدء الاستماع');
    }

    /* -----------------------------------------------------------------------
     * UI wiring
     * -------------------------------------------------------------------- */

    function populateSurahs() {
        const select = els.surahSelect;
        select.textContent = '';
        for (let i = 0; i < suras.length; i += 1) {
            const option = document.createElement('option');
            option.value = String(i + 1);
            option.textContent = toArabicDigits(i + 1) + '. ' + (suras[i].getAttribute('name') || '');
            select.appendChild(option);
        }
        select.disabled = false;
    }

    function fillInputs(range) {
        els.surahSelect.value = String(range.surah);
        els.fromInput.value = toArabicDigits(range.from);
        els.toInput.value = toArabicDigits(range.to);
        els.surahSelect.disabled = false;
        els.fromInput.disabled = false;
        els.toInput.disabled = false;
        els.applyButton.disabled = false;
    }

    function readInputs() {
        const surah = parseInt(toLatinDigits(els.surahSelect.value), 10);
        const from = parseInt(toLatinDigits(els.fromInput.value), 10);
        const to = parseInt(toLatinDigits(els.toInput.value), 10);
        if (!(surah >= 1 && surah <= 114) || !(from >= 1) || !(to >= 1)) {
            showToast('أدخل أرقامًا صحيحة للسورة والآيات');
            return null;
        }
        return { surah: surah, from: from, to: to };
    }

    function applyInputs() {
        const range = readInputs();
        if (!range) {
            return;
        }
        const normalized = normalizeRange(range);
        fillInputs(normalized);
        renderRange(normalized);
    }

    function updateSegmented() {
        const radios = document.querySelectorAll('input[name="feedback"]');
        radios.forEach(function (radio) {
            const label = radio.closest('label');
            if (label) {
                label.classList.toggle('is-selected', radio.checked);
            }
        });
    }

    /* The tools menu of the bar (⋮ on small screens): the view switch and the
       theme live inside it there; on wide bars they stay inline. */
    function setMenu(open) {
        els.appbar.classList.toggle('is-menu-open', open);
        els.toolsToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function wireUI() {
        els.micToggle.addEventListener('click', function () {
            if (running) {
                stopListening();
                setStatus(baseStatus());
            } else {
                startListening();
            }
        });

        els.maincontent.addEventListener('click', onMainClick);

        els.settingsToggle.addEventListener('click', function () {
            const open = els.settingsPanel.hidden;
            els.settingsPanel.hidden = !open;
            els.settingsToggle.classList.toggle('is-active', open);
            els.settingsToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        });

        els.revealAll.addEventListener('click', revealAll);
        els.resetButton.addEventListener('click', resetAll);
        els.applyButton.addEventListener('click', applyInputs);

        els.surahSelect.addEventListener('change', function () {
            const surah = parseInt(toLatinDigits(els.surahSelect.value), 10);
            if (surah >= 1 && surah <= 114) {
                const count = verseCount(surah);
                const from = 1;
                const to = Math.min(count, 7);
                const normalized = normalizeRange({ surah: surah, from: from, to: to });
                fillInputs(normalized);
                renderRange(normalized);
            }
        });

        [els.fromInput, els.toInput].forEach(function (input) {
            input.addEventListener('keydown', function (event) {
                if (event.key === 'Enter') {
                    applyInputs();
                }
            });
            input.addEventListener('change', function () {
                input.value = toArabicDigits(toLatinDigits(input.value).replace(/[^0-9]/g, ''));
            });
        });

        document.querySelectorAll('input[name="feedback"]').forEach(function (radio) {
            radio.addEventListener('change', function () {
                settings.feedback = radio.value;
                updateSegmented();
                saveState();
            });
        });

        els.hideModeSelect.addEventListener('change', function () {
            settings.hideMode = els.hideModeSelect.value;
            for (let i = 0; i < wordState.length; i += 1) {
                if (wordState[i] === 'pending' && spans[i]) {
                    spans[i].classList.toggle('is-blur', settings.hideMode === 'blur');
                }
            }
            saveState();
        });

        els.autoscrollCheck.addEventListener('change', function () {
            settings.autoScroll = els.autoscrollCheck.checked;
            saveState();
        });
        if (els.phonemeModelSelect) {
            els.phonemeModelSelect.addEventListener('change', function () {
                switchPhonemeModel(els.phonemeModelSelect.value);
                saveState();
            });
        }
        if (els.engineSelect) {
            els.engineSelect.addEventListener('change', function () {
                settings.engine = els.engineSelect.value;
                saveState();
                stopListening();
                if (settings.engine === 'phoneme') {
                    ensurePronModel();
                    setStatus('محرّك الفونيمات — اضغط الميكروفون لبدء التلاوة');
                } else {
                    if (asr) {
                        asr.setEngineKind('int8').catch(function () { });
                    }
                    setStatus(baseStatus());
                }
            });
        }

        els.themeToggle.addEventListener('click', function () {
            const root = document.documentElement;
            const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
            root.setAttribute('data-theme', next);
            try {
                localStorage.setItem('quran-theme', next);
            } catch (error) { /* ignore */ }
            els.themeToggle.setAttribute('aria-label',
                next === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
        });

        /* The tools menu (⋮): opened by its button, closed by anything else. */
        els.toolsToggle.addEventListener('click', function () {
            setMenu(!els.appbar.classList.contains('is-menu-open'));
        });
        document.addEventListener('click', function (event) {
            if (els.appbar.classList.contains('is-menu-open')
                && !event.target.closest('#appbar-tools')
                && !event.target.closest('#tools-toggle')) {
                setMenu(false);
            }
        });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && els.appbar.classList.contains('is-menu-open')) {
                setMenu(false);
                els.toolsToggle.focus();
            }
        });
    }

    /* The word-recognition family. The page offers phoneme mode (its own
       engine) and the int8 FastConformer; this returns the FastConformer
       kind for the non-phoneme path (the v8 exports stay dormant code). */
    function asrKind() {
        return 'int8';
    }

    function syncSettingsUI() {
        document.querySelectorAll('input[name="feedback"]').forEach(function (radio) {
            radio.checked = radio.value === settings.feedback;
        });
        updateSegmented();
        els.hideModeSelect.value = settings.hideMode;
        els.autoscrollCheck.checked = Boolean(settings.autoScroll);
        if (els.phonemeModelSelect) {
            els.phonemeModelSelect.value = settings.phonemeModel === 'v31-fp32' ? 'v31-fp32' : 'v31-int8';
        }
        if (els.engineSelect) {
            els.engineSelect.value = settings.engine;
        }
    }

    /* -----------------------------------------------------------------------
     * Boot
     * -------------------------------------------------------------------- */

    function init() {
        els = {
            maincontent: document.getElementById('maincontent'),
            micToggle: document.getElementById('mic-toggle'),
            statusText: document.getElementById('status-text'),
            heardText: document.getElementById('heard-text'),
            meterFill: document.getElementById('meter-fill'),
            settingsToggle: document.getElementById('settings-toggle'),
            settingsPanel: document.getElementById('settings-panel'),
            revealAll: document.getElementById('reveal-all'),
            resetButton: document.getElementById('reset-button'),
            surahSelect: document.getElementById('surah-select'),
            fromInput: document.getElementById('from-input'),
            toInput: document.getElementById('to-input'),
            applyButton: document.getElementById('apply-button'),
            themeToggle: document.getElementById('theme-toggle'),
            appbar: document.getElementById('button-container'),
            toolsToggle: document.getElementById('tools-toggle'),
            supportNotice: document.getElementById('mic-support-notice'),
            hideModeSelect: document.getElementById('hide-mode-select'),
            autoscrollCheck: document.getElementById('autoscroll-check'),
            engineSelect: document.getElementById('engine-select'),
            phonemeModelSelect: document.getElementById('phoneme-model-select'),
            pronStatus: document.getElementById('proncheck-status')
        };

        wireUI();
        syncSettingsUI();
        updateSupportNotice();
        /* FastConformer (int8 or v8) is the recognizer; nothing downloads
           before the first mic press (loadNow=false only records the choice). */
        const bootEngine = ensureAsr();
        if (bootEngine) {
            bootEngine.setEngineKind(asrKind(), false);
        }
        if (settings.engine === 'phoneme') {
            /* the phoneme engine is the recognizer, not an add-on: start the
               one-time model load right away so the mic is ready sooner */
            ensurePronModel();
        }

        loadXml(SOURCE).then(function (nodes) {
            suras = nodes;
            populateSurahs();
            const range = resolveRange();
            fillInputs(range);
            renderRange(range);
        }).catch(function () {
            els.maincontent.textContent = '';
            const empty = document.createElement('p');
            empty.className = 'empty';
            empty.textContent = 'تعذّر تحميل النص القرآني — تحقّق من الاتصال، أو نزّل المحتوى للقراءة دون اتصال.';
            els.maincontent.appendChild(empty);
            setStatus('تعذّر التحميل');
        });
    }

    /* -----------------------------------------------------------------------
     * Test hooks (used by the browser checks; harmless in production)
     * -------------------------------------------------------------------- */

    window.QuranMemorize = {
        _feed: function (text) {
            if (!tracker) {
                return [];
            }
            clearPeekMarks();
            const ops = tracker.finalize(text);
            applyOps(ops);
            return ops;
        },
        _peek: function (text) {
            if (!tracker) {
                return [];
            }
            const ops = tracker.optimistic(text);
            applyOps(ops);
            return ops;
        },
        _reset: function () {
            resetAll();
        },
        _revealAll: function () {
            revealAll();
        },
        _state: function () {
            if (!tracker) {
                return null;
            }
            return {
                cursor: tracker.cursor,
                states: wordState.slice(),
                done: tracker.done,
                stats: Object.assign({}, tracker.stats),
                range: currentRange ? Object.assign({}, currentRange) : null
            };
        },
        _items: function () {
            return items.map(function (item) {
                return { raw: item.raw, norm: item.norm, meta: item.meta, soft: item.soft, s: item.s, a: item.a };
            });
        },
        _setSetting: function (key, value) {
            settings[key] = value;
            syncSettingsUI();
            saveState();
            if (key === 'model' && asr) {
                /* keep the live engine in step when the hook switches models */
                asr.setEngineKind(value).catch(function () { });
            }
            if (key === 'phonemeModel') {
                switchPhonemeModel(value);
            }
            return settings[key];
        },
        _asr: function () {
            return asr
                ? { device: asr.device(), listening: asr.isListening(), busy: asr.isBusy(), modelReady: modelReady }
                : null;
        },
        _ensureModel: function () {
            const engineInstance = ensureAsr();
            if (!engineInstance) {
                return Promise.reject(new Error('QuranASR missing'));
            }
            return engineInstance.setEngineKind('int8');
        },
        _ensureV8: function (kind) {
            const engineInstance = ensureAsr();
            if (!engineInstance) {
                return Promise.reject(new Error('QuranASR missing'));
            }
            return engineInstance.setEngineKind(kind === 'v8fp32' ? 'v8fp32' : 'v8');
        },
        _transcribe: function (samples) {
            /* test hook: run a 16 kHz utterance through the live engine
               (includes the GOP reference the app would send) */
            const engineInstance = ensureAsr();
            if (!engineInstance) {
                return Promise.reject(new Error('QuranASR missing'));
            }
            return engineInstance.transcribeSamples(samples);
        },
        _decodeAudio: function (arrayBuffer) {
            const engineInstance = ensureAsr();
            if (!engineInstance) {
                return Promise.reject(new Error('QuranASR missing'));
            }
            return engineInstance.decodeTo16k(arrayBuffer);
        },
        _reference: function () {
            /* test hook: what the next utterance would be graded against */
            return buildReference();
        },
        _resetEngine: function () {
            /* test hook: drop the live recognizer (workers reload on the
               next ensure, picking up fresh worker scripts) */
            if (asr) {
                try { asr.dispose(); } catch (error) { /* ignore */ }
                asr = null;
                modelReady = false;
            }
            return true;
        },
        _inject: function (text, meta) {
            /* test hook: commit a transcript with worker-style word data */
            commitTranscript(text, meta || null);
            return true;
        },
        _phon: function (units) {
            /* feeds heard phoneme units straight into the checker (tests) */
            handlePhonemes({ units: units });
            return true;
        },
        _phonState: function () {
            return {
                enabled: settings.engine === 'phoneme',
                ready: pronLoaded,
                busy: pronBusy,
                model: pronModelActive,
                requested: phonemeModelId()
            };
        },
        _phonLoad: function () {
            const promise = ensurePronModel();
            return promise || Promise.reject(new Error('checker disabled'));
        },
        _phonLog: function () {
            try {
                return JSON.parse(localStorage.getItem('quran-phoneme-log') || '[]');
            } catch (error) {
                return [];
            }
        },
        _phonAudio: function (samples) {
            /* routes raw 16k samples through the continuous stream (tests) */
            if (settings.engine !== 'phoneme') {
                return false;
            }
            for (let at = 0; at < samples.length; at += 4096) {
                maybeStreamFrame(samples.slice(at, at + 4096));
            }
            return true;
        },
        _phonStreamState: function () {
            return {
                started: phonStreamStarted,
                pendingUnits: phonStreamUnits.length,
                aligning: phonStreamAligning
            };
        },
        _phonEnd: function () {
            /* flushes and closes the stream (tests) */
            stopPhonemeStream();
            return true;
        },
        _phonFlush: function () {
            /* decodes the pending tail without closing the stream (tests) */
            flushPhonemeStream();
            return true;
        }
    };

    init();
})();
