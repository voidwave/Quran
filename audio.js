/**
 * The recitations of the app (shared by index.html, index2.html and offline.js).
 *
 * The audio files have their own page of the site, next to the app:
 *
 *     /QuranAudio/reciters.json                 the list of the reciter folders
 *     /QuranAudio/<reciter>/<sura3><ayah3>.mp3  002255.mp3 = sura 2, ayah 255
 *     /QuranAudio/<reciter>/<sura3>000.mp3      the basmala that opens a sura
 *
 * That folder lies outside the service worker's scope (the worker covers
 * /Quran/ only), so the worker can neither capture a file the first time it
 * is played nor serve one from its caches. This script takes both over for
 * the pages:
 *
 *   - reciters() reads the reciter list: the network first (a reciter added
 *     on the server shows up on the next visit), and the copy the تنزيل
 *     download stored (the quran-data cache) when there is no network;
 *   - source() hands a player something it can load: the stored copy of the
 *     file (quran-audio cache, filled by the تنزيل download, by earlier
 *     listening or below) as a blob: URL, or — when nothing is stored yet —
 *     the file fetched whole, stored for the next time and handed back. It
 *     also tells the worker how big the file is, so the audio byte budget
 *     keeps counting it and still trims the oldest listening first;
 *   - setSource() keeps the blob: URLs it creates alive for as long as the
 *     player is on them, and revokes them on the next switch.
 *
 * Nothing stored and no network leaves the plain URL: the player asks the
 * server itself and reports the failure the way it always did.
 */
(function () {
    'use strict';

    /* The audio page. Point it somewhere else (a full URL) while developing
     * by setting window.QURAN_AUDIO_BASE before this script loads. */
    var BASE = window.QURAN_AUDIO_BASE || '/QuranAudio/';
    var AUDIO_CACHE = 'quran-audio';
    var DATA_CACHE = 'quran-data';

    function absolute(path) {
        return new URL(path, document.baseURI).href;
    }

    /* 002255.mp3 = sura 2, ayah 255; 002000.mp3 = the basmala of sura 2. */
    function path(reciterId, chapter, fileNumber) {
        return BASE + encodeURIComponent(reciterId) + '/'
            + pad(chapter) + pad(fileNumber) + '.mp3';
    }

    function pad(value) {
        return String(value).padStart(3, '0');
    }

    function cached(url, cacheName) {
        if (!('caches' in window)) return Promise.resolve(null);
        return caches.open(cacheName)
            .then(cache => cache.match(url))
            .catch(() => null);
    }

    /* The reciter list: the network first, the stored copy when it is away. */
    async function reciters() {
        var url = absolute(BASE + 'reciters.json');
        try {
            var response = await fetch(url, { cache: 'no-cache' });
            if (response.ok) return response.json();
        } catch (error) {
            /* offline: the stored copy answers below */
        }
        var stored = await cached(url, DATA_CACHE);
        if (stored && stored.ok) return stored.json();
        throw new Error('could not read ' + url);
    }

    /* Where a player gets its audio from: the stored copy when there is one,
     * otherwise one download that is kept for the next time. */
    async function source(filePath) {
        var url = absolute(filePath);
        var blob = null;
        var cache = null;

        try {
            cache = await caches.open(AUDIO_CACHE);
            var stored = await cache.match(url);
            if (stored && stored.ok) blob = await stored.blob();
        } catch (error) {
            blob = null;    // no cache storage: fetch the file below
        }

        if (!blob) {
            try {
                var fetched = await fetch(url);
                if (fetched.ok) {
                    var copy = fetched.clone();
                    blob = await fetched.blob();
                    if (cache) {
                        /* A store that fails (quota, private browsing) must
                         * not stop the playback. */
                        await cache.put(url, copy).catch(() => { });
                    }
                    announce(url, blob.size);
                }
            } catch (error) {
                blob = null;
            }
        }

        return blob && blob.size ? URL.createObjectURL(blob) : url;
    }

    /* The worker's ledger drives the audio byte budget: it has to hear about
     * the files this page stored itself. Messages sent before a worker is in
     * control are kept and flushed once one is (same pattern as offline.js). */
    var unsent = [];

    function announce(url, bytes) {
        if (!bytes) return;
        var controller = navigator.serviceWorker && navigator.serviceWorker.controller;
        if (!controller) {
            unsent.push([url, bytes]);
            return;
        }
        controller.postMessage({ type: 'audio-stored', cache: AUDIO_CACHE, files: [[url, bytes]] });
    }

    if (navigator.serviceWorker) {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            var pending = unsent;
            unsent = [];
            for (var file of pending) {
                navigator.serviceWorker.controller.postMessage(
                    { type: 'audio-stored', cache: AUDIO_CACHE, files: [file] });
            }
        });
    }

    /* Blob URLs live until the player leaves them. */
    var objectUrls = new WeakMap();

    function setSource(element, src, filePath) {
        var previous = objectUrls.get(element);
        if (previous) URL.revokeObjectURL(previous);
        if (src.slice(0, 5) === 'blob:') objectUrls.set(element, src);
        else objectUrls.delete(element);
        element.dataset.audioPath = filePath || '';
        element.src = src;
    }

    window.QuranAudio = {
        base: BASE,
        path: path,
        reciters: reciters,
        source: source,
        setSource: setSource
    };
})();
