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
check("normalizeToken('ٱلْعَـٰلَمِينَ')", core.normalizeToken('ٱلْعَـٰلَمِينَ') === 'العلمين', core.normalizeToken('ٱلْعَـٰلَمِينَ'));
check("normalizeToken('ذَٰلِكَ')", core.normalizeToken('ذَٰلِكَ') === 'ذلك', core.normalizeToken('ذَٰلِكَ'));
check("normalizeToken('ٱلرَّحْمَـٰنِ')", core.normalizeToken('ٱلرَّحْمَـٰنِ') === 'الرحمن', core.normalizeToken('ٱلرَّحْمَـٰنِ'));
check("normalizeToken('مُوسَىٰ')", core.normalizeToken('مُوسَىٰ') === 'موسي', core.normalizeToken('مُوسَىٰ'));
check("standalone waqf mark → ''", core.normalizeToken('ۛ') === '' && core.normalizeToken('ۖ') === '');
check('sajda mark and small letters stripped', core.normalizeToken('لَّهُۥ') === 'له', core.normalizeToken('لَّهُۥ'));
check("tokenize splits and drops marks", JSON.stringify(core.tokenize('لَا رَيْبَ ۛ فِيهِ')) === JSON.stringify(['لا', 'ريب', 'فيه']));

section('word scoring');
check("exact = 1", core.wordScore('الله', 'الله') === 1);
check('الرحمن/الرحمان is strong (0.857)', core.wordScore('الرحمن', 'الرحمان') >= core.STRONG_SIM);
check('dagger-alef words still match modern spellings',
    core.wordScore('العلمين', 'العالمين') >= core.STRONG_SIM && core.wordScore('ذلك', 'ذلك') === 1,
    String(core.wordScore('العلمين', 'العالمين')));
check('a lone alef insertion is strong (مالك/ملك، صراط/صرط)',
    core.wordScore('مالك', 'ملك') >= core.STRONG_SIM && core.wordScore('صراط', 'صرط') >= core.STRONG_SIM,
    core.wordScore('مالك', 'ملك') + ', ' + core.wordScore('صراط', 'صرط'));
check('قال/قل stays weak (real words)', core.wordScore('قال', 'قل') < core.STRONG_SIM);
check('المؤمنون vs المجرمون = 0 (real substitution)', core.wordScore('المءمنون', 'المجرمون') === 0);
check('منهم/منكم = 0.75 (weak band)', (function () {
    const score = core.wordScore('منهم', 'منكم');
    return score > 0 && score < core.STRONG_SIM;
})(), String(core.wordScore('منهم', 'منكم')));
check('قال/قل is weak, not strong', (function () {
    const score = core.wordScore('قال', 'قل');
    return score > 0 && score < core.STRONG_SIM;
})(), String(core.wordScore('قال', 'قل')));
check('two-letter words require exactness', core.wordScore('ما', 'من') === 0);
check('levenshtein sanity', core.levenshtein('كتاب', 'كتب') === 1);

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
    === 'ذلك الكتب لا ريب  فيه  هدي', waqfItems.map(function (item) { return item.norm; }).join(' '));
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

section('basmala handling');
{
    const result = runTracker(core.buildItems(SKIP_VERSE), ['بسم الله الرحمن الرحيم قل هو الله احد']);
    check('basmala stripped, verse-1 words committed',
        result.tracker.states.slice(0, 4).join(',') === 'ok,ok,ok,ok',
        result.tracker.states.slice(0, 4).join(','));
    check('cursor after verse 1', result.tracker.cursor === 4, String(result.tracker.cursor));
    check('no spurious extras', result.tracker.stats.extras === 0);

    const withBasmala = core.buildItems([{ s: 1, a: 1, text: 'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ' }]);
    const result2 = runTracker(withBasmala, ['بسم الله الرحمن الرحيم']);
    check('basmala kept when it IS the passage', statesOf(result2.tracker) === 'ok,ok,ok,ok', statesOf(result2.tracker));
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

/* -------------------------------------------------------------------------- */

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed === 0 ? 0 : 1;
