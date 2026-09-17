/* one-off: NeMo preprocessing source lookup */
const files = [
    'https://raw.githubusercontent.com/NVIDIA/NeMo/main/nemo/collections/asr/parts/preprocessing/features.py',
    'https://raw.githubusercontent.com/NVIDIA/NeMo/main/nemo/collections/asr/parts/utils/audio_utils.py',
    'https://raw.githubusercontent.com/NVIDIA/NeMo/main/nemo/collections/asr/data/audio_to_mel.py'
];
const keys = ['pad_mode', 'log_zero_guard_value', 'log_zero_guard_type', 'def mel_filter_bank',
    'slaney', 'def normalize', 'per_feature', 'nfilt', 'stft'];

for (const url of files) {
    let text;
    try {
        text = await fetch(url).then(r => r.text());
    } catch (error) {
        console.log('ERR ' + url + ' ' + error);
        continue;
    }
    if (text.indexOf('404: Not Found') === 0) {
        console.log('404: ' + url);
        continue;
    }
    console.log('==== ' + url.split('/').pop() + ' (' + text.length + ' chars) ====');
    for (const key of keys) {
        let at = -1;
        let count = 0;
        while ((at = text.indexOf(key, at + 1)) !== -1 && count < 2) {
            console.log('--- ' + key + ' @' + at + ' ---');
            console.log(text.slice(Math.max(0, at - 140), at + 260).replace(/\s+/g, ' ').slice(0, 380));
            count += 1;
        }
    }
}
