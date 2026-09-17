/* ===========================================================================
 * memorize-asr-worker.js — the on-device Quran speech engine (worker side).
 *
 * Runs the Quran fine-tune of Whisper (tarteel-ai/whisper-base-ar-quran, the
 * ONNX exports published as `iqbalaesthetic/Basira`) through transformers.js.
 * Everything happens inside the browser: the audio and the transcript never
 * leave the device, and after the one-time model download the engine works
 * offline.
 *
 * Protocol (postMessage):
 *   in : { type:'load', webgpu:boolean }
 *   in : { type:'transcribe', id, audio:Float32Array(16 kHz, mono) }
 *   out: { type:'status', message }            loading stage
 *   out: { type:'progress', info:{...} }       download progress
 *   out: { type:'ready', device, dtype }       model ready
 *   out: { type:'result', id, text, ms }       transcription finished
 *   out: { type:'error', id?, message }
 * =========================================================================== */

'use strict';

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0';
const MODEL_ID = 'iqbalaesthetic/Basira';

/* Whisper decoder prompt for Arabic transcription. The converted repo's
 * generation_config.json was auto-generated from config.json with
 * is_multilingual:false and no lang_to_id / task_to_id tables. transformers.js
 * reads those tables to build the decoder prompt when a language is forced
 * (lang_to_id['<|ar|>']), so we supply them here. The tokenizer is the
 * standard multilingual whisper vocab (51865 tokens); ids verified against
 * this repo's tokenizer.json:
 *   <|startoftranscript|> = 50258, <|ar|> = 50272,
 *   <|translate|> = 50358, <|transcribe|> = 50359, <|notimestamps|> = 50363
 *
 * The same file was also auto-written with use_cache:false and
 * max_length:1024. A decoder repetition loop would then re-run the decoder
 * over an ever-growing context on the CPU and never return (observed: many
 * minutes of stall on a short ayah). With the KV cache on and the output
 * capped, even a looping generation ends quickly.
 */
const WHISPER_PROMPT = {
    is_multilingual: true,
    lang_to_id: { '<|ar|>': 50272 },
    task_to_id: { transcribe: 50359, translate: 50358 },
    no_timestamps_token_id: 50363,
    use_cache: true,
    max_new_tokens: 96
};

let transcriber = null;

self.onmessage = async function (event) {
    const message = event.data || {};
    try {
        if (message.type === 'load') {
            await loadModel(message);
        } else if (message.type === 'transcribe') {
            if (!transcriber) {
                throw new Error('the model is not loaded yet');
            }
            const audio = new Float32Array(message.audio);
            const started = Date.now();
            const output = await transcriber(audio, Object.assign({
                language: 'ar',
                task: 'transcribe'
            }, WHISPER_PROMPT));
            /* The ASR pipeline can answer either [{ text }] or { text }. */
            const first = Array.isArray(output) ? output[0] : output;
            const text = (first && first.text) || '';
            self.postMessage({
                type: 'result',
                id: message.id,
                text: text,
                ms: Date.now() - started,
                debug: (Array.isArray(output) ? 'array[' + output.length + ']' : typeof output)
                    + ' — first.text: ' + JSON.stringify(String(first && first.text).slice(0, 160))
            });
        }
    } catch (error) {
        self.postMessage({
            type: 'error',
            id: message.id,
            message: String((error && error.message) || error)
        });
    }
};

/**
 * Loads the pipeline, trying the best runtime first:
 *   WebGPU fp16 → WebGPU q4 → WASM q8
 * The WASM q8 files are the smallest (~100 MB total); fp16 is the fastest on
 * desktop GPUs. Progress events are forwarded so the page can show a gauge.
 *
 * A watchdog guards every attempt: some GPU/driver combinations let session
 * creation hang forever (typically the WebGPU process dying without an
 * error), so an attempt that makes no progress for STALL_MS is abandoned and
 * the next candidate is tried. When a GPU attempt stalls, the remaining GPU
 * attempts are skipped — they would hang the same way — and the CPU (WASM)
 * path is used instead.
 */
const STALL_MS = 90000;

function attemptPipeline(module, attempt, onProgress) {
    return new Promise(function (resolve, reject) {
        let settled = false;
        let timer = null;
        const fail = function (error) {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                reject(error);
            }
        };
        const kick = function () {
            clearTimeout(timer);
            timer = setTimeout(function () {
                fail(new Error('stalled (no progress for ' + Math.round(STALL_MS / 1000) + 's)'));
            }, STALL_MS);
        };
        kick();
        module.pipeline('automatic-speech-recognition', MODEL_ID, {
            device: attempt.device,
            dtype: attempt.dtype,
            progress_callback: function (info) {
                onProgress(info);
                kick();
            }
        }).then(function (value) {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve(value);
            }
        }, fail);
    });
}

async function loadModel(message) {
    const prefer = message.prefer || 'auto';
    let attempts = [];
    if (prefer === 'wasm') {
        /* the only hard CPU-only setting */
        attempts.push({ device: 'wasm', dtype: 'q8' });
    } else {
        if (message.webgpu) {
            attempts.push({ device: 'webgpu', dtype: 'fp16' });
            attempts.push({ device: 'webgpu', dtype: 'q4' });
        }
        /* 'webgpu' means "try the GPU first, CPU as the safety net": a broken
           WebGPU stack (a real case: onnxruntime-web's EP refuses this decoder
           graph with a TypeInferenceError) must not leave the engine with no
           model at all. */
        attempts.push({ device: 'wasm', dtype: 'q8' });
    }

    let lastError = null;
    let index = 0;
    while (attempts.length) {
        const attempt = attempts.shift();
        index += 1;
        try {
            /* A fresh module instance per attempt. onnxruntime-web keeps the
               WASM / GPU backends in module-global state, and a failed WebGPU
               session creation poisons whatever attempt follows it: the CPU
               fallback then dies with the GPU's own TypeInferenceError
               (observed 2026-09-17). A distinct URL bypasses the ES-module
               cache and gives every attempt a clean runtime; the library and
               model files are cached, so the cost is just a re-parse. */
            const module = await import(index === 1 ? TRANSFORMERS_URL : TRANSFORMERS_URL + '?fresh=' + index);
            self.postMessage({
                type: 'status',
                message: 'loading ' + attempt.device + '/' + attempt.dtype
            });
            transcriber = await attemptPipeline(module, attempt, function (info) {
                self.postMessage({
                    type: 'progress',
                    info: {
                        status: info && info.status,
                        file: info && info.file,
                        progress: info && info.progress,
                        loaded: info && info.loaded,
                        total: info && info.total
                    }
                });
            });
            self.postMessage({ type: 'ready', device: attempt.device, dtype: attempt.dtype });
            return;
        } catch (error) {
            lastError = error;
            transcriber = null;
            const reason = String((error && error.message) || error);
            self.postMessage({
                type: 'status',
                message: 'failed ' + attempt.device + '/' + attempt.dtype + ': ' + reason
            });
            if (attempt.device === 'webgpu' && reason.indexOf('stalled') === 0) {
                attempts = attempts.filter(function (next) { return next.device !== 'webgpu'; });
            }
        }
    }
    throw lastError || new Error('could not load the speech model');
}
