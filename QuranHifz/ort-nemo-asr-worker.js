/* ===========================================================================
 * ort-nemo-asr-worker.js — hosts the FastConformer int8 engine off the main
 * thread, so the memorize UI, the level meter and above all the microphone
 * keep running while a chunk is decoding.
 *
 * Loads the shared driver (ort-nemo-asr.js, same folder) and speaks the same
 * protocol as memorize-asr-worker.js:
 *   in : { type: 'load' } | { type: 'transcribe', id, audio: Float32Array }
 *   out: { type: 'status', message }   (stages, tagged 'int8 ' for the page)
 *        { type: 'ready', device, dtype } | { type: 'result', id, text, ms }
 *        { type: 'error', id?, message }
 * =========================================================================== */

importScripts('ort-nemo-asr.js');

let engine = null;
let loading = null;

function ensure() {
    if (!loading) {
        loading = Promise.resolve().then(function () {
            if (!self.OrtNemoASR) {
                throw new Error('ort-nemo-asr.js لم يُحمَّل داخل العامل');
            }
            if (!engine) {
                engine = self.OrtNemoASR.create('quran-int8-ort', {
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
        ensure().then(function () {
            self.postMessage({ type: 'ready', device: 'wasm', dtype: 'int8' });
        }, function (error) {
            self.postMessage({ type: 'error', message: (error && error.message) || 'engine error' });
        });
        return;
    }
    if (message.type === 'transcribe') {
        const started = Date.now();
        ensure().then(function () {
            return engine.transcribeSamples(message.audio);
        }).then(function (result) {
            self.postMessage({
                type: 'result',
                id: message.id,
                text: (result && result.text) || '',
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
