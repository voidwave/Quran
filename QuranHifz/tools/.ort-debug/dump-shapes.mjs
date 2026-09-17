/* print value_info shapes for names matching a pattern */
import fs from 'node:fs';

const buf = fs.readFileSync(process.argv[2]);
const needle = process.argv[3] || 'self_attn';
function readVarint(b, i0) {
    let r = 0; let s = 0; let i = i0; let x;
    do { x = b[i]; i += 1; r |= (x & 0x7f) << s; s += 7; } while (x & 0x80);
    return { v: r >>> 0, n: i };
}
function walk(b) {
    const out = [];
    let i = 0;
    while (i < b.length) {
        const t = readVarint(b, i); i = t.n;
        const f = t.v >>> 3; const w = t.v & 7;
        if (w === 2) { const l = readVarint(b, i); i = l.n; out.push({ f, w, raw: b.subarray(i, i + l.v) }); i += l.v; }
        else if (w === 0) { const v = readVarint(b, i); i = v.n; out.push({ f, w, v: v.v }); }
        else if (w === 5) { out.push({ f, w, raw: b.subarray(i, i + 4) }); i += 4; }
        else if (w === 1) { out.push({ f, w, raw: b.subarray(i, i + 8) }); i += 8; }
        else { throw new Error('wire ' + w); }
    }
    return out;
}
const model = walk(buf);
const graph = walk(model.find(r => r.f === 7).raw);
console.log('graph records: inputs(f11)=' + graph.filter(r => r.f === 11).length
    + ' outputs(f12)=' + graph.filter(r => r.f === 12).length
    + ' value_info(f13)=' + graph.filter(r => r.f === 13).length);
let printed = 0;
for (const rec of graph) {
    if (rec.f !== 13 && rec.f !== 11 && rec.f !== 12) { continue; }
    const vi = walk(rec.raw);
    let name = '';
    let shape = '';
    let elem = '';
    for (const x of vi) {
        if (x.f === 1 && x.w === 2) { name = x.raw.toString('utf8'); }
        else if (x.f === 2 && x.w === 2) {
            const tp = walk(x.raw);
            for (const y of tp) {
                if (y.f === 1 && y.w === 2) {   // tensor_type
                    const tt = walk(y.raw);
                    for (const z of tt) {
                        if (z.f === 1 && z.w === 0) { elem = 'T' + z.v; }
                        else if (z.f === 2 && z.w === 2) {  // shape
                            const sh = walk(z.raw);
                            const dims = [];
                            for (const d of sh) {
                                if (d.f === 1 && d.w === 2) {
                                    const dd = walk(d.raw);
                                    let dv = '?';
                                    for (const e of dd) {
                                        if (e.f === 1 && e.w === 0) { dv = e.v; }
                                        else if (e.f === 2 && e.w === 2) { dv = e.raw.toString('utf8'); }
                                    }
                                    dims.push(dv);
                                }
                            }
                            shape = '[' + dims.join(',') + ']';
                        }
                    }
                }
            }
        }
    }
    if (name.includes(needle) && printed < 40) {
        printed += 1;
        console.log(name + ' ' + elem + ' ' + shape);
    }
}
