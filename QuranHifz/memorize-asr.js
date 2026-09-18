/* ===========================================================================
 * memorize-asr.js — on-device speech capture for the memorisation view.
 *
 * Main-thread half of the local engine: it captures the microphone, runs a
 * simple energy VAD (an utterance ends after a short pause) and hands the
 * transcripts back. Everything is local: no audio ever leaves the browser.
 *
 * Two backends per session (engine.setEngineKind):
 *   - 'whisper' (default): Whisper-Basira inside memorize-asr-worker.js.
 *   - 'int8':      FastConformer Quran int8 inside ort-nemo-asr-worker.js
 *                  (ORT-Web wasm kernels; its own thread, decodes ~4x faster).
 *
 * Usage:
 *   const engine = window.QuranASR.createEngine({
 *       level(value),            // 0..1 microphone level for the meter
 *       status(text),            // note: also used for load stages
 *       progress(info),          // model download progress {progress,loaded,total}
 *       ready({device,dtype}),   // model loaded
 *       transcript(text, meta),  // a finished utterance ({ms} decode time)
 *       error(message)
 *   });
 *   engine.start(); engine.stop();
 *   engine.setEngineKind('int8').then(() => engine.start());
 *   engine.transcribeSamples(float32_16k).then(({text, ms}) => ...) // tools
 *   engine.decodeTo16k(arrayBuffer).then(float32)                   // tools
 * =========================================================================== */

(function () {
    'use strict';

    /* Resolved against this script (not the page), so the engine also works
       from sub-pages like QuranHifz/tools/speech-spike.html. */
    const SCRIPT_SRC = (document.currentScript && document.currentScript.src) || document.baseURI;
    const WORKER_URL = new URL('memorize-asr-worker.js', SCRIPT_SRC).href;
    const INT8_WORKER_URL = new URL('ort-nemo-asr-worker.js', SCRIPT_SRC).href;
    const SAMPLE_RATE = 16000;
    const FRAME_SAMPLES = 1024;        // ~64 ms per AudioContext callback:
    // the worker can decode a 48-frame
    // step as soon as it accrues instead
    // of waiting for the next 256 ms
    // batch (saves ~150–300 ms of lag)
    const VAD_RMS = 0.018;             // speech threshold (RMS)
    /* Whisper-quality notes: clipped one-or-two-word fragments are where the
       recognizer invents endings (a measured example: a 2.2 s cut of "قل هو
       الله أحد" came back as "قُلْ هُوَ اللَّهُ أَعْلَمُ"). Let a phrase run to
       a natural pause: 1.2 s of silence closes a full utterance, and a short
       one (under 0.7 s of speech) waits 2 s before deciding the reciter
       stopped — tiny fragments then merge with whatever follows. */
    const SILENCE_FLUSH_MS = 1200;     // pause that closes an utterance
    const SHORT_SPEECH_MS = 700;       // below this a gap must be longer
    const LONG_FLUSH_SILENCE_MS = 2000; // pause before flushing a short one
    const CAPTURE_FLUSH_MS = 550;      // phoneme stream: flush the tail at the
    // first natural pause (verse-end pauses
    // are ~0.5 s; the 1.2/2 s whisper limits
    // made the last word of a verse wait for
    // the NEXT verse's audio to fill a
    // decode window). Repeated flushes are
    // no-ops when nothing is pending.
    const MIN_SPEECH_MS = 350;         // ignore clicks, coughs and lip noise
    const MAX_UTTERANCE_MS = 14000;    // hard cut for a very long phrase
    const TRANSCRIBE_TIMEOUT_MS = 60000; // restart the worker if generation wedges

    function createEngine(handlers) {
        const emit = function (name, a, b) {
            try {
                if (handlers && typeof handlers[name] === 'function') {
                    handlers[name](a, b);
                }
            } catch (error) { /* a listener must not break the engine */ }
        };

        /* ---- worker + model ------------------------------------------------- */

        let worker = null;
        let modelInfo = null;
        let loadPromise = null;
        let preferred = null;          // device the page asked for (auto|webgpu|wasm)
        const pending = new Map();     // id -> {resolve, reject}
        const queue = [];              // [{samples, resolve, reject}]
        let decoding = false;
        let nextId = 1;

        let engineKind = 'whisper';    // 'whisper' | 'int8' | 'v8' (int8 family shares a worker)
        let int8Worker = null;         // ort-nemo-asr-worker.js instance
        let int8ModelId = null;        // which export the worker currently hosts
        let int8Ready = null;          // in-flight int8 model load
        let referenceProvider = null;  // () => ({text}) — expected words for GOP

        function ensureWorker() {
            if (worker) {
                return;
            }
            worker = new Worker(WORKER_URL, { type: 'module' });
            worker.onmessage = onWorkerMessage;
            worker.onerror = function (event) {
                emit('error', (event && event.message) || 'worker error');
            };
        }

        /** Abandons a wedged worker (e.g. a runaway generation) and starts
            over. The model files are cached, so a reload costs a couple of
            seconds. */
        function resetWorker(reason) {
            if (worker) {
                worker.terminate();
                worker = null;
            }
            const stuck = Array.from(pending.values());
            pending.clear();
            stuck.forEach(function (entry) {
                clearTimeout(entry.timer);
                entry.reject(new Error(reason || 'engine restarted'));
            });
            const waiting = queue.splice(0, queue.length);
            waiting.forEach(function (entry) {
                entry.setPromise(Promise.reject(new Error(reason || 'engine restarted')));
            });
            modelInfo = null;
            loadPromise = null;
        }

        function onWorkerMessage(event) {
            const message = event.data || {};
            if (message.type === 'progress') {
                emit('progress', message.info);
                return;
            }
            if (message.type === 'status') {
                emit('status', message.message);
                return;
            }
            if (message.type === 'ready') {
                modelInfo = { device: message.device, dtype: message.dtype };
                /* Remember what worked so later visits skip dead paths
                   (e.g. a WebGPU that hangs on this machine). Only whisper
                   reports a device choice — int8 is always wasm and must not
                   overwrite it. */
                if (engineKind === 'whisper') {
                    try {
                        localStorage.setItem('quran-asr-device', message.device);
                    } catch (error) { /* private mode */ }
                }
                const load = pending.get('load');
                if (load) {
                    pending.delete('load');
                    load.resolve(modelInfo);
                }
                emit('ready', modelInfo);
                return;
            }
            if (message.type === 'result') {
                const entry = pending.get(message.id);
                if (entry) {
                    pending.delete(message.id);
                    clearTimeout(entry.timer);
                    entry.resolve({
                        text: message.text || '',
                        words: message.words || null,
                        gopWords: message.gopWords || null,
                        ms: message.ms | 0
                    });
                }
                decoding = false;
                pumpQueue();
                return;
            }
            if (message.type === 'error') {
                const key = message.id === undefined ? 'load' : message.id;
                const entry = pending.get(key);
                if (entry) {
                    pending.delete(key);
                    clearTimeout(entry.timer);
                    entry.reject(new Error(message.message || 'engine error'));
                }
                if (key !== 'load') {
                    decoding = false;
                    pumpQueue();
                }
                emit('error', message.message || 'engine error');
            }
        }

        /* ---- int8 backend (FastConformer via ort-nemo-asr-worker.js) -------- */

        /** Spawns the int8 worker (hosts ort-nemo-asr.js off the main thread). */
        function ensureInt8Worker() {
            if (int8Worker) {
                return int8Worker;
            }
            int8Worker = new Worker(INT8_WORKER_URL);
            int8Worker.onmessage = onWorkerMessage;
            int8Worker.onerror = function (event) {
                emit('error', (event && event.message) || 'int8 worker error');
            };
            return int8Worker;
        }

        /** True when the active engine is one of the FastConformer ORT models. */
        function int8Family() {
            return engineKind === 'int8' || engineKind === 'v8' || engineKind === 'v8fp32';
        }

        /** ORT model id for an engine kind. */
        function modelFor(kind) {
            if (kind === 'v8') {
                return 'quran-v8-ctc';
            }
            if (kind === 'v8fp32') {
                return 'quran-v8-fp32';
            }
            return 'quran-int8-ort';
        }

        /** Loads the FastConformer engine once (inside its worker); resolves { device, dtype }. */
        function ensureInt8(modelId) {
            const id = modelId || modelFor(engineKind);
            if (int8Ready && int8ModelId !== id) {
                resetInt8('model switched');   // the worker hosts the other export
            }
            if (int8Ready) {
                return int8Ready;
            }
            int8ModelId = id;
            const target = ensureInt8Worker();
            int8Ready = new Promise(function (resolve, reject) {
                pending.set('load', { resolve: resolve, reject: reject });
                target.postMessage({ type: 'load', model: id });
            });
            int8Ready.catch(function () {
                int8Ready = null;   // allow a retry after a failure
                resetInt8('int8 load failed');
            });
            return int8Ready;
        }

        /** Drops the int8 worker; its sessions reload on the next use. */
        function resetInt8(reason) {
            if (int8Worker) {
                int8Worker.terminate();
                int8Worker = null;
            }
            const stuck = Array.from(pending.values());
            pending.clear();
            stuck.forEach(function (entry) {
                clearTimeout(entry.timer);
                entry.reject(new Error(reason || 'engine restarted'));
            });
            const waiting = queue.splice(0, queue.length);
            waiting.forEach(function (entry) {
                entry.setPromise(Promise.reject(new Error(reason || 'engine restarted')));
            });
            int8Ready = null;
            int8ModelId = null;
            modelInfo = null;
        }

        /** Restarts whichever backend is active (timeout recovery). */
        function resetEngine(reason) {
            if (int8Family()) {
                resetInt8(reason);
            } else {
                resetWorker(reason);
            }
        }

        /**
         * Chooses the recognizer: the default Whisper worker, or the
         * FastConformer int8 model in its own worker. loadNow=false only
         * records the choice (used at boot so a saved setting does not
         * download anything before the first mic press).
         */
        function setEngineKind(kind, loadNow) {
            const next = kind === 'int8' ? 'int8'
                : (kind === 'v8' ? 'v8' : (kind === 'v8fp32' ? 'v8fp32' : 'whisper'));
            if (next !== engineKind) {
                if (next === 'whisper') {
                    resetInt8('engine switched');
                } else {
                    /* the whisper worker may hold ~150 MB; drop it while unused */
                    resetWorker('engine switched');
                    if (engineKind !== 'whisper') {
                        resetInt8('engine switched');   // int8 <-> v8: reload in the worker
                    }
                }
                engineKind = next;
            }
            if (loadNow === false) {
                return Promise.resolve(engineKind);
            }
            return int8Family() ? ensureInt8(modelFor(engineKind)) : ensureModel(preferred);
        }

        /** Loads the model once; resolves with { device, dtype }. */
        function ensureModel(prefer) {
            if (prefer) {
                preferred = prefer;
            }
            if (modelInfo) {
                return Promise.resolve(modelInfo);
            }
            if (loadPromise) {
                return loadPromise;
            }
            ensureWorker();
            let saved = null;
            try {
                saved = localStorage.getItem('quran-asr-device');
            } catch (error) { /* private mode */ }
            loadPromise = new Promise(function (resolve, reject) {
                pending.set('load', { resolve: resolve, reject: reject });
                worker.postMessage({
                    type: 'load',
                    webgpu: Boolean(navigator.gpu),
                    prefer: prefer || preferred || saved || 'auto'
                });
            });
            loadPromise.catch(function () {
                loadPromise = null; // allow a retry after a failure
            });
            return loadPromise;
        }

        /**
         * Switches the runtime (auto | webgpu | wasm) immediately: drops the
         * current worker and loads the model again on the chosen path. The
         * model files are cached, so this costs a few seconds.
         */
        function setDevice(prefer) {
            if (int8Family()) {
                /* the q8 exports only run on wasm kernels — remember the
                   choice for a later switch back to whisper and leave
                   sessions alone */
                preferred = prefer || preferred;
                return Promise.resolve(modelInfo || { device: 'wasm', dtype: 'int8' });
            }
            const wasListening = listening;
            if (wasListening) {
                stop();
            }
            resetWorker('engine switched');
            const wait = ensureModel(prefer);
            if (wasListening) {
                wait.then(function () { return start(); }).catch(function () { });
            }
            return wait;
        }

        /** Serialises decodes so mic chunks and tool requests never overlap. */
        function pumpQueue() {
            if (decoding) {
                return;
            }
            const entry = queue.shift();
            if (!entry) {
                return;
            }
            decoding = true;
            emit('status', 'transcribing');
            const int8 = int8Family();
            let target;
            if (int8) {
                target = ensureInt8Worker();
                ensureInt8(modelFor(engineKind));   // kicks the model load; the worker queues behind it
            } else {
                ensureWorker();
                target = worker;
            }
            const id = nextId;
            nextId += 1;
            let reference = null;
            if (int8 && referenceProvider) {
                try {
                    const ref = referenceProvider();
                    reference = ref && ref.text ? String(ref.text) : null;
                } catch (error) {
                    reference = null;
                }
            }
            const promise = new Promise(function (resolve, reject) {
                /* A wedged generation can occupy the wasm thread forever and
                   the worker would never answer again: give up and restart. */
                const timer = setTimeout(function () {
                    pending.delete(id);
                    reject(new Error('timeout-waiting-for-transcript'));
                    decoding = false;
                    resetEngine('engine restarted after a timeout');
                    emit('status', 'engine-restart');
                    pumpQueue();
                }, TRANSCRIBE_TIMEOUT_MS);
                pending.set(id, { resolve: resolve, reject: reject, timer: timer });
            });
            entry.setPromise(promise);
            target.postMessage({
                type: 'transcribe', id: id, audio: entry.samples,
                model: int8 ? modelFor(engineKind) : undefined,
                reference: reference || undefined
            });
        }

        function enqueue(samples) {
            let setPromise = null;
            const result = new Promise(function (resolve, reject) {
                setPromise = function (p) {
                    p.then(resolve, reject);
                };
            });
            queue.push({ samples: samples, setPromise: setPromise });
            pumpQueue();
            return result;
        }

        /* ---- microphone capture + VAD --------------------------------------- */

        let mediaStream = null;
        let audioCtx = null;
        let sourceNode = null;
        let processorNode = null;
        let listening = false;
        let starting = null;
        let captureOnly = false;   // phoneme-only mode: mic + VAD, no text model
        let micClean = false;      // raw mic (no NS/AGC) — the phoneme model wants it

        let collecting = false;
        let frames = [];
        let bufferedMs = 0;
        let silenceMs = 0;
        let speechMs = 0;

        function start() {
            if (listening) {
                return Promise.resolve();
            }
            if (starting) {
                return starting;
            }
            starting = (captureOnly
                ? Promise.resolve()
                : (int8Family() ? ensureInt8(modelFor(engineKind)) : ensureModel())).then(function () {
                    emit('status', 'requesting-mic');
                    return navigator.mediaDevices.getUserMedia({
                        audio: micClean
                            ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
                            : { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
                    });
                }).then(function (stream) {
                    mediaStream = stream;
                    const Ctx = window.AudioContext || window.webkitAudioContext;
                    let ctx;
                    try {
                        ctx = new Ctx({ sampleRate: SAMPLE_RATE });
                    } catch (error) {
                        ctx = new Ctx();
                    }
                    audioCtx = ctx;
                    return ctx.resume().catch(function () { }).then(function () {
                        sourceNode = ctx.createMediaStreamSource(stream);
                        processorNode = ctx.createScriptProcessor
                            ? ctx.createScriptProcessor(FRAME_SAMPLES, 1, 1)
                            : null;
                        if (!processorNode) {
                            throw new Error('ScriptProcessor is not available');
                        }
                        processorNode.onaudioprocess = onAudio;
                        sourceNode.connect(processorNode);
                        processorNode.connect(ctx.destination);
                        listening = true;
                        emit('status', 'listening');
                    });
                }).finally(function () {
                    starting = null;
                });
            return starting;
        }

        function stop() {
            finishCollect();
            if (processorNode) {
                processorNode.onaudioprocess = null;
                try {
                    processorNode.disconnect();
                    sourceNode.disconnect();
                } catch (error) { /* already detached */ }
                processorNode = null;
                sourceNode = null;
            }
            if (audioCtx) {
                audioCtx.close().catch(function () { });
                audioCtx = null;
            }
            if (mediaStream) {
                mediaStream.getTracks().forEach(function (track) { track.stop(); });
                mediaStream = null;
            }
            listening = false;
            emit('level', 0);
        }

        function onAudio(event) {
            const input = event.inputBuffer.getChannelData(0);
            const frame = new Float32Array(input.length);
            frame.set(input);

            let sum = 0;
            for (let i = 0; i < frame.length; i += 1) {
                sum += frame[i] * frame[i];
            }
            const rms = Math.sqrt(sum / frame.length);
            emit('level', Math.min(1, rms * 8));

            if (captureOnly) {
                /* the phoneme engine consumes the raw stream, not utterances */
                emit('frame', audioCtx && audioCtx.sampleRate !== SAMPLE_RATE
                    ? resampleTo16k(frame, audioCtx.sampleRate)
                    : frame);
            }

            const frameMs = (frame.length / (audioCtx ? audioCtx.sampleRate : SAMPLE_RATE)) * 1000;
            const voiced = rms >= VAD_RMS;

            if (voiced) {
                if (!collecting) {
                    collecting = true;
                    speechMs = 0;
                    silenceMs = 0;
                }
                frames.push(frame);
                bufferedMs += frameMs;
                speechMs += frameMs;
                silenceMs = 0;
            } else if (collecting) {
                frames.push(frame);
                bufferedMs += frameMs;
                silenceMs += frameMs;
            }

            if (collecting) {
                /* captureOnly (phoneme stream) mode only needs the tail
                   DECODED at a pause — short-context streaming is safe
                   there, so use the short limit; the whisper limits stay
                   for the text engines (tiny fragments invent endings) */
                const silenceLimit = captureOnly
                    ? CAPTURE_FLUSH_MS
                    : (speechMs >= SHORT_SPEECH_MS ? SILENCE_FLUSH_MS : LONG_FLUSH_SILENCE_MS);
                if (silenceMs >= silenceLimit || bufferedMs >= MAX_UTTERANCE_MS) {
                    finishCollect();
                }
            }
        }

        function finishCollect() {
            const collected = frames;
            const hadSpeech = speechMs;
            frames = [];
            bufferedMs = 0;
            silenceMs = 0;
            speechMs = 0;
            collecting = false;
            if (!hadSpeech || hadSpeech < MIN_SPEECH_MS || !collected.length) {
                return;
            }
            let samples = concatFrames(collected);
            const rate = audioCtx ? audioCtx.sampleRate : SAMPLE_RATE;
            if (rate !== SAMPLE_RATE) {
                samples = resampleTo16k(samples, rate);
            }
            /* the same 16 kHz utterance feeds any extra listeners (e.g. the
               phoneme pronunciation checker) before being queued */
            emit('utterance', samples);
            if (captureOnly) {
                /* phoneme-only mode: no text recognizer runs at all */
                return;
            }
            enqueue(samples).then(function (result) {
                emit('transcript', result.text, result);
            }).catch(function (error) {
                emit('error', error.message || String(error));
            });
        }

        /* ---- helpers --------------------------------------------------------- */

        function concatFrames(list) {
            let total = 0;
            list.forEach(function (frame) { total += frame.length; });
            const out = new Float32Array(total);
            let offset = 0;
            list.forEach(function (frame) {
                out.set(frame, offset);
                offset += frame.length;
            });
            return out;
        }

        function resampleTo16k(input, fromRate) {
            if (fromRate === SAMPLE_RATE) {
                return input;
            }
            /* Windowed-sinc (Hamming, 32 taps). The old linear interpolation
               aliased the 6.4–8 kHz band back into speech — mobile devices
               usually refuse a 16 kHz AudioContext (iOS gives 44.1/48 kHz),
               so this path is the mobile-quality path and must not smear the
               sibilants the phoneme model listens for. ~32 mults per output
               sample ≈ 0.5 ms per 0.25 s frame — negligible. */
            const ratio = SAMPLE_RATE / fromRate;
            const length = Math.max(1, Math.round(input.length * ratio));
            const out = new Float32Array(length);
            const half = 16;
            const fc = Math.min(0.5, ratio * 0.5);   // output Nyquist, cycles per input sample
            for (let i = 0; i < length; i += 1) {
                const center = (i + 0.5) / ratio - 0.5;
                let acc = 0;
                let norm = 0;
                const from = Math.ceil(center - half);
                const to = Math.floor(center + half);
                for (let j = from; j <= to; j += 1) {
                    if (j < 0 || j >= input.length) {
                        continue;
                    }
                    const t = j - center;
                    const x = 2 * fc * t;
                    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
                    const win = 0.54 + 0.46 * Math.cos((Math.PI * t) / half);
                    const k = sinc * win;
                    acc += input[j] * k;
                    norm += k;
                }
                out[i] = norm > 1e-6 ? acc / norm : 0;
            }
            return out;
        }

        /* ---- file decoding (for the accuracy tool) --------------------------- */

        function decodeTo16k(arrayBuffer) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            const ctx = new Ctx();
            return new Promise(function (resolve, reject) {
                ctx.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
            }).then(function (decoded) {
                ctx.close().catch(function () { });
                const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
                const length = Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE));
                const offline = new Offline(1, length, SAMPLE_RATE);
                const source = offline.createBufferSource();
                source.buffer = decoded;
                source.connect(offline.destination);
                source.start();
                return offline.startRendering();
            }).then(function (rendered) {
                return rendered.getChannelData(0);
            });
        }

        return {
            ensureModel: ensureModel,
            start: start,
            stop: stop,
            setDevice: setDevice,
            setEngineKind: setEngineKind,
            setReferenceProvider: function (fn) { referenceProvider = fn || null; },
            setCaptureOnly: function (value) { captureOnly = Boolean(value); },
            setMicClean: function (value) { micClean = Boolean(value); },
            engineKind: function () { return engineKind; },
            isListening: function () { return listening; },
            isBusy: function () { return decoding || queue.length > 0; },
            device: function () { return modelInfo ? modelInfo.device + '/' + modelInfo.dtype : null; },
            workerUrl: function () { return WORKER_URL; },
            transcribeSamples: enqueue,
            decodeTo16k: decodeTo16k,
            dispose: function () {
                if (listening) {
                    stop();
                }
                resetWorker('disposed');
                resetInt8('disposed');
            }
        };
    }

    window.QuranASR = { createEngine: createEngine };
})();
