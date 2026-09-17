/* ===========================================================================
 * add-onnx-metadata.mjs — appends metadata_props entries to an ONNX file.
 *
 *   node QuranHifz/tools/add-onnx-metadata.mjs file.onnx key1=value1 key2=value2 ...
 *
 * sherpa-onnx needs metadata on NeMo streaming encoders (vocab_size,
 * window_size, chunk_shift, cache dims, ...). The entries are appended as
 * protobuf field 14 records at the end of the file — field order does not
 * matter to protobuf readers, and the bytes of the existing model are left
 * untouched.
 * =========================================================================== */

import fs from 'node:fs';

const file = process.argv[2];
const pairs = process.argv.slice(3);
if (!file || !pairs.length) {
    console.log('usage: node tools/add-onnx-metadata.mjs <file.onnx> key=value [key=value ...]');
    process.exit(1);
}

function pbVarint(n) {
    const bytes = [];
    let v = n;
    while (v > 127) {
        bytes.push((v & 0x7f) | 0x80);
        v = Math.floor(v / 128);
    }
    bytes.push(v);
    return Buffer.from(bytes);
}

function pbString(field, value) {
    const bytes = Buffer.from(String(value), 'utf8');
    return Buffer.concat([pbVarint((field << 3) | 2), pbVarint(bytes.length), bytes]);
}

const entries = pairs.map(function (pair) {
    const at = pair.indexOf('=');
    if (at <= 0) {
        throw new Error('bad key=value pair: ' + pair);
    }
    const key = pair.slice(0, at);
    const value = pair.slice(at + 1);
    const entry = Buffer.concat([pbString(1, key), pbString(2, value)]);
    return Buffer.concat([pbVarint((14 << 3) | 2), pbVarint(entry.length), entry]);
});

fs.appendFileSync(file, Buffer.concat(entries));
console.log('appended ' + entries.length + ' metadata entries to ' + file + ':');
pairs.forEach(function (pair) { console.log('  ' + pair); });
