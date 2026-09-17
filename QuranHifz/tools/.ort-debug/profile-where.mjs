/* run the ORIGINAL encoder with ORT profiling on, then show the Where node shapes */
import ort from 'onnxruntime-node';
import fs from 'node:fs';

const sess = await ort.InferenceSession.create(process.argv[2], {
    enableProfiling: true,
    profileFilePrefix: 'profile'
});
const mk = needle => { for (const x of sess.inputNames) { if (String(x).toLowerCase().includes(needle)) return x; } return null; };
const feeds = {};
feeds[mk('audio')] = new ort.Tensor('float32', new Float32Array(80 * 22).fill(0.1), [1, 80, 22]);
feeds[mk('length')] = new ort.Tensor('int64', BigInt64Array.from([22n]), [1]);
feeds[mk('cache_last_channel')] = new ort.Tensor('float32', new Float32Array(17 * 70 * 512), [1, 17, 70, 512]);
feeds[mk('cache_last_time')] = new ort.Tensor('float32', new Float32Array(17 * 512 * 9), [1, 17, 512, 9]);
feeds[mk('cache_last_channel_len')] = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
await sess.run(feeds);
await sess.endProfiling();

const prof = JSON.parse(fs.readFileSync('profile.json', 'utf8'));
const hits = prof.filter(e => e.name && String(e.name).includes('self_attn/Where'));
for (const h of hits.slice(0, 6)) {
    console.log('== ' + h.name + ' cat=' + h.cat);
    console.log('  inputs: ' + (h.args ? JSON.stringify(h.args).slice(0, 400) : '?'));
    console.log('  output: ' + JSON.stringify(h.output_type_shape));
}
console.log('total profile events: ' + prof.length);
