/* phoneme-asr-worker.js — streaming Quran phoneme recognizer (ort-web wasm).
 *
 * One architecture, two exports of Quran-Lab/zipformer_p-arabic-v3 (the v3.1
 * madd fine-tune), fed exactly as its card prescribes (torchaudio.compliance
 * kaldi.fbank): snip_edges=False → frames centred at (t+0.5)*160 (left pad =
 * mirror of the first 120 samples, right pad = the reversed signal); kaldi mel
 * 20–7600 (high_freq=-400); dc-offset removal, 0.97 preemphasis within the
 * frame, povey window, power spectrum, log(max(x, eps)).
 *   'arabic-v3'      — zipformer_p_arabic_v3.1.int8.onnx (default)
 *   'arabic-v3-fp32' — zipformer_p_arabic_v3.1.onnx (full precision)
 * The fp32 export falls back to the int8 one when its file is missing.
 *
 * The model emits a 250-unit Qur'anic phonetic alphabet (blank id read from
 * tokens.txt — 250), consumes 97 streaming caches + processed_lens (int64
 * frame counter), runs T=61-frame windows stepped by 48 frames, and flushes
 * with clamped tail windows.
 *
 * Protocol:
 *   in : {type:'load', model?}
 *        {type:'phonemes', id, audio: Float32Array(16000 Hz)}
 *        {type:'stream', action:'start'|'audio'|'end'|'flush', audio?}
 *   out: {type:'status', message} | {type:'ready', model}
 *        {type:'phonemes', id, units, unitIds, margins, ms, seconds}
 *        {type:'stream-units', unitIds, units, margins} | {type:'stream-end'}
 *        {type:'error', message}
 *
 * Every unit carries a confidence margin (margin_peak, decode_with_confidence
 * semantics): at the frame where the unit's probability peaked during its run,
 * peak probability minus the best runner-up. Aligned with unitIds; the run
 * still open at send time has no margin yet (margins may be one shorter).
 *
 * License: Quran-Lab NPL-1.2 (no-profit; automatic tajweed feedback can be
 * wrong and does not replace a qualified teacher).
 */
'use strict';

var ORT_VERSION = '1.30.0';
var ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@' + ORT_VERSION + '/dist/';

var SR = 16000, NFFT = 512, FRAME = 400, SHIFT = 160, BINS = 80;
var FLT_EPS = 1.1920929e-7;
var T = 61, STEP = 48;
var PAD_LEFT = FRAME / 2 - SHIFT / 2;          /* 120 — centred-frame left pad */

var MODELS = {
    'arabic-v3': {
        dir: 'tools/asr-models/zipformer-p-arabic-v3/',
        file: 'zipformer_p_arabic_v3.1.int8.onnx',
        label: 'v3.1 int8',
        snipEdges: false,
        highFreq: 7600
    },
    'arabic-v3-fp32': {
        dir: 'tools/asr-models/zipformer-p-arabic-v3/',
        file: 'zipformer_p_arabic_v3.1.onnx',
        label: 'v3.1 fp32',
        snipEdges: false,
        highFreq: 7600
    }
};
var FALLBACK = { 'arabic-v3-fp32': 'arabic-v3', 'arabic-v3': null };

/* Where the phoneme model files live when the site itself does not carry them
   (GitHub cannot host the larger exports): the project mirror on Hugging Face.
   The files sit at the root of voidwaveDev/phoneme-v3; the older
   fastconformer-quran/phoneme-v3/ folder stays as a second candidate. Same
   local-first, mirror-second order as the FastConformer int8 engine. */
var MIRROR_BASES = [
    'https://huggingface.co/voidwaveDev/phoneme-v3/resolve/main/',
    'https://huggingface.co/voidwaveDev/fastconformer-quran/resolve/main/phoneme-v3/'
];

/* ---------- fbank ---------- */

var melScale = function (f) { return 1127 * Math.log(1 + f / 700); };
var numFftBins = NFFT / 2;
var fftBinWidth = SR / NFFT;
var MEL_CACHE = {};

/** Kaldi mel filterbank for one high cutoff (20 Hz .. highFreq, mel-domain
 *  triangular weights over the first 256 FFT bins — the Nyquist bin carries
 *  no weight, matching kaldi's zero right column). */
function melFilters(highFreq) {
    if (MEL_CACHE[highFreq]) {
        return MEL_CACHE[highFreq];
    }
    var melLow = melScale(20);
    var melHigh = melScale(highFreq);
    var melDelta = (melHigh - melLow) / (BINS + 1);
    var filters = [];
    for (var b = 0; b < BINS; b += 1) {
        var left = melLow + b * melDelta;
        var center = melLow + (b + 1) * melDelta;
        var right = melLow + (b + 2) * melDelta;
        var weights = new Float32Array(numFftBins);
        for (var i = 0; i < numFftBins; i += 1) {
            var mel = melScale(fftBinWidth * i);
            if (mel > left && mel < right) {
                weights[i] = mel <= center
                    ? (mel - left) / (center - left)
                    : (right - mel) / (right - center);
            }
        }
        filters.push(weights);
    }
    MEL_CACHE[highFreq] = filters;
    return filters;
}
var POVEY = new Float32Array(FRAME);
for (var n = 0; n < FRAME; n += 1) {
    POVEY[n] = Math.pow(0.5 - 0.5 * Math.cos(2 * Math.PI * n / (FRAME - 1)), 0.85);
}

function fft(re, im) {
    var size = re.length;
    for (var i = 1, j = 0; i < size; i += 1) {
        var bit = size >> 1;
        for (; j & bit; bit >>= 1) { j ^= bit; }
        j ^= bit;
        if (i < j) {
            var tr = re[i]; re[i] = re[j]; re[j] = tr;
            var ti = im[i]; im[i] = im[j]; im[j] = ti;
        }
    }
    for (var len = 2; len <= size; len <<= 1) {
        var ang = -2 * Math.PI / len;
        var wr = Math.cos(ang);
        var wi = Math.sin(ang);
        for (var start = 0; start < size; start += len) {
            var cwr = 1, cwi = 0;
            for (var k = 0; k < len / 2; k += 1) {
                var ur = re[start + k], ui = im[start + k];
                var vr = re[start + k + len / 2] * cwr - im[start + k + len / 2] * cwi;
                var vi = re[start + k + len / 2] * cwi + im[start + k + len / 2] * cwr;
                re[start + k] = ur + vr;
                im[start + k] = ui + vi;
                re[start + k + len / 2] = ur - vr;
                im[start + k + len / 2] = ui - vi;
                var nwr = cwr * wr - cwi * wi;
                cwi = cwr * wi + cwi * wr;
                cwr = nwr;
            }
        }
    }
}

/* active feature config, set per model at load */
var ACTIVE = null;

function computeFrame(buf, offset, re, im) {
    var out = new Float32Array(BINS);
    var n;
    var mean = 0;
    for (n = 0; n < FRAME; n += 1) { mean += buf[offset + n]; }
    mean /= FRAME;
    for (n = 0; n < FRAME; n += 1) { re[n] = buf[offset + n] - mean; }
    for (n = FRAME - 1; n > 0; n -= 1) { re[n] -= 0.97 * re[n - 1]; }
    re[0] -= 0.97 * re[0];
    for (n = 0; n < FRAME; n += 1) { re[n] *= POVEY[n]; }
    for (n = FRAME; n < NFFT; n += 1) { re[n] = 0; }
    im.fill(0);
    fft(re, im);
    var filters = ACTIVE.filters;
    for (var bin = 0; bin < BINS; bin += 1) {
        var filter = filters[bin];
        var acc = 0;
        for (var f = 0; f < numFftBins; f += 1) {
            acc += (re[f] * re[f] + im[f] * im[f]) * filter[f];
        }
        out[bin] = Math.log(Math.max(acc, FLT_EPS));
    }
    return out;
}

/** The whole clip at once. snip_edges=True keeps the classic layout (frames
 *  start at t*160); snip_edges=False builds the kaldi padded signal (left
 *  mirror of PAD_LEFT samples + the reversed full signal on the right) and
 *  centres the frames inside it. */
function computeFbank(samples) {
    var sampleCount = samples.length;
    var re = new Float32Array(NFFT);
    var im = new Float32Array(NFFT);
    var buf;
    var count;
    if (ACTIVE.snipEdges) {
        count = Math.max(0, 1 + Math.floor((sampleCount - FRAME) / SHIFT));
        buf = samples;
    } else {
        if (sampleCount < PAD_LEFT + 1) {
            return { feats: new Float32Array(0), numFrames: 0 };
        }
        count = Math.floor((sampleCount + SHIFT / 2) / SHIFT);
        buf = new Float32Array(PAD_LEFT + sampleCount * 2);
        var i;
        for (i = 0; i < PAD_LEFT; i += 1) {
            buf[i] = samples[PAD_LEFT - 1 - i];             /* mirror of the first samples */
        }
        buf.set(samples, PAD_LEFT);
        for (i = 0; i < sampleCount; i += 1) {
            buf[PAD_LEFT + sampleCount + i] = samples[sampleCount - 1 - i];  /* reversed signal */
        }
    }
    var feats = new Float32Array(count * BINS);
    for (var t = 0; t < count; t += 1) {
        var row = computeFrame(buf, t * SHIFT, re, im);
        feats.set(row, t * BINS);
    }
    return { feats: feats, numFrames: count };
}

/* ---------- encoder cache shapes (16 layers) ---------- */

var CACHE_CFG = [
    { key: [256, 1, 128], nonlin: [1, 1, 256, 144], val: [256, 1, 48], conv: [1, 192, 15] },
    { key: [256, 1, 128], nonlin: [1, 1, 256, 144], val: [256, 1, 48], conv: [1, 192, 15] },
    { key: [128, 1, 128], nonlin: [1, 1, 128, 192], val: [128, 1, 48], conv: [1, 256, 15] },
    { key: [128, 1, 128], nonlin: [1, 1, 128, 192], val: [128, 1, 48], conv: [1, 256, 15] },
    { key: [64, 1, 128], nonlin: [1, 1, 64, 288], val: [64, 1, 48], conv: [1, 384, 7] },
    { key: [64, 1, 128], nonlin: [1, 1, 64, 288], val: [64, 1, 48], conv: [1, 384, 7] },
    { key: [64, 1, 128], nonlin: [1, 1, 64, 288], val: [64, 1, 48], conv: [1, 384, 7] },
    { key: [32, 1, 256], nonlin: [1, 1, 32, 384], val: [32, 1, 96], conv: [1, 512, 7] },
    { key: [32, 1, 256], nonlin: [1, 1, 32, 384], val: [32, 1, 96], conv: [1, 512, 7] },
    { key: [32, 1, 256], nonlin: [1, 1, 32, 384], val: [32, 1, 96], conv: [1, 512, 7] },
    { key: [32, 1, 256], nonlin: [1, 1, 32, 384], val: [32, 1, 96], conv: [1, 512, 7] },
    { key: [64, 1, 128], nonlin: [1, 1, 64, 288], val: [64, 1, 48], conv: [1, 384, 7] },
    { key: [64, 1, 128], nonlin: [1, 1, 64, 288], val: [64, 1, 48], conv: [1, 384, 7] },
    { key: [64, 1, 128], nonlin: [1, 1, 64, 288], val: [64, 1, 48], conv: [1, 384, 7] },
    { key: [128, 1, 128], nonlin: [1, 1, 128, 192], val: [128, 1, 48], conv: [1, 256, 15] },
    { key: [128, 1, 128], nonlin: [1, 1, 128, 192], val: [128, 1, 48], conv: [1, 256, 15] }
];

var session = null;
var activeId = null;
var id2piece = {};
var BLANK = 250;
var loadPromise = null;
var loadKey = null;

function setStatus(message) {
    self.postMessage({ type: 'status', message: message });
}

function makeCaches() {
    var caches = {};
    session.inputNames.forEach(function (name) {
        if (name === 'x' || name === 'processed_lens') {
            return;
        }
        if (name === 'embed_states') {
            caches[name] = new ort.Tensor('float32', new Float32Array(1 * 128 * 3 * 19), [1, 128, 3, 19]);
            return;
        }
        var match = name.match(/^cached_(key|nonlin_attn|val1|val2|conv1|conv2)_(\d+)$/);
        if (!match || !CACHE_CFG[Number(match[2])]) {
            throw new Error('مدخل غير متوقع في النموذج: ' + name);
        }
        var cfg = CACHE_CFG[Number(match[2])];
        var shape = match[1] === 'key' ? cfg.key
            : match[1] === 'nonlin_attn' ? cfg.nonlin
                : match[1].indexOf('val') === 0 ? cfg.val : cfg.conv;
        var size = shape.reduce(function (a, b) { return a * b; }, 1);
        caches[name] = new ort.Tensor('float32', new Float32Array(size), shape);
    });
    return caches;
}

/* One zero window with fresh caches proves the graph, the cache shapes and
 * the tensor names all line up before anything is promised to the page. */
function warmupRun() {
    var feeds = makeCaches();
    feeds.x = new ort.Tensor('float32', new Float32Array(T * BINS), [1, T, BINS]);
    feeds.processed_lens = new ort.Tensor('int64', BigInt64Array.from([BigInt(T)]), [1]);
    return session.run(feeds).then(function (outputs) {
        if (!outputs.log_probs || outputs.log_probs.dims[2] !== 251) {
            throw new Error('مخرج غير متوقع من النموذج');
        }
    });
}

var ortLoaded = false;

function require_ort() {
    if (ortLoaded) {
        return;
    }
    importScripts(ORT_CDN + 'ort.min.js');
    ort.env.wasm.wasmPaths = ORT_CDN;
    /* one wasm thread: a thread pool cannot be spawned from inside a
       worker without cross-origin isolation (see ort-nemo-asr.js) */
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = true;
    ortLoaded = true;
}

function loadOne(modelId) {
    var model = MODELS[modelId];
    var localBase = new URL(model.dir, self.location.href).href;
    var bases = [localBase].concat(MIRROR_BASES);

    var open = function (base) {
        return fetch(base + 'tokens.txt').then(function (r) {
            if (!r.ok) {
                throw new Error('tokens.txt HTTP ' + r.status);
            }
            return r.text();
        }).then(function (text) {
            id2piece = {};
            BLANK = 250;
            text.split('\n').filter(Boolean).forEach(function (line) {
                var sp = line.lastIndexOf(' ');
                var piece = line.slice(0, sp);
                var id = Number(line.slice(sp + 1));
                id2piece[id] = piece;
                if (piece === '<blank>') {
                    BLANK = id;
                }
            });
            setStatus('الرموز جاهزة (' + (model.label || modelId) + ') — إنشاء جلسة ORT…');
            return ort.InferenceSession.create(base + model.file, { executionProviders: ['wasm'] });
        }).then(function (created) {
            session = created;
            ACTIVE = { snipEdges: model.snipEdges, filters: melFilters(model.highFreq), highFreq: model.highFreq };
            return warmupRun();
        });
    };

    var attemptBase = function (index) {
        if (index >= bases.length) {
            return Promise.reject(new Error('تعذّر جلب ملفات النموذج (' + (model.label || modelId) + ')'));
        }
        return open(bases[index]).catch(function (error) {
            session = null;
            ACTIVE = null;
            if (index + 1 < bases.length) {
                setStatus('ملفات ' + (model.label || modelId) + ' غير موجودة مع الموقع — الجلب من مرآة المشروع على Hugging Face…');
                return attemptBase(index + 1);
            }
            throw error;
        });
    };

    return attemptBase(0).then(function () {
        activeId = modelId;
        return modelId;
    });
}

function loadModel(requestedId) {
    /* an explicit request switches export; messages without one (stream
       frames, one-shot utterances) keep whatever is currently loaded */
    var key = MODELS[requestedId] ? requestedId : (activeId || 'arabic-v3');
    if (session && activeId === key) {
        return Promise.resolve(activeId);
    }
    if (loadPromise && loadKey === key) {
        return loadPromise;
    }
    if (loadPromise && loadKey !== key) {
        /* a load for another export is in flight — wait it out, then switch */
        return loadPromise.catch(function () { }).then(function () {
            return loadModel(requestedId);
        });
    }
    require_ort();
    var order = [];
    var id = key;
    while (id) {
        order.push(id);
        id = FALLBACK[id];
    }
    var attempt = function (index) {
        if (index >= order.length) {
            return Promise.reject(new Error('لا يوجد نموذج فونيمات متاح'));
        }
        var candidate = order[index];
        var label = MODELS[candidate].label || candidate;
        setStatus(candidate === 'arabic-v3'
            ? '…جارٍ تحميل نموذج الفونيمات v3.1 int8 (مرة واحدة)'
            : '…جارٍ تحميل نموذج الفونيمات ' + label + ' (‏~٢٥٠ م.ب — مرة واحدة)');
        return loadOne(candidate).catch(function (error) {
            var next = order[index + 1];
            if (next) {
                setStatus('تعذّر تحميل ' + label + ' (' + ((error && error.message) || error)
                    + ') — أجرّب ' + (MODELS[next].label || next) + '…');
            }
            session = null;
            ACTIVE = null;
            return attempt(index + 1);
        });
    };
    if (session) {
        try { session.release(); } catch (error) { /* ignore */ }
        session = null;
        ACTIVE = null;
        activeId = null;
    }
    loadKey = key;
    loadPromise = attempt(0);
    loadPromise.catch(function () {
        loadPromise = null;
        loadKey = null;
    });
    return loadPromise;
}

/* ---------- greedy CTC with per-unit margins ---------- */

/** Top-2 of one log_probs row (broadcast over WIN frames). */
function rowTop(lp, rowIndex) {
    var off = rowIndex * 251;
    var best = 0;
    var bestV = -Infinity;
    var secondV = -Infinity;
    for (var k = 0; k < 251; k += 1) {
        var value = lp.data[off + k];
        if (value > bestV) {
            secondV = bestV;
            bestV = value;
            best = k;
        } else if (value > secondV) {
            secondV = value;
        }
    }
    return { best: best, bestV: bestV, secondV: secondV };
}

/** margin_peak of a finished run: peak probability minus its runner-up. */
function runMargin(run) {
    return Math.round((run.peak - run.second) * 1000) / 1000;
}

/* ---------- decode: T=61 windows stepped by 48 + greedy CTC ---------- */

function transcribe(samples) {
    var fbank = computeFbank(samples);
    var feats = fbank.feats;
    var numFrames = fbank.numFrames;
    if (numFrames < 1) {
        return Promise.resolve({ ms: 0, seconds: samples.length / SR, unitIds: [], units: [], margins: [] });
    }
    var caches = makeCaches();
    var x = new Float32Array(T * BINS);
    var unitIds = [];
    var margins = [];
    var prevId = -1;
    var run = null;
    var totalSteps = Math.ceil(numFrames / STEP) + 2;   /* extra tail for the last words */
    var t0 = performance.now();
    var chain = Promise.resolve();
    var closeRun = function () {
        if (run) {
            margins.push(runMargin(run));
            run = null;
        }
    };
    for (var step = 0; step < totalSteps; step += 1) {
        (function (t) {
            chain = chain.then(function () {
                for (var frame = 0; frame < T; frame += 1) {
                    var f = Math.max(0, Math.min(t + frame, numFrames - 1));
                    for (var bin = 0; bin < BINS; bin += 1) {
                        x[frame * BINS + bin] = feats[f * BINS + bin];
                    }
                }
                var feeds = Object.assign({}, caches);
                feeds.x = new ort.Tensor('float32', x.slice(), [1, T, BINS]);
                feeds.processed_lens = new ort.Tensor('int64',
                    BigInt64Array.from([BigInt(Math.min(t + T, numFrames))]), [1]);
                return session.run(feeds).then(function (outputs) {
                    var lp = outputs.log_probs;
                    for (var r = 0; r < lp.dims[1]; r += 1) {
                        var top = rowTop(lp, r);
                        if (top.best !== prevId) {
                            closeRun();
                            if (top.best !== BLANK) {
                                unitIds.push(top.best);
                                run = { peak: top.bestV, second: top.secondV };
                            }
                            prevId = top.best;
                        } else if (run && top.bestV > run.peak) {
                            run.peak = top.bestV;
                            run.second = top.secondV;
                        }
                    }
                    session.outputNames.forEach(function (name) {
                        if (name.indexOf('new_') === 0) {
                            caches[name.slice(4)] = outputs[name];
                        }
                    });
                });
            });
        })(step * STEP);
    }
    return chain.then(function () {
        closeRun();
        return {
            ms: Math.round(performance.now() - t0),
            seconds: samples.length / SR,
            unitIds: unitIds,
            units: unitIds.map(function (id) { return id2piece[id] || ('#' + id); }),
            margins: margins
        };
    });
}

/* ---------- streaming (continuous mic) ----------
 * The zipformer is a streaming model: keep its caches and feed one T=61
 * frame window every STEP=48 new frames.  The page receives unit deltas
 * as they are decoded and aligns them continuously. */

var stream = null;

function streamReset() {
    stream = {
        samples: new Float32Array(0),
        frames: [],            /* Float32Array(BINS) rows */
        windowStart: 0,        /* next window start (advances by STEP) */
        caches: null,
        prevId: -1,
        unitIds: [],
        margins: [],
        run: null,
        sentUnits: 0
    };
}

function streamAppend(chunk) {
    var merged = new Float32Array(stream.samples.length + chunk.length);
    merged.set(stream.samples, 0);
    merged.set(chunk, stream.samples.length);
    stream.samples = merged;
    var re = new Float32Array(NFFT);
    var im = new Float32Array(NFFT);
    var samples = stream.samples;
    if (ACTIVE.snipEdges) {
        while (samples.length >= stream.frames.length * SHIFT + FRAME) {
            stream.frames.push(computeFrame(samples, stream.frames.length * SHIFT, re, im));
        }
    } else {
        /* centred frames: frame t spans original samples [t*160-120, t*160+280);
           the negatives come from the mirror of the opening samples */
        var mirror = new Float32Array(PAD_LEFT);
        var scratch = new Float32Array(FRAME);
        while (samples.length >= stream.frames.length * SHIFT + (FRAME - PAD_LEFT) + 1) {
            for (var m = 0; m < PAD_LEFT; m += 1) {
                mirror[m] = samples[PAD_LEFT - 1 - m];
            }
            var start = stream.frames.length * SHIFT - PAD_LEFT;
            for (var s = 0; s < FRAME; s += 1) {
                var p = start + s;
                scratch[s] = p < 0 ? mirror[-1 - p] : samples[p];
            }
            stream.frames.push(computeFrame(scratch, 0, re, im));
        }
    }
}

function streamRunWindow(startFrame, clamp, chain) {
    var frames = stream.frames;
    var x = new Float32Array(T * BINS);
    for (var i = 0; i < T; i += 1) {
        var f = startFrame + i;
        if (clamp) {
            f = Math.min(f, frames.length - 1);
        }
        f = Math.max(0, Math.min(f, frames.length - 1));
        var row = frames[f];
        for (var bin = 0; bin < BINS; bin += 1) {
            x[i * BINS + bin] = row[bin];
        }
    }
    var feeds = Object.assign({}, stream.caches);
    feeds.x = new ort.Tensor('float32', x.slice(), [1, T, BINS]);
    feeds.processed_lens = new ort.Tensor('int64',
        BigInt64Array.from([BigInt(Math.min(startFrame + T, frames.length))]), [1]);
    return chain.then(function () {
        return session.run(feeds).then(function (outputs) {
            var lp = outputs.log_probs;
            for (var r = 0; r < lp.dims[1]; r += 1) {
                var top = rowTop(lp, r);
                if (top.best !== stream.prevId) {
                    if (stream.run) {
                        stream.margins.push(runMargin(stream.run));
                        stream.run = null;
                    }
                    if (top.best !== BLANK) {
                        stream.unitIds.push(top.best);
                        stream.run = { peak: top.bestV, second: top.secondV };
                    }
                    stream.prevId = top.best;
                } else if (stream.run && top.bestV > stream.run.peak) {
                    stream.run.peak = top.bestV;
                    stream.run.second = top.secondV;
                }
            }
            session.outputNames.forEach(function (name) {
                if (name.indexOf('new_') === 0) {
                    stream.caches[name.slice(4)] = outputs[name];
                }
            });
        });
    });
}

function streamDecode(tail) {
    if (!stream || !session) {
        return Promise.resolve();
    }
    var frames = stream.frames;
    if (!frames.length) {
        return Promise.resolve();
    }
    if (!stream.caches) {
        stream.caches = makeCaches();
    }
    var chain = Promise.resolve();
    while (frames.length >= stream.windowStart + T) {
        chain = streamRunWindow(stream.windowStart, false, chain);
        stream.windowStart += STEP;
    }
    if (tail) {
        /* two clamped windows flush the last words */
        chain = streamRunWindow(stream.windowStart, true, chain);
        chain = streamRunWindow(stream.windowStart + STEP, true, chain);
    }
    return chain;
}

function postStreamDelta() {
    if (!stream) {
        return;
    }
    var from = stream.sentUnits;
    var count = stream.unitIds.length - from;
    if (count <= 0) {
        return;
    }
    var ids = stream.unitIds.slice(from);
    stream.sentUnits = stream.unitIds.length;
    self.postMessage({
        type: 'stream-units',
        unitIds: ids,
        units: ids.map(function (id) { return id2piece[id] || ('#' + id); }),
        /* aligned with unitIds; the currently-open run has no margin yet */
        margins: stream.margins.slice(from)
    });
}

/* ---------- messages ---------- */

var queue = Promise.resolve();

function handle(message) {
    if (message.type === 'load') {
        return loadModel(message.model).then(function (loadedId) {
            self.postMessage({ type: 'ready', model: loadedId });
        }).catch(function (error) {
            self.postMessage({ type: 'error', message: String((error && error.message) || error) });
        });
    }
    if (message.type === 'stream') {
        return loadModel(message.model).then(function () {
            if (message.action === 'start') {
                streamReset();
                return;
            }
            if (!stream) {
                streamReset();
            }
            if (message.action === 'audio') {
                streamAppend(message.audio);
                return streamDecode(false).then(function () { postStreamDelta(); });
            }
            if (message.action === 'flush') {
                /* speech paused: decode the pending tail NOW (one clamped
                   window) so the last word appears immediately instead of
                   waiting for the next audio to fill a decode window; the
                   caches carry on from the end of the flushed audio. */
                if (!stream || !stream.frames.length) {
                    return;
                }
                if (!stream.caches) {
                    stream.caches = makeCaches();
                }
                return streamDecode(false).then(function () {
                    if (stream.frames.length > stream.windowStart) {
                        return streamRunWindow(stream.windowStart, true, Promise.resolve()).then(function () {
                            stream.windowStart = stream.frames.length;
                        });
                    }
                }).then(function () {
                    postStreamDelta();
                });
            }
            if (message.action === 'end') {
                return streamDecode(true).then(function () {
                    postStreamDelta();
                    self.postMessage({ type: 'stream-end' });
                    stream = null;
                });
            }
        }).catch(function (error) {
            self.postMessage({ type: 'error', message: String((error && error.message) || error) });
        });
    }
    if (message.type === 'phonemes') {
        return loadModel(message.model).then(function () {
            return transcribe(message.audio);
        }).then(function (result) {
            self.postMessage({
                type: 'phonemes',
                id: message.id,
                units: result.units,
                unitIds: result.unitIds,
                margins: result.margins,
                ms: result.ms,
                seconds: result.seconds
            });
        }).catch(function (error) {
            self.postMessage({ type: 'error', message: String((error && error.message) || error) });
        });
    }
    return Promise.resolve();
}

self.onmessage = function (event) {
    var message = event.data || {};
    queue = queue.then(function () { return handle(message); });
};
