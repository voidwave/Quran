/* ===========================================================================
 * test-memorize-core.mjs — fixture runner for memorize-core.js.
 *
 *   node QuranHifz/tools/test-memorize-core.mjs
 *
 * The scenarios mimic what the Web Speech pipeline will feed the tracker:
 * clean chunks, wrong words, skipped words, skipped verses, repeats, jumps
 * forward and back, basmala prefixes, noise and waqf marks.
 * =========================================================================== */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const core = require('../memorize-core.js');

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
    if (condition) {
        passed += 1;
        console.log('  \u2713 ' + name);
    } else {
        failed += 1;
        console.log('  \u2717 ' + name + (detail ? '  \u2014 ' + detail : ''));
    }
}

function section(title) {
    console.log('\n' + title);
}

function opsOf(ops, type) {
    return ops.filter(function (op) { return op.op === type; });
}

function statesOf(tracker) {
    return tracker.states.join(',');
}

/* Runs a series of chunks through one tracker and collects every op. */
function runTracker(items, chunks, options) {
    const tracker = core.createTracker(items, options);
    const ops = [];
    chunks.forEach(function (chunk) {
        tracker.finalize(chunk).forEach(function (op) { ops.push(op); });
    });
    return { tracker: tracker, ops: ops };
}

/* -------------------------------------------------------------------------- */

section('normalization');
check("normalizeToken('ٱلْحَمْدُ')", core.normalizeToken('ٱلْحَمْدُ') === 'الحمد', core.normalizeToken('ٱلْحَمْدُ'));
check("normalizeToken('ٱلْعَـٰلَمِينَ')", core.normalizeToken('ٱلْعَـٰلَمِينَ') === 'العالمين', core.normalizeToken('ٱلْعَـٰلَمِينَ'));
check("normalizeToken('ذَٰلِكَ')", core.normalizeToken('ذَٰلِكَ') === 'ذالك', core.normalizeToken('ذَٰلِكَ'));
check("normalizeToken('ٱلرَّحْمَـٰنِ')", core.normalizeToken('ٱلرَّحْمَـٰنِ') === 'الرحمان', core.normalizeToken('ٱلرَّحْمَـٰنِ'));
check("normalizeToken('مُوسَىٰ')", core.normalizeToken('مُوسَىٰ') === 'موسيا', core.normalizeToken('مُوسَىٰ'));
check("standalone waqf mark → ''", core.normalizeToken('ۛ') === '' && core.normalizeToken('ۖ') === '');
check('sajda mark and small letters stripped', core.normalizeToken('لَّهُۥ') === 'له', core.normalizeToken('لَّهُۥ'));
check('Uthmani madda («ءَاثَـٰرِهِمْ») folds to the modern spelling (اثارهم)',
    core.normalizeToken('ءَاثَـٰرِهِمْ') === 'اثارهم' && core.normalizeToken('آثَارِهِمْ') === 'اثارهم',
    core.normalizeToken('ءَاثَـٰرِهِمْ') + ' / ' + core.normalizeToken('آثَارِهِمْ'));
check('hamza-before-alef words settle exactly (آثَارِهِمْ heard for ءَاثَـٰرِهِمْ)',
    core.wordScore(core.normalizeToken('آثَارِهِمْ'), core.normalizeToken('ءَاثَـٰرِهِمْ')) === 1,
    String(core.wordScore(core.normalizeToken('آثَارِهِمْ'), core.normalizeToken('ءَاثَـٰرِهِمْ'))));
check('the hamza fold applies inside words too (قُرْءَانٍ → قران)',
    core.normalizeToken('قُرْءَانٍ') === 'قران' && core.normalizeToken('قُرْآنٍ') === 'قران'
    && core.wordScore(core.normalizeToken('قُرْآنٍ'), core.normalizeToken('قُرْءَانٍ')) === 1,
    core.normalizeToken('قُرْءَانٍ') + ' / ' + core.normalizeToken('قُرْآنٍ'));
check("tokenize splits and drops marks", JSON.stringify(core.tokenize('لَا رَيْبَ ۛ فِيهِ')) === JSON.stringify(['لا', 'ريب', 'فيه']));
check('«يا أيها» is joined to the Uthmani word «ياايها»',
    JSON.stringify(core.flattenTokens(['يا ايها'])) === JSON.stringify(['ياايها']),
    JSON.stringify(core.flattenTokens(['يا ايها'])));
check('a lone «يا» is left alone (يا ليتني)',
    JSON.stringify(core.flattenTokens(['يا ليتني'])) === JSON.stringify(['يا', 'ليتني']),
    JSON.stringify(core.flattenTokens(['يا ليتني'])));

section('word scoring');
check("exact = 1", core.wordScore('الله', 'الله') === 1);
check('الرحمن/الرحمان is strong (0.857)', core.wordScore('الرحمن', 'الرحمان') >= core.STRONG_SIM);
check('dagger-alef words still match modern spellings',
    core.wordScore('العلمين', 'العالمين') >= core.STRONG_SIM && core.wordScore('ذلك', 'ذلك') === 1,
    String(core.wordScore('العلمين', 'العالمين')));
check('a lone alef insertion is strong (مالك/ملك، صراط/صرط)',
    core.wordScore('مالك', 'ملك') >= core.STRONG_SIM && core.wordScore('صراط', 'صرط') >= core.STRONG_SIM,
    core.wordScore('مالك', 'ملك') + ', ' + core.wordScore('صراط', 'صرط'));
check('dagger alefs become alef (ٱلسَّمَـٰوَٰتِ → السماوات, exact score)',
    core.normalizeToken('ٱلسَّمَـٰوَٰتِ') === 'السماوات'
    && core.wordScore('السماوات', core.normalizeToken('ٱلسَّمَـٰوَٰتِ')) === 1,
    core.normalizeToken('ٱلسَّمَـٰوَٰتِ') + ' \u2192 ' + core.wordScore('السماوات', core.normalizeToken('ٱلسَّمَـٰوَٰتِ')));
check('two alefs dropped is strong too (السموت \u2190 السماوات reversed)',
    core.wordScore('السموت', 'السماوات') >= core.STRONG_SIM,
    String(core.wordScore('السموت', 'السماوات')));
check('قال/قل is a different word (perfect matching → 0)',
    core.wordScore('قال', 'قل') === 0, String(core.wordScore('قال', 'قل')));
check('«مالكم» is not «مالك» (extra letter → 0)',
    core.wordScore('مالكم', 'مالك') === 0, String(core.wordScore('مالكم', 'مالك')));
check('المؤمنون vs المجرمون = 0 (real substitution)', core.wordScore('المءمنون', 'المجرمون') === 0);
check('a replaced letter is not the same word (منهم/منكم → 0)',
    core.wordScore('منهم', 'منكم') === 0, String(core.wordScore('منهم', 'منكم')));
check('«أنقمت» is not «أنعمت» (substitution → 0)',
    core.wordScore('انقمت', 'انعمت') === 0, String(core.wordScore('انقمت', 'انعمت')));
check('a dropped letter is a different word too (عليه/عليهم → 0)',
    core.wordScore('عليه', 'عليهم') === 0, String(core.wordScore('عليه', 'عليهم')));
check('two-letter words require exactness', core.wordScore('ما', 'من') === 0);
check('levenshtein sanity', core.levenshtein('كتاب', 'كتب') === 1);

section('word endings (ASR confusions)');
check('الصالحين is rescued as الصالحات', core.wordScore('الصالحين', 'الصالحات') >= core.STRONG_SIM,
    String(core.wordScore('الصالحين', 'الصالحات')));
check('صالحه (dropped article) is rescued too', core.wordScore('صالحه', 'الصالحات') >= core.STRONG_SIM,
    String(core.wordScore('صالحه', 'الصالحات')));
check('الصالحون counts as well', core.wordScore('الصالحون', 'الصالحات') >= core.STRONG_SIM,
    String(core.wordScore('الصالحون', 'الصالحات')));
check('a different stem is not rescued (طالحة)', core.wordScore('طالحة', 'الصالحات') === 0,
    String(core.wordScore('طالحة', 'الصالحات')));
check('a different stem is not rescued (الصادقين)', core.wordScore('الصادقين', 'الصالحات') === 0,
    String(core.wordScore('الصادقين', 'الصالحات')));
check('a truncated word is not rescued (صالح)', core.wordScore('صالح', 'الصالحات') === 0,
    String(core.wordScore('صالح', 'الصالحات')));
check('exact forms are untouched (score 1)', core.wordScore('الصالحات', 'الصالحات') === 1);
check('rescue never fires for equal words', core.endingRescue('الصالحات', 'الصالحات') === false);

section('pronunciation signatures');
check('marks collected in order', core.vowelSignature('قُلْ') === '\u064F\u0652', core.vowelSignature('قُلْ'));
check('wrong vowel differs', core.vowelSignature('قَلْ') !== core.vowelSignature('قُلْ'));
check('unvoweled words give no signature', core.vowelSignature('قل') === '');
{
    const items = core.buildItems([{ s: 1, a: 1, text: 'أَنْعَمْتَ عَلَيْهِمْ' }]);
    const tracker = core.createTracker(items);
    const ops = tracker.finalize('أَنْعَمْتُ عَلَيْهِمْ');
    const notes = ops.filter(function (op) { return op.op === 'pronounce'; });
    check('wrong vowel flagged as a note', notes.length === 1 && notes[0].i === 0, JSON.stringify(notes));
    check('word itself is still ok', tracker.states[0] === 'ok');
}
{
    const items = core.buildItems([{ s: 1, a: 1, text: 'أَنْعَمْتَ' }]);
    const tracker = core.createTracker(items);
    const ops = tracker.finalize('انعمت');
    check('no note when marks are missing', ops.filter(function (op) { return op.op === 'pronounce'; }).length === 0);
}

section('buildItems');
const waqfItems = core.buildItems([
    { s: 2, a: 2, text: 'ذَٰلِكَ ٱلْكِتَـٰبُ لَا رَيْبَ ۛ فِيهِ ۛ هُدًى' }
]);
check('waqf marks are meta', waqfItems.filter(function (item) { return item.meta; }).length === 2);
check('norms in order', waqfItems.map(function (item) { return item.norm; }).join(' ')
    === 'ذالك الكتاب لا ريب  فيه  هدي', waqfItems.map(function (item) { return item.norm; }).join(' '));
check('word-audio numbering skips meta', waqfItems[waqfItems.length - 1].wbw === 6,
    String(waqfItems[waqfItems.length - 1].wbw));
const muqItems = core.buildItems([{ s: 2, a: 1, text: 'الٓمٓ' }]);
check('muqatta\'at is soft', muqItems[0].soft === true && muqItems[0].norm === 'الم');

/* -------------------------------------------------------------------------- */

const FATIHA2 = [{ s: 1, a: 2, text: 'ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ' }];
const SKIP_VERSE = [
    { s: 112, a: 1, text: 'قُلْ هُوَ ٱللَّهُ أَحَدٌ' },
    { s: 112, a: 2, text: 'ٱللَّهُ ٱلصَّمَدُ' },
    { s: 112, a: 3, text: 'لَمْ يَلِدْ وَلَمْ يُولَدْ' }
];
const SIX_VERSES = [
    { s: 23, a: 1, text: 'قَدْ أَفْلَحَ ٱلْمُؤْمِنُونَ' },
    { s: 112, a: 2, text: 'ٱللَّهُ ٱلصَّمَدُ' },
    { s: 112, a: 3, text: 'لَمْ يَلِدْ وَلَمْ يُولَدْ' },
    { s: 112, a: 4, text: 'وَلَمْ يَكُن لَّهُۥ كُفُوًا أَحَدٌ' },
    { s: 78, a: 1, text: 'عَمَّ يَتَسَاءَلُونَ' },
    { s: 78, a: 2, text: 'عَنِ ٱلنَّبَإِ ٱلْعَظِيمِ' }
];
const ALL_SIX = 'قد افلح المؤمنون الله الصمد لم يلد ولم يولد ولم يكن له كفوا احد';

section('clean recitation');
{
    const result = runTracker(core.buildItems(FATIHA2), ['الحمد لله رب العالمين']);
    check('every word ok', statesOf(result.tracker) === 'ok,ok,ok,ok', statesOf(result.tracker));
    check('strong count = 4', result.tracker.stats.strong === 4);
    check('complete op fired', opsOf(result.ops, 'complete').length === 1);
    check('done flag', result.tracker.done === true);
    check('further chunks ignored', result.tracker.finalize('الحمد').length === 0);
}

section('wrong word (substitution)');
{
    const tracker = core.createTracker(core.buildItems(FATIHA2));
    const ops = tracker.finalize('الحمد لله الملك العالمين');
    const subs = opsOf(ops, 'sub');
    check('one substitution at word 3', subs.length === 1 && subs[0].i === 2, JSON.stringify(subs));
    check('heard word reported', subs[0].heard === 'الملك', subs[0].heard);
    check('the wrong word stays pending', statesOf(tracker) === 'ok,ok,pending,pending', statesOf(tracker));
    check('cursor waits at the wrong word', tracker.cursor === 2, String(tracker.cursor));
    check('nothing beyond it settled', !tracker.done);
    const again = tracker.finalize('رب العالمين');
    check('reading it correctly advances', statesOf(tracker) === 'ok,ok,ok,ok', statesOf(tracker));
    check('complete after the fix', opsOf(again, 'complete').length === 1, JSON.stringify(again));
}

section('wrong word after committed words (window contamination)');
{
    // The back-margin pulls already-committed words into the alignment; the
    // substitution must still land on the unsettled word and hold there.
    const tracker = core.createTracker(core.buildItems(FATIHA2));
    tracker.finalize('الحمد لله');
    const ops = tracker.finalize('الملك العالمين');
    const subs = opsOf(ops, 'sub');
    check('substitution at word 3', subs.length === 1 && subs[0].i === 2 && subs[0].heard === 'الملك',
        JSON.stringify(subs));
    check('the wrong word stays pending', statesOf(tracker) === 'ok,ok,pending,pending', statesOf(tracker));
    check('cursor waits at the wrong word', tracker.cursor === 2, String(tracker.cursor));
    const again = tracker.finalize('رب العالمين');
    check('reading it correctly advances', statesOf(tracker) === 'ok,ok,ok,ok', statesOf(tracker));
}

section('skipped word');
{
    const tracker = core.createTracker(core.buildItems(FATIHA2));
    const ops = tracker.finalize('الحمد رب العالمين');
    const misses = opsOf(ops, 'miss');
    check('miss feedback at word 2', misses.length === 1 && misses[0].i === 1, JSON.stringify(misses));
    check('the missed word stays pending', statesOf(tracker) === 'ok,pending,pending,pending', statesOf(tracker));
    check('cursor waits at the missed word', tracker.cursor === 1, String(tracker.cursor));
    const again = tracker.finalize('لله رب العالمين');
    check('filling it in advances', statesOf(tracker) === 'ok,ok,ok,ok', statesOf(tracker));
    check('complete fired', opsOf(again, 'complete').length === 1, JSON.stringify(again));
}

section('skipped verse');
{
    const tracker = core.createTracker(core.buildItems(SKIP_VERSE));
    const ops = tracker.finalize('قل هو الله احد لم يلد ولم يولد');
    const misses = opsOf(ops, 'miss').map(function (op) { return op.i; });
    check('skipped verse reported at its first word', JSON.stringify(misses) === JSON.stringify([4]),
        JSON.stringify(misses));
    check('verse 2 stays pending', tracker.states.slice(4, 6).join(',') === 'pending,pending',
        tracker.states.slice(4, 6).join(','));
    check('cursor waits at verse 2', tracker.cursor === 4, String(tracker.cursor));
    check('not complete yet', tracker.done === false);
    const again = tracker.finalize('الله الصمد لم يلد ولم يولد');
    check('finishing verse 2 completes', tracker.done === true, statesOf(tracker));
    check('complete fired', opsOf(again, 'complete').length === 1);
}

section('repeated word');
{
    const tracker = core.createTracker(core.buildItems(SKIP_VERSE));
    const first = tracker.finalize('قل هو');
    check('first chunk commits 2 words', opsOf(first, 'ok').length === 2 && tracker.cursor === 2);
    const second = tracker.finalize('هو الله احد');
    check('repeat reported for word 2', opsOf(second, 'repeat').map(function (op) { return op.i; }).join(',') === '1',
        JSON.stringify(opsOf(second, 'repeat')));
    check('stats.repeats = 1', tracker.stats.repeats === 1);
    check('no errors raised', opsOf(second, 'sub').length === 0 && opsOf(second, 'miss').length === 0);
    check('all verse-1 words ok', tracker.states.slice(0, 4).join(',') === 'ok,ok,ok,ok', statesOf(tracker));
}

section('opening basmala: dropped only when the passage lacks it');
{
    // Surah 112 does not contain the basmala; saying it out of habit must
    // leave no trace — no error marks, no hold/lowconf nags.
    const result = runTracker(core.buildItems(SKIP_VERSE), ['بسم الله الرحمن الرحيم قل هو الله احد']);
    check('verse-1 words commit',
        result.tracker.states.slice(0, 4).join(',') === 'ok,ok,ok,ok',
        result.tracker.states.slice(0, 4).join(','));
    check('cursor after verse 1', result.tracker.cursor === 4, String(result.tracker.cursor));
    check('no extras', result.tracker.stats.extras === 0, String(result.tracker.stats.extras));
    check('no misses and no hold nag', result.tracker.stats.misses === 0
        && opsOf(result.ops, 'hold').length === 0,
        JSON.stringify([result.tracker.stats.misses, opsOf(result.ops, 'hold').length]));

    // the isti'adha is dropped the same way
    const adha = runTracker(core.buildItems(SKIP_VERSE),
        ['اعوذ بالله من الشيطان الرجيم قل هو الله احد']);
    check("isti'adha dropped too, verse commits",
        adha.tracker.states.slice(0, 4).join(',') === 'ok,ok,ok,ok', statesOf(adha.tracker));
    check("no extras for the isti'adha", adha.tracker.stats.extras === 0,
        String(adha.tracker.stats.extras));

    // a passage that IS the basmala keeps it: the words are real text
    const withBasmala = core.buildItems([{ s: 1, a: 1, text: 'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ' }]);
    const result2 = runTracker(withBasmala, ['بسم الله الرحمن الرحيم']);
    check('basmala matches when it IS the passage', statesOf(result2.tracker) === 'ok,ok,ok,ok',
        statesOf(result2.tracker));
    check('no extras then', result2.tracker.stats.extras === 0, String(result2.tracker.stats.extras));
}

section('basmala inside the text is real (An-Naml 27:30)');
{
    // «وَإِنَّهُۥ بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ» is part of this verse. The
    // old phrase stripper deleted it from the heard stream, left the words
    // unsettleable and stalled the tracker on «بسم» — this is the regression.
    const NAML = [{ s: 27, a: 30, text: 'إِنَّهُۥ مِن سُلَيْمَـٰنَ وَإِنَّهُۥ بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ' }];
    const result = runTracker(core.buildItems(NAML), ['انه من سليمان وانه بسم الله الرحمن الرحيم']);
    check('every word settles, including the basmala',
        statesOf(result.tracker) === 'ok,ok,ok,ok,ok,ok,ok,ok', statesOf(result.tracker));
    check('no misses', opsOf(result.ops, 'miss').length === 0, JSON.stringify(opsOf(result.ops, 'miss')));
    check('complete', result.tracker.done === true);
}

section('recognizer splits «يا أيها» — joined back (4:1)');
{
    const items = core.buildItems([{ s: 4, a: 1, text: 'يَـٰٓأَيُّهَا ٱلنَّاسُ ٱتَّقُوا۟ رَبَّكُمُ' }]);
    const result = runTracker(items, ['يا ايها الناس اتقوا ربكم']);
    check('every word settles, including «ياايها»', statesOf(result.tracker) === 'ok,ok,ok,ok',
        statesOf(result.tracker));
    check('complete', result.tracker.done === true);
}

section('forward jump is refused (stay put)');
{
    // The reciter recites later verses without finishing the marked gap:
    // the tracker must hold at the gap instead of skipping ahead.
    const feed = ['قد افلح', 'المؤمنون الله', 'الصمد لم', 'يلد ولم', 'يولد ولم', 'يكن له', 'كفوا احد'];
    const chunks = feed.concat(['عن النبا العظيم']);
    const result = runTracker(core.buildItems(SIX_VERSES), chunks, { fwd: 2, back: 4 });
    check('no skip ops', opsOf(result.ops, 'skip').length === 0, JSON.stringify(opsOf(result.ops, 'skip')));
    check('no relocate ops', opsOf(result.ops, 'relocate').length === 0, JSON.stringify(opsOf(result.ops, 'relocate')));
    check('the gap stays pending', result.tracker.states.slice(14, 16).join(',') === 'pending,pending',
        result.tracker.states.slice(14, 16).join(','));
    check('the far verse is not revealed', result.tracker.states.slice(16, 19).join(',') === 'pending,pending,pending',
        result.tracker.states.slice(16, 19).join(','));
    check('cursor parked at the gap', result.tracker.cursor === 14, String(result.tracker.cursor));
    check('not complete', result.tracker.done === false);
}

section('repeated wrong attempts stay put');
{
    // The user is stuck on a word and tries it several times: every attempt
    // is shown as feedback but the cursor must not creep forward, and
    // reciting on may not drag it ahead either.
    const tracker = core.createTracker(core.buildItems(SKIP_VERSE));
    tracker.finalize('قل هو الله احد');    // commits verse 1, cursor at 'الله'
    ['جبل', 'حجر'].forEach(function (t) { tracker.finalize(t); });
    check('still at the stuck word', tracker.cursor === 4, String(tracker.cursor));
    check('attempts committed nothing', tracker.states.slice(4).every(function (s) { return s === 'pending'; }),
        statesOf(tracker));
    const rush = tracker.finalize('الصمد لم يلد');
    check('reciting on past it is refused', tracker.states.slice(4).every(function (s) { return s === 'pending'; }),
        statesOf(tracker));
    check('hold feedback surfaced', opsOf(rush, 'hold').length === 1, JSON.stringify(rush));
    tracker.finalize('الله الصمد لم يلد ولم يولد');
    check('finishing it correctly moves on', tracker.done === true, statesOf(tracker));
}

section('repeated word elsewhere (An-Nas anchor)');
{
    // An-Nas ends four verses on «الناس». A lone «الناس» at the CURRENT word
    // used to align to the EARLIEST identical word (verse 1, already accepted)
    // and be dismissed as a repeat — the word under the caret never committed.
    const NAS = [
        { s: 114, a: 1, text: 'قُلْ أَعُوذُ بِرَبِّ ٱلنَّاسِ' },
        { s: 114, a: 2, text: 'مَلِكِ ٱلنَّاسِ' },
        { s: 114, a: 3, text: 'إِلَٰهِ ٱلنَّاسِ' }
    ];
    const tracker = core.createTracker(core.buildItems(NAS));
    tracker.finalize('قل اعوذ برب الناس');
    check('verse 1 commits', tracker.states.slice(0, 4).join(',') === 'ok,ok,ok,ok', statesOf(tracker));
    tracker.finalize('ملك');
    check('ملك commits', tracker.states[4] === 'ok', statesOf(tracker));
    const ops = tracker.finalize('الناس');
    check('lone repeated word accepted at the cursor', tracker.states[5] === 'ok', statesOf(tracker));
    check('not dismissed as a mere repeat', opsOf(ops, 'repeat').length === 0, JSON.stringify(ops));
    check('cursor moves past verse 2', tracker.cursor === 6, String(tracker.cursor));
    tracker.finalize('اله');                   // verse 3 begins
    check('إله commits', tracker.states[6] === 'ok', statesOf(tracker));
    tracker.finalize('الناس');                 // verse 3 repeats الناس once more
    check('the next repetition also lands correctly', tracker.states[7] === 'ok', statesOf(tracker));
    check('cursor at the end of the range', tracker.cursor === 8, String(tracker.cursor));
}
{
    // the two-word chunk must keep working as before
    const NAS = [
        { s: 114, a: 1, text: 'قُلْ أَعُوذُ بِرَبِّ ٱلنَّاسِ' },
        { s: 114, a: 2, text: 'مَلِكِ ٱلنَّاسِ' },
        { s: 114, a: 3, text: 'إِلَٰهِ ٱلنَّاسِ' }
    ];
    const tracker = core.createTracker(core.buildItems(NAS));
    tracker.finalize('قل اعوذ برب الناس');
    tracker.finalize('ملك الناس');
    check('verse 2 commits from a two-word chunk', tracker.states.slice(4, 6).join(',') === 'ok,ok', statesOf(tracker));
}

section('restart backwards (search reset)');
{
    const feed = ['قد افلح', 'المؤمنون الله', 'الصمد لم', 'يلد ولم', 'يولد ولم', 'يكن له', 'كفوا احد'];
    const chunks = feed.concat(['قد افلح المؤمنون']);
    const result = runTracker(core.buildItems(SIX_VERSES), chunks, { fwd: 2, back: 4 });
    check('reset op from 0', opsOf(result.ops, 'reset').some(function (op) { return op.from === 0; }));
    check('first verse ok again', result.tracker.states.slice(0, 3).join(',') === 'ok,ok,ok',
        result.tracker.states.slice(0, 3).join(','));
    check('later words pending again', result.tracker.states.slice(3, 14).every(function (state) {
        return state === 'pending' || state === 'meta';
    }));
    check('cursor back at word 4', result.tracker.cursor === 3, String(result.tracker.cursor));
    check('not complete', result.tracker.done === false);
}

section('noise (extra words)');
{
    const result = runTracker(core.buildItems(FATIHA2), ['الحمد هنا لله رب العالمين']);
    const extras = opsOf(result.ops, 'extra');
    check('extra reported', extras.length === 1 && extras[0].heard === 'هنا', JSON.stringify(extras));
    check('no false errors', result.tracker.stats.subs === 0 && result.tracker.stats.misses === 0);
    check('all expected words ok', statesOf(result.tracker) === 'ok,ok,ok,ok', statesOf(result.tracker));
}

section('muqatta\'at is a soft skip');
{
    const items = core.buildItems([
        { s: 2, a: 1, text: 'الٓمٓ' },
        { s: 2, a: 2, text: 'ذَٰلِكَ ٱلْكِتَـٰبُ' }
    ]);
    const result = runTracker(items, ['ذلك الكتاب']);
    check('soft op, not miss', opsOf(result.ops, 'soft').map(function (op) { return op.i; }).join(',') === '0');
    check('no miss ops', opsOf(result.ops, 'miss').length === 0);
    check('soft word auto-accepted', result.tracker.states[0] === 'ok');
    check('complete fired', opsOf(result.ops, 'complete').length === 1);
}

section('waqf marks never receive ops');
{
    const items = core.buildItems([{ s: 2, a: 2, text: 'ذَٰلِكَ ٱلْكِتَـٰبُ لَا رَيْبَ ۛ فِيهِ ۛ هُدًى' }]);
    const result = runTracker(items, ['ذلك الكتاب لا ريب فيه هدي']);
    const touchedMeta = result.ops.some(function (op) {
        return op.i !== undefined && items[op.i] && items[op.i].meta;
    });
    check('no op touches a meta word', touchedMeta === false);
    check('meta states untouched', items.every(function (item, i) {
        return !item.meta || result.tracker.states[i] === 'meta';
    }));
    check('verse complete', result.tracker.done === true);
}

section('gibberish is ignored (no false errors)');
{
    const result = runTracker(core.buildItems(FATIHA2), ['مرحبا بالعالم', 'كلام غير مفهوم', 'شيء آخر تماما']);
    check('lowconf ops surfaced', opsOf(result.ops, 'lowconf').length >= 1);
    check('no state committed', result.tracker.states.every(function (state) { return state === 'pending'; }),
        statesOf(result.tracker));
    check('no sub/miss ops', opsOf(result.ops, 'sub').length === 0 && opsOf(result.ops, 'miss').length === 0);
}

section('hallucinated endings must not skip ahead');
{
    // Whisper regularly invents a rhyme ending ("الرحيم") from noise or a
    // cut-off fragment. It used to match the LAST word of the passage,
    // mark the three words before it as missed and jump to the very end.
    const tracker = core.createTracker(core.buildItems([{ s: 0, a: 0, text: 'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ' }]));
    const ops = tracker.finalize(['الرحيم']);
    check('single hallucinated word stays put', opsOf(ops, 'skip').length === 0 && opsOf(ops, 'miss').length === 0,
        JSON.stringify(ops));
    check('no word committed', tracker.states.join(',') === 'pending,pending,pending,pending', statesOf(tracker));
    check('cursor unmoved', tracker.cursor === 0, String(tracker.cursor));
    check('lowconf reported', opsOf(ops, 'lowconf').length === 1, JSON.stringify(ops));
}
{
    // "قُلْ هُوَانٌ" — the recognizer's garbled reading of a short "قل هو"
    // fragment ("هوان" loosely resembles "هو" at score 0.5). That weak pair
    // used to commit, mark "قل" as missed and move the cursor past both.
    const tracker = core.createTracker(core.buildItems([{ s: 0, a: 0, text: 'قُلْ هُوَ ٱللَّهُ أَحَدٌ' }]));
    const ops = tracker.finalize(['هوان']);
    check('weak soundalike is treated as noise', opsOf(ops, 'ok').length === 0
        && opsOf(ops, 'weak').length === 0 && opsOf(ops, 'miss').length === 0, JSON.stringify(ops));
    check('nothing committed', tracker.states.join(',') === 'pending,pending,pending,pending', statesOf(tracker));
    check('cursor unmoved', tracker.cursor === 0, String(tracker.cursor));
}
{
    // Even a solidly-recited chunk from later in the passage cannot jump
    // the cursor: the marked word comes first (miss + hold feedback).
    const items = core.buildItems([{ s: 0, a: 0, text: 'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ' }]);
    const tracker = core.createTracker(items);
    const ops = tracker.finalize(['الحمد لله رب العالمين']);
    check('nothing revealed beyond the current word',
        tracker.states.every(function (s) { return s === 'pending'; }), statesOf(tracker));
    check('cursor unmoved', tracker.cursor === 0, String(tracker.cursor));
    check('current word flagged as not heard',
        opsOf(ops, 'miss').map(function (op) { return op.i; }).join(',') === '0', JSON.stringify(opsOf(ops, 'miss')));
    check('hold feedback surfaced', opsOf(ops, 'hold').length === 1, JSON.stringify(ops));
}

section('ending confusion settles the word with a note (Al-Asr 103:3)');
{
    const items = core.buildItems([{ s: 103, a: 3, text: 'وَعَمِلُوا۟ ٱلصَّـٰلِحَـٰتِ وَتَوَاصَوْا۟ بِٱلْحَقِّ' }]);
    check('the Uthmani word normalizes to الصالحات', items[1].norm === 'الصالحات', items[1].norm);
    const tracker = core.createTracker(items);
    tracker.finalize('وعملوا');
    const ops = tracker.finalize('الصالحين');
    check('«الصالحين» heard for «الصالحات» still settles the word', tracker.states[1] === 'ok', statesOf(tracker));
    const notes = opsOf(ops, 'ending');
    check('with an ending note naming the heard form',
        notes.length === 1 && notes[0].i === 1 && notes[0].heard === 'الصالحين', JSON.stringify(ops));
    check('and the recitation continues', tracker.cursor === 2, String(tracker.cursor));
}
{
    const items = core.buildItems([{ s: 103, a: 3, text: 'ٱلصَّـٰلِحَـٰتِ' }]);
    const tracker = core.createTracker(items);
    const ops = tracker.finalize('صالحه');
    check('a lone retry «صالحه» settles too', tracker.states[0] === 'ok', statesOf(tracker) + ' ' + JSON.stringify(ops));
    check('note names the heard form', opsOf(ops, 'ending')[0] && opsOf(ops, 'ending')[0].heard === 'صالحه',
        JSON.stringify(ops));
}
{
    const items = core.buildItems([{ s: 103, a: 3, text: 'ٱلصَّـٰلِحَـٰتِ' }]);
    const tracker = core.createTracker(items);
    const ops = tracker.finalize('طالحة');
    check('gibberish «طالحة» never settles', tracker.states[0] === 'pending', statesOf(tracker));
    check('and raises no ending note', opsOf(ops, 'ending').length === 0, JSON.stringify(ops));
}

section('a different word is a mistake, never a match (أنقمت، مالكم)');
{
    const items = core.buildItems([{ s: 1, a: 7, text: 'صِرَٰطَ ٱلَّذِينَ أَنْعَمْتَ عَلَيْهِمْ' }]);
    const tracker = core.createTracker(items);
    const ops = tracker.finalize('صراط الذين انقمت');
    check('the two good words settle', tracker.states.slice(0, 2).join(',') === 'ok,ok', statesOf(tracker));
    check('«أنعمت» is not revealed by «انقمت»', tracker.states[2] === 'pending'
        && !opsOf(ops, 'ok').some(function (op) { return op.i === 2; }), JSON.stringify(ops));
    check('cursor waits at «أنعمت»', tracker.cursor === 2, String(tracker.cursor));

    const tracker2 = core.createTracker(items);
    const ops2 = tracker2.finalize('صراط الذين انقمت عليهم');
    const subs = opsOf(ops2, 'sub');
    check('a substitution lands on «أنعمت» with the heard word',
        subs.length === 1 && subs[0].i === 2 && subs[0].heard === 'انقمت', JSON.stringify(subs));
    check('and the word is not revealed', tracker2.states[2] === 'pending', statesOf(tracker2));

    const again = tracker.finalize('انعمت عليهم');
    check('saying it correctly settles it', tracker.states.slice(2, 4).join(',') === 'ok,ok', statesOf(tracker));
}
{
    const items = core.buildItems([{ s: 1, a: 4, text: 'مَـٰلِكِ يَوْمِ ٱلدِّينِ' }]);
    const tracker = core.createTracker(items);
    const ops = tracker.finalize('مالكم يوم الدين');
    const subs = opsOf(ops, 'sub');
    check('«مالكم» is a substitution at «مالك»', subs.length === 1 && subs[0].i === 0
        && subs[0].heard === 'مالكم', JSON.stringify(subs));
    check('«مالك» stays unrevealed', tracker.states[0] === 'pending', statesOf(tracker));

    // the approved alef convention keeps working: «ملك» still settles «مالك»
    const tracker2 = core.createTracker(items);
    tracker2.finalize('ملك يوم الدين');
    check('«ملك» still settles «مالك» (alef convention)', tracker2.states[0] === 'ok', statesOf(tracker2));
}

/* -------------------------------------------------------------------------- */

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed === 0 ? 0 : 1;
