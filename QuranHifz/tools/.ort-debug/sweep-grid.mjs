/* sweep (W, C, K) grid internally and write results to a file */
import ort from 'onnxruntime-node';
import fs from 'node:fs';

const path = '../asr-models/fastconformer-ar-quran/encoder.onnx';
const sess = await ort.InferenceSession.create(path);
const names = sess.inputNames;
const mk = needle => { for (const x of names) { if (String(x).toLowerCase().includes(needle)) return x; } return null; };

const lines = [];
async function attempt(W, C, K) {
    const feeds = {};
    feeds[mk('audio')] = new ort.Tensor('float32', new Float32Array(80 * W).fill(0.1), [1, 80, W]);
    feeds[mk('length')] = new ort.Tensor('int64', BigInt64Array.from([BigInt(W)]), [1]);
    feeds[mk('cache_last_channel')] = new ort.Tensor('float32', new Float32Array(17 * C * 512), [1, 17, C, 512]);
    feeds[mk('cache_last_time')] = new ort.Tensor('float32', new Float32Array(17 * 512 * K), [1, 17, 512, K]);
    feeds[mk('cache_last_channel_len')] = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
    try {
        const out = await sess.run(feeds);
        const o0 = out[sess.outputNames[0]];
        lines.push('W=' + W + ' C=' + C + ' K=' + K + ' OK out=' + JSON.stringify(o0.dims));
        return true;
    } catch (error) {
        const msg = String(error && error.message ? error.message : error).replace(/\s+/g, ' ');
        const node = /Name:'([^']+)'/.exec(msg);
        const bcast = /(\d+) by (\d+)/.exec(msg);
        lines.push('W=' + W + ' C=' + C + ' K=' + K + ' FAIL' + (node ? ' @' + node[1] : '') + (bcast ? ' (' + bcast[1] + ' by ' + bcast[2] + ')' : ' ' + msg.slice(0, 80)));
        return false;
    }
}

/* phase 1: K sweep at C=70, W=22 */
for (const K of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20]) {
    await attempt(22, 70, K);
}
/* phase 2: C sweep at K=9, W=22 (find OK) */
for (let C = 64; C <= 76; C += 1) {
    await attempt(22, C, 9);
}
/* phase 3: W sweep at C=70, K=9 */
for (const W of [9, 10, 17, 18, 19, 20, 21, 23, 24, 25, 26, 32, 33, 40, 41, 48, 49]) {
    await attempt(W, 70, 9);
}

fs.writeFileSync('grid-results.txt', lines.join('\n'));
console.log('wrote grid-results.txt (' + lines.length + ' lines)');
