/**
 * Service worker for the Quran app (index.html + index2.html).
 *
 * The app is fully static, so after the first visit it can run offline:
 *
 *   shell   The two pages, their scripts, the manifest and the icons. Served
 *           from the cache and refreshed in the background; the pages
 *           themselves are checked against the network first (with a short
 *           deadline), so a new deploy lands immediately while an offline
 *           reader still opens without waiting.
 *   data    The Quran text, the mushaf page data and the fonts. Captured on
 *           demand and kept under a byte budget, oldest files evicted first.
 *   audio   The recitation files. Captured the first time a file is played,
 *           under their own byte budget: repeated listening stops hitting the
 *           network, and what has been played once works offline.
 *   fonts   The Google fonts the pages link (best effort, tiny cache).
 *
 * A hard reload (Ctrl+Shift+R) sends every request to the network and
 * refreshes the cached copy, so it is also the way to pick up a data rebuild.
 *
 * Bump VERSION when the caching rules below change: the previous shell cache
 * is deleted on activate. The data/audio caches survive version bumps.
 */

const VERSION = 'v1';

const SHELL_CACHE = 'quran-shell-' + VERSION;
const DATA_CACHE = 'quran-data';
const AUDIO_CACHE = 'quran-audio';
const FONT_CACHE = 'quran-webfonts';
const META_CACHE = 'quran-meta';

/* The app shell: small files that must be there for a cold offline start. */
const SHELL_FILES = [
    './',
    'index.html',
    'index2.html',
    'index.js',
    'index2.js',
    'pwa.js',
    'manifest.webmanifest',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-maskable-512.png',
    'icons/apple-touch-icon.png'
];

/* Byte budgets for the on-demand caches. The complete mushaf (every page's
 * words + font) is ~120 MB; the recitation is ~230 KB per file on average,
 * so 150 MB is around 650 files of listening. Both trim oldest-first. */
const DATA_MAX_BYTES = 150 * 1024 * 1024;
const AUDIO_MAX_BYTES = 150 * 1024 * 1024;
const BUDGETS = {
    [DATA_CACHE]: DATA_MAX_BYTES,
    [AUDIO_CACHE]: AUDIO_MAX_BYTES
};

/* Path suffixes that belong to the shell rather than to the data. */
const SHELL_SUFFIXES = [
    '/index.html',
    '/index2.html',
    '/index.js',
    '/index2.js',
    '/pwa.js',
    '/manifest.webmanifest',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/icon-maskable-512.png',
    '/icons/apple-touch-icon.png'
];

const isShellPath = pathname => pathname === '/' || SHELL_SUFFIXES.some(suffix => pathname.endsWith(suffix));

/* How long a freshness check waits for the server before the cached copy
 * answers instead. A connection that is down but not reported as such (a
 * dying server, a dead LAN) must never hold the reader hostage behind an
 * OS-level connect timeout. */
const NETWORK_FIRST_TIMEOUT_MS = 2000;

/* After a network failure the next checks skip the network entirely for a
 * little while; the cached copies answer instantly and a background fetch
 * keeps probing, so recovery is noticed on the same visit. */
const DEAD_NETWORK_GRACE_MS = 10000;
let lastNetworkFailure = 0;

/* Cache keys drop the query string, so "index.html?surah=18" and
 * "index.html" share one stored copy. */
function cleanUrl(url) {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href;
}

function cacheNameFor(pathname) {
    if (pathname.endsWith('.mp3')) return AUDIO_CACHE;
    return isShellPath(pathname) ? SHELL_CACHE : DATA_CACHE;
}

/* --------------------------------------------------------------------------
   Install and activate
   -------------------------------------------------------------------------- */

self.addEventListener('install', event => {
    event.waitUntil(precache().then(() => self.skipWaiting()));
});

async function precache() {
    const cache = await caches.open(SHELL_CACHE);
    /* One file failing must not abort the whole install, so they are added
     * one by one and the misses are only logged. */
    await Promise.all(SHELL_FILES.map(async file => {
        try {
            await cache.add(new Request(file, { cache: 'reload' }));
        } catch (error) {
            console.warn('[sw] could not precache ' + file, error);
        }
    }));
}

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const alive = new Set([SHELL_CACHE, DATA_CACHE, AUDIO_CACHE, FONT_CACHE, META_CACHE]);
        for (const name of await caches.keys()) {
            if (name.startsWith('quran-') && !alive.has(name)) {
                await caches.delete(name);
            }
        }
        await self.clients.claim();
    })());
});

/* --------------------------------------------------------------------------
   Fetch routing
   -------------------------------------------------------------------------- */

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) {
        /* The Google fonts the pages link: cache them so the offline pages
         * keep their typeface. Everything else cross-origin (the
         * word-by-word audio, the flags) goes straight to the network. */
        if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
            respondStaleWhileRevalidate(event, FONT_CACHE);
        }
        return;
    }

    /* A reload or a no-cache fetch wants the newest copy: go to the network,
     * but only for as long as it answers in time. Pages are handled the same
     * way, so a new deploy lands on the next visit. */
    if (request.mode === 'navigate' || request.cache === 'reload' || request.cache === 'no-cache') {
        respondFreshFirst(event, cacheNameFor(url.pathname));
        return;
    }

    if (url.pathname.endsWith('.mp3')) {
        event.respondWith(audioResponse(request));
        return;
    }

    respondStaleWhileRevalidate(event, cacheNameFor(url.pathname));
});

/* Serve what is cached and refresh it in the background for the next visit. */
function respondStaleWhileRevalidate(event, cacheName) {
    event.respondWith((async () => {
        const cache = await caches.open(cacheName);
        const cached = await cache.match(event.request, { ignoreSearch: true });
        const refresh = fetchAndStore(cacheName, event.request);
        if (cached) {
            /* The refresh must not delay the cached copy; the waitUntil keeps
             * the worker alive until it is done. */
            event.waitUntil(refresh.catch(() => { }));
            return cached;
        }
        return refresh;
    })());
}

/* Network first, cache as the fallback: for pages, hard reloads and the
 * app's own no-cache data fetches. The cache exists so the reader is never
 * stuck waiting on a network that will not answer: when the connection is
 * already known to be down, or the server takes longer than the deadline
 * above, the cached copy answers right away and the network keeps filling
 * the cache in the background for the next visit. */
function respondFreshFirst(event, cacheName) {
    const request = event.request;
    event.respondWith((async () => {
        const cached = await caches.match(request, { ignoreSearch: true })
            || (request.mode === 'navigate' ? await caches.match('index.html') : null);

        const network = fetchAndStore(cacheName, request);
        if (!cached) return network;
        const guarded = network.catch(() => null);

        /* The connection is known to be down, or just was: do not wait on it
         * again. The cached copy answers now and the probe keeps running. */
        if (!navigator.onLine || Date.now() - lastNetworkFailure < DEAD_NETWORK_GRACE_MS) {
            event.waitUntil(guarded);
            return cached;
        }

        const deadline = new Promise(resolve => setTimeout(resolve, NETWORK_FIRST_TIMEOUT_MS, null));
        const winner = await Promise.race([guarded, deadline]);
        if (winner) return winner;

        event.waitUntil(guarded);
        return cached;
    })());
}

async function fetchAndStore(cacheName, request) {
    let response;
    try {
        response = await fetch(request);
    } catch (error) {
        /* Remember the failure so the next cached copy does not wait for the
         * same timeout again (see DEAD_NETWORK_GRACE_MS). */
        lastNetworkFailure = Date.now();
        throw error;
    }

    if (response.type === 'opaque') {
        /* Opaque responses cannot be read or measured; store as they are. */
        const cache = await caches.open(cacheName);
        await cache.put(cleanUrl(request.url), response.clone());
    } else if (response.status === 200) {
        await storeResponse(cacheName, request, response.clone());
    }
    return response;
}

/* --------------------------------------------------------------------------
   Recitation audio
   -------------------------------------------------------------------------- */

async function audioResponse(request) {
    const key = cleanUrl(request.url);
    const cache = await caches.open(AUDIO_CACHE);
    const cached = await cache.match(key);
    if (cached) return cached;

    /* The player asks for byte ranges. Fetch the whole file once (they are
     * small) so it can be cached, and hand the player the full response. */
    const response = await fetch(key);
    if (response.status === 200 && (response.headers.get('content-type') || '').startsWith('audio')) {
        await storeResponse(AUDIO_CACHE, request, response.clone());
    }
    return response;
}

/* --------------------------------------------------------------------------
   Storing, measuring and trimming
   -------------------------------------------------------------------------- */

async function storeResponse(cacheName, request, response) {
    const key = cleanUrl(request.url);
    const bytes = BUDGETS[cacheName] ? await measure(response) : 0;

    const cache = await caches.open(cacheName);
    await cache.put(key, response);

    if (BUDGETS[cacheName]) {
        await noteStored(cacheName, key, bytes);
    }
}

/* Content-Length when the server sent one, otherwise weigh the body. */
async function measure(response) {
    const length = Number(response.headers.get('content-length'));
    if (length > 0) return length;
    try {
        return (await response.clone().blob()).size;
    } catch (error) {
        return 0;
    }
}

/* A ledger of what the byte-budgeted caches hold, kept as one small JSON
 * document in its own cache:
 *
 *     { "quran-data": { "<url>": { "s": bytes, "t": storedAt }, ... }, ... }
 *
 * All updates run through a promise chain so parallel requests cannot
 * clobber each other, and the oldest files are evicted when a cache grows
 * past its budget. */
const META_KEY = 'quran-meta.json';
let metaQueue = Promise.resolve();

function withLedger(work) {
    const run = metaQueue.then(async () => {
        const cache = await caches.open(META_CACHE);
        const stored = await cache.match(META_KEY);
        const ledger = stored ? await stored.json() : {};

        await work(ledger);

        await cache.put(META_KEY, new Response(JSON.stringify(ledger), {
            headers: { 'content-type': 'application/json' }
        }));
    });
    metaQueue = run.catch(() => { });
    return run;
}

function noteStored(cacheName, key, bytes) {
    const budget = BUDGETS[cacheName];
    if (!budget) return Promise.resolve();

    return withLedger(async ledger => {
        const entries = ledger[cacheName] || (ledger[cacheName] = {});
        entries[key] = { s: bytes, t: Date.now() };

        let total = 0;
        for (const entry of Object.values(entries)) total += entry.s;
        if (total <= budget) return;

        /* Oldest first, until the cache fits its budget again. */
        const cache = await caches.open(cacheName);
        const oldest = Object.entries(entries).sort((a, b) => a[1].t - b[1].t);
        for (const [url, entry] of oldest) {
            if (total <= budget) break;
            await cache.delete(url);
            delete entries[url];
            total -= entry.s;
        }
        console.log('[sw] ' + cacheName + ' trimmed to ' + Math.round(total / 1048576) + ' MB');
    });
}
