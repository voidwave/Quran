/* ===========================================================================
 * parse-spm-model.mjs — extracts the SentencePiece pieces + scores from
 * tokenizer.model (a protobuf, parsed here with zero dependencies) and
 * writes sp-model.json next to it.
 *
 *   node QuranHifz/tools/parse-spm-model.mjs
 *
 * Why: the browser GOP pipeline must re-tokenize the reference text exactly
 * like the Python aligner does (`spm.SentencePieceProcessor.encode`). The
 * BPE merge priorities live in tokenizer.model; tokens.txt only maps
 * pieces to ids. sp-model.json carries { p: piece, s: score } pairs the
 * JS encoder needs (plus the piece table for id lookups is already in
 * tokens.txt).
 * =========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODEL_PATH = process.argv[2] || path.join(ROOT, 'QuranHifz', 'tools', 'asr-models', 'fastconformer-quran-v8', 'tokenizer.model');
const OUT_PATH = process.argv[3] || path.join(path.dirname(MODEL_PATH), 'sp-model.json');

/* ---- minimal protobuf wire reader --------------------------------------- */

function readVarint(buf, off) {
    let result = 0;
    let shift = 0;
    while (off < buf.length) {
        const byte = buf[off];
        off += 1;
        result += (byte & 0x7f) * Math.pow(2, shift);
        if ((byte & 0x80) === 0) {
            return { value: result, off };
        }
        shift += 7;
        if (shift > 56) {
            throw new Error('varint too long');
        }
    }
    throw new Error('varint out of range');
}

/** Iterates top-level fields of a protobuf message. */
function forEachField(buf, start, end, handler) {
    let off = start;
    while (off < end) {
        const tag = readVarint(buf, off);
        off = tag.off;
        const field = tag.value >> 3;
        const wire = tag.value & 7;
        if (wire === 0) {
            const v = readVarint(buf, off);
            off = v.off;
            handler(field, wire, v.value);
        } else if (wire === 1) {
            off += 8;
        } else if (wire === 2) {
            const len = readVarint(buf, off);
            off = len.off;
            handler(field, wire, buf.subarray(off, off + len.value));
            off += len.value;
        } else if (wire === 5) {
            handler(field, wire, buf.readFloatLE(off));
            off += 4;
        } else {
            throw new Error('unsupported wire type ' + wire);
        }
    }
    return off;
}

/* ---- parse the model ---------------------------------------------------- */

if (!fs.existsSync(MODEL_PATH)) {
    console.log('tokenizer.model not found at ' + MODEL_PATH);
    console.log('Download it from https://huggingface.co/Muno459/fastconformer-quran/resolve/main/tokenizer.model');
    console.log('and place it in QuranHifz/tools/asr-models/fastconformer-quran-v8/, then re-run.');
    process.exit(1);
}

const buf = fs.readFileSync(MODEL_PATH);
const pieces = [];
let modelType = null;

forEachField(buf, 0, buf.length, (field, wire, value) => {
    if (field === 1 && wire === 2) {
        /* SentencePiece piece: { string piece = 1; float score = 2; enum type = 3 } */
        let p = null;
        let s = 0;
        forEachField(value, 0, value.length, (f2, w2, v2) => {
            if (f2 === 1 && w2 === 2) {
                p = v2.toString('utf8');
            } else if (f2 === 2 && w2 === 5) {
                s = v2;
            }
        });
        if (p !== null) {
            pieces.push({ p: p, s: +s.toFixed(6) });
        }
    } else if (field === 2 && wire === 2) {
        /* TrainerSpec: model_type enum = field 3 */
        forEachField(value, 0, value.length, (f2, w2, v2) => {
            if (f2 === 3 && w2 === 0) {
                modelType = v2;   /* 1 = UNIGRAM, 2 = BPE, 3 = WORD, 4 = CHAR */
            }
        });
    }
});

if (!pieces.length) {
    console.log('no pieces parsed — unexpected tokenizer.model layout');
    process.exit(1);
}

const typeName = { 1: 'UNIGRAM', 2: 'BPE', 3: 'WORD', 4: 'CHAR' }[modelType] || String(modelType);
fs.writeFileSync(OUT_PATH, JSON.stringify({ modelType: typeName, pieces: pieces }));
console.log('pieces: ' + pieces.length + ', model type: ' + typeName);
console.log('written -> ' + OUT_PATH + ' (' + (fs.statSync(OUT_PATH).size / 1024).toFixed(0) + ' KB)');
