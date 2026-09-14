
/* ---------------------------------------------------------------------------
 * Quran text sources
 *   quran-uthmani.xml      - the Uthmani text that is displayed for reading
 *   quran-simple-clean.xml - diacritic free text used for searching
 *   en.sahih.xml           - English translation
 *   ar.jalalayn.xml        - Arabic tafsir
 * ------------------------------------------------------------------------ */
const SOURCE_UTHMANI = 'https://voidwave.com/Quran/QuranText/Quran/quran-uthmani.xml';
const SOURCE_CLEAN = 'https://voidwave.com/Quran/QuranText/Quran/quran-simple-clean.xml';
const SOURCE_ENGLISH = 'https://voidwave.com/Quran/QuranText/English-Translation/en.sahih.xml';
const SOURCE_TAFSIR = 'https://voidwave.com/Quran/QuranText/Arabic-Tafsir/ar.jalalayn.xml';

/* Search results are rendered in pages so common words stay responsive.
 * A page is drawn in small chunks: the first chunk appears immediately, the
 * rest is added while the browser is idle. */
const RESULTS_PER_PAGE = 120;
const RESULTS_CHUNK = 24;

/* Tafsir and translation are clamped to a few lines in result cards, so long
 * excerpts are cut short before they reach the DOM. */
const RESULTS_EXCERPT_LENGTH = 300;

/* Arabic-Indic digits, used for surah and ayah numbers. */
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

var surasTashkeel;
var surasClean;
var surasEnglish;
var surasTafsirJalalyn;
var SurahText;

let showTafsir = true; // Flag to track the visibility of Tafsir
let showEnglish = true; // Flag to track the visibility of English

let selectedSurah = null; // Variable to track selected Surah
let currentMatches = [];  // Matches of the last search query
let renderedMatches = 0;  // Number of matches that are already on screen
let resultsTarget = 0;    // Number of matches the loaded pages contain
let renderHandle = null;  // Pending idle render of the next chunk
let searchTimer = null;   // Debounce timer for the search field

Promise.all([
    loadXml(SOURCE_UTHMANI).then(data => surasTashkeel = data),
    loadXml(SOURCE_CLEAN).then(data => surasClean = data),
    loadXml(SOURCE_ENGLISH).then(data => surasEnglish = data),
    loadXml(SOURCE_TAFSIR).then(data => surasTafsirJalalyn = data)
]).then(() => {
    console.log("All XML files loaded successfully!");
    initializePage();
    setupSearchBar(); // Call the function that initializes the page
}).catch(error => {
    console.error("Error loading XML files:", error);
    var target = document.getElementById('maincontent');
    if (target) {
        target.innerHTML = '<p class="empty">تعذّر تحميل النص القرآني. تأكّد من الاتصال بالإنترنت ثم أعد تحميل الصفحة.</p>';
    }
});


function loadXml(path) {
    return fetch(path)
        .then(response => response.text())
        .then(xml => {
            let parser = new DOMParser();
            let xmlDOM = parser.parseFromString(xml, 'application/xml');
            return xmlDOM.querySelectorAll('sura'); // Return the parsed sura elements
        });
}

function initializePage() {
    SurahText = document.getElementById('maincontent');
    var randomButton = document.getElementById("random-button");
    var randomSurahButton = document.getElementById("randomSurah-button");
    var clearButton = document.getElementById('clear-button');
    var list = document.getElementById("nav");
    var navBackdrop = document.getElementById("nav-backdrop");
    var closeNavButton = document.getElementById("nav-close");
    var surahFilter = document.getElementById("surah-filter");
    var themeButton = document.getElementById("theme-toggle");
    var toTop = document.getElementById('to-top');
    var showNav = document.getElementById('show-nav');
    var toggleTafsirButton = document.getElementById("toggle-tafsir"); // Get the toggle button
    var toggleEnglishButton = document.getElementById("toggle-english"); // Get the toggle button

    // The text is available now, so the toolbar can be used.
    document.querySelectorAll('.appbar [disabled]').forEach(function (element) {
        element.disabled = false;
    });
    SurahText.innerHTML = emptyStateHTML();
    applyTheme(document.documentElement.getAttribute('data-theme') || 'dark');
    syncToggleState(toggleTafsirButton, showTafsir, "HIDE TAFSIR", "SHOW TAFSIR");
    syncToggleState(toggleEnglishButton, showEnglish, "HIDE ENGLISH", "SHOW ENGLISH");

    toggleTafsirButton.addEventListener('click', function () {
        // Toggle the visibility flags
        showTafsir = !showTafsir;
        syncToggleState(toggleTafsirButton, showTafsir, "HIDE TAFSIR", "SHOW TAFSIR");

        // Re-render the content based on the new visibility state
        if (selectedSurah !== null) {
            ViewSurah(selectedSurah, false);
        }
        refreshSearchResults();
    });
    toggleEnglishButton.addEventListener('click', function () {
        // Toggle the visibility flags
        showEnglish = !showEnglish;
        syncToggleState(toggleEnglishButton, showEnglish, "HIDE ENGLISH", "SHOW ENGLISH");

        // Re-render the content based on the new visibility state
        if (selectedSurah !== null) {
            ViewSurah(selectedSurah, false);
        }
        refreshSearchResults();
    });

    themeButton.addEventListener('click', function () {
        var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        applyTheme(next);
        try {
            localStorage.setItem('quran-theme', next);
        } catch (error) {
            // Ignore storage errors (private mode, storage disabled, ...)
        }
    });

    // One button per surah, with its number and name.
    for (var i = 0; i < 114; i++) {
        var surahItem = document.createElement("button");
        surahItem.type = "button";
        surahItem.className = "surah";
        surahItem.innerHTML = '<span class="surah__num">' + toArabicDigits(i + 1) + '</span>'
            + '<span class="surah__name">' + surasTashkeel[i].getAttribute('name') + '</span>';
        addSurahClickHandler(surahItem, i);
        list.appendChild(surahItem);
    }
    var surahButtons = list.querySelectorAll('.surah');

    // Filter the list by surah name or number.
    surahFilter.addEventListener('input', function () {
        var query = normalizeArabic(surahFilter.value.trim());
        surahButtons.forEach(function (button, index) {
            var name = normalizeArabic(surasTashkeel[index].getAttribute('name'));
            var number = String(index + 1);
            var isMatch = !query || name.indexOf(query) !== -1 || number.indexOf(query) === 0;
            button.hidden = !isMatch;
        });
    });

    showNav.addEventListener('click', function () {
        if (list.style.display == 'none') {
            list.style.display = 'grid';
            navBackdrop.hidden = false;
            showNav.setAttribute('aria-expanded', 'true');
            surahFilter.focus({ preventScroll: true });
        } else {
            closeSurahNav();
        }
    });

    closeNavButton.addEventListener('click', closeSurahNav);

    navBackdrop.addEventListener('click', closeSurahNav);

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
            closeSurahNav();
        }
    });

    // Random Ayah button functionality
    randomButton.addEventListener('click', function () {
        var randomSura = generateRandomNumber(0, 113);
        var randomAyahNumber = generateRandomNumber(0, surasTashkeel[randomSura].children.length - 1);

        clearSearch();
        selectSurah(randomSura);
        SurahText.innerHTML = surahHeadHTML(randomSura) + ayahCardHTML(randomSura, randomAyahNumber);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Random Surah button functionality
    randomSurahButton.addEventListener('click', function () {
        clearSearch();
        ViewSurah(generateRandomNumber(0, 113));
    });

    // Clear button functionality
    clearButton.addEventListener('click', function () {
        SurahText.innerHTML = emptyStateHTML(); // Clear the displayed surah and ayah
        clearSearch();                          // Clear the search field and the results
        clearSurahSelection();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Back to top button
    toTop.addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    var syncToTopVisibility = function () {
        toTop.hidden = window.scrollY < 700;
    };
    window.addEventListener('scroll', syncToTopVisibility, { passive: true });
    syncToTopVisibility();
}

function setupSearchBar() {
    const searchBar = document.getElementById('search-bar');
    const searchButton = document.getElementById('search-button');
    const resultsContainer = document.getElementById('search-results');

    searchButton.addEventListener('click', function () {
        runSearch(true);
    });

    searchBar.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            runSearch(true);
        }
    });

    // Search while typing (debounced) so the list follows the query.
    searchBar.addEventListener('input', function () {
        if (searchTimer) {
            clearTimeout(searchTimer);
        }
        searchTimer = setTimeout(function () {
            runSearch(false);
        }, 280);
    });

    // A single delegated listener serves every result card, including paged ones.
    resultsContainer.addEventListener('click', function (event) {
        var card = event.target.closest('.result');
        if (card) {
            navigateToAyah(Number(card.dataset.surah), Number(card.dataset.ayah));
        }
    });

    resultsContainer.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }
        var card = event.target.closest('.result');
        if (card) {
            event.preventDefault();
            navigateToAyah(Number(card.dataset.surah), Number(card.dataset.ayah));
        }
    });
}

/* Runs a search and renders the first page of results. */
function runSearch(scrollToResults) {
    var searchBar = document.getElementById('search-bar');
    var resultsContainer = document.getElementById('search-results');
    if (!searchBar || !resultsContainer || !surasClean) {
        return;
    }

    const query = normalizeArabic(searchBar.value.trim());

    if (query.length < 2) { // Avoid overly short searches
        clearSearch();
        return;
    }

    cancelPendingRender();
    currentMatches = collectMatches(query);
    renderedMatches = 0;
    resultsTarget = 0;
    resultsContainer.innerHTML = '';

    if (currentMatches.length === 0) {
        resultsContainer.innerHTML = '<p class="empty">لا توجد نتائج مطابقة'
            + (selectedSurah !== null ? ' في سورة ' + surahName(selectedSurah) : '') + '.</p>';
        return;
    }

    appendResultsPage();

    if (scrollToResults) {
        resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

/* Re-renders the current results, for example after the selected surah changed. */
function refreshSearchResults() {
    if (!surasClean) {
        return;
    }
    runSearch(false);
}

/* Collects every ayah that contains the query (in the selected surah only). */
function collectMatches(query) {
    const matches = [];
    const firstSurah = selectedSurah === null ? 0 : selectedSurah;
    const lastSurah = selectedSurah === null ? surasClean.length - 1 : selectedSurah;

    for (let s = firstSurah; s <= lastSurah; s++) {
        const ayahs = surasClean[s].children;
        for (let a = 0; a < ayahs.length; a++) {
            const cleanText = ayahs[a].getAttribute('text') || '';
            if (cleanText && normalizeArabic(cleanText).includes(query)) {
                matches.push({ surah: s, ayah: a, cleanText: cleanText });
            }
        }
    }
    return matches;
}

/* Adds the next page of matches, drawn in chunks so typing stays smooth. */
function appendResultsPage() {
    const previousButton = document.getElementById('load-more');

    cancelPendingRender();
    if (previousButton) {
        previousButton.remove();
    }

    resultsTarget = Math.min(renderedMatches + RESULTS_PER_PAGE, currentMatches.length);

    if (renderedMatches === 0) {
        document.getElementById('search-results').insertAdjacentHTML('beforeend',
            '<p class="results-meta">' + toArabicDigits(currentMatches.length) + ' نتيجة'
            + (selectedSurah !== null ? ' في سورة ' + surahName(selectedSurah) : '')
            + '</p>');
    }

    renderNextChunk();
}

/* Renders one chunk, then hands the rest back to the browser's idle time. */
function renderNextChunk() {
    const resultsContainer = document.getElementById('search-results');
    const chunkEnd = Math.min(renderedMatches + RESULTS_CHUNK, resultsTarget);
    let html = '';

    for (let i = renderedMatches; i < chunkEnd; i++) {
        html += searchResultHTML(currentMatches[i]);
    }
    renderedMatches = chunkEnd;

    if (html) {
        resultsContainer.insertAdjacentHTML('beforeend', html);
    }

    if (renderedMatches < resultsTarget) {
        renderHandle = scheduleIdle(renderNextChunk);
    } else {
        renderHandle = null;
        addLoadMoreButton();
    }
}

function addLoadMoreButton() {
    if (resultsTarget >= currentMatches.length) {
        return;
    }

    const resultsContainer = document.getElementById('search-results');
    resultsContainer.insertAdjacentHTML('beforeend',
        '<button id="load-more" class="btn load-more" type="button">عرض المزيد ('
        + toArabicDigits(currentMatches.length - resultsTarget) + ' نتيجة)</button>');
    document.getElementById('load-more').addEventListener('click', appendResultsPage);
}

function scheduleIdle(callback) {
    if (typeof requestIdleCallback === 'function') {
        return requestIdleCallback(callback, { timeout: 500 });
    }
    return setTimeout(callback, 24);
}

function cancelPendingRender() {
    if (renderHandle === null) {
        return;
    }
    if (typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(renderHandle);
    } else {
        clearTimeout(renderHandle);
    }
    renderHandle = null;
}

/* Shortens a long excerpt; the card clamps the text to three lines anyway. */
function excerpt(text) {
    if (!text || text.length <= RESULTS_EXCERPT_LENGTH) {
        return text;
    }
    return text.slice(0, RESULTS_EXCERPT_LENGTH).replace(/\s+\S*$/, '') + '…';
}

/* Clears the search field and everything that was rendered for it. */
function clearSearch() {
    const resultsContainer = document.getElementById('search-results');
    const searchBar = document.getElementById('search-bar');

    if (resultsContainer) {
        resultsContainer.innerHTML = '';
    }
    if (searchBar) {
        searchBar.value = '';
    }
    currentMatches = [];
    renderedMatches = 0;
    resultsTarget = 0;
    cancelPendingRender();
}

function normalizeArabic(text) {
    return (text || '')
        .toLowerCase()
        .replace(/[أإآٱى]/g, 'ا')
        .replace(/[ئؤ]/g, 'ء')
        .replace(/ة/g, 'ه');
}

// Function to select a surah (for example when a surah button is clicked)
function selectSurah(surahIndex) {
    selectedSurah = surahIndex;  // Store the selected surah index

    // Highlight the selected surah in the navigation list
    const buttons = document.querySelectorAll('#nav .surah');
    for (let i = 0; i < buttons.length; i++) {
        buttons[i].classList.toggle('is-active', i === surahIndex);
    }

    // Refresh the results based on the selected surah
    refreshSearchResults();
}

// Reset the search to search the entire Quran
function clearSurahSelection() {
    selectedSurah = null;  // Clear the selected surah

    const buttons = document.querySelectorAll('#nav .surah');
    for (let i = 0; i < buttons.length; i++) {
        buttons[i].classList.remove('is-active');
    }
}

function navigateToAyah(surahIndex, ayahIndex) {
    ViewSurah(surahIndex, false);
    const ayah = document.getElementById(`ayah-${surahIndex}-${ayahIndex}`);
    if (ayah) {
        ayah.scrollIntoView({ behavior: 'smooth', block: 'center' });
        ayah.classList.add('is-flash');
        setTimeout(function () {
            ayah.classList.remove('is-flash');
        }, 1800);
    }
}
/* Splits text into word ranges: [[start, end], ...] */
function wordRanges(text) {
    const ranges = [];
    const pattern = /\S+/g;
    let match;

    while ((match = pattern.exec(text)) !== null) {
        ranges.push([match.index, match.index + match[0].length]);
    }
    return ranges;
}

function highlightMatch(uthmaniText, cleanText, query) {
    const normalizedText = normalizeArabic(cleanText);
    const normalizedQuery = normalizeArabic(query);
    const charRanges = [];

    let matchIndex = normalizedText.indexOf(normalizedQuery);
    while (matchIndex !== -1) {
        charRanges.push([matchIndex, matchIndex + normalizedQuery.length]);
        matchIndex = normalizedText.indexOf(normalizedQuery, matchIndex + normalizedQuery.length);
    }

    if (charRanges.length === 0) {
        return uthmaniText;
    }

    // The clean and the Uthmani text are word aligned, so the matched words can
    // be marked in the Uthmani text even though it carries the diacritics.
    const cleanWords = wordRanges(cleanText);
    const uthmaniWords = wordRanges(uthmaniText);
    if (cleanWords.length !== uthmaniWords.length) {
        return uthmaniText; // Not aligned: show the text without a highlight
    }

    const markedWords = [];
    const alreadyMarked = {};

    for (let c = 0; c < charRanges.length; c++) {
        for (let w = 0; w < cleanWords.length; w++) {
            const overlaps = cleanWords[w][1] > charRanges[c][0] && cleanWords[w][0] < charRanges[c][1];
            if (overlaps && !alreadyMarked[w]) {
                alreadyMarked[w] = true;
                markedWords.push(w);
            }
        }
    }

    let highlightedText = uthmaniText;
    for (let i = markedWords.length - 1; i >= 0; i--) {
        const [start, end] = uthmaniWords[markedWords[i]];
        highlightedText = highlightedText.substring(0, end) +
            '</mark>' + highlightedText.substring(end);
        highlightedText = highlightedText.substring(0, start) +
            '<mark>' + highlightedText.substring(start);
    }

    return highlightedText;
}

function generateRandomNumber(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}


/* ---------------------------------------------------------------------------
 * Rendering
 * ------------------------------------------------------------------------ */

/* Renders numbers with Arabic-Indic digits (٠١٢٣…). */
function toArabicDigits(value) {
    return String(value).replace(/[0-9]/g, function (digit) {
        return ARABIC_DIGITS[Number(digit)];
    });
}

function surahName(surahIndex) {
    return surasTashkeel[surahIndex].getAttribute('name');
}

function surahHeadHTML(surahIndex) {
    return '<header class="surah-head">'
        + '<span class="surah-head__badge">' + toArabicDigits(surahIndex + 1) + '</span>'
        + '<h2 class="surah-head__name">' + surahName(surahIndex) + '</h2>'
        + '</header>';
}

/* One ayah card: number, Uthmani text, tafsir and translation. */
function ayahCardHTML(surahIndex, ayahIndex) {
    let html = '<article class="ayah" id="ayah-' + surahIndex + '-' + ayahIndex + '">'
        + '<div class="ayah__head">'
        + '<span class="ayah__num">' + toArabicDigits(ayahIndex + 1) + '</span>'
        + '<span class="ayah__rule" aria-hidden="true"></span>'
        + '</div>'
        + '<p class="ayah__text quran-text" lang="ar">'
        + surasTashkeel[surahIndex].children[ayahIndex].getAttribute('text')
        + '</p>';

    if (showTafsir) {
        const tafsir = surasTafsirJalalyn[surahIndex].children[ayahIndex].getAttribute('text');
        if (tafsir) {
            html += '<div class="ayah__block">'
                + '<span class="ayah__label">تفسير الجلالين</span>'
                + '<p class="ayah__tafsir">' + tafsir + '</p>'
                + '</div>';
        }
    }

    if (showEnglish) {
        const english = surasEnglish[surahIndex].children[ayahIndex].getAttribute('text');
        if (english) {
            html += '<div class="ayah__block" dir="ltr">'
                + '<span class="ayah__label">English</span>'
                + '<p class="ayah__english">' + english + '</p>'
                + '</div>';
        }
    }

    return html + '</article>';
}

/* One search result card (the matched ayah, with the query highlighted). */
function searchResultHTML(match) {
    const surahIndex = match.surah;
    const ayahIndex = match.ayah;
    const searchBar = document.getElementById('search-bar');
    const query = searchBar ? normalizeArabic(searchBar.value.trim()) : '';
    const highlighted = highlightMatch(
        surasTashkeel[surahIndex].children[ayahIndex].getAttribute('text'),
        match.cleanText,
        query
    );

    let html = '<div class="result" role="button" tabindex="0"'
        + ' data-surah="' + surahIndex + '" data-ayah="' + ayahIndex + '"'
        + ' aria-label="' + surahName(surahIndex) + ' ' + toArabicDigits(ayahIndex + 1) + '">'
        + '<div class="result__head">'
        + '<h4 class="result__ref">' + surahName(surahIndex) + '</h4>'
        + '<span class="result__loc">'
        + toArabicDigits(surahIndex + 1) + ':' + toArabicDigits(ayahIndex + 1)
        + '</span>'
        + '</div>'
        + '<p class="quran-text" lang="ar">' + highlighted + '</p>';

    if (showTafsir) {
        const tafsir = surasTafsirJalalyn[surahIndex].children[ayahIndex].getAttribute('text');
        if (tafsir) {
            html += '<div class="ayah__block">'
                + '<span class="ayah__label">تفسير الجلالين</span>'
                + '<p class="ayah__tafsir clamp-text">' + excerpt(tafsir) + '</p>'
                + '</div>';
        }
    }

    if (showEnglish) {
        const english = surasEnglish[surahIndex].children[ayahIndex].getAttribute('text');
        if (english) {
            html += '<div class="ayah__block" dir="ltr">'
                + '<span class="ayah__label">English</span>'
                + '<p class="ayah__english clamp-text">' + excerpt(english) + '</p>'
                + '</div>';
        }
    }

    return html + '</div>';
}

function emptyStateHTML() {
    return '<p class="empty">اختر سورة من قائمة السور، أو ابحث في القرآن الكريم من الشريط في الأعلى.</p>';
}

/* Keeps a reading toggle (tafsir / English) in sync with its state. */
function syncToggleState(button, isActive, activeLabel, inactiveLabel) {
    const label = isActive ? activeLabel : inactiveLabel;
    const srOnly = button.querySelector('.sr-only');

    if (srOnly) {
        srOnly.innerText = label;
    }
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', isActive);
    button.classList.toggle('is-active', isActive);
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);

    const button = document.getElementById('theme-toggle');
    if (button) {
        button.setAttribute('aria-label', theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
        button.title = theme === 'light' ? 'تفعيل الوضع الليلي' : 'تفعيل الوضع النهاري';
    }

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
        meta.setAttribute('content', theme === 'light' ? '#f7f5ef' : '#0a0f10');
    }
}

function addSurahClickHandler(button, surahIndex) {
    button.addEventListener('click', function () {
        ViewSurah(surahIndex);
    }, false);
}

function closeSurahNav() {
    const list = document.getElementById('nav');
    const backdrop = document.getElementById('nav-backdrop');
    const showNav = document.getElementById('show-nav');
    if (!list) {
        return;
    }

    list.style.display = 'none';
    if (backdrop) {
        backdrop.hidden = true;
    }
    if (showNav) {
        showNav.setAttribute('aria-expanded', 'false');
    }

    // The list always opens unfiltered again.
    const filter = document.getElementById('surah-filter');
    if (filter && filter.value) {
        filter.value = '';
        list.querySelectorAll('.surah').forEach(function (button) {
            button.hidden = false;
        });
    }
}

function renderSurah(index) {
    const parts = [surahHeadHTML(index)];

    // Surah 1 already contains the basmala as its first ayah, surah 9 has none.
    if (index !== 0 && index !== 8) {
        parts.push('<p class="basmala" lang="ar">'
            + surasTashkeel[0].children[0].getAttribute('text') + '</p>');
    }

    for (let a = 0; a < surasTashkeel[index].children.length; a++) {
        parts.push(ayahCardHTML(index, a));
    }

    SurahText.innerHTML = parts.join('');
}

function ViewSurah(index, scrollToTop) {
    selectSurah(index);
    closeSurahNav();
    renderSurah(index);

    if (scrollToTop !== false) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}