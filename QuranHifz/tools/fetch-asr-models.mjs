/* ===========================================================================
 * fetch-asr-models.mjs — downloads the FastConformer Quran int8 model used by
 * the memorize app (ort-nemo-asr-worker.js → ort-nemo-asr.js).
 *
 *   node QuranHifz/tools/fetch-asr-models.mjs
 *
 * CC-BY-4.0. Downloads from the voidwaveDev mirror (itself a mirror of
 * mohammed/fastconformer-quran-ar-onnx-int8). Only the files the engine loads
 * are fetched — the upstream joiner.int8.onnx is a byte-duplicate of
 * decoder.int8.onnx and is skipped.
 * =========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function download(url, dest, label) {
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
        const mb = (fs.statSync(dest).size / 1048576).toFixed(1);
        console.log('  skip  ' + label + ' (already there, ' + mb + ' MB)');
        return true;
    }
    console.log('  fetch ' + label + ' ...');
    const response = await fetch(url);
    if (!response.ok) {
        console.log('  FAIL  ' + label + ': HTTP ' + response.status + (response.status === 401 || response.status === 403
            ? ' — gated model: accept the license on Hugging Face and download manually'
            : ''));
        return false;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buffer);
    console.log('  saved ' + label + ' (' + (buffer.length / 1048576).toFixed(1) + ' MB)');
    return true;
}

/* ---- FastConformer Quran int8 (the model the app runs) -------------------- */

const INT8_MODEL = {
    base: 'https://huggingface.co/voidwaveDev/fastconformer-quran/resolve/main/',
    dir: path.join(ROOT, 'QuranHifz', 'tools', 'asr-models', 'fastconformer-quran-int8'),
    /* small files first so a broken connection fails cheaply */
    files: ['tokens.txt', 'meta.json', 'decoder.int8.onnx', 'encoder.int8.onnx']
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
