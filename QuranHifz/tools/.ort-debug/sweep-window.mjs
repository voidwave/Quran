/* sweep window sizes against the ORIGINAL encoder to find the geometry
   the export was built for (mask broadcast must fit) */
import ort from 'onnxruntime-node';

const path = process.argv[2];
const sess = await ort.InferenceSession.create(path);
const names = sess.inputNames;
const mk = needle => { for (const x of names) { if (String(x).toLowerCase().includes(needle)) return x; } return null; };

const windows = process.argv.slice(3).map(Number);
const cacheC = process.env.CACHE_C ? Number(process.env.CACHE_C) : 70;
const cacheK = process.env.CACHE_K ? Number(process.env.CACHE_K) : 9;
for (const W of windows) {
    const feeds = {};
    feeds[mk('audio')] = new ort.Tensor('float32', new Float32Array(80 * W).fill(0.1), [1, 80, W]);
    feeds[mk('length')] = new ort.Tensor('int64', BigInt64Array.from([BigInt(W)]), [1]);
    feeds[mk('cache_last_channel')] = new ort.Tensor('float32', new Float32Array(17 * cacheC * 512), [1, 17, cacheC, 512]);
    feeds[mk('cache_last_time')] = new ort.Tensor('float32', new Float32Array(17 * 512 * cacheK), [1, 17, 512, cacheK]);
    feeds[mk('cache_last_channel_len')] = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
    try {
        const t0 = Date.now();
        const out = await sess.run(feeds);
        const o0 = out[sess.outputNames[0]];
        console.log('W=' + W + ' C=' + cacheC + ' K=' + cacheK + ' OK in ' + (Date.now() - t0) + 'ms · out ' + JSON.stringify(o0.dims));
    } catch (error) {
        const msg = String(error && error.message ? error.message : error).replace(/\s+/g, ' ');
        const m = /(\d+) by (\d+)/.exec(msg);
        const node = /Name:'([^']+)'/.exec(msg);
        console.log('W=' + W + ' C=' + cacheC + ' K=' + cacheK + ' FAIL' + (node ? ' @' + node[1] : '') + (m ? ' (' + m[1] + ' by ' + m[2] + ')' : '') + ' · ' + msg.slice(0, 100));
    }
}
