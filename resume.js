/**
 * Shared place-memory for the two views (index.html and index2.html).
 *
 * Both pages load this script in <head> with data-launch="index" or
 * data-launch="index2". The app is opened at index.html (the manifest's
 * start_url), so on a load without a position in the address bar the stored
 * view decides which page is really shown: the installed app comes back on
 * the view the reader was using, and the two views can hand each other the
 * verse the reader is on.
 *
 * One key holds everything, under localStorage['quran-last']:
 *
 *     { "view": "index" | "index2",   the view that was on screen last
 *       "surah": 1-114,               the reader stores the verse it shows
 *       "ayah": 1-n,
 *       "page": 1-604 }               the mushaf stores the printed page
 *
 * The reader writes surah + ayah, the mushaf writes page + the verse at the
 * top of the viewport; every write replaces the whole record, so a field can
 * never outlive the position it belongs to. The version of the app without
 * this file simply keeps working: every caller has a stub fallback.
 */
(function () {
    'use strict';

    var KEY = 'quran-last';

    function read() {
        try {
            var stored = JSON.parse(localStorage.getItem(KEY));
            return stored && typeof stored === 'object' ? stored : null;
        } catch (error) {
            return null;
        }
    }

    /* Stores the view and the position it knows; missing fields are dropped
     * rather than kept from an earlier write. */
    function remember(view, position) {
        var value = { view: view, t: Date.now() };
        for (var field of ['surah', 'ayah', 'page']) {
            var number = Number(position && position[field]);
            if (number > 0) value[field] = number;
        }
        try {
            localStorage.setItem(KEY, JSON.stringify(value));
        } catch (error) {
            // Ignore storage errors (private mode, storage disabled, ...)
        }
    }

    /* Forgets the position but keeps the view (the reader's Clear button). */
    function forget(view) {
        remember(view, null);
    }

    function launch(view) {
        var stored = read();
        if (!stored) return;

        if (view === 'index') {
            /* ?surah= in the address bar is a deliberate open, never redirected. */
            if (/[?&]surah=/.test(location.search)) return;
            if (stored.view === 'index2' && stored.page) {
                location.replace('index2.html#p' + stored.page);
            }
            return;
        }

        /* The mushaf is only opened on purpose: #p/#s in the address bar or a
         * ?surah= from the reader. A bare load is an app start. */
        if (location.hash || /[?&]surah=/.test(location.search)) return;
        if (stored.view === 'index' && stored.surah) {
            location.replace('index.html?surah=' + stored.surah
                + (stored.ayah ? '&ayah=' + stored.ayah : ''));
        }
    }

    window.QuranResume = { read: read, remember: remember, forget: forget, launch: launch };

    var script = document.currentScript;
    if (script && script.dataset.launch) {
        launch(script.dataset.launch);
    }
})();
