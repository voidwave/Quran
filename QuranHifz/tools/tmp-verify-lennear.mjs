/* tmp-verify-lennear.mjs — one-off: verifies the lenNear settle-gate fix in
 * phoneme-check.js against the REAL 18:2 reproduction of the stuck «مِّن»
 * (heard «مِ» for the ghunna-held «ممممِ»). Runs phoneme-check.js in Node
 * with tiny browser stubs. Delete when the fix is confirmed live. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const qh = path.resolve(dir, '..');
const qhUrl = 'file:///' + path.resolve(qh).replace(/\\/g, '/');
const src = readFileSync(path.join(qh, 'phoneme-check.js'), 'utf8');

const win = {};
const fetchStub = async (url) => {
    const p = fileURLToPath(String(url));
    const body = JSON.parse(readFileSync(p, 'utf8'));
    return { ok: true, json: async () => body };
};
new Function('window', 'document', 'location', 'fetch', 'URL', src)(
    win,
    { currentScript: { src: qhUrl + '/phoneme-check.js' } },
    { href: qhUrl + '/memorize.html' },
    fetchStub,
    URL
);
const C = win.QuranPhonemeCheck;

const canon = await C.canonFor(18, 2);
const skip = canon.lens.slice(0, 4).reduce((a, b) => a + b, 0);
const seq = C.buildSequence([{
    s: 18, a: 2, wiOffset: 4,
    canon: { clusters: canon.clusters.slice(skip), lens: canon.lens.slice(4), bismillah: false }
}]);

const probes = {
    stuckRepeat: 'شَ دِ ۦۦ دَ اا مِ ن لَ دُ ن هُ ۥۥ وَ يُ بَ ششِ رَ ل مُ ء مِ نِ ۦۦ',
    variant2: 'دَ اا مِ ن للَ دُ ن هُ قَ ييِ م للِ يُ ن ذِ رَ بَ ء سَ و شَ',
    perfectHold: 'شَ دِ ۦۦ دَ اا ممممِ للَ دُ ن هُ ۥۥ وَ يُ بَ ششِ رَ ل مُ ء مِ نِ ۦۦ'
};
for (const [name, u] of Object.entries(probes)) {
    const r = C.analyzeSequence(seq, u.split(' '));
    const w = r ? r.words.find((x) => x.ref.wi === 4) : null;
    const stats = w && { total: w.total, seen: w.seen, exact: w.exact, lenNear: w.lenNear, bad: w.bad, miss: w.miss };
    const gateOld = w ? w.exact * 2 >= w.total : null;
    const gateNew = w ? (w.exact + w.lenNear) * 2 >= w.total : null;
    const notes = r ? r.flags.filter((f) => f.ref.wi === 4)
        .flatMap((f) => f.notes.map((n) => n.kind)) : null;
    console.log(name.padEnd(12), JSON.stringify({ stats, gateOld, gateNew, notes }));
}

const mk = (clusters) => C.buildSequence([{ s: 1, a: 1, canon: { clusters, lens: [clusters.length] } }]);
const runOnly = C.analyzeSequence(mk(['ممممِ', 'ممممِ', 'ممممِ']), ['مِ', 'مِ', 'مِ']).words[0];
const vowels = C.analyzeSequence(mk(['قُ', 'قُ', 'قُ']), ['قَ', 'قَ', 'قَ']).words[0];
console.log('run-only len   ', JSON.stringify({ exact: runOnly.exact, lenNear: runOnly.lenNear, gateNew: (runOnly.exact + runOnly.lenNear) * 2 >= runOnly.total }));
console.log('vowel-diff len ', JSON.stringify({ exact: vowels.exact, lenNear: vowels.lenNear, gateNew: (vowels.exact + vowels.lenNear) * 2 >= vowels.total }));

/* 18:5:14 «إِلَّا» — the second live stuck case */
const c5 = await C.canonFor(18, 5);
const c6 = await C.canonFor(18, 6);
const skip5 = c5.lens.slice(0, 14).reduce((a, b) => a + b, 0);
const seq5 = C.buildSequence([
    { s: 18, a: 5, wiOffset: 14, canon: { clusters: c5.clusters.slice(skip5), lens: c5.lens.slice(14), bismillah: false } },
    { s: 18, a: 6, canon: c6 }
]);
const probes5 = {
    latest: 'ءِ لَ اا',
    perfect: 'ءِ للَ اا',
    staleTail: 'لُ ۥۥ ءِ لَ اا',
    withNext: 'ءِ لَ اا كَ ذِ بَ ںںں فَ لَ عَ للَ كَ'
};
for (const [name, u] of Object.entries(probes5)) {
    const r = C.analyzeSequence(seq5, u.split(' '));
    const w = r ? r.words.find((x) => x.ref.wi === 14) : null;
    const stats = w && { total: w.total, seen: w.seen, exact: w.exact, lenNear: w.lenNear, bad: w.bad, miss: w.miss };
    const gateNew = w ? (w.exact + w.lenNear) * 2 >= w.total : null;
    const notes = r ? r.flags.filter((f) => f.ref.wi === 14).flatMap((f) => f.notes.map((n) => n.kind)) : null;
    console.log('ila ' + name.padEnd(10), JSON.stringify({ stats, gateNew, notes }));
}
