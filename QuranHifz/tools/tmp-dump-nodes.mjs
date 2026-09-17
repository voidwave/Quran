/* one-off: dump ONNX graph nodes matching a name/op query, plus their
   producers — used to understand the /layers.1/self_attn/Where node that
   blocks ORT-web's WebGPU kernels. */
import fs from 'node:fs';

const file = process.argv[2];
const needle = process.argv[3] || 'Where';
const buf = fs.readFileSync(file);

function leb(b, i0) {
    let r = 0; let s = 0; let i = i0; let x;
    do {
        x = b[i]; i += 1;
        r |= (x & 0x7f) << s;
        s += 7;
    } while (x & 0x80);
    return { v: r >>> 0, n: i };
}

function parse(b) {
    const out = [];
    let i = 0;
    while (i < b.length) {
        const t = leb(b, i); i = t.n;
        const field = t.v >>> 3;
        const wire = t.v & 7;
        if (wire === 2) {
            const l = leb(b, i); i = l.n;
            out.push({ f: field, wire: wire, data: b.subarray(i, i + l.v) });
            i += l.v;
        } else if (wire === 0) {
            const v = leb(b, i); i = v.n;
            out.push({ f: field, wire: wire, v: v.v });
        } else if (wire === 5) {
            out.push({ f: field, wire: wire, v: b.readFloatLE(i) });
            i += 4;
        } else if (wire === 1) {
            out.push({ f: field, wire: wire, v: b.readDoubleLE(i) });
            i += 8;
        } else {
            throw new Error('bad wire ' + wire + ' at ' + i);
        }
    }
    return out;
}

const fields = f => fields.cache || (fields.cache = new Map());

const model = parse(buf);
const graph = model.find(x => x.f === 7 && x.wire === 2).data;
const gfields = parse(graph);

function str(d) { return d.toString('utf8'); }

const nodes = [];
const valueTypes = new Map();
for (const g of gfields) {
    if (g.f === 1 && g.wire === 2) {
        const nf = parse(g.data);
        const node = { inputs: [], outputs: [], name: '', op: '', attrs: [] };
        for (const x of nf) {
            if (x.f === 1) node.inputs.push(str(x.data));
            else if (x.f === 2) node.outputs.push(str(x.data));
            else if (x.f === 3) node.name = str(x.data);
            else if (x.f === 4) node.op = str(x.data);
            else if (x.f === 5) {
                const af = parse(x.data);
                const a = {};
                for (const y of af) {
                    if (y.f === 1) a.name = str(y.data);
                    else if (y.f === 3) a.i = y.v;
                    else if (y.f === 2) a.f = y.v;
                    else if (y.f === 4) a.s = str(y.data);
                }
                node.attrs.push(a);
            }
        }
        nodes.push(node);
    } else if ((g.f === 13 || g.f === 11 || g.f === 12) && g.wire === 2) {
        const vf = parse(g.data);
        let name = '';
        let type = '';
        for (const x of vf) {
            if (x.f === 1) name = str(x.data);
            else if (x.f === 2) {
                const tf = parse(x.data);
                for (const t of tf) {
                    if (t.f === 1) {
                        const ttf = parse(t.data);
                        for (const e of ttf) {
                            if (e.f === 1) type = 'elemtype=' + e.v;
                        }
                    }
                }
            }
        }
        if (name) valueTypes.set(name, type);
    }
}

const producer = new Map();
for (const n of nodes) {
    for (const o of n.outputs) producer.set(o, n);
}

console.log('total nodes: ' + nodes.length);
const hits = nodes.filter(n => (n.name + ' ' + n.op).indexOf(needle) !== -1);
console.log('matching "' + needle + '": ' + hits.length);
const seen = new Set();
for (const h of hits) {
    console.log('=== ' + h.op + ' "' + h.name + '"');
    console.log('  inputs:  ' + h.inputs.join(', '));
    console.log('  outputs: ' + h.outputs.join(', '));
    if (h.attrs.length) console.log('  attrs:   ' + JSON.stringify(h.attrs));
    h.inputs.forEach(inName => {
        const p = producer.get(inName);
        if (p && !seen.has(inName)) {
            seen.add(inName);
            console.log('  ↳ producer of ' + inName + ': ' + p.op + ' "' + p.name + '"  in=[' + p.inputs.join(',') + ']' + (p.attrs.length ? ' attrs=' + JSON.stringify(p.attrs) : ''));
            p.inputs.forEach(pp => {
                const q = producer.get(pp);
                if (q && !seen.has(pp)) {
                    seen.add(pp);
                    console.log('     ↳ ' + pp + ': ' + q.op + ' "' + q.name + '" in=[' + q.inputs.join(',') + ']' + (q.attrs.length ? ' attrs=' + JSON.stringify(q.attrs) : ''));
                } else if (!q) {
                    console.log('     ↳ ' + pp + ': <initializer or graph input>');
                }
            });
        } else if (!p) {
            console.log('  ↳ producer of ' + inName + ': <initializer or graph input>');
        }
    });
}
