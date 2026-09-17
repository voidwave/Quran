/* local ORT validation for the patched encoder */
import ort from 'onnxruntime-node';

const files = process.argv.slice(2);
for (const f of files) {
    try {
        const t0 = Date.now();
        const sess = await ort.InferenceSession.create(f);
        console.log(f + ' => OK (' + sess.inputNames.length + ' inputs, ' + sess.outputNames.length + ' outputs, ' + (Date.now() - t0) + 'ms)');
    } catch (error) {
        console.log(f + ' => FAIL: ' + String(error && error.message ? error.message : error).slice(0, 400));
    }
}
