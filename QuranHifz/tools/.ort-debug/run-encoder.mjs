/* run the patched encoder with a zero window; sanity-check outputs */
import ort from 'onnxruntime-node';

const sess = await ort.InferenceSession.create(process.argv[2]);
const mk = needle => { for (const x of sess.inputNames) { if (String(x).toLowerCase().includes(needle)) return x; } return null; };
const feeds = {};
feeds[mk('audio')] = new ort.Tensor('float32', new Float32Array(80 * 22).fill(0.1), [1, 80, 22]);
feeds[mk('length')] = new ort.Tensor('int64', BigInt64Array.from([22n]), [1]);
feeds[mk('cache_last_channel')] = new ort.Tensor('float32', new Float32Array(17 * 70 * 512), [1, 17, 70, 512]);
feeds[mk('cache_last_time')] = new ort.Tensor('float32', new Float32Array(17 * 512 * 9), [1, 17, 512, 9]);
feeds[mk('cache_last_channel_len')] = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
const t0 = Date.now();
const out = await sess.run(feeds);
console.log('ran in ' + (Date.now() - t0) + 'ms');
for (const name of sess.outputNames) {
    const t = out[name];
    const d = t.data;
    let nan = 0; let min = Infinity; let max = -Infinity; let sum = 0;
    for (let i = 0; i < d.length; i += 1) {
        const v = Number(d[i]);
        if (Number.isNaN(v)) { nan += 1; continue; }
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
    }
    console.log('  ' + name + ' dims ' + JSON.stringify(t.dims) + ' type ' + t.type + ' · nan=' + nan + ' min=' + min.toFixed(3) + ' max=' + max.toFixed(3) + ' mean=' + (sum / d.length).toFixed(4));
}
