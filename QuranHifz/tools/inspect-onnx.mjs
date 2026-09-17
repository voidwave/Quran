/* ===========================================================================
 * inspect-onnx.mjs — reads the header of an ONNX file (no dependencies).
 *
 *   node QuranHifz/tools/inspect-onnx.mjs QuranHifz/tools/asr-models/fastconformer-quran-int8/encoder.int8.onnx
 *
 * Reports ir_version, producer, opset imports, file size, and the sherpa-onnx
 * metadata fields when present. The graph itself is skipped (length-delimited
 * protobuf), so it is fast even for a 450MB model.
 * =========================================================================== */

import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
    console.log('usage: node tools/inspect-onnx.mjs <file.onnx>');
    process.exit(1);
}
const buf = fs.readFileSync(file);
let i = 0;
const varint = () => {
    let result = 0;
    let shift = 0;
    let b;
    do { b = buf[i++]; result |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    return result >>> 0;
};
const str = (len) => buf.subarray(i, i += len).toString('utf8');

function parseDim(end) {
    let value = null;
    while (i < end) {
        const k = varint();
        const f = k >>> 3;
        const w = k & 7;
        if (w === 0) {
            const v = varint();
            if (f === 1) value = v;
        } else if (w === 2) {
            const l = varint();
            if (f === 2) value = str(l);
            else i += l;
        } else {
            i = end;
        }
    }
    return value === null ? '?' : value;
}

function parseShapeDims(end) {
    const out = [];
    while (i < end) {
        const k = varint();
        const f = k >>> 3;
        const w = k & 7;
        if (w === 2) {
            const l = varint();
            if (f === 1) out.push(parseDim(i + l));
            else i += l;
        } else if (w === 0) varint();
        else i = end;
    }
    return out;
}

function parseTensorShape(end) {
    let dims = null;
    while (i < end) {
        const k = varint();
        const f = k >>> 3;
        const w = k & 7;
        if (w === 2) {
            const l = varint();
            if (f === 2) dims = parseShapeDims(i + l);
            else i += l;
        } else if (w === 0) varint();
        else i = end;
    }
    return dims;
}

function parseValueInfo(end) {
    const info = { name: '', shape: null };
    while (i < end) {
        const k = varint();
        const f = k >>> 3;
        const w = k & 7;
        if (w === 2) {
            const l = varint();
            if (f === 1) {
                info.name = str(l);
            } else if (f === 2) {
                const endT = i + l;
                let dims = null;
                while (i < endT) {
                    const k2 = varint();
                    const f2 = k2 >>> 3;
                    const w2 = k2 & 7;
                    if (w2 === 2) {
                        const l2 = varint();
                        if (f2 === 1) dims = parseTensorShape(i + l2);
                        else i += l2;
                    } else if (w2 === 0) varint();
                    else i = endT;
                }
                info.shape = dims;
            } else {
                i += l;
            }
        } else if (w === 0) varint();
        else i = end;
    }
    return info;
}

const out = { file, sizeMB: +(buf.length / 1048576).toFixed(1), ir_version: null, producer: null, producer_version: null, opset: [], graphBytes: null, graphName: null, inputs: [], outputs: [], metadata: {} };

while (i < buf.length) {
    const key = varint();
    const field = key >>> 3;
    const wire = key & 7;
    if (wire === 2) {
        const len = varint();
        if (field === 2) {
            out.producer = str(len);
        } else if (field === 3) {
            out.producer_version = str(len);
        } else if (field === 7) {
            /* Walk only the shape metadata of the graph: nodes and
               initializers are skipped by their declared length. */
            out.graphBytes = len;
            const end = i + len;
            while (i < end) {
                const k2 = varint();
                const f2 = k2 >>> 3;
                const w2 = k2 & 7;
                if (w2 === 2) {
                    const l2 = varint();
                    if (f2 === 2) {
                        out.graphName = str(l2);
                    } else if (f2 === 11 || f2 === 12) {
                        const info = parseValueInfo(i + l2);
                        info.name = info.name || '(unnamed)';
                        (f2 === 11 ? out.inputs : out.outputs).push(info.name + ' ' + JSON.stringify(info.shape));
                    } else {
                        i += l2;
                    }
                } else if (w2 === 0) {
                    varint();
                } else {
                    i = end;
                }
            }
        } else if (field === 8) {
            const end = i + len;
            let domain = '';
            let version = 0;
            while (i < end) {
                const k2 = varint();
                const f2 = k2 >>> 3;
                const w2 = k2 & 7;
                if (w2 === 0) {
                    const v2 = varint();
                    if (f2 === 2) version = v2;
                } else if (w2 === 2) {
                    const l2 = varint();
                    const s2 = str(l2);
                    if (f2 === 1) domain = s2;
                } else {
                    i = end;
                }
            }
            out.opset.push((domain || 'ai.onnx') + '@' + version);
        } else if (field === 14) { // metadata_props
            const end = i + len;
            let key2 = '';
            let value = '';
            while (i < end) {
                const k2 = varint();
                const f2 = k2 >>> 3;
                const w2 = k2 & 7;
                if (w2 === 2) {
                    const l2 = varint();
                    const s2 = str(l2);
                    if (f2 === 1) key2 = s2;
                    else if (f2 === 2) value = s2;
                } else if (w2 === 0) {
                    varint();
                } else {
                    i = end;
                }
            }
            out.metadata[key2] = value.length > 200 ? value.slice(0, 200) + '…' : value;
        } else {
            i += len;
        }
    } else if (wire === 0) {
        const v = varint();
        if (field === 1) out.ir_version = v;
    } else if (wire === 5) {
        i += 4;
    } else if (wire === 1) {
        i += 8;
    } else {
        break;
    }
}

/* Quick scan for contributor op domains in the raw bytes. */
const contrib = buf.includes(Buffer.from('com.microsoft'));
const onnxMl = buf.includes(Buffer.from('ai.onnx.ml'));

console.log(JSON.stringify(Object.assign(out, { hasComMicrosoftDomain: contrib, hasAiOnnxMlDomain: onnxMl }), null, 2));
