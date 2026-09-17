/**
 * "Download for offline use" - shared by index.html and index2.html.
 *
 * Adds a تنزيل button to the tools menu of both pages. It opens a small panel
 * with two downloads:
 *
 *   المصحف والنصوص والتفاسير  the six Quran XML files of QuranText/Quran,
 *                             every Arabic tafsir plus the ones picked in the
 *                             sources picker, the Mushaf page data with its
 *                             page fonts, the flags and the ʿUthmānic font
 *                             (about 124 MB)
 *   التلاوة                   every recitation file of one reciter, chosen
 *                             in the panel (567 MB - 1.4 GB)
 *
 * The files are fetched here, a few at a time, and stored straight into the
 * two caches the service worker serves from (quran-data / quran-audio):
 *
 *   - the `x-quran-offline` header tells the worker to step aside, so it does
 *     not also keep its own, trimmable copy of a file the reader asked to
 *     keep, and
 *   - every stored file is announced to the worker, which pins it in its
 *     ledger. The byte budgets and their oldest-first eviction only ever
 *     touch what the worker cached by itself, so a download is never evicted
 *     by ordinary reading (see the message handler in sw.js).
 *
 * A download can be stopped and started again at any time: files the cache
 * already holds are skipped, so it picks up where it left off. حذف التنزيل
 * gives the space back.
 *
 * Everything here works in a normal tab as well - it fills the same caches -
 * but the installed app is where it pays off, because that is what opens
 * offline in the first place.
 */
(function () {
    'use strict';

    const DATA_CACHE = 'quran-data';
    const AUDIO_CACHE = 'quran-audio';
    const PAGE_DIR = 'QuranText/MushafPages/';
    const CATALOG_URL = 'QuranText/catalog.json';
    const RECITERS_URL = 'QuranAudio/reciters.json';
    const RECITER_KEY = 'quran-reciter';
    const SOURCES_KEY = 'quran-sources';

    /* The worker skips its own caching for requests carrying this header. */
    const OFFLINE_HEADER = 'x-quran-offline';

    /* Files fetched at the same time; local files answer fast, and a phone
     * connection benefits from more than one request in flight. */
    const CONCURRENCY = 4;

    /* How many stored files are announced to the worker in one message. */
    const PIN_BATCH = 200;

    /* The six text files of QuranText/Quran: the reader's own text and search
     * copies, plus the four the other sources are built from. */
    const QURAN_XML = [
        'quran-simple.xml',
        'quran-simple-clean.xml',
        'quran-simple-min.xml',
        'quran-simple-plain.xml',
        'quran-uthmani.xml',
        'quran-uthmani-min.xml'
    ].map(name => 'QuranText/Quran/' + name);

    const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
    const toArabic = value => String(value).replace(/[0-9]/g, digit => ARABIC_DIGITS[Number(digit)]);

    /* 1048576 -> "١ م.ب", 1.4 GB -> "١٫٤ ج.ب" */
    function sizeText(bytes) {
        if (!bytes) return '';
        const gigabytes = bytes / 1073741824;
        if (gigabytes >= 1) return toArabic(gigabytes.toFixed(1)).replace('.', '٫') + ' ج.ب';
        return toArabic(Math.max(1, Math.round(bytes / 1048576))) + ' م.ب';
    }

    function getJson(url) {
        return fetch(url, { cache: 'no-cache' }).then(response => {
            if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + url);
            return response.json();
        });
    }

    /* The tafsir and translation files the reader has ticked, read from the
     * same keys the sources picker of the app writes (its two older
     * single-select keys included). */
    function selectedSources() {
        let stored = null;
        try {
            stored = JSON.parse(localStorage.getItem(SOURCES_KEY));
        } catch (error) {
            stored = null;
        }
        if (Array.isArray(stored)) return stored;

        const chosen = [];
        let hadChoice = false;
        ['quran-tafsir', 'quran-translation'].forEach(key => {
            let value = null;
            try {
                value = localStorage.getItem(key);
            } catch (error) {
                value = null;
            }
            if (value !== null) {
                hadChoice = true;
                if (value) chosen.push(value);
            }
        });
        return hadChoice ? chosen : ['ar.jalalayn', 'en.sahih'];
    }

    function storedReciter() {
        try {
            return localStorage.getItem(RECITER_KEY) || '';
        } catch (error) {
            return '';
        }
    }

    /* --------------------------------------------------------------------------
     * The two file lists
     * ----------------------------------------------------------------------- */

    /* Everything the reader and the Mushaf need for a full offline run. */
    async function contentFiles() {
        const files = new Set(QURAN_XML);
        files.add(CATALOG_URL);
        files.add(RECITERS_URL);

        const catalog = await getJson(CATALOG_URL).catch(() => ({ tafsirs: [], translations: [] }));
        const picked = new Set(selectedSources());
        for (const entry of [].concat(catalog.tafsirs || [], catalog.translations || [])) {
            if (!entry || !entry.path) continue;
            /* Every Arabic tafsir, plus whatever the reader has ticked. */
            if (entry.path.indexOf('QuranText/Arabic-Tafsir/') !== 0 && !picked.has(entry.id)) continue;
            files.add(entry.path);
            if (entry.flag) files.add('flags/' + entry.flag + '.png');
        }

        const manifest = await getJson(PAGE_DIR + 'index.json');
        files.add(PAGE_DIR + 'index.json');
        files.add(PAGE_DIR + 'verse-pages.json');
        for (const info of manifest.pages || []) {
            files.add(PAGE_DIR + 'p' + info.page + '.json');
            if (info.font) files.add(info.font);
        }
        if (manifest.surahNamesFont) files.add(manifest.surahNamesFont);
        files.add('fonts/uthmanic_hafs_v22.ttf');

        return Array.from(files);
    }

    /* Every recitation file of one reciter: the basmala that opens a surah
     * (<sura>000.mp3, which surah 1 has as its first ayah and surah 9 has
     * none), then the ayah files. Files a folder does not have answer 404 and
     * are counted as done, so a partial recitation still downloads. */
    async function reciterFiles(reciterId) {
        const manifest = await getJson(PAGE_DIR + 'index.json');
        const base = 'QuranAudio/' + encodeURIComponent(reciterId) + '/';
        const files = [];
        for (const chapter of manifest.chapters || []) {
            const surah = String(chapter.id).padStart(3, '0');
            if (chapter.id !== 1 && chapter.id !== 9) files.push(base + surah + '000.mp3');
            for (let ayah = 1; ayah <= chapter.versesCount; ayah += 1) {
                files.push(base + surah + String(ayah).padStart(3, '0') + '.mp3');
            }
        }
        return files;
    }

    /* --------------------------------------------------------------------------
     * Storing, announcing and removing
     * ----------------------------------------------------------------------- */

    const absolute = file => new URL(file, document.baseURI).href;

    /* The files of a list that the cache already holds. */
    async function cachedCount(cacheName, files) {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        const have = new Set(keys.map(request => request.url));
        let done = 0;
        for (const file of files) {
            if (have.has(absolute(file))) done += 1;
        }
        return done;
    }

    /* The worker keeps the ledger; the page tells it what it stored itself so
     * those files are pinned (and can be unpinned again on حذف). Messages sent
     * before a worker is in control are kept and flushed once one is. */
    let unsent = [];

    function tellWorker(type, cache, files) {
        if (!files.length) return;
        const controller = navigator.serviceWorker && navigator.serviceWorker.controller;
        if (!controller) {
            unsent.push({ type, cache, files });
            return;
        }
        controller.postMessage({ type: type, cache: cache, files: files });
    }

    if (navigator.serviceWorker) {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            const pending = unsent;
            unsent = [];
            for (const message of pending) tellWorker(message.type, message.cache, message.files);
        });
    }

    /* Downloads one list into its cache. Files the cache already holds are
     * skipped, so starting again resumes instead of repeating. */
    async function download(job, files) {
        if (job.running) return;
        job.running = true;
        job.cancel = false;
        job.error = '';
        job.done = 0;
        job.kept = 0;      // already in the cache from an earlier run
        job.stored = 0;    // fetched and stored by this run
        job.missing = 0;   // not on the server (a hole in a recitation)
        job.bytes = 0;
        job.total = files.length;

        const cache = await caches.open(job.cache);
        let pin = [];    // [key, bytes] stored by this run
        let keep = [];   // keys the cache already held: pinned as well
        const flush = () => {
            tellWorker('offline-stored', job.cache, pin);
            tellWorker('offline-keep', job.cache, keep);
            pin = [];
            keep = [];
        };

        let next = 0;
        const worker = async () => {
            while (!job.cancel) {
                const index = next;
                next += 1;
                if (index >= files.length) return;
                const key = absolute(files[index]);

                if (await cache.match(key)) {
                    job.done += 1;
                    job.kept += 1;
                    /* Stored before (by this worker or an earlier download):
                     * pin it too, or the byte budget could evict it. */
                    keep.push([key]);
                    if (keep.length >= PIN_BATCH) flush();
                    progress(job);
                    continue;
                }
                let response = null;
                for (let attempt = 0; attempt < 2 && !response; attempt += 1) {
                    try {
                        response = await fetch(key, { headers: { 'x-quran-offline': '1' } });
                    } catch (error) {
                        if (attempt) throw error;   // a second failure stops the job
                    }
                }
                if (response.status === 404) {
                    /* Not on this server (a hole in a recitation): fine. */
                    job.done += 1;
                    job.missing += 1;
                    progress(job);
                    continue;
                }
                if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + files[index]);

                const bytes = Number(response.headers.get('content-length'))
                    || (await response.clone().blob()).size;
                await cache.put(new Request(key), response);

                job.done += 1;
                job.stored += 1;
                job.bytes += bytes;
                pin.push([key, bytes]);
                if (pin.length >= PIN_BATCH) flush();
                progress(job);
            }
        };

        try {
            await Promise.all(Array.from({ length: CONCURRENCY }, worker));
            flush();
            job.state = job.cancel ? 'idle' : 'done';
        } catch (error) {
            flush();
            job.state = 'error';
            job.error = error.message || String(error);
        } finally {
            job.running = false;
            job.have = job.kept + job.stored;
            render();
        }
    }

    /* Gives the space of a list back: the stored files and their ledger rows. */
    async function remove(job, files) {
        if (job.running) return;
        job.running = true;
        job.state = 'removing';
        job.done = 0;
        job.total = files.length;
        render();

        const cache = await caches.open(job.cache);
        const gone = [];
        for (const file of files) {
            const key = absolute(file);
            if (await cache.delete(key)) gone.push([key, 0]);
            job.done += 1;
            progress(job);
        }
        tellWorker('offline-delete', job.cache, gone);

        job.running = false;
        await refresh(job);
    }

    /* --------------------------------------------------------------------------
     * The panel
     * ----------------------------------------------------------------------- */

    const jobs = {
        content: {
            cache: DATA_CACHE,
            build: contentFiles,
            running: false,
            cancel: false,
            state: 'idle',
            done: 0,
            have: 0,
            total: 0,
            kept: 0,
            bytes: 0,
            error: '',
            size: '≈ ١٢٤ م.ب'
        },
        reciter: {
            cache: AUDIO_CACHE,
            build: () => reciterFiles(currentReciter()),
            running: false,
            cancel: false,
            state: 'idle',
            done: 0,
            have: 0,
            total: 0,
            kept: 0,
            bytes: 0,
            error: '',
            size: ''
        }
    };

    let panel = null;
    let button = null;
    let picker = null;
    let reciters = null;          // [{ id, name, bytes? }]
    let currentReciter = () => storedReciter();
    const rows = {};

    function progress(job) {
        if (renderTimer) return;
        renderTimer = setTimeout(() => {
            renderTimer = null;
            render();
        }, 200);
    }
    let renderTimer = null;

    /* Rebuilds a job's file list and how much of it is stored. */
    async function refresh(job) {
        try {
            job.list = await job.build();
            job.total = job.list.length;
            job.have = await cachedCount(job.cache, job.list);
            job.state = job.have && job.have === job.total ? 'done' : 'idle';
        } catch (error) {
            job.state = 'error';
            job.error = 'تعذّر قراءة قائمة الملفات';
        }
        render();
    }

    function stateText(job) {
        if (job.state === 'running') {
            const percent = job.total ? Math.round(job.done / job.total * 100) : 0;
            return 'جارٍ التنزيل — ' + toArabic(job.done) + ' من ' + toArabic(job.total)
                + ' (' + toArabic(percent) + '٪)' + (job.bytes ? ' • ' + sizeText(job.bytes) : '');
        }
        if (job.state === 'removing') {
            return 'جارٍ الحذف — ' + toArabic(job.done) + ' من ' + toArabic(job.total);
        }
        if (job.state === 'error') return 'تعذّر إكمال التنزيل: ' + job.error;
        if (job.state === 'done') return '✓ محفوظ بالكامل للقراءة دون اتصال';
        if (job.have) return 'محفوظ ' + toArabic(job.have) + ' من ' + toArabic(job.total) + ' — يمكن الاستئناف';
        return 'لم يُنزَّل بعد';
    }

    function render() {
        for (const name of Object.keys(rows)) {
            const job = jobs[name];
            const row = rows[name];
            if (!row) continue;

            row.state.textContent = stateText(job);
            const fraction = job.state === 'running' || job.state === 'removing'
                ? (job.total ? job.done / job.total : 0)
                : (job.total ? job.have / job.total : 0);
            row.bar.style.width = Math.round(fraction * 100) + '%';

            const busy = job.state === 'running' || job.state === 'removing';
            row.start.hidden = busy || job.state === 'done';
            row.cancel.hidden = job.state !== 'running';
            row.remove.hidden = busy || !job.have;
        }
    }

    function buildRow(name, titleHTML) {
        const box = document.createElement('div');
        box.className = 'offline__job';
        box.innerHTML = '<div class="offline__row">' + titleHTML + '</div>'
            + '<p class="offline__state"></p>'
            + '<div class="offline__bar"><i></i></div>'
            + '<div class="offline__actions">'
            + '<button class="btn btn--primary" type="button" data-action="start">تنزيل</button>'
            + '<button class="btn" type="button" data-action="cancel" hidden>إلغاء</button>'
            + '<button class="btn" type="button" data-action="remove" hidden>حذف التنزيل</button>'
            + '</div>';

        rows[name] = {
            box: box,
            state: box.querySelector('.offline__state'),
            bar: box.querySelector('.offline__bar i'),
            start: box.querySelector('[data-action="start"]'),
            cancel: box.querySelector('[data-action="cancel"]'),
            remove: box.querySelector('[data-action="remove"]')
        };

        rows[name].start.addEventListener('click', () => {
            const job = jobs[name];
            if (navigator.storage && navigator.storage.persist) {
                /* Best effort: keeps the browser from evicting a download. */
                navigator.storage.persist().catch(() => { });
            }
            if (!job.list) {
                refresh(job).then(() => download(job, job.list || []));
                return;
            }
            download(job, job.list);
        });
        rows[name].cancel.addEventListener('click', () => {
            jobs[name].cancel = true;
        });
        rows[name].remove.addEventListener('click', () => {
            const job = jobs[name];
            if (job.list) remove(job, job.list);
        });

        return box;
    }

    /* The reciter picker inside the panel: the one the app plays, with each
     * folder's size when QuranAudio/reciters.json carries it. */
    async function buildReciterSelect(select) {
        if (!reciters) {
            reciters = await getJson(RECITERS_URL).catch(() => []);
            if (!Array.isArray(reciters)) reciters = reciters ? [reciters] : [];
        }
        /* Filled once: a reciter picked in the panel survives reopening it. */
        if (!select.dataset.ready) {
            select.dataset.ready = '1';
            const wanted = storedReciter();
            select.innerHTML = reciters.map(reciter =>
                '<option value="' + reciter.id + '">' + reciter.name + '</option>').join('');
            const known = reciters.some(reciter => reciter.id === wanted);
            select.value = known ? wanted : (reciters[0] ? reciters[0].id : '');
        }
        currentReciter = () => select.value || storedReciter();
    }

    function sizeOfReciter(id) {
        const reciter = (reciters || []).find(item => item.id === id);
        return reciter && reciter.bytes ? '≈ ' + sizeText(reciter.bytes) : '';
    }

    function renderReciterSize() {
        if (!rows.reciter || !rows.reciter.size) return;
        rows.reciter.size.textContent = sizeOfReciter(currentReciter());
    }

    async function buildPanel() {
        picker = document.createElement('div');
        picker.className = 'picker offline';
        picker.id = 'offline-picker';

        button = document.createElement('button');
        button.type = 'button';
        button.id = 'offline-toggle';
        button.className = 'btn';
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-controls', 'offline-panel');
        button.title = 'تنزيل المحتوى للقراءة دون اتصال';
        button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"'
            + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            + '<path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M4 19h16"></path></svg>'
            + '<span class="btn__label">تنزيل</span>';

        panel = document.createElement('div');
        panel.className = 'picker__panel offline__panel';
        panel.id = 'offline-panel';
        panel.hidden = true;
        panel.innerHTML = '<p class="offline__title">القراءة دون اتصال</p>'
            + '<p class="offline__note">تُحفظ الملفات داخل المتصفح، فيعمل التطبيق بلا شبكة. '
            + 'يمكن إيقاف التنزيل ثم استئنافه، وحذفه يعيد المساحة.</p>'
            + '<p class="offline__note offline__space"></p>';

        const textRow = buildRow('content',
            '<span class="offline__name">المصحف والنصوص والتفاسير</span>'
            + '<span class="offline__size">' + jobs.content.size + '</span>');
        const reciterRow = buildRow('reciter',
            '<select class="offline__select" aria-label="اختر القارئ لتنزيل تلاوته"></select>'
            + '<span class="offline__size"></span>');
        rows.reciter.size = reciterRow.querySelector('.offline__size');

        panel.appendChild(textRow);
        panel.appendChild(reciterRow);

        const select = reciterRow.querySelector('select');
        select.addEventListener('change', () => {
            renderReciterSize();
            refresh(jobs.reciter);
        });

        picker.appendChild(button);
        picker.appendChild(panel);

        const tools = document.getElementById('appbar-tools');
        if (!tools) return;
        /* The tools menu wraps on small screens; the panel follows the picker
         * rules of the page it is on (up in index2.html, down in index.html). */
        tools.appendChild(picker);

        const setOpen = open => {
            panel.hidden = !open;
            button.setAttribute('aria-expanded', open ? 'true' : 'false');
            if (!open) return;
            if (navigator.storage && navigator.storage.estimate) {
                navigator.storage.estimate().then(estimate => {
                    const free = (estimate.quota || 0) - (estimate.usage || 0);
                    panel.querySelector('.offline__space').textContent =
                        free > 0 ? 'المساحة المتاحة في المتصفح: ' + sizeText(free) : '';
                }).catch(() => { });
            }
            buildReciterSelect(select).then(() => {
                renderReciterSize();
                /* What is stored can have changed since the panel was last
                 * open (another tab, a download that was stopped, ...). */
                if (!jobs.reciter.running) refresh(jobs.reciter);
            });
            if (!jobs.content.running) refresh(jobs.content);
            render();
        };

        button.addEventListener('click', event => {
            event.stopPropagation();
            setOpen(panel.hidden);
        });
        document.addEventListener('click', event => {
            if (!panel.hidden && !picker.contains(event.target)) setOpen(false);
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') setOpen(false);
        });
    }

    /* The panel's own styles, following the page's colour variables. */
    function addStyles() {
        const style = document.createElement('style');
        style.textContent = ''
            + '.offline__panel { width: min(370px, calc(100vw - 24px)); padding: 12px; }'
            + '.offline__title { margin: 0 0 6px; font-family: var(--font-ar); font-size: 1rem;'
            + ' font-weight: 700; color: var(--text); }'
            + '.offline__note { margin: 0 0 10px; color: var(--muted); font-family: var(--font-ar);'
            + ' font-size: 0.84rem; line-height: 1.6; }'
            + '.offline__job { padding: 10px; border: 1px solid var(--border); border-radius: 12px; }'
            + '.offline__job + .offline__job { margin-top: 10px; }'
            + '.offline__row { display: flex; gap: 8px; align-items: center; justify-content: space-between; }'
            + '.offline__name { font-family: var(--font-ar); font-size: 0.95rem; color: var(--text); }'
            + '.offline__size { color: var(--muted); font-size: 0.78rem; white-space: nowrap; }'
            + '.offline__state { margin: 6px 0 0; min-height: 1.3em; color: var(--muted);'
            + ' font-family: var(--font-ar); font-size: 0.82rem; }'
            + '.offline__bar { height: 6px; margin-top: 8px; overflow: hidden; border-radius: 999px;'
            + ' background: var(--surface-2); }'
            + '.offline__bar i { display: block; width: 0; height: 100%; border-radius: inherit;'
            + ' background: var(--accent); transition: width 200ms ease; }'
            + '.offline__actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }'
            + '.offline__actions .btn { padding: 6px 12px; font-family: var(--font-ar); font-size: 0.85rem; }'
            + '.offline__select { flex: 1; min-width: 0; height: 34px; padding: 0 8px;'
            + ' border: 1px solid var(--border); border-radius: 9px; background: var(--surface-2);'
            + ' color: var(--text); font-family: var(--font-ar); font-size: 0.88rem; }';
        document.head.appendChild(style);
    }

    /* Offline downloads need Cache Storage and a service worker to be worth
     * anything, so the button only appears where both exist. */
    if ('caches' in window && 'serviceWorker' in navigator) {
        addStyles();
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => buildPanel());
        } else {
            buildPanel();
        }
    }

    /* Kept small and stable: the tests drive the downloads through this. */
    window.QuranOffline = {
        jobs: jobs,
        start: (name, files) => {
            const job = jobs[name];
            if (!job) return Promise.resolve();
            return files ? download(job, files) : refresh(job).then(() => download(job, job.list || []));
        },
        remove: (name, files) => {
            const job = jobs[name];
            if (!job) return Promise.resolve();
            return files ? remove(job, files) : refresh(job).then(() => remove(job, job.list || []));
        },
        report: name => refresh(jobs[name]),
        contentFiles: contentFiles,
        reciterFiles: reciterFiles
    };
})();
