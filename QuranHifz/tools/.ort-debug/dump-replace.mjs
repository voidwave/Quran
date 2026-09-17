/* dump bytes around the first replacement in the patched file */
import fs from 'node:fs';

const file = process.argv[2] || 't4.onnx';
const buf = fs.readFileSync(file);
const needle = Buffer.from('/sur_cast');
let at = buf.indexOf(needle);
console.log('first /sur_cast at ' + at);
const start = Math.max(0, at - 260);
const chunk = buf.subarray(start, at + 160);
console.log(chunk.toString('hex').replace(/(..)/g, '$1 '));
console.log('---- as utf8 ----');
console.log(chunk.toString('utf8').replace(/[^\x20-\x7e]+/g, '.'));
