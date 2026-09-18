/* TEMP: read the interface of the phoneme zipformer ONNX without any deps —
 * a minimal protobuf walker over ModelProto (graph inputs/outputs + metadata).
 *
 *   node QuranHifz/tools/tmp-zipformer-inspect.mjs
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, 'asr-models', 'zipformer-quran-phonemes', 'quran_phoneme_zipformer.int8.onnx');
const buf = await readFile(file);

/* ---- minimal protobuf field walker -------------------------------------- */

function readVarint(b, pos) {
    let result = 0;
    let shift = 0;
    while (true) {
        const byte = b[pos];
        pos += 1;
        result += (byte & 0x7f) * Math.pow(2, shift);
        if ((byte & 0x80) === 0) {
            return { value: result, pos };
        }
        shift += 7;
    }
}

function fields(b, start, end) {
    const out = [];
    let pos = start;
    while (pos < end) {
        const tag = readVarint(b, pos);
        pos = tag.pos;
        const field = tag.value >> 3;
        const wire = tag.value & 7;
        if (wire === 0) {
            const v = readVarint(b, pos);
            pos = v.pos;
            out.push({ field, wire, value: v.value });
        } else if (wire === 2) {
            const len = readVarint(b, pos);
            pos = len.pos;
            out.push({ field, wire, bytes: b.subarray(pos, pos + len.value), start: pos, end: pos + len.value });
            pos += len.value;
        } else if (wire === 5) {
            out.push({ field, wire, value: 0 });
            pos += 4;
        } else if (wire === 1) {
            out.push({ field, wire, value: 0 });
            pos += 8;
        } else {
            throw new Error('unsupported wire type ' + wire + ' at ' + pos);
        }
    }
    return out;
}

const text = (node) => Buffer.from(node.bytes).toString('utf8');

/* ---- navigate ModelProto ------------------------------------------------ */

const top = fields(buf, 0, buf.length);
const graph = top.find(f => f.field === 7);
const metadata = top.filter(f => f.field === 14);

const ELEM = {
    1: 'float32', 2: 'uint8', 3: 'int8', 4: 'uint16', 5: 'int16', 6: 'int32',
    7: 'int64', 9: 'bool', 10: 'float16', 11: 'float64'
};

function printValueInfo(node) {
    const parts = fields(node.bytes, 0, node.bytes.length);
    const name = parts.find(f => f.field === 1);
    const type = parts.find(f => f.field === 2);
    let elem = '?';
    const dims = [];
    if (type) {
        const tt = fields(type.bytes, 0, type.bytes.length).find(f => f.field === 1); // tensor_type
        if (tt) {
            const ttParts = fields(tt.bytes, 0, tt.bytes.length);
            const et = ttParts.find(f => f.field === 1);
            if (et) elem = ELEM[et.value] || String(et.value);
            const shape = ttParts.find(f => f.field === 2);
            if (shape) {
                fields(shape.bytes, 0, shape.bytes.length).filter(f => f.field === 1).forEach(dim => {
                    const dp = fields(dim.bytes, 0, dim.bytes.length);
                    const dv = dp.find(f => f.field === 1);
                    const dpar = dp.find(f => f.field === 2);
                    dims.push(dv ? dv.value : (dpar ? text(dpar) : '?'));
                });
            }
        }
    }
    return name ? text(name) + ': ' + elem + ' [' + dims.join(', ') + ']' : '?';
}

console.log('== metadata_props ==');
for (const m of metadata) {
    const parts = fields(m.bytes, 0, m.bytes.length);
    const k = parts.find(f => f.field === 1);
    const v = parts.find(f => f.field === 2);
    console.log((k ? text(k) : '?') + ' = ' + (v ? text(v) : '?'));
}

if (graph) {
    const g = fields(graph.bytes, 0, graph.bytes.length);
    const inputs = g.filter(f => f.field === 11);
    const outputs = g.filter(f => f.field === 12);
    const nodes = g.filter(f => f.field === 1);
    console.log('\n== graph ==');
    console.log('nodes:', nodes.length, ' inputs:', inputs.length, ' outputs:', outputs.length);
    console.log('\n-- inputs --');
    inputs.forEach(n => console.log('  ' + printValueInfo(n)));
    console.log('\n-- outputs --');
    outputs.forEach(n => console.log('  ' + printValueInfo(n)));
} else {
    console.log('no graph found');
}
