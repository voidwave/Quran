/* probe the int8 FastConformer Quran bundle: exact I/O names/shapes + run smoke tests */
import ort from 'onnxruntime-node';

const base = '../asr-models/fastconformer-quran-int8/';
const enc = await ort.InferenceSession.create(base + 'encoder.int8.onnx');
const dec = await ort.InferenceSession.create(base + 'decoder.int8.onnx');
const join = await ort.InferenceSession.create(base + 'joiner.int8.onnx');

for (const [name, sess] of [['encoder', enc], ['decoder', dec], ['joiner', join]]) {
    console.log('== ' + name);
    console.log('   in : ' + sess.inputNames.join(', '));
    console.log('   out: ' + sess.outputNames.join(', '));
}

/* ---- encoder smoke run ---- */
const W = 128;
const encFeeds = {};
encFeeds[enc.inputNames[0]] = new ort.Tensor('float32', new Float32Array(80 * W).fill(0.1), [1, 80, W]);
encFeeds[enc.inputNames[1]] = new ort.Tensor('int64', BigInt64Array.from([BigInt(W)]), [1]);
const t0 = Date.now();
const encOut = await enc.run(encFeeds);
console.log('encoder ran in ' + (Date.now() - t0) + 'ms');
for (const n of enc.outputNames) {
    console.log('   ' + n + ' dims ' + JSON.stringify(encOut[n].dims) + ' type ' + encOut[n].type);
}

/* ---- decoder (possibly decoder_joint) smoke run ---- */
function feedFor(sess, role) {
    const feeds = {};
    for (const name of sess.inputNames) {
        const lower = name.toLowerCase();
        if (lower.includes('target_length')) {
            feeds[name] = new ort.Tensor('int32', Int32Array.from([1]), [1]);
        } else if (lower.includes('target')) {
            feeds[name] = new ort.Tensor('int32', Int32Array.from([1024]), [1, 1]);
        } else if (lower.includes('encoder')) {
            feeds[name] = new ort.Tensor('float32', new Float32Array(512), [1, 512, 1]);
        } else if (lower.includes('decoder_outputs')) {
            feeds[name] = new ort.Tensor('float32', new Float32Array(640), [1, 640, 1]);
        } else if (lower.includes('states_1') || lower.includes('state1')) {
            feeds[name] = new ort.Tensor('float32', new Float32Array(640), [1, 1, 640]);
        } else if (lower.includes('states_2') || lower.includes('state2')) {
            feeds[name] = new ort.Tensor('float32', new Float32Array(640), [1, 1, 640]);
        } else if (lower.includes('length')) {
            feeds[name] = new ort.Tensor('int32', Int32Array.from([1]), [1]);
        } else {
            feeds[name] = new ort.Tensor('float32', new Float32Array(640), [1, 1, 640]);
        }
    }
    return feeds;
}

for (const [label, sess] of [['decoder', dec], ['joiner', join]]) {
    try {
        const out = await sess.run(feedFor(sess));
        const parts = sess.outputNames.map(n => n + JSON.stringify(out[n].dims) + '/' + out[n].type);
        console.log(label + ' run OK: ' + parts.join('  '));
        /* show first logits stats of first output */
        const first = out[sess.outputNames[0]];
        const d = first.data.slice(0, 6);
        console.log('   first output sample:', Array.from(d, v => Number(v).toFixed(2)).join(', '));
    } catch (error) {
        console.log(label + ' run FAIL: ' + String(error.message || error).slice(0, 300));
    }
}
