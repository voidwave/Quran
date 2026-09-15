'use strict';

/* ---------------------------------------------------------------------------
 * Mushaf reader — index2.html
 *
 * The whole Quran (604 printed pages) drawn the way the print does it, with the
 * technique quran.com uses:
 *
 *   1. data       QuranText/MushafPages/p<page>.json lists the words of one
 *                 printed page (built by tools/build-mushaf-pages.mjs). A word
 *                 carries `g` (the code points of its glyph in the page font),
 *                 `x` (the real ʿUthmānī word) and its printed line number.
 *   2. glyphs     every word becomes one <span> in the page font p<page>-v2, so
 *                 a word is a single vector shape in its printed form.
 *   3. layout     the words of a printed line are spread over the full page
 *                 width, so the text breaks exactly where the printed page
 *                 breaks; one glyph size is shared by every page, like the print.
 *   4. text       the real words stay next to the glyphs, so selection, screen
 *                 readers and the copy handler all see real Arabic.
 *
 * The pages are stacked in one long column and drawn only while they are near
 * the viewport, so the Quran scrolls like one document on desktop and mobile.
 * ------------------------------------------------------------------------ */
const PAGE_DIR = 'QuranText/MushafPages/';
const MANIFEST_URL = PAGE_DIR + 'index.json';
const WORD_AUDIO_BASE = 'https://verses.quran.com/';   // word-by-word recitation
const THEME_KEY = 'quran-theme';

/* Line pitch of the printed page: quran.com lays a 43.72px glyph on a 76.19px
 * line, i.e. 1.743. The page scales with this factor. */
const LINE_RATIO = 1.743;

/* A surah banner takes two of the 15 printed lines. */
const BANNER_LINES = 2;

/* Pages are drawn when they come this close to the viewport, and dropped again
 * once they are that far away from it. */
const RENDER_MARGIN = '1500px 0px';
const KEEP_MARGIN = '4000px 0px';

/* Parsed pages kept in memory. */
const PAGE_CACHE = 24;

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const toArabicDigits = value => String(value).replace(/\d/g, digit => ARABIC_DIGITS[Number(digit)]);

const state = {
    manifest: null,
    chapters: [],
    pages: [],               // page numbers, ascending
    pageInfo: new Map(),     // page number -> { slots, font, fontBytes }
    slots: [],               // the slot element of every page
    offsets: [],             // slot offsetTops, so finding the current page is cheap
    data: new Map(),         // page number -> parsed JSON (LRU)
    open: new Map(),         // page number -> { slot, card, words }
    loading: new Map(),      // page number -> promise
    fonts: new Map(),        // family -> promise
    size: 0,                 // the glyph size shared by every page
    extraHeight: 0,          // page padding + page number
    current: 1,
    openWord: null
};

const el = {
    appbar: document.getElementById('appbar'),
    mushaf: document.getElementById('mushaf'),
    chip: document.getElementById('page-chip'),
    prev: document.getElementById('prev-page'),
    next: document.getElementById('next-page'),
    surahToggle: document.getElementById('surah-toggle'),
    surahPanel: document.getElementById('surah-panel'),
    surahFilter: document.getElementById('surah-filter'),
    surahList: document.getElementById('surah-list'),
    random: document.getElementById('random-button'),
    theme: document.getElementById('theme-toggle'),
    popover: document.getElementById('popover'),
    toast: document.getElementById('toast')
};

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------ */
function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

let toastTimer = null;
function showToast(text) {
    el.toast.textContent = text;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2800);
}

function debounce(fn, wait) {
    let timer = null;
    return function () {
        clearTimeout(timer);
        timer = setTimeout(fn, wait);
    };
}

async function getJson(url) {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(response.status + ' ' + url);
    return response.json();
}

/* Loads a font through the FontFace API so it is ready before measuring the
 * lines (measuring with a fallback font would size the page wrongly). */
async function ensureFont(family, url) {
    if (state.fonts.has(family)) return true;
    try {
        const face = new FontFace(family, 'url("' + url + '")');
        await face.load();
        document.fonts.add(face);
        state.fonts.add(family);
        return true;
    } catch (error) {
        console.warn('Font failed to load:', family, error);
        return false;
    }
}

/* ---------------------------------------------------------------------------
 * Drawing one printed page
 * ------------------------------------------------------------------------ */
function surahBanner(chapter) {
    const banner = element('div', 'banner');
    const icon = element('span', 'chapter-icon');
    icon.setAttribute('data-chapter-icon', String(chapter).padStart(3, '0'));
    icon.setAttribute('aria-hidden', 'true');
    banner.appendChild(icon);
    /* Surah 9 has no basmala; in surah 1 the basmala is verse 1 itself. */
    if (chapter !== 9 && chapter !== 1) {
        banner.appendChild(element('span', 'banner__basmala', 'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ'));
    }
    return banner;
}

function wordElement(word, words) {
    const span = element('span', word.t === 'end' ? 'word word--end' : 'word');
    span.dataset.loc = word.k + ':' + word.p;
    span.dataset.type = word.t;
    span.setAttribute('role', 'button');
    span.tabIndex = 0;
    span.setAttribute('aria-label', word.x);
    span.textContent = word.g;
    words.set(span.dataset.loc, word);
    return span;
}

/* Draws one printed page into a page sheet. */
function buildCard(data, fontOk) {
    const card = element('div', 'page');
    card.dir = 'rtl';
    card.lang = 'ar';
    card.setAttribute('translate', 'no');
    card.style.setProperty('--page-font', fontOk ? '"' + data.font + '"' : '"Uthmanic"');

    const lines = element('div', 'page__lines');
    const words = new Map();

    for (const line of data.lines) {
        /* A surah opens at the head of a printed line: draw its banner. */
        const first = line.words[0];
        if (first.p === 1 && /:1$/.test(first.k)) {
            lines.appendChild(surahBanner(Number(first.k.split(':')[0])));
        }

        const row = element('div', 'line-row');
        for (const word of line.words) row.appendChild(wordElement(word, words));
        lines.appendChild(row);
    }

    card.appendChild(lines);
    card.appendChild(element('div', 'page__number', toArabicDigits(data.page)));
    card.appendChild(element('div', 'sr-only', data.verses.map(verse => verse.text).join(' ')));
    card._words = words;
    return card;
}

/* ---------------------------------------------------------------------------
 * Slots: one printed page each, drawn only while it is near the viewport
 * ------------------------------------------------------------------------ */
const slotFor = page => document.getElementById('p' + page);

/* Parsed pages, newest kept, oldest dropped once the cache is full. */
async function pageData(pageNumber) {
    const cached = state.data.get(pageNumber);
    if (cached) {
        state.data.delete(pageNumber);
        state.data.set(pageNumber, cached);
        return cached;
    }
    const data = await getJson(PAGE_DIR + 'p' + pageNumber + '.json');
    state.data.set(pageNumber, data);
    while (state.data.size > PAGE_CACHE) state.data.delete(state.data.keys().next().value);
    return data;
}

function openSlot(slot) {
    const page = Number(slot.dataset.page);
    if (state.open.has(page)) return Promise.resolve();
    if (state.loading.has(page)) return state.loading.get(page);

    const work = (async () => {
        try {
            const data = await pageData(page);
            const fontOk = await ensureFont(data.font, data.fontFile);
            if (!fontOk) showToast('تعذّر تحميل خط الصفحة — يُعرض النص بخط عثماني عادي.');
            if (state.open.has(page)) return;   // drawn while it was loading
            const card = buildCard(data, fontOk);
            slot.appendChild(card);
            state.open.set(page, { slot, card, words: card._words });
        } catch (error) {
            console.warn(error);
            showToast('تعذّر تحميل الصفحة ' + toArabicDigits(page) + '.');
        } finally {
            state.loading.delete(page);
        }
    })();

    state.loading.set(page, work);
    return work;
}

function closeSlot(slot) {
    const page = Number(slot.dataset.page);
    const record = state.open.get(page);
    if (!record) return;
    /* Leave the slot as tall as the page was, so the scroll position holds. */
    slot.style.minHeight = Math.round(record.card.offsetHeight) + 'px';
    record.card.remove();
    state.open.delete(page);
}

/* Drawing a page costs a font load and a layout pass; a couple at a time is
 * plenty to keep scrolling smooth. */
const queue = [];
let busy = 0;

function pump() {
    while (busy < 2 && queue.length) {
        const task = queue.shift();
        busy += 1;
        task().catch(error => console.warn(error)).finally(() => {
            busy -= 1;
            pump();
        });
    }
}

function enqueue(task) {
    queue.push(task);
    pump();
}

const loader = new IntersectionObserver(entries => {
    for (const entry of entries) {
        if (entry.isIntersecting) enqueue(() => openSlot(entry.target));
    }
}, { rootMargin: RENDER_MARGIN });

const trimmer = new IntersectionObserver(entries => {
    for (const entry of entries) {
        if (!entry.isIntersecting) closeSlot(entry.target);
    }
}, { rootMargin: KEEP_MARGIN });

/* ---------------------------------------------------------------------------
 * One glyph size for the whole Mushaf, like the print: the biggest size at
 * which the longest line of a page still fits the page width.
 * ------------------------------------------------------------------------ */
function sizeForCard(card, rows) {
    const styles = getComputedStyle(card);
    const padding = parseFloat(styles.paddingInlineStart) + parseFloat(styles.paddingInlineEnd);
    const inner = card.clientWidth - padding;

    /* Measure the natural width of the lines once, at a big reference size:
     * the widths grow with the glyph size, so no search is needed. */
    const REFERENCE = 100;
    card.style.setProperty('--fs', REFERENCE + 'px');
    card.style.setProperty('--lh', (REFERENCE * LINE_RATIO).toFixed(2) + 'px');
    let widest = 0;
    for (const row of rows) widest = Math.max(widest, rowWidth(row));
    card.style.removeProperty('--fs');
    card.style.removeProperty('--lh');

    if (!widest) return 0;
    /* A hair of slack: glyph advances are rounded per size. */
    return Math.max(8, (inner / widest) * REFERENCE * 0.997);
}

/* The width a line takes when the page is wide enough; the words never wrap. */
function rowWidth(row) {
    row.style.width = 'max-content';
    const width = row.getBoundingClientRect().width;
    row.style.width = '';
    return width;
}

function applySize(size) {
    state.size = size;
    el.mushaf.style.setProperty('--fs', size.toFixed(2) + 'px');
    el.mushaf.style.setProperty('--lh', (size * LINE_RATIO).toFixed(2) + 'px');
    measureExtra();
    updateSlotHeights();
}

/* Everything a page adds around its printed lines: padding, border, number. */
function measureExtra() {
    for (const record of state.open.values()) {
        const info = state.pageInfo.get(Number(record.slot.dataset.page));
        if (!info) continue;
        const styles = getComputedStyle(record.card);
        const vertical = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
        state.extraHeight = record.card.offsetHeight - info.slots * state.size * LINE_RATIO - vertical;
        return;
    }
}

/* Every page is as tall as its printed lines; knowing that up front keeps the
 * scrollbar steady while pages are drawn and dropped. */
function updateSlotHeights() {
    if (!state.size) return;
    const lineHeight = state.size * LINE_RATIO;
    for (const slot of state.slots) {
        const info = state.pageInfo.get(Number(slot.dataset.page));
        slot.style.minHeight = Math.round(info.slots * lineHeight + state.extraHeight + 2) + 'px';
    }
    state.offsets = state.slots.map(slot => slot.offsetTop);
}

/* Sizes the glyphs from the pages that are drawn right now. A page with a very
 * long line can lower the shared size, so the reader is put back afterwards. */
function refit() {
    let size = Infinity;
    for (const record of state.open.values()) {
        size = Math.min(size, sizeForCard(record.card, [...record.card.querySelectorAll('.line-row')]));
    }
    if (!isFinite(size)) return;
    const changed = !state.size || Math.abs(size - state.size) > 0.05;
    if (!changed) return;
    const anchor = state.current;
    applySize(size);
    if (state.offsets.length) scrollToPage(anchor, false);
}

/* ---------------------------------------------------------------------------
 * Pages, position and the app bar
 * ------------------------------------------------------------------------ */
const appbarHeight = () => el.appbar.offsetHeight;

function pageFromHash() {
    const match = /^#p(\d+)$/.exec(location.hash);
    return match ? Number(match[1]) : 0;
}

/* The printed page the reader is looking at: the last one under the app bar. */
function pageAtTop() {
    const line = window.scrollY + appbarHeight() + 12;
    let low = 0;
    let high = state.offsets.length - 1;
    let index = 0;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (state.offsets[mid] <= line) { index = mid; low = mid + 1; } else high = mid - 1;
    }
    return state.pages[index] || state.current;
}

function scrollToPage(page, smooth) {
    const index = state.pages.indexOf(page);
    if (index < 0) return;
    const slot = slotFor(page);
    const top = state.offsets[index] !== undefined ? state.offsets[index] : slot.offsetTop;
    window.scrollTo({
        top: Math.max(0, top - appbarHeight() - 10),
        behavior: smooth ? 'smooth' : 'instant'
    });
}

function setCurrent(page) {
    state.current = page;
    el.chip.textContent = toArabicDigits(page);
    el.prev.disabled = page <= state.pages[0];
    el.next.disabled = page >= state.pages[state.pages.length - 1];
    if (location.hash !== '#p' + page) history.replaceState(null, '', '#p' + page);
}

function goToPage(page, smooth) {
    if (!state.pageInfo.has(page)) return;
    openSlot(slotFor(page));
    scrollToPage(page, smooth);
    setCurrent(page);
}

function updateChrome() {
    const page = pageAtTop();
    if (page !== state.current) setCurrent(page);
}

/* ---------------------------------------------------------------------------
 * Copy: hand over the real ʿUthmānī words, never the glyph code points
 * ------------------------------------------------------------------------ */
document.addEventListener('copy', event => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);

    const picked = [];
    for (const node of el.mushaf.querySelectorAll('.word')) {
        if (!range.intersectsNode(node)) continue;
        const card = node.closest('.page');
        const word = card && card._words.get(node.dataset.loc);
        if (word && word.t !== 'end') picked.push(word);   // like quran.com: no verse number
    }
    if (!picked.length) return;

    const text = picked.map(word => word.x).join(' ');
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
    showToast('نُسخ: ' + text);
});

/* ---------------------------------------------------------------------------
 * Word popover (real word, meaning, recitation)
 * ------------------------------------------------------------------------ */
let wordAudio = null;

function playWord(word) {
    if (!word.a) return;
    if (!wordAudio) wordAudio = new Audio();
    wordAudio.src = WORD_AUDIO_BASE + word.a;
    wordAudio.play().catch(() => showToast('تعذّر تشغيل تلاوة الكلمة.'));
}

function placePopover(node) {
    const rect = node.getBoundingClientRect();
    const box = el.popover.getBoundingClientRect();
    const left = Math.max(8, Math.min(
        rect.left + rect.width / 2 - box.width / 2,
        window.innerWidth - box.width - 8));
    let top = rect.top - box.height - 10;
    if (top < 8) top = rect.bottom + 10;
    el.popover.style.left = left + 'px';
    el.popover.style.top = top + 'px';
}

function openPopover(node) {
    const card = node.closest('.page');
    const word = card && card._words.get(node.dataset.loc);
    if (!word) return;
    if (state.openWord === node) { closePopover(); return; }

    closePopover();
    state.openWord = node;
    node.classList.add('is-open');

    el.popover.textContent = '';
    el.popover.appendChild(element('div', 'popover__word', word.x));
    if (word.tl) el.popover.appendChild(element('div', 'popover__translit', word.tl));
    if (word.tr) el.popover.appendChild(element('div', 'popover__translation', word.tr));

    const foot = element('div', 'popover__foot');
    foot.appendChild(element('span', 'popover__loc',
        word.k + ' — الكلمة ' + toArabicDigits(word.p)));
    if (word.a) {
        const play = element('button', 'play-btn', 'سماع الكلمة');
        play.type = 'button';
        play.addEventListener('click', () => playWord(word));
        foot.appendChild(play);
    }
    el.popover.appendChild(foot);

    el.popover.hidden = false;
    placePopover(node);
}

function closePopover() {
    el.popover.hidden = true;
    if (state.openWord) {
        state.openWord.classList.remove('is-open');
        state.openWord = null;
    }
}

/* ---------------------------------------------------------------------------
 * Surah picker, theme, events and start-up
 * ------------------------------------------------------------------------ */
function buildSurahList() {
    const fragment = document.createDocumentFragment();
    for (const chapter of state.chapters) {
        const item = element('button', 'surah-item');
        item.type = 'button';
        item.dataset.page = chapter.firstPage;
        item.dataset.search = (chapter.nameArabic + ' ' + chapter.nameSimple + ' ' + chapter.id).toLowerCase();
        item.appendChild(element('span', 'surah-item__num', toArabicDigits(chapter.id)));
        item.appendChild(element('span', 'surah-item__name', chapter.nameArabic));
        item.appendChild(element('span', 'surah-item__page', 'صفحة ' + toArabicDigits(chapter.firstPage)));
        fragment.appendChild(item);
    }
    el.surahList.appendChild(fragment);
}

/* One slot for every printed page; they hold the height of their page even
 * while the page itself is not drawn. */
function buildSlots() {
    const fragment = document.createDocumentFragment();
    for (const info of state.manifest.pages) {
        const slot = element('section', 'page-slot');
        slot.id = 'p' + info.page;
        slot.dataset.page = info.page;
        fragment.appendChild(slot);
    }
    el.mushaf.appendChild(fragment);
    state.slots = [...el.mushaf.querySelectorAll('.page-slot')];
}

function filterSurahs() {
    const query = el.surahFilter.value.trim().toLowerCase();
    for (const item of el.surahList.children) {
        item.hidden = Boolean(query) && !item.dataset.search.includes(query);
    }
}

function setPanel(open) {
    el.surahPanel.hidden = !open;
    el.surahToggle.setAttribute('aria-expanded', String(open));
    if (open) {
        el.surahFilter.focus();
    } else if (el.surahFilter.value) {
        el.surahFilter.value = '';
        filterSurahs();
    }
}

function setTheme(theme) {
    const light = theme === 'light';
    document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
    try {
        localStorage.setItem(THEME_KEY, light ? 'light' : 'dark');
    } catch (error) {
        /* private mode: the choice just will not be remembered */
    }
    el.theme.title = light ? 'تفعيل الوضع الليلي' : 'تفعيل الوضع النهاري';
    el.theme.setAttribute('aria-label', el.theme.title);
}

function wireEvents() {
    el.prev.addEventListener('click', () => goToPage(state.current - 1, true));
    el.next.addEventListener('click', () => goToPage(state.current + 1, true));

    el.random.addEventListener('click', () => {
        const chapter = state.chapters[Math.floor(Math.random() * state.chapters.length)];
        goToPage(chapter.firstPage, false);
    });

    el.theme.addEventListener('click', () => {
        setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
    });

    el.surahToggle.addEventListener('click', () => setPanel(el.surahPanel.hidden));
    el.surahFilter.addEventListener('input', filterSurahs);
    el.surahList.addEventListener('click', event => {
        const item = event.target.closest('.surah-item');
        if (!item) return;
        setPanel(false);
        goToPage(Number(item.dataset.page), false);
    });

    /* Word popover, wherever the pointer lands on a drawn page. */
    el.mushaf.addEventListener('click', event => {
        const node = event.target.closest('.word');
        if (node) openPopover(node); else closePopover();
    });

    el.mushaf.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const node = event.target.closest('.word');
        if (!node) return;
        event.preventDefault();
        openPopover(node);
    });

    document.addEventListener('click', event => {
        if (!el.surahPanel.hidden && !event.target.closest('#surah-picker')) setPanel(false);
        if (el.popover.contains(event.target) || event.target.closest('.word')) return;
        closePopover();
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            setPanel(false);
            closePopover();
            return;
        }
        /* In a Mushaf the next page is the one on the left. */
        if (event.key === 'ArrowLeft') goToPage(state.current + 1, true);
        if (event.key === 'ArrowRight') goToPage(state.current - 1, true);
    });

    /* The app bar follows the scroll, so it always shows the page under it. */
    let scrollPending = false;
    window.addEventListener('scroll', () => {
        if (scrollPending) return;
        scrollPending = true;
        requestAnimationFrame(() => {
            scrollPending = false;
            updateChrome();
        });
    }, { passive: true });

    window.addEventListener('resize', debounce(() => {
        document.documentElement.style.setProperty('--appbar-h', appbarHeight() + 'px');
        refit();
    }, 150));

    window.addEventListener('hashchange', () => {
        const page = pageFromHash();
        if (page) goToPage(page, false);
    });
}

async function init() {
    try {
        state.manifest = await getJson(MANIFEST_URL);
    } catch (error) {
        console.warn(error);
        showToast('بيانات المصحف غير موجودة — شغّل: node tools/build-mushaf-pages.mjs all');
        return;
    }

    state.chapters = state.manifest.chapters;
    state.pages = state.manifest.pages.map(info => info.page);
    state.pageInfo = new Map(state.manifest.pages.map(info => [info.page, info]));

    buildSlots();
    buildSurahList();
    wireEvents();

    document.documentElement.style.setProperty('--appbar-h', appbarHeight() + 'px');
    setTheme(document.documentElement.getAttribute('data-theme'));

    /* The ornate surah name cartouches; the banners stay hidden until ready. */
    ensureFont('surahnames', state.manifest.surahNamesFont).then(ok => {
        if (ok) document.documentElement.setAttribute('data-surah-names-ready', 'true');
    });
    ensureFont('Uthmanic', 'fonts/uthmanic_hafs_v22.ttf');

    /* Draw the page the reader asked for first: that page fixes the glyph size,
     * and the size fixes how tall every page is. */
    const wanted = pageFromHash();
    const start = state.pageInfo.has(wanted) ? wanted : state.pages[0];
    await openSlot(slotFor(start));
    refit();
    scrollToPage(start, false);
    setCurrent(start);

    for (const slot of state.slots) {
        loader.observe(slot);
        trimmer.observe(slot);
    }
}

init();
