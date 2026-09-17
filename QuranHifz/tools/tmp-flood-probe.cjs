/* Temporary stress probe: hammer the tracker with mistake-laden sequences and
 * flag any chunk that settles or reveals words BEYOND the current cursor. */
const core = require('../memorize-core.js');

function makeItems(verses) {
    return core.buildItems(verses);
}

const FATIHA = [
    { s: 1, a: 1, text: 'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ' },
    { s: 1, a: 2, text: 'ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ' },
    { s: 1, a: 3, text: 'ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ' },
    { s: 1, a: 4, text: 'مَـٰلِكِ يَوْمِ ٱلدِّينِ' },
    { s: 1, a: 5, text: 'إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ' },
    { s: 1, a: 6, text: 'ٱهْدِنَا ٱلصِّرَٰطَ ٱلْمُسْتَقِيمَ' },
    { s: 1, a: 7, text: 'صِرَٰطَ ٱلَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ ٱلْمَغْضُوبِ عَلَيْهِمْ وَلَا ٱلضَّآلِّينَ' }
];

const WORDS = ['بسم', 'الله', 'الرحمن', 'الرحيم', 'الحمد', 'لله', 'رب', 'العالمين',
    'مالك', 'يوم', 'الدين', 'إياك', 'نعبد', 'وإياك', 'نستعين', 'اهدنا', 'الصرط',
    'المستقيم', 'صرط', 'الذين', 'انعمت', 'عليهم', 'غير', 'المغضوب', 'ولا', 'الضالين'];
const WRONG = ['كتاب', 'قلب', 'جبل', 'حجر', 'شمس', 'قمر', 'بحر', 'نهر', 'طير', 'ورد',
    'بيت', 'باب', 'علم', 'قلم', 'كلم', 'همم', 'لمم', 'ممم', 'ققق', 'تتا'];

function revealBeyond(tracker) {
    let count = 0;
    for (let i = 0; i < tracker.states.length; i += 1) {
        const st = tracker.states[i];
        if (i > tracker.cursor && (st === 'unclear' || st === 'skip')) {
            count += 1;
        }
    }
    return count;
}

function run(name, verses, chunks) {
    const items = makeItems(verses);
    const tracker = core.createTracker(items);
    let worst = { chunk: -1, reveal: 0, cursor: 0, ops: null };
    chunks.forEach(function (chunk, ci) {
        const ops = tracker.finalize(chunk);
        const reveal = revealBeyond(tracker);
        if (reveal > worst.reveal) {
            worst = { chunk: ci, reveal: reveal, cursor: tracker.cursor, ops: JSON.stringify(ops) };
        }
    });
    console.log(name, '-> worst reveal-beyond-cursor:', worst.reveal,
        '| states:', tracker.states.join(','), '| cursor:', tracker.cursor);
    if (worst.reveal > 0) {
        console.log('   chunk#' + worst.chunk, 'cursor-after:', worst.cursor, worst.ops);
    }
}

/* 1) stuck at word 4, hammer with wrong words + repeats of accepted words */
{
    const chunks = ['بسم الله الرحمن الرحيم'];
    for (let i = 0; i < 40; i += 1) {
        const r = Math.random();
        if (r < 0.5) {
            chunks.push(WRONG[i % WRONG.length]);
        } else if (r < 0.7) {
            chunks.push('بسم الله');
        } else if (r < 0.85) {
            chunks.push('الرحمن الرحيم');
        } else {
            chunks.push('بسم الله الرحمن الرحيم الحمد لله رب العالمين');
        }
    }
    run('stuck+hammer', FATIHA, chunks);
}

/* 2) progress far, then restart from the beginning repeatedly */
{
    const chunks = [];
    chunks.push('بسم الله الرحمن الرحيم');
    chunks.push('الحمد لله رب العالمين');
    chunks.push('الرحمن الرحيم');
    chunks.push('مالك يوم الدين');
    for (let i = 0; i < 25; i += 1) {
        const r = Math.random();
        if (r < 0.3) chunks.push('بسم الله الرحمن الرحيم');
        else if (r < 0.5) chunks.push('بسم الله');
        else if (r < 0.7) chunks.push(WRONG[i % WRONG.length]);
        else chunks.push('بسم الله الرحمن الرحيم الحمد لله رب العالمين الرحمن الرحيم');
    }
    run('far+restart', FATIHA, chunks);
}

/* 3) long noisy merged chunks while stuck */
{
    const chunks = ['بسم الله الرحمن الرحيم'];
    for (let i = 0; i < 30; i += 1) {
        const words = [];
        const n = 4 + (i % 9);
        for (let j = 0; j < n; j += 1) {
            words.push(Math.random() < 0.5 ? WRONG[(i + j) % WRONG.length] : WORDS[(i * 3 + j) % WORDS.length]);
        }
        chunks.push(words.join(' '));
    }
    run('noisy-merged', FATIHA, chunks);
}

/* 4) same storms on a repeat-heavy passage */
{
    const SIX = [
        { s: 23, a: 1, text: 'قَدْ أَفْلَحَ ٱلْمُؤْمِنُونَ' },
        { s: 112, a: 2, text: 'ٱللَّهُ ٱلصَّمَدُ' },
        { s: 112, a: 3, text: 'لَمْ يَلِدْ وَلَمْ يُولَدْ' },
        { s: 112, a: 4, text: 'وَلَمْ يَكُن لَّهُۥ كُفُوًا أَحَدٌ' },
        { s: 78, a: 1, text: 'عَمَّ يَتَسَاءَلُونَ' },
        { s: 78, a: 2, text: 'عَنِ ٱلنَّبَإِ ٱلْعَظِيمِ' }
    ];
    const chunks = ['قد افلح المؤمنون', 'الله الصمد'];
    for (let i = 0; i < 40; i += 1) {
        const r = Math.random();
        if (r < 0.4) chunks.push(WRONG[i % WRONG.length]);
        else if (r < 0.6) chunks.push('قل هو الله احد');
        else if (r < 0.8) chunks.push('لم يلد ولم يولد');
        else chunks.push('قل هو الله احد لم يلد ولم يولد يكن له كفوا احد');
    }
    run('six-verses-storm', SIX, chunks);
}

/* 5) restart mid-passage after a holed commit (cursor ahead, gaps behind) */
{
    const chunks = ['بسم الله الرحمن الرحيم', 'الحمد لله', 'الرحمن الرحيم', 'مالك يوم الدين',
        'إياك نعبد وإياك نستعين', 'اهدنا الصرط المستقيم'];
    for (let i = 0; i < 20; i += 1) {
        chunks.push(i % 3 === 0 ? 'بسم الله الرحمن الرحيم' : WRONG[i % WRONG.length]);
    }
    run('holed+restart', FATIHA, chunks);
}

console.log('done');
