/* ===========================================================================
 * patch-onnx-where.mjs — replaces Where nodes with pure-float arithmetic.
 *
 *   node QuranHifz/tools/patch-onnx-where.mjs in.onnx out.onnx
 *
 * ORT-web's WebGPU (JSEP) kernels cannot execute the masked-attention
 * `Where(cond_bool, fill, data)` nodes of the NeMo FastConformer export
 * ("Can't perform where op on the given tensors"). The identity
 *     where(c, x, y) == c*x + (1-c)*y        (c in {0,1})
 * reproduces the node exactly with Cast/Mul/Sub/Add, all of which the
 * WebGPU kernels support. Node/initializer bytes are kept verbatim; only
 * the node list is edited (protobuf-level).
 * =========================================================================== */

import fs from 'node:fs';

const inFile = process.argv[2];
const outFile = process.argv[3];
if (!inFile || !outFile) {
    console.log('usage: node tools/patch-onnx-where.mjs in.onnx out.onnx');
    process.exit(1);
}

/* NO_REPLACE=1: only re-serialize (no node edits) — used to bisect
   serialization bugs vs patched-content bugs. LIMIT=n: patch first n
   nodes only. SKIP_INIT=1: do not append the scalar initializer. */
const identity = process.env.NO_REPLACE === '1';
const limit = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : Infinity;
const skipInit = process.env.SKIP_INIT === '1';

const buf = fs.readFileSync(inFile);

function readVarint(b, i0) {
    let r = 0; let s = 0; let i = i0; let x;
    do {
        x = b[i]; i += 1;
        r |= (x & 0x7f) << s;
        s += 7;
    } while (x & 0x80);
    return { v: r >>> 0, n: i };
}

function writeVarint(n) {
    const out = [];
    let v = n >>> 0;
    while (v > 127) {
        out.push((v & 0x7f) | 0x80);
        v = Math.floor(v / 128);
    }
    out.push(v);
    return Buffer.from(out);
}

/* records: { f, wire, raw (wire 0: varint number; 1: 8 bytes; 5: 4 bytes; 2: sub-buffer) } */
function parse(b) {
    const out = [];
    let i = 0;
    while (i < b.length) {
        const t = readVarint(b, i); i = t.n;
        const field = t.v >>> 3;
        const wire = t.v & 7;
        if (wire === 2) {
            const l = readVarint(b, i); i = l.n;
            out.push({ f: field, wire: wire, raw: b.subarray(i, i + l.v) });
            i += l.v;
        } else if (wire === 0) {
            const v = readVarint(b, i); i = v.n;
            out.push({ f: field, wire: wire, raw: v.v });
        } else if (wire === 5) {
            out.push({ f: field, wire: wire, raw: b.subarray(i, i + 4) });
            i += 4;
        } else if (wire === 1) {
            out.push({ f: field, wire: wire, raw: b.subarray(i, i + 8) });
            i += 8;
        } else {
            throw new Error('unsupported wire type ' + wire);
        }
    }
    return out;
}

function emit(field, wire, raw) {
    const tag = writeVarint((field << 3) | wire);
    if (wire === 2) {
        return Buffer.concat([tag, writeVarint(raw.length), raw]);
    }
    if (wire === 0) {
        return Buffer.concat([tag, writeVarint(raw)]);
    }
    return Buffer.concat([tag, raw]);
}

function emitRecord(rec) {
    return emit(rec.f, rec.wire, rec.raw);
}

function makeNode(inputs, outputs, name, op, attrs) {
    const parts = [];
    outputs.forEach(o => parts.push(emit(2, 2, Buffer.from(o, 'utf8'))));
    inputs.forEach(x => parts.push(emit(1, 2, Buffer.from(x, 'utf8'))));
    parts.push(emit(4, 2, Buffer.from(op, 'utf8')));
    parts.push(emit(3, 2, Buffer.from(name, 'utf8')));
    (attrs || []).forEach(attr => {
        /* attr: {name, type, i} */
        const ab = [];
        ab.push(emit(1, 2, Buffer.from(attr.name, 'utf8')));
        ab.push(emit(3, 0, attr.i));
        ab.push(emit(20, 0, attr.type));
        parts.push(emit(5, 2, Buffer.concat(ab)));
    });
    return Buffer.concat(parts);
}

function makeFloatScalarInitializer(name, value) {
    const fb = Buffer.alloc(4);
    fb.writeFloatLE(value, 0);
    const parts = [];
    parts.push(emit(2, 0, 1));                    /* data_type = FLOAT */
    parts.push(emit(4, 5, fb));                   /* float_data[0] */
    parts.push(emit(8, 2, Buffer.from(name, 'utf8')));
    return Buffer.concat(parts);
}

/* ------------------------------------------------------------------ model */

const model = parse(buf);
const graphRec = model.find(r => r.f === 7 && r.wire === 2);
if (!graphRec) {
    throw new Error('no graph in model');
}
const graph = parse(graphRec.raw);

/* -------- pre-pass: output types (value_info / inputs / outputs) and
   producers, so integer Where nodes can be left untouched ---- */
const typeOf = new Map();
const producerOf = new Map();
for (const rec of graph) {
    if (rec.f === 11 || rec.f === 12 || rec.f === 13) {
        const vi = parse(rec.raw);
        let name = '';
        let elem = null;
        for (const x of vi) {
            if (x.f === 1 && x.wire === 2) {
                name = x.raw.toString('utf8');
            } else if (x.f === 2 && x.wire === 2) {
                const tp = parse(x.raw);
                for (const y of tp) {
                    if (y.f === 1 && y.wire === 2) {
                        const tt = parse(y.raw);
                        for (const z of tt) {
                            if (z.f === 1 && z.wire === 0) {
                                elem = z.raw;
                            }
                        }
                    }
                }
            }
        }
        if (name && elem !== null) {
            typeOf.set(name, elem);
        }
    } else if (rec.f === 1 && rec.wire === 2) {
        const parsed = parse(rec.raw);
        for (const x of parsed) {
            if (x.f === 2 && x.wire === 2) {
                producerOf.set(x.raw.toString('utf8'), parsed);
            }
        }
    }
}

/* data_type of a node's `value` attribute tensor (Constant/ConstantOfShape) */
function tensorValueType(parsedNode) {
    for (const x of parsedNode) {
        if (x.f === 5 && x.wire === 2) {
            const af = parse(x.raw);
            let aname = '';
            let tensor = null;
            for (const y of af) {
                if (y.f === 1 && y.wire === 2) {
                    aname = y.raw.toString('utf8');
                } else if (y.f === 5 && y.wire === 2) {
                    tensor = y.raw;
                }
            }
            if (aname === 'value' && tensor) {
                const tf = parse(tensor);
                for (const t of tf) {
                    if (t.f === 2 && t.wire === 0) {
                        return t.raw;
                    }
                }
            }
        }
    }
    return null;
}

let skippedInts = 0;

const ONE = '/surgeon/one_f32';
let replacements = 0;
const newGraphParts = [];

for (const rec of graph) {
    if (!(rec.f === 1 && rec.wire === 2)) {
        newGraphParts.push(emitRecord(rec));
        continue;
    }
    const node = parse(rec.raw);
    let op = '';
    const inputs = [];
    const outputs = [];
    for (const x of node) {
        if (x.f === 4 && x.wire === 2) {
            op = x.raw.toString('utf8');
        } else if (x.f === 1 && x.wire === 2) {
            inputs.push(x.raw.toString('utf8'));
        } else if (x.f === 2 && x.wire === 2) {
            outputs.push(x.raw.toString('utf8'));
        }
    }
    if (identity || op !== 'Where' || inputs.length !== 3 || outputs.length !== 1
        || replacements >= limit) {
        newGraphParts.push(emitRecord(rec));
        continue;
    }
    /* Where survives on WebGPU only for some dtypes; integer-typed Where
       nodes work fine and must not be rewritten as float math. */
    let dtype = typeOf.get(outputs[0]);
    if (dtype === undefined && producerOf.has(inputs[1])) {
        dtype = tensorValueType(producerOf.get(inputs[1]));
    }
    if (dtype === undefined && producerOf.has(inputs[2])) {
        dtype = tensorValueType(producerOf.get(inputs[2]));
    }
    if (dtype === 3 || dtype === 4 || dtype === 5 || dtype === 6 || dtype === 7) {
        skippedInts += 1;
        newGraphParts.push(emitRecord(rec));
        continue;
    }
    const [cond, fill, data] = inputs;
    const out = outputs[0];
    const sfx = out.replace(/[^A-Za-z0-9_]/g, '_');
    const cCast = out + '/sur_cast';
    const cA = out + '/sur_a';
    const cB = out + '/sur_b';
    const cD = out + '/sur_d';
    replacements += 1;
    newGraphParts.push(emit(1, 2, makeNode([cond], [cCast], sfx + '/sur_cast', 'Cast', [{ name: 'to', type: 2, i: 1 }])));
    newGraphParts.push(emit(1, 2, makeNode([cCast, fill], [cA], sfx + '/sur_a', 'Mul')));
    newGraphParts.push(emit(1, 2, makeNode([ONE, cCast], [cB], sfx + '/sur_b', 'Sub')));
    newGraphParts.push(emit(1, 2, makeNode([cB, data], [cD], sfx + '/sur_d', 'Mul')));
    newGraphParts.push(emit(1, 2, makeNode([cA, cD], [out], sfx + '/sur_add', 'Add')));
}

/* append the scalar "1" initializer (graph field 5) */
if (!identity && !skipInit) {
    newGraphParts.push(emit(5, 2, makeFloatScalarInitializer(ONE, 1)));
}

const newGraph = Buffer.concat(newGraphParts);

const modelParts = [];
for (const rec of model) {
    if (rec === graphRec) {
        modelParts.push(emit(7, 2, newGraph));
    } else {
        modelParts.push(emitRecord(rec));
    }
}

fs.writeFileSync(outFile, Buffer.concat(modelParts));
console.log('replaced ' + replacements + ' Where node(s) (' + skippedInts + ' integer-typed left as-is); wrote ' + outFile);
