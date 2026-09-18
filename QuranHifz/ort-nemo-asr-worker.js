/* ===========================================================================
 * ort-nemo-asr-worker.js — hosts the FastConformer int8 engine off the main
 * thread, so the memorize UI, the level meter and above all the microphone
 * keep running while a chunk is decoding.
 *
 * Loads the shared driver (ort-nemo-asr.js, same folder) and speaks the same
 * protocol as memorize-asr-worker.js:
 *   in : { type: 'load', model? } | { type: 'transcribe', id, audio, model? }
 *   out: { type: 'status', message }   (stages, tagged 'int8 ' for the page)
 *        { type: 'ready', device, dtype } | { type: 'result', id, text, ms }
 *        { type: 'error', id?, message }
 * =========================================================================== */

importScripts('quran-gop.js', 'ort-nemo-asr.js');

let engine = null;
let engineModel = null;
let loading = null;

function ensure(modelId) {
    const id = modelId || engineModel || 'quran-int8-ort';
    if (engine && engineModel !== id) {
        /* a different export was requested: drop the old sessions first */
        try { engine.dispose(); } catch (error) { /* ignore */ }
        engine = null;
        loading = null;
    }
    if (!loading) {
        loading = Promise.resolve().then(function () {
            if (!self.OrtNemoASR) {
                throw new Error('ort-nemo-asr.js لم يُحمَّل داخل العامل');
            }
            if (!engine) {
                engineModel = id;
                engine = self.OrtNemoASR.create(id, {
                    /* Arabic stage messages; the 'int8 ' tag lets the page
                       show them without touching the whisper statuses */
                    status: function (text) {
                        self.postMessage({ type: 'status', message: 'int8 ' + text });
                    }
                }, { ep: 'wasm' });
            }
            return engine.ensureModel();
        });
        loading.catch(function () {
            loading = null;   // allow a retry on the next message
        });
    }
    return loading;
}

self.onmessage = function (event) {
    const message = event.data || {};
    if (message.type === 'load') {
        ensure(message.model).then(function () {
            self.postMessage({
                type: 'ready',
                device: 'wasm',
                dtype: engineModel === 'quran-v8-ctc' ? 'v8'
                    : (engineModel === 'quran-v8-fp32' ? 'v8fp32' : 'int8')
            });
        }, function (error) {
            self.postMessage({ type: 'error', message: (error && error.message) || 'engine error' });
        });
        return;
    }
    if (message.type === 'transcribe') {
        const started = Date.now();
        ensure(message.model).then(function () {
            return engine.transcribeSamples(
                message.audio,
                message.reference ? { reference: message.reference } : undefined
            );
        }).then(function (result) {
            self.postMessage({
                type: 'result',
                id: message.id,
                text: (result && result.text) || '',
                words: (result && result.words) || null,
                gopWords: (result && result.gopWords) || null,
                ms: Date.now() - started
            });
        }, function (error) {
            self.postMessage({
                type: 'error',
                id: message.id,
                message: (error && error.message) || 'engine error'
            });
        });
    }
};
