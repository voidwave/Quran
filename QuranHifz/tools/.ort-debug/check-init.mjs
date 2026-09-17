/* verify the appended initializer record */
import fs from 'node:fs';

const buf = fs.readFileSync(process.argv[2]);
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
let count = 0;
for (const rec of graph) {
    if (rec.f !== 5) { continue; }
    count += 1;
    if (rec.raw.includes(Buffer.from('surgeon'))) {
        console.log('found initializer record (field 5), bytes:');
        console.log(rec.raw.toString('hex').replace(/(..)/g, '$1 '));
        const inner = walk(rec.raw);
        for (const x of inner) {
            console.log('  field ' + x.f + ' wire ' + x.w + ' ' + (x.raw && x.raw.length < 40 && x.f === 8 ? '= "' + x.raw.toString('utf8') + '"' : x.v !== undefined ? '= ' + x.v : '= <' + (x.raw ? x.raw.length + ' bytes' : '?') + '>'));
        }
    }
}
console.log('total graph field-5 (initializer) records seen: ' + count);
console.log('surgeon present: ' + graph.filter(r => r.f === 5 && r.raw.includes(Buffer.from('surgeon'))).length);
