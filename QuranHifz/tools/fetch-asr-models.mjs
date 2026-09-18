/* ===========================================================================
 * fetch-asr-models.mjs — downloads the ASR models used by the memorize app
 * (ort-nemo-asr-worker.js → ort-nemo-asr.js for the word recognizers,
 * phoneme-asr-worker.js for the phoneme engine).
 *
 *   node QuranHifz/tools/fetch-asr-models.mjs
 *
 * Word engines:
 *   int8 (v3)  — CC-BY-4.0, mirrored from mohammed/fastconformer-quran-ar-onnx-int8.
 *                The upstream joiner.int8.onnx is a byte-duplicate of
 *                decoder.int8.onnx and is skipped.
 *   v8 (CTC)   — NPL-1.1 (non-commercial; no paid tiers/monetisation).
 *                Upstream Muno459/fastconformer-quran is GATED: accept the
 *                license on Hugging Face, download the files once, then copy
 *                them into the folder below or upload them to the voidwaveDev
 *                mirror under v8/. The tajweed/ module, tokenizer,
 *                pronunciation head and demo clips are reference material.
 *
 * Phoneme engine (two interchangeable exports, chosen in the settings):
 *   zikrhub    — digisolutionsapps/zikrhub-recitation-zipformer (free-non-commercial).
 *   arabic-v3  — Quran-Lab/zipformer_p-arabic-v3 (NPL-1.2, gated). The v3.1
 *                madd fine-tune is the file the app loads; the plain v3 int8
 *                is kept beside it for A/B tests. Same 250-unit alphabet,
 *                same streaming interface; the card's exact kaldi fbank
 *                (mel 20–7600, centred frames) is implemented in the worker.
 * =========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function download(url, dest, label, quiet) {
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
        const mb = (fs.statSync(dest).size / 1048576).toFixed(1);
        if (!quiet) {
            console.log('  skip  ' + label + ' (already there, ' + mb + ' MB)');
        }
        return true;
    }
    if (!quiet) {
        console.log('  fetch ' + label + ' ...');
    }
    const response = await fetch(url);
    if (!response.ok) {
        if (!quiet) {
            console.log('  FAIL  ' + label + ': HTTP ' + response.status + (response.status === 401 || response.status === 403
                ? ' — gated model: accept the license on Hugging Face and download manually'
                : ''));
        }
        return false;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buffer);
    if (!quiet) {
        console.log('  saved ' + label + ' (' + (buffer.length / 1048576).toFixed(1) + ' MB)');
    }
    return true;
}

/* ---- FastConformer Quran int8 (v3 export — the default recognizer) -------- */

const INT8_MODEL = {
    base: 'https://huggingface.co/voidwaveDev/fastconformer-quran/resolve/main/',
    dir: path.join(ROOT, 'QuranHifz', 'tools', 'asr-models', 'fastconformer-quran-int8'),
    /* small files first so a broken connection fails cheaply */
    files: ['tokens.txt', 'meta.json', 'decoder.int8.onnx', 'encoder.int8.onnx']
};

/* ---- FastConformer Quran v8 (CTC q8 — the new engine option) -------------- */

const V8_MODEL = {
    base: 'https://huggingface.co/voidwaveDev/fastconformer-quran/resolve/main/v8/',
    dir: path.join(ROOT, 'QuranHifz', 'tools', 'asr-models', 'fastconformer-quran-v8'),
    /* what the engine itself loads */
    files: ['tokens.txt', 'model_with_encoder.q8.onnx'],
    /* reference material (not loaded by the app yet): the tajweed Python
       module (rules, GOP and pron-head scorers — for the future in-browser
       tajweed pass and parity tests), the SentencePiece model, the
       pronunciation head, and the demo clips used to verify a build */
    extras: [
        'tokenizer.model',
        'model_with_encoder.onnx',   /* fp32 — the «v8 fp32» engine option (~458 MB) */
        'tajweed/__init__.py', 'tajweed/aligner.py', 'tajweed/engine.py',
        'tajweed/full_scorer.py', 'tajweed/gop_scorer.py', 'tajweed/head_scorer.py',
        'tajweed/phonology.py', 'tajweed/rules.py', 'tajweed/text_analyzer.py',
        'tajweed/token_features.py',
        'head/pronunciation_head.pt',
        'demo/01_alafasy_fatihah.wav', 'demo/02_basfar_ikhlas.wav', 'demo/03_alafasy_naba.wav'
    ]
};

/* ---- Quran-Lab zipformer v3 phoneme model (the phoneme engine's upgrade) -- */

const PHONEME_V3_MODEL = {
    /* the project mirror: every device fetches missing files automatically
       (phoneme-asr-worker.js tries the site copy first, then this repo) */
    base: 'https://huggingface.co/voidwaveDev/phoneme-v3/resolve/main/',
    dir: path.join(ROOT, 'QuranHifz', 'tools', 'asr-models', 'zipformer-p-arabic-v3'),
    files: [
        'tokens.txt',
        'zipformer_p_arabic_v3.1.int8.onnx',   /* the default export the app loads */
        'zipformer_p_arabic_v3.1.onnx'         /* the fp32 export (~263 MB) */
    ],
    extras: [
        'config.json',
        'phoneme_units.json',
        'ordered_quran_phonemes.json',   /* canonical phonemisation of all 6,236 ayat */
        'decode_with_confidence.py',     /* margin_peak reference — the worker mirrors it */
        'quran_per_eval.py',             /* the upstream streaming loop */
        'export_quran_streaming_onnx.py',
        'LICENSE'
    ]
};

/* ---- main ---------------------------------------------------------------- */

console.log('Workspace: ' + ROOT + '\n');
console.log('FastConformer Quran int8 (CC-BY-4.0, ~131 MB):');
let ok = true;
for (const file of INT8_MODEL.files) {
    ok = (await download(INT8_MODEL.base + file, path.join(INT8_MODEL.dir, file), file)) && ok;
}
console.log(ok
    ? 'ready in QuranHifz/tools/asr-models/fastconformer-quran-int8/'
    : 'download incomplete — check the network and re-run');

console.log('\nFastConformer Quran v8 (NPL-1.1, ~132 MB) — OPTIONAL (dormant code; the app no longer offers it):');
let v8ok = true;
for (const file of V8_MODEL.files) {
    v8ok = (await download(V8_MODEL.base + file, path.join(V8_MODEL.dir, file), file)) && v8ok;
}
if (!v8ok) {
    console.log('');
    console.log('  v8 weights are GATED upstream. To enable the v8 engine:');
    console.log('   1. Sign in at https://huggingface.co/Muno459/fastconformer-quran');
    console.log('      and accept the license (NPL-1.1 — non-commercial).');
    console.log('   2. Download  onnx/model_with_encoder.q8.onnx  and  tokens.txt');
    console.log('   3. Either copy them into QuranHifz/tools/asr-models/fastconformer-quran-v8/');
    console.log('      or upload them to the voidwaveDev mirror under v8/ so all');
    console.log('      devices fetch them automatically, then re-run this script.');
}
let extraMissing = 0;
for (const file of V8_MODEL.extras) {
    const got = await download(V8_MODEL.base + file, path.join(V8_MODEL.dir, file), file, true);
    if (!got) {
        extraMissing += 1;
    }
}
console.log('  reference files (tajweed/, tokenizer, head, demo): '
    + (extraMissing ? extraMissing + ' not on the mirror yet' : 'all present'));
console.log(v8ok
    ? 'v8 ready in QuranHifz/tools/asr-models/fastconformer-quran-v8/'
    : 'v8 skipped — optional/dormant; the word engine (int8) and the phoneme model are what the app offers');

console.log('\nzipformer phoneme v3 (Quran-Lab, NPL-1.2, ~75 MB per int8) — phoneme engine upgrade:');
let p3ok = true;
for (const file of PHONEME_V3_MODEL.files) {
    p3ok = (await download(PHONEME_V3_MODEL.base + file, path.join(PHONEME_V3_MODEL.dir, file), file)) && p3ok;
}
if (!p3ok) {
    console.log('');
    console.log('  v3 weights are GATED upstream. To enable the v3 phoneme model:');
    console.log('   1. Sign in at https://huggingface.co/Quran-Lab/zipformer_p-arabic-v3');
    console.log('      and accept the license (NPL-1.2 — no-profit use).');
    console.log('   2. Download  zipformer_p_arabic_v3.1.int8.onnx  and  tokens.txt');
    console.log('      (optionally the fp32 export zipformer_p_arabic_v3.1.onnx).');
    console.log('   3. Either copy them into  QuranHifz/tools/asr-models/zipformer-p-arabic-v3/');
    console.log('      (exactly this folder name — watch for typos!) or upload them to');
    console.log('      the voidwaveDev/phoneme-v3 repo on Hugging Face so all devices');
    console.log('      fetch them automatically, then re-run this script.');
}
let p3extra = 0;
for (const file of PHONEME_V3_MODEL.extras) {
    const got = await download(PHONEME_V3_MODEL.base + file, path.join(PHONEME_V3_MODEL.dir, file), file, true);
    if (!got) {
        p3extra += 1;
    }
}
console.log('  reference files (eval loop, confidence decoder, canonical phonemes): '
    + (p3extra ? 'not on the mirror yet' : 'all present'));
console.log(p3ok
    ? 'v3 phoneme model ready in QuranHifz/tools/asr-models/zipformer-p-arabic-v3/'
    : 'phoneme engine runs with the base model until v3 is downloaded');
