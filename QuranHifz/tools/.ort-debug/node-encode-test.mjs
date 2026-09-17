/* reproduce + hexdump the new-node encoding */
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
function makeNode(inputs, outputs, name, op, attrs) {
    const parts = [];
    outputs.forEach(o => parts.push(emit(2, 2, Buffer.from(o, 'utf8'))));
    inputs.forEach(x => parts.push(emit(1, 2, Buffer.from(x, 'utf8'))));
    parts.push(emit(4, 2, Buffer.from(op, 'utf8')));
    parts.push(emit(3, 2, Buffer.from(name, 'utf8')));
    (attrs || []).forEach(attr => {
        const ab = [];
        ab.push(emit(1, 2, Buffer.from(attr.name, 'utf8')));
        ab.push(emit(3, 0, attr.i));
        ab.push(emit(20, 0, attr.type));
        parts.push(emit(5, 2, Buffer.concat(ab)));
    });
    return Buffer.concat(parts);
}

const node = makeNode(['cond_x'], ['out_x'], 'out_x/sur_cast', 'Cast', [{ name: 'to', type: 2, i: 1 }]);
console.log('bytes: ' + node.length);
console.log(node.toString('hex').replace(/(..)/g, '$1 '));
console.log('---- structure walk ----');
let i = 0;
function readVarint() {
    let r = 0; let s = 0; let x;
    do { x = node[i]; i += 1; r |= (x & 0x7f) << s; s += 7; } while (x & 0x80);
    return r >>> 0;
}
while (i < node.length) {
    const tag = readVarint();
    const f = tag >>> 3;
    const w = tag & 7;
    if (w === 2) {
        const len = readVarint();
        console.log('field ' + f + ' wire 2 len ' + len + ' = "' + node.subarray(i, i + len).toString('utf8') + '"');
        i += len;
    } else if (w === 0) {
        console.log('field ' + f + ' wire 0 value ' + readVarint());
    } else {
        console.log('field ' + f + ' wire ' + w + ' (unhandled)');
        break;
    }
}
