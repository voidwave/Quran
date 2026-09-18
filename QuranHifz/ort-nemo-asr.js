/* ===========================================================================
 * ort-nemo-asr.js — NeMo FastConformer streaming engine on ORT-Web (browser).
 *
 * The sherpa-onnx WASM runtime cannot host the 456 MB fp32 encoder (wasm
 * memory is too small), so this engine runs the same cache-aware streaming
 * model through onnxruntime-web + WebGPU directly:
 *
 *   - NeMo-compatible feature extraction: preemph 0.97, 25ms hann / 10ms hop,
 *     n_fft 512, 80 mel filters (librosa/slaney), log(x + 2^-24), per-feature
 *     normalization — mirrors nemo.collections.asr FilterbankFeatures.
 *   - Chunk loop mirrors sherpa-onnx OnlineRecognizerTransducerNeMoImpl:
 *     feed `window` mel frames, advance `shift`, carry (cache_last_channel,
 *     cache_last_time, cache_last_channel_len) between calls.
 *   - Greedy RNNT: one token per encoder frame max; predictor re-primed per
 *     chunk with the last emitted token (blank when empty); blank = vocab-1.
 *
 *   const engine = window.OrtNemoASR.create('quran-int8-ort', handlers);
 *   await engine.ensureModel();
 *   const { text, ms } = engine.transcribeSamples(float32_16k);
 *
 * handlers (all optional): { status(text), progress(info), ready(info), log(text) }
 *
 * The working 'quran-int8-ort' (stateless int8 export) also backs the
 * memorize app page — via ort-nemo-asr-worker.js, which importScripts() this
 * file and keeps every decode off the main thread. Model files resolve against
 * THIS script's folder, so one copy serves the app, its worker, and
 * QuranHifz/tools/speech-spike.html.
 * =========================================================================== */

(function () {
    'use strict';

    const ORT_VERSION = '1.30.0';
    const ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@' + ORT_VERSION + '/dist/';
    const ORT_URL = ORT_CDN + 'ort.min.js';
    /* This file runs both on a page (spike tool) and inside the int8 worker:
       with no document around, resolve against the worker's own URL. */
    const SCRIPT_SRC = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src)
        || self.location.href;
    const BASE_URL = new URL('./', SCRIPT_SRC).href;

    /* True when a URL answers a HEAD request — used to pick the model source:
       the site's own copy under tools/asr-models/, or the fallback mirror. */
    function headOk(url) {
        return fetch(url, { method: 'HEAD' })
            .then(function (response) { return response.ok; })
            .catch(function () { return false; });
    }

    const MODELS = {
        /* Stateless export: the encoder takes plain features (no cache I/O)
           and the "decoder" file is a fused decoder_joint returning joint
           logits for one encoder frame. Fully causal [128,0], int8. */
        'quran-int8-ort': {
            label: 'FastConformer Quran int8 (ORT-Web) — تلاوة',
            /* served from the site when present; otherwise the engine falls
               back to the Hugging Face mirror automatically */
            dir: 'tools/asr-models/fastconformer-quran-int8/',
            fallbackDir: 'https://huggingface.co/voidwaveDev/fastconformer-quran/resolve/main/',
            encoderFile: 'encoder.int8.onnx',
            jointFile: 'decoder.int8.onnx',
            tokensFile: 'tokens.txt',
            stateless: true,
            /* the shipped meta.json claims normalize_type "" but per-feature
               normalization is what actually decodes (verified 2026-09-17) */
            normalize: true
        },
        /* Muno459/fastconformer-quran v8 export (June 2026): plain CTC in a
           single q8 session, logprobs (1, T', 1025) + 512-d encoder
           features. ~2x better on real phone microphones than the v3 int8
           export. NPL-1.1 — non-commercial; the weights are gated upstream,
           so the site serves its mirror or the user drops the files in dir. */
        'quran-v8-ctc': {
            label: 'FastConformer Quran v8 (CTC q8) — تلاوة',
            dir: 'tools/asr-models/fastconformer-quran-v8/',
            fallbackDir: 'https://huggingface.co/voidwaveDev/fastconformer-quran/resolve/main/v8/',
            encoderFile: 'model_with_encoder.q8.onnx',
            tokensFile: 'tokens.txt',
            ctc: true,
            normalize: true
        },
        /* Same network at full precision (~458 MB): sharper logits (better
           for the GOP confidence pass), heavier and slower on wasm. */
        'quran-v8-fp32': {
            label: 'FastConformer Quran v8 (CTC fp32) — تلاوة',
            dir: 'tools/asr-models/fastconformer-quran-v8/',
            fallbackDir: 'https://huggingface.co/voidwaveDev/fastconformer-quran/resolve/main/v8/',
            encoderFile: 'model_with_encoder.onnx',
            tokensFile: 'tokens.txt',
            ctc: true,
            normalize: true
        }
    };

    /* ------------------------------------------------------------- runtime */

    let ortPromise = null;
    function loadOrt() {
        if (ortPromise) {
            return ortPromise;
        }
        ortPromise = new Promise(function (resolve, reject) {
            function finish() {
                const ort = self.ort;
                if (!ort || !ort.InferenceSession) {
                    reject(new Error('ort script loaded but no InferenceSession'));
                    return;
                }
                ort.env.wasm.numThreads = 1;
                ort.env.wasm.simd = true;
                /* wasm binaries live in the same CDN dist folder; explicit in
                   workers, where the script path cannot be auto-detected */
                ort.env.wasm.wasmPaths = ORT_CDN;
                resolve(ort);
            }
            if (self.ort && self.ort.InferenceSession) {
                finish();
                return;
            }
            if (typeof document === 'undefined') {
                /* worker context: synchronous import */
                try {
                    importScripts(ORT_URL);
                } catch (error) {
                    reject(new Error('failed to load ort-web: ' + ((error && error.message) || error)));
                    return;
                }
                finish();
                return;
            }
            const script = document.createElement('script');
            script.src = ORT_URL;
            script.onload = finish;
            script.onerror = function () { reject(new Error('failed to load ort-web')); };
            document.head.appendChild(script);
        });
        ortPromise.catch(function () { ortPromise = null; });
        return ortPromise;
    }

    /* --------------------------------------------------------- NeMo features */

    function hannPeriodic(n) {
        const w = new Float32Array(n);
        for (let i = 0; i < n; i += 1) {
            w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
        }
        return w;
    }

    /* Slaney mel scale (librosa default). */
    function hzToMelSlaney(f) {
        const fMin = 0;
        const fSp = 200 / 3;
        const minLogHz = 1000;
        const minLogMel = (minLogHz - fMin) / fSp;
        const logstep = Math.log(6.4) / 27;
        if (f < minLogHz) {
            return (f - fMin) / fSp;
        }
        return minLogMel + Math.log(f / minLogHz) / logstep;
    }

    function melToHzSlaney(m) {
        const fMin = 0;
        const fSp = 200 / 3;
        const minLogHz = 1000;
        const minLogMel = (minLogHz - fMin) / fSp;
        const logstep = Math.log(6.4) / 27;
        if (m < minLogMel) {
            return fMin + m * fSp;
        }
        return minLogHz * Math.exp(logstep * (m - minLogMel));
    }

    function melFilterBank(sampleRate, nFft, nMels, fMin, fMax) {
        const nBins = nFft / 2 + 1;
        const melMin = hzToMelSlaney(fMin);
        const melMax = hzToMelSlaney(fMax);
        const mels = new Float64Array(nMels + 2);
        for (let i = 0; i < nMels + 2; i += 1) {
            mels[i] = melMin + (melMax - melMin) * i / (nMels + 1);
        }
        const hz = Array.from(mels, melToHzSlaney);
        const binHz = Array.from({ length: nBins }, function (_v, k) {
            return (sampleRate / 2) * k / (nBins - 1);
        });
        const filters = new Float32Array(nMels * nBins);
        for (let m = 0; m < nMels; m += 1) {
            const lower = hz[m];
            const center = hz[m + 1];
            const upper = hz[m + 2];
            const enorm = 2 / (upper - lower);
            for (let k = 0; k < nBins; k += 1) {
                const f = binHz[k];
                let w = 0;
                if (f >= lower && f <= center && center > lower) {
                    w = (f - lower) / (center - lower);
                } else if (f > center && f <= upper && upper > center) {
                    w = (upper - f) / (upper - center);
                }
                filters[m * nBins + k] = w * enorm;
            }
        }
        return filters;
    }

    /* In-place radix-2 FFT. */
    function fft(re, im) {
        const n = re.length;
        for (let i = 1, j = 0; i < n; i += 1) {
            let bit = n >> 1;
            for (; j & bit; bit >>= 1) {
                j ^= bit;
            }
            j ^= bit;
            if (i < j) {
                let t = re[i]; re[i] = re[j]; re[j] = t;
                t = im[i]; im[i] = im[j]; im[j] = t;
            }
        }
        for (let len = 2; len <= n; len <<= 1) {
            const ang = -2 * Math.PI / len;
            const wr = Math.cos(ang);
            const wi = Math.sin(ang);
            for (let i = 0; i < n; i += len) {
                let curR = 1;
                let curI = 0;
                for (let k = 0; k < len / 2; k += 1) {
                    const aR = re[i + k];
                    const aI = im[i + k];
                    const bR = re[i + k + len / 2] * curR - im[i + k + len / 2] * curI;
                    const bI = re[i + k + len / 2] * curI + im[i + k + len / 2] * curR;
                    re[i + k] = aR + bR;
                    im[i + k] = aI + bI;
                    re[i + k + len / 2] = aR - bR;
                    im[i + k + len / 2] = aI - bI;
                    const nextR = curR * wr - curI * wi;
                    curI = curR * wi + curI * wr;
                    curR = nextR;
                }
            }
        }
    }

    const N_FTT = 512;
    const WIN = 400;
    const HOP = 160;
    const N_MELS = 80;
    const LOG_GUARD = Math.pow(2, -24);

    let melCache = null;
    let frameWindowCache = null;

    /** NeMo-compatible log-mel features, flattened [T * 80]. */
    function nemoFeatures(samples, normalize, preemph) {
        if (!melCache) {
            melCache = melFilterBank(16000, N_FTT, N_MELS, 0, 8000);
            frameWindowCache = hannPeriodic(WIN);
        }
        if (preemph === undefined || preemph === null) {
            preemph = 0.97;
        }
        const n = samples.length;
        /* preemphasis: y[0] = x[0]; y[i] = x[i] - p*x[i-1] */
        const pre = new Float32Array(n);
        pre[0] = samples[0];
        for (let i = 1; i < n; i += 1) {
            pre[i] = samples[i] - preemph * samples[i - 1];
        }
        /* center padding (constant = 0), win centered inside n_fft */
        const pad = N_FTT >> 1;
        const lead = (N_FTT - WIN) >> 1;
        const frames = 1 + Math.floor(n / HOP);
        const feats = new Float32Array(frames * N_MELS);
        const re = new Float64Array(N_FTT);
        const im = new Float64Array(N_FTT);
        const power = new Float64Array(N_FTT / 2 + 1);
        const win = frameWindowCache;
        const mel = melCache;
        for (let t = 0; t < frames; t += 1) {
            const base = t * HOP - pad + lead; // start of the 400-sample window
            re.fill(0);
            for (let k = 0; k < WIN; k += 1) {
                const idx = base + k;
                re[lead + k] = (idx >= 0 && idx < n) ? pre[idx] * win[k] : 0;
            }
            im.fill(0);
            fft(re, im);
            for (let k = 0; k <= N_FTT / 2; k += 1) {
                power[k] = re[k] * re[k] + im[k] * im[k];
            }
            const out = t * N_MELS;
            for (let m = 0; m < N_MELS; m += 1) {
                let acc = 0;
                const row = m * (N_FTT / 2 + 1);
                for (let k = 0; k <= N_FTT / 2; k += 1) {
                    const w = mel[row + k];
                    if (w !== 0) {
                        acc += w * power[k];
                    }
                }
                feats[out + m] = Math.log(acc + LOG_GUARD);
            }
        }
        if (normalize) {
            /* per-feature: mean/std over time per mel bin (NeMo normalize_batch) */
            const mean = new Float64Array(N_MELS);
            const std = new Float64Array(N_MELS);
            for (let t = 0; t < frames; t += 1) {
                for (let m = 0; m < N_MELS; m += 1) {
                    mean[m] += feats[t * N_MELS + m];
                }
            }
            for (let m = 0; m < N_MELS; m += 1) {
                mean[m] /= frames;
            }
            for (let t = 0; t < frames; t += 1) {
                for (let m = 0; m < N_MELS; m += 1) {
                    const d = feats[t * N_MELS + m] - mean[m];
                    std[m] += d * d;
                }
            }
            for (let m = 0; m < N_MELS; m += 1) {
                std[m] = Math.sqrt(std[m] / frames) + 1e-5;
            }
            for (let t = 0; t < frames; t += 1) {
                for (let m = 0; m < N_MELS; m += 1) {
                    const idx = t * N_MELS + m;
                    feats[idx] = (feats[idx] - mean[m]) / std[m];
                }
            }
        }
        return { data: feats, frames: frames };
    }

    /* ------------------------------------------------------------- tokens */

    function parseTokens(text) {
        const idToToken = [];
        text.split(/\r?\n/).forEach(function (line) {
            const parts = line.split(/\s+/);
            if (parts.length >= 2) {
                const id = parseInt(parts[parts.length - 1], 10);
                const token = parts.slice(0, parts.length - 1).join(' ');
                if (!Number.isNaN(id)) {
                    idToToken[id] = token;
                }
            } else if (parts.length === 1 && parts[0] && idToToken.length > 0) {
                idToToken[idToToken.length] = parts[0];
            }
        });
        return idToToken;
    }

    function detokenize(idToToken, ids) {
        let text = '';
        ids.forEach(function (id) {
            const tok = idToToken[id];
            if (tok === undefined || tok === '<blk>' || tok === '<unk>') {
                return;
            }
            text += tok;
        });
        /* sentencepiece markers -> spaces */
        return text.replace(/\u2581/g, ' ').replace(/\s+/g, ' ').trim();
    }

    /* ------------------------------------------------------------- engine */

    function describeError(error) {
        if (error === null || error === undefined) {
            return String(error);
        }
        if (typeof error === 'object') {
            return (error.constructor && error.constructor.name ? error.constructor.name + ': ' : '')
                + (error.message || '(no message)');
        }
        return String(error);
    }

    function create(id, handlers, options) {
        const model = MODELS[id];
        if (!model) {
            throw new Error('unknown ort-nemo model: ' + id);
        }
        const opts = options || {};
        const report = function (name, value) {
            if (handlers && typeof handlers[name] === 'function') {
                try {
                    handlers[name](value);
                } catch (error) { /* ignore */ }
            }
        };
        let ort = null;
        let encoder = null;
        let decoder = null;
        let joiner = null;
        let joint = null;
        let idToToken = null;
        let encNames = null;
        let decNames = null;
        let joinNames = null;
        let activeBase = null;         // resolved model source (local or fallback)
        let ctcOut = null;             // CTC logprobs output name (v8 model)

        /**
         * Picks where the model files come from: the site's own copy when it
         * ships one, otherwise model.fallbackDir (Hugging Face). Probed once
         * per engine instance.
         */
        function resolveBase() {
            if (activeBase) {
                return Promise.resolve(activeBase);
            }
            const local = BASE_URL + model.dir;
            if (!model.fallbackDir) {
                activeBase = local;
                return Promise.resolve(activeBase);
            }
            return headOk(local + model.encoderFile).then(function (ok) {
                activeBase = ok ? local : model.fallbackDir;
                if (!ok) {
                    report('status', 'النموذج غير موجود مع الموقع — التنزيل من Hugging Face…');
                }
                return activeBase;
            });
        }

        function findInput(names, needle, fallbackIndex) {
            for (let i = 0; i < names.length; i += 1) {
                if (String(names[i]).toLowerCase().indexOf(needle) !== -1) {
                    return names[i];
                }
            }
            return names[fallbackIndex];
        }

        async function createSessions() {
            const ep = opts.ep || 'auto';
            /* the int8 graphs use quantized ops that only the wasm kernels run */
            const providers = ep === 'webgpu' ? ['webgpu']
                : (ep === 'wasm' || model.stateless || model.ctc) ? ['wasm'] : ['webgpu', 'wasm'];
            const fits = { executionProviders: providers };
            const base = await resolveBase();
            if (model.ctc) {
                report('status', 'إنشاء جلسة FastConformer v8 (' + model.encoderFile + ')…');
                try {
                    encoder = await ort.InferenceSession.create(base + model.encoderFile, fits);
                } catch (error) {
                    throw new Error('تعذّر تحميل ملفات FastConformer v8 — تأكّد من تنزيل '
                        + model.encoderFile + ' و tokens.txt (راجع QuranHifz/tools/fetch-asr-models.mjs)');
                }
                encNames = {
                    audio: findInput(encoder.inputNames, 'audio', 0),
                    length: findInput(encoder.inputNames, 'length', 1)
                };
                /* "model_with_encoder" exports logprobs + encoder_output;
                   pick logprobs by name, fall back to the first output */
                ctcOut = encoder.outputNames[0];
                for (let i = 0; i < encoder.outputNames.length; i += 1) {
                    if (String(encoder.outputNames[i]).toLowerCase().indexOf('logprob') !== -1) {
                        ctcOut = encoder.outputNames[i];
                        break;
                    }
                }
                return;
            }
            if (model.stateless) {
                report('status', 'إنشاء جلسة المُرمِّز (encoder int8)…');
                encoder = await ort.InferenceSession.create(base + model.encoderFile, fits);
                report('status', 'إنشاء جلسة المفكِّك المدمج (decoder_joint int8)…');
                joint = await ort.InferenceSession.create(base + model.jointFile, fits);
                encNames = {
                    audio: findInput(encoder.inputNames, 'audio', 0),
                    length: findInput(encoder.inputNames, 'length', 1)
                };
                return;
            }
            report('status', 'إنشاء جلسة المُرمِّز (encoder)…');
            encoder = await ort.InferenceSession.create(base + model.encoderFile, fits);
            report('status', 'إنشاء جلسة المفكِّك (decoder)…');
            decoder = await ort.InferenceSession.create(base + model.decoderFile, fits);
            report('status', 'إنشاء جلسة الدامج (joiner)…');
            joiner = await ort.InferenceSession.create(base + model.joinerFile, fits);
            encNames = {
                audio: findInput(encoder.inputNames, 'audio', 0),
                length: findInput(encoder.inputNames, 'length', 1),
                cacheChannel: findInput(encoder.inputNames, 'cache_last_channel', 2),
                cacheTime: findInput(encoder.inputNames, 'cache_last_time', 3),
                cacheLen: findInput(encoder.inputNames, 'cache_last_channel_len', 4)
            };
            decNames = {
                targets: findInput(decoder.inputNames, 'target', 0),
                targetLength: findInput(decoder.inputNames, 'target_length', 1),
                state1: findInput(decoder.inputNames, 'input_states_1', 2),
                state2: findInput(decoder.inputNames, 'input_states_2', 3)
            };
            /* some exports keep an unused encoder_outputs input on the decoder */
            const extra = decoder.inputNames.filter(function (n) {
                return String(n).toLowerCase().indexOf('encoder') !== -1;
            });
            decNames.extra = extra.length ? extra[0] : null;
            joinNames = {
                enc: findInput(joiner.inputNames, 'encoder', 0),
                dec: findInput(joiner.inputNames, 'decoder', 1)
            };
        }

        function tensorFor(name, type, data, dims) {
            return new ort.Tensor(type, data, dims);
        }

        const blankId = 1024;
        const predHidden = 640;

        async function runDecoder(token, state1, state2) {
            const feeds = {};
            feeds[decNames.targets] = tensorFor('targets', 'int32', Int32Array.from([token]), [1, 1]);
            feeds[decNames.targetLength] = tensorFor('target_length', 'int32', Int32Array.from([1]), [1]);
            feeds[decNames.state1] = tensorFor('state1', 'float32', state1, [1, 1, 640]);
            feeds[decNames.state2] = tensorFor('state2', 'float32', state2, [1, 1, 640]);
            if (decNames.extra) {
                feeds[decNames.extra] = tensorFor('extra', 'float32', new Float32Array(512), [1, 512, 1]);
            }
            const out = await decoder.run(feeds);
            const names = decoder.outputNames;
            const logits = out[names[0]];
            /* find the float state outputs by shape (some exports name them
               oddly or reorder them) */
            const stateOuts = [];
            for (let i = 2; i < names.length; i += 1) {
                const t = out[names[i]];
                if (t && t.type === 'float32' && t.dims.length === 3) {
                    stateOuts.push(t);
                }
            }
            const next1 = stateOuts[0] && stateOuts[0].data.length === predHidden ? stateOuts[0].data : state1;
            const next2 = stateOuts[1] && stateOuts[1].data.length === predHidden ? stateOuts[1].data : state2;
            return { logits: logits, state1: next1, state2: next2 };
        }

        async function runJoiner(encFrame, decLogits) {
            const feeds = {};
            feeds[joinNames.enc] = tensorFor('enc', 'float32', encFrame, [1, 512, 1]);
            feeds[joinNames.dec] = tensorFor('dec', 'float32', decLogits, [1, 640, 1]);
            const out = await joiner.run(feeds);
            return out[joiner.outputNames[0]].data;
        }

        function argmax(arr, n) {
            let best = 0;
            let bestV = arr[0];
            for (let i = 1; i < n; i += 1) {
                if (arr[i] > bestV) {
                    bestV = arr[i];
                    best = i;
                }
            }
            return best;
        }

        /* ---- CTC (Muno459 v8 export, single q8 session) -------------------- */

        async function transcribeCtc(samples, options) {
            const started = Date.now();
            const normalize = opts.normalize === undefined ? !!model.normalize : !!opts.normalize;
            const feats = nemoFeatures(samples, normalize, opts.preemph);
            const F = feats.data;
            const T = feats.frames;
            /* audio_signal: (1, 80, T) — transpose from (T, 80) */
            const audio = new Float32Array(80 * T);
            for (let t = 0; t < T; t += 1) {
                for (let c = 0; c < 80; c += 1) {
                    audio[c * T + t] = F[t * 80 + c];
                }
            }
            const feeds = {};
            feeds[encNames.audio] = tensorFor('audio', 'float32', audio, [1, 80, T]);
            feeds[encNames.length] = tensorFor('len', 'int64', BigInt64Array.from([BigInt(T)]), [1]);
            const out = await encoder.run(feeds);
            const lp = out[ctcOut];
            const dims = lp.dims;
            /* (1, T', V) normally; (1, V, T') for transposed exports — the
               vocab dimension is the one sized like the token table */
            const vocab = idToToken.length + 1;   // + CTC blank (last class)
            const layoutVT = Math.abs(dims[1] - vocab) < Math.abs(dims[2] - vocab);
            const V = layoutVT ? dims[1] : dims[2];
            const Tout = layoutVT ? dims[2] : dims[1];
            const data = lp.data;
            const blank = V - 1;
            const tokens = [];
            const wordsOut = [];
            let prev = -1;
            let openTok = null;
            let curWord = null;
            const finishWord = function (word) {
                return {
                    w: word.w,
                    gop: +(word.sum / Math.max(1, word.weight)).toFixed(3),
                    min: +(word.min === Infinity ? 0 : word.min).toFixed(3)
                };
            };
            /* close the open token into the current word; a piece starting
               with «▁» starts a new word */
            const closeTok = function () {
                if (!openTok) {
                    return;
                }
                const piece = idToToken[openTok.id] || '';
                /* pronunciation margin of this token: log P(token) minus the
                   best OTHER non-blank at the token's peak frame. LARGER is
                   clearer — a blurred letter or an ambivalent harakah pulls
                   the runner-up close, so the margin collapses toward 0
                   BEFORE the decoded TEXT changes */
                const gop = openTok.peakOther > -Infinity ? openTok.peakLp - openTok.peakOther : 0;
                const startsWord = piece.indexOf('\u2581') === 0;
                if (!curWord || startsWord) {
                    if (curWord) {
                        wordsOut.push(finishWord(curWord));
                    }
                    curWord = {
                        w: startsWord ? piece.replace(/^\u2581/, '') : piece,
                        sum: 0,
                        weight: 0,
                        min: Infinity
                    };
                } else {
                    curWord.w += piece;
                }
                curWord.sum += gop * openTok.count;
                curWord.weight += openTok.count;
                curWord.min = Math.min(curWord.min, gop);
                openTok = null;
            };
            for (let t = 0; t < Tout; t += 1) {
                let best = -1;
                let bestV = -Infinity;
                let otherV = -Infinity;
                let blankV = -Infinity;
                for (let v = 0; v < V; v += 1) {
                    const value = layoutVT ? data[v * Tout + t] : data[t * V + v];
                    if (v === blank) {
                        blankV = value;
                        continue;
                    }
                    if (value > bestV) {
                        otherV = bestV;
                        bestV = value;
                        best = v;
                    } else if (value > otherV) {
                        otherV = value;
                    }
                }
                const winner = bestV > blankV ? best : blank;
                if (winner === blank) {
                    closeTok();
                    prev = blank;
                    continue;
                }
                if (winner === prev && openTok && openTok.id === winner) {
                    /* CTC collapse: the same token keeps winning; keep its
                       peak frame (highest log P) for the margin */
                    if (bestV > openTok.peakLp) {
                        openTok.peakLp = bestV;
                        openTok.peakOther = otherV;
                    }
                    openTok.count += 1;
                    continue;
                }
                closeTok();
                openTok = { id: winner, peakLp: bestV, peakOther: otherV, count: 1 };
                tokens.push(winner);
                prev = winner;
            }
            closeTok();
            if (curWord) {
                wordsOut.push(finishWord(curWord));
            }
            /* pronunciation check (tajweed GOP): when the caller supplies the
               expected text, force-align it against the same logprobs and
               grade every reference word (log P(expected) − best competitor
               at each token's peak frame). Silence in the worker ⇒ skipped. */
            let gopWords = null;
            const gopLib = (typeof self !== 'undefined' && self.QuranGop) || null;
            if (options && options.reference && gopLib) {
                try {
                    await gopLib.load();
                    /* budget the alignment by what was actually heard: the
                       expected text is only a candidate for these tokens;
                       more would squeeze every interval (the rest frames 0) */
                    const budget = tokens.length + Math.max(4, Math.round(tokens.length * 0.35));
                    gopWords = gopLib.analyze(Tout, V, function (t, id) {
                        return layoutVT ? data[id * Tout + t] : data[t * V + id];
                    }, String(options.reference), budget);
                } catch (error) {
                    gopWords = null;
                }
            }
            const text = detokenize(idToToken, tokens);
            return {
                text: text,
                tokens: tokens.map(function (tk) { return idToToken[tk]; }),
                words: wordsOut,
                gopWords: gopWords,
                ms: Date.now() - started,
                info: { frames: T, outFrames: Tout, tokens: tokens.length, kind: 'ctc' }
            };
        }

        /* ---- stateless (cache-free) int8 pipeline -------------------------- */

        async function transcribeStateless(samples) {
            const started = Date.now();
            const normalize = opts.normalize === undefined ? !!model.normalize : !!opts.normalize;
            const feats = nemoFeatures(samples, normalize, opts.preemph);
            const F = feats.data;
            const T = feats.frames;
            /* audio_signal: (1, 80, T) — transpose from (T, 80) */
            const audio = new Float32Array(80 * T);
            for (let t = 0; t < T; t += 1) {
                for (let c = 0; c < 80; c += 1) {
                    audio[c * T + t] = F[t * 80 + c];
                }
            }
            const feeds = {};
            feeds[encNames.audio] = tensorFor('audio', 'float32', audio, [1, 80, T]);
            feeds[encNames.length] = tensorFor('len', 'int64', BigInt64Array.from([BigInt(T)]), [1]);
            const out = await encoder.run(feeds);
            const encOut = out[encoder.outputNames[0]];
            const dims = encOut.dims;
            const layoutCT = dims[1] === 512;      // (1, 512, T') vs (1, T', 512)
            const Tout = layoutCT ? dims[2] : dims[1];
            const fdata = encOut.data;

            const jNames = {
                enc: findInput(joint.inputNames, 'encoder', 0),
                targets: findInput(joint.inputNames, 'target', 1),
                targetLength: findInput(joint.inputNames, 'target_length', 2),
                state1: findInput(joint.inputNames, 'input_states_1', 3),
                state2: findInput(joint.inputNames, 'input_states_2', 4)
            };
            const jOut = joint.outputNames;
            const tokens = [];
            const trace = [];
            const maxPer = opts.maxSymbols || 10;
            let s1 = new Float32Array(predHidden);
            let s2 = new Float32Array(predHidden);
            let last = blankId;

            for (let t = 0; t < Tout; t += 1) {
                const frame = new Float32Array(512);
                if (layoutCT) {
                    for (let c = 0; c < 512; c += 1) {
                        frame[c] = fdata[c * Tout + t];
                    }
                } else {
                    frame.set(fdata.subarray(t * 512, t * 512 + 512));
                }
                let emitted = 0;
                while (emitted < maxPer) {
                    const jf = {};
                    jf[jNames.enc] = tensorFor('enc', 'float32', frame, [1, 512, 1]);
                    jf[jNames.targets] = tensorFor('targets', 'int32', Int32Array.from([last]), [1, 1]);
                    jf[jNames.targetLength] = tensorFor('target_length', 'int32', Int32Array.from([1]), [1]);
                    jf[jNames.state1] = tensorFor('state1', 'float32', s1, [1, 1, 640]);
                    jf[jNames.state2] = tensorFor('state2', 'float32', s2, [1, 1, 640]);
                    const jo = await joint.run(jf);
                    const logits = jo[jOut[0]].data;
                    const y = argmax(logits, 1025);
                    if (y === blankId) {
                        break;
                    }
                    tokens.push(y);
                    if (trace.length < 300) {
                        trace.push(t + ':' + y + '=' + (idToToken[y] || '?'));
                    }
                    last = y;
                    const n1 = jo[jOut[2]];
                    const n2 = jo[jOut[3]];
                    if (n1 && n1.data.length === predHidden) {
                        s1 = n1.data;
                    }
                    if (n2 && n2.data.length === predHidden) {
                        s2 = n2.data;
                    }
                    emitted += 1;
                }
            }
            const text = detokenize(idToToken, tokens);
            return {
                text: text,
                tokens: tokens.map(function (tk) { return idToToken[tk]; }),
                ms: Date.now() - started,
                info: { frames: T, outFrames: Tout, tokens: tokens.length, trace: trace }
            };
        }

        return {
            label: model.label,

            /** Releases the ORT sessions (frees ~500MB in the wasm heap). */
            dispose: function () {
                [encoder, decoder, joiner, joint].forEach(function (s) {
                    try {
                        if (s) {
                            s.release();
                        }
                    } catch (error) { /* ignore */ }
                });
                encoder = null;
                decoder = null;
                joiner = null;
                joint = null;
            },

            ensureModel: async function () {
                ort = await loadOrt();
                report('status', 'تحميل المودل عبر ORT-Web…');
                const t0 = Date.now();
                await createSessions();
                const base = await resolveBase();
                idToToken = parseTokens(await fetch(base + model.tokensFile).then(function (r) { return r.text(); }));
                report('ready', { model: id, ms: Date.now() - t0 });
                return { model: id, ms: Date.now() - t0 };
            },

            transcribeSamples: async function (samples, options) {
                if (!encoder) {
                    throw new Error('model not loaded');
                }
                if (model.ctc) {
                    return transcribeCtc(samples, options);
                }
                if (model.stateless) {
                    return transcribeStateless(samples);
                }
                const started = Date.now();
                const W = opts.window || model.window;
                const S = opts.shift || model.shift;
                const K = opts.cacheTime || model.cacheTime;
                const statesMode = opts.statesMode || 'post';
                const normalize = opts.normalize === undefined ? true : opts.normalize;
                const feats = nemoFeatures(samples, normalize, opts.preemph);
                const F = feats.data;
                const T = feats.frames;
                const L = model.layers;
                const D = model.dModel;

                let cacheChannel = new Float32Array(L * 70 * D);
                let cacheLen = BigInt64Array.from([0n]);

                const tokens = [];
                const trace = [];
                const traceLimit = opts.trace || 0;
                let decState1 = new Float32Array(predHidden);
                let decState2 = new Float32Array(predHidden);
                let dec = await runDecoder(blankId, decState1, decState2);
                let lastToken = blankId;
                let pos = 0;
                let steps = 0;
                let lastGoodStates = null;

                while (pos + W <= T) {
                    /* audio_signal: (1, 80, W) — transpose from (W, 80) */
                    const audio = new Float32Array(80 * W);
                    for (let t = 0; t < W; t += 1) {
                        const src = (pos + t) * 80;
                        for (let c = 0; c < 80; c += 1) {
                            audio[c * W + t] = F[src + c];
                        }
                    }
                    const feeds = {};
                    feeds[encNames.audio] = tensorFor('audio', 'float32', audio, [1, 80, W]);
                    feeds[encNames.length] = tensorFor('len', 'int64', BigInt64Array.from([BigInt(W)]), [1]);
                    feeds[encNames.cacheChannel] = tensorFor('cc', 'float32', cacheChannel, [1, L, 70, D]);
                    /* the exported graph reports the time cache with a dynamic
                       trailing dim of 0, so it cannot be carried across calls;
                       a zero time cache costs a few conv frames of context
                       (the long-range memory lives in cache_last_channel) */
                    feeds[encNames.cacheTime] = tensorFor('ct', 'float32', new Float32Array(L * D * K), [1, L, D, K]);
                    /* cache_last_channel_len: the export's own output for this
                       can be garbage (e.g. -288), so callers can choose how to
                       feed it back */
                    const lenMode = opts.lenMode || 'linear';
                    let lenValue;
                    if (lenMode === 'zero') {
                        lenValue = 0n;
                    } else if (lenMode === 'linear') {
                        lenValue = BigInt(Math.min(70, (steps + 1) * (opts.lenStep || 1)));
                    } else {
                        lenValue = cacheLen[0];
                    }
                    feeds[encNames.cacheLen] = tensorFor('cl', 'int64', BigInt64Array.from([lenValue]), [1]);
                    /* re-prime the predictor exactly like sherpa's NeMo decoder */
                    dec = await runDecoder(lastToken, statesMode === 'pre' && lastGoodStates ? lastGoodStates[0] : decState1,
                        statesMode === 'pre' && lastGoodStates ? lastGoodStates[1] : decState2);
                    const out = await encoder.run(feeds);
                    const names = encoder.outputNames;
                    const encOut = out[names[0]];
                    const dims = encOut.dims;
                    const Tout = dims[1] === D ? dims[2] : dims[1];
                    const layoutCT = dims[1] === D; // (1, 512, T) vs (1, T, 512)
                    const fdata = encOut.data;
                    cacheChannel = out[names[2]].data;
                    cacheLen = out[names[4]].data;
                    if (steps < 6) {
                        trace.push('len@' + steps + '=' + Array.from(cacheLen).join(','));
                    }

                    for (let t = 0; t < Tout; t += 1) {
                        const encFrame = new Float32Array(D);
                        if (layoutCT) {
                            for (let c = 0; c < D; c += 1) {
                                encFrame[c] = fdata[c * Tout + t];
                            }
                        } else {
                            encFrame.set(fdata.subarray(t * D, t * D + D));
                        }
                        const logits = await runJoiner(encFrame, dec.logits.data);
                        const y = argmax(logits, 1025);
                        if (y !== blankId) {
                            tokens.push(y);
                            if (trace.length < 400) {
                                trace.push(steps + '.' + t + ':' + y + '=' + (idToToken[y] || '?'));
                            }
                            lastToken = y;
                            if (statesMode === 'pre') {
                                lastGoodStates = [decState1.slice(), decState2.slice()];
                            }
                            dec = await runDecoder(y, dec.state1, dec.state2);
                        }
                    }
                    if (statesMode === 'post') {
                        decState1 = dec.state1;
                        decState2 = dec.state2;
                    } else {
                        /* keep pre-token states for the next chunk re-prime */
                        decState1 = dec.state1;
                        decState2 = dec.state2;
                    }
                    pos += S;
                    steps += 1;
                    if (steps % 20 === 0) {
                        report('progress', { phase: 'decode', steps: steps, tokens: tokens.length });
                    }
                }

                const text = detokenize(idToToken, tokens);
                return {
                    text: text,
                    tokens: tokens.map(function (tk) { return idToToken[tk]; }),
                    ms: Date.now() - started,
                    info: { frames: T, steps: steps, tokens: tokens.length, trace: trace }
                };
            }
        };
    }

    function isAvailable(id) {
        const model = MODELS[id];
        if (!model) {
            return Promise.resolve(false);
        }
        return headOk(BASE_URL + model.dir + model.encoderFile).then(function (ok) {
            if (ok || !model.fallbackDir) {
                return ok;
            }
            return headOk(model.fallbackDir + model.encoderFile);
        });
    }

    self.OrtNemoASR = { models: MODELS, create: create, isAvailable: isAvailable, nemoFeatures: nemoFeatures };
}());
