/* TEMP: verify that memorize-core's `wbw` numbering (1-based ordinal among
 * recitable words) matches the mushaf page data's word positions `p`, which
 * index2.js uses for the quran.com word-audio files (wbw/SSS_AAA_PPP.mp3).
 * Run: node QuranHifz/tools/tmp-check-wbw.mjs
 */
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const core = require('../memorize-core.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

/* ------------------------------------------------ expected text (Tanzil) */
const xml = await readFile(path.join(root, 'QuranText/Quran/quran-uthmani.xml'), 'utf8');
const expected = new Map();   // "s:a" -> items
let sura = 0;
for (const line of xml.split('\n')) {
    const suraMatch = line.match(/<sura index="(\d+)"/);
    if (suraMatch) { sura = Number(suraMatch[1]); continue; }
    const ayaMatch = line.match(/<aya index="(\d+)" text="([^"]*)"/);
    if (!ayaMatch) continue;
    const key = sura + ':' + ayaMatch[1];
    expected.set(key, core.buildItems([{ s: sura, a: Number(ayaMatch[1]), text: ayaMatch[2] }]));
}

/* ------------------------------------------------- mushaf position data */
const dir = path.join(root, 'QuranText/MushafPages');
const files = (await readdir(dir)).filter(f => /^p\d+\.json$/.test(f));
const mushaf = new Map();     // "s:a" -> [{p, x}, ...] for t == "word"
for (const file of files) {
    const data = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
    for (const line of data.lines || []) {
        for (const w of line.words || []) {
            if (!w.k || w.t !== 'word') continue;
            const list = mushaf.get(w.k) || [];
            list.push({ p: w.p, x: w.x });
            mushaf.set(w.k, list);
        }
    }
}

/* ------------------------------------------------------------- compare */
const missing = [];       // verses in Tanzil but not in the mushaf data
const mismatches = [];    // different counts
const samples = [];
for (const [key, items] of expected) {
    const wbwItems = items.filter(it => !it.meta);
    const pos = mushaf.get(key);
    if (!pos) { missing.push(key); continue; }
    if (pos.length !== wbwItems.length) {
        mismatches.push({ key, wbwItems, pos });
        if (samples.length < 12) samples.push({ key, wbwItems, pos });
    }
}

console.log('files:', files.length);
console.log('Tanzil verses:', expected.size, ' mushaf verses:', mushaf.size);
console.log('missing from mushaf data:', missing.length, missing.slice(0, 10));
console.log('mismatched verses:', mismatches.length, 'of', expected.size);

/* Align Tanzil tokens to quran.com slots by normalized equality and report
 * the Tanzil-token spans that share one slot (quran.com merges phrases like
 * «بَعْدَ مَا» or «إِلْ يَاسِينَ» into a single audio file). */
for (const { key, wbwItems, pos } of samples) {
    const tan = wbwItems.map(it => core.normalizeToken(it.raw));
    const musTokens = [];   // {word: slotIndex, norm}
    pos.forEach((entry, j) => {
        core.tokenize(entry.x).forEach(norm => musTokens.push({ word: j, norm }));
    });
    if (tan.length !== musTokens.length) {
        console.log('\n==', key, ': token streams differ in length', tan.length, musTokens.length);
        continue;
    }
    const bad = tan.findIndex((t, i) => t !== musTokens[i].norm);
    if (bad >= 0) {
        console.log('\n==', key, ': mismatch at token', bad, tan[bad], musTokens[bad].norm);
        continue;
    }
    // merge spans: consecutive Tanzil tokens on the same word slot
    const spans = [];
    for (let i = 0; i < tan.length; i += 1) {
        const start = i;
        while (i + 1 < tan.length && musTokens[i + 1].word === musTokens[i].word) i += 1;
        if (i > start) spans.push({ tanzil: [start + 1, i + 1], slot: pos[musTokens[start].word].p });
    }
    console.log('\n==', key, 'WORDS:', wbwItems.map(it => it.raw).join(' | '));
    console.log('   slots:', pos.map(e => e.p + ':' + e.x).join(' | '));
    console.log('   merges:', JSON.stringify(spans));
}
