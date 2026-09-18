/* phoneme-check.js — compares phoneme-model units with the canonical Quran
 * phoneme tables (QuranText/QuranPhonemes/, built by tools/build-quran-phonemes.py).
 *
 * window.QuranPhonemeCheck = {
 *   canonFor(sura, aya) -> Promise<{clusters, lens, bismillah}|null>,
 *   buildSequence(entries) -> {clusters, refs},     entries: [{s, a, canon}]
 *   analyzeSequence(sequence, heardUnits) -> {flags, stats}|null,
 *   unitInfo(piece), alignUnits(clusters, heard), MARK_KINDS
 * }
 *
 * A flag is {ref:{s,a,wi}, notes:[{kind, expected, heard, margin?}]} where
 * kind is one of letter | letterNear | vowel | shadda | maddShort | maddLong |
 * qlqla | confidence | missing. Only letter/missing block; letterNear (a
 * same-family letter confusion) and confidence (a low-margin blur) settle
 * with a visible note. MARK_KINDS lists the kinds worth showing as a word
 * note (madd lengths are reciter-dependent and stay informatory).
 *
 * Per-word stats (analyzeSequence) carry lenNear: near-pairs that differ ONLY
 * in a repeated-letter run length (a madd/ghunna hold — the model's one
 * unreliable dimension). Callers may credit them as half-evidence when
 * deciding whether the word's letters were truly said.
 */
(function () {
    'use strict';

    var SCRIPT_SRC = (document.currentScript && document.currentScript.src) || location.href;
    var CANON_BASE = new URL('../QuranText/QuranPhonemes/', SCRIPT_SRC).href;

    var HARAKA = 'َُِ';
    var LETTER_ALIAS = { 'ں': 'ن', '۾': 'م', 'ۥ': 'و', 'ۦ': 'ي' };
    var MADD_LETTERS = { 'ا': true, 'و': true, 'ي': true };
    var GAP = 4;
    var MIN_ALIGNED = 3;
    /* The model's known letter confusions live inside phonetic families
       (ض↔ظ، ص↔س، ذ↔ز، ط↔ت، ك↔ق، ح↔ه/خ/غ، ع↔ء). A same-family substitution
       becomes a NON-blocking «حرف متقارب» note that still settles the word —
       mis-hearing within a family is the single most common false block.
       A different letter outside its family stays a blocking mistake. */
    var LETTER_FAMILIES = [['ص', 'س', 'ث'], ['ض', 'ظ'], ['ذ', 'ز'], ['ط', 'ت'], ['ك', 'ق'], ['ح', 'ه', 'خ', 'غ'], ['ع', 'ء']];
    var FAMILY_OF = {};
    LETTER_FAMILIES.forEach(function (fam) {
        fam.forEach(function (letter) {
            FAMILY_OF[letter] = fam;
        });
    });
    function sameFamily(a, b) {
        var fam = FAMILY_OF[a];
        return Boolean(fam) && fam.indexOf(b) >= 0;
    }
    /* Below this peak-margin the model was not sure what it heard: a letter
       difference is a blur (confidence note), not a mistake. Calibrated
       against real recitations (see the phoneme trail's margin stats). */
    var LETTER_MARGIN_MIN = 2.0;

    var MARK_KINDS = { letter: true, letterNear: true, vowel: true, shadda: true, missing: true, confidence: true };

    var canonCache = {};

    /** Fetches (once per sura) the canonical table; null when unavailable. */
    function canonLoad(sura) {
        if (!canonCache[sura]) {
            canonCache[sura] = fetch(CANON_BASE + sura + '.json')
                .then(function (response) {
                    if (!response.ok) {
                        throw new Error('HTTP ' + response.status);
                    }
                    return response.json();
                })
                .catch(function () {
                    canonCache[sura] = null;
                    return null;
                });
        }
        return canonCache[sura];
    }

    /** Canonical clusters of one aya: {clusters, lens, bismillah} or null. */
    function canonFor(sura, aya) {
        return canonLoad(sura).then(function (obj) {
            if (!obj) {
                return null;
            }
            if (aya === 0) {
                return obj.b ? { clusters: obj.b.split(' '), lens: null, bismillah: true } : null;
            }
            var entry = obj.a[aya - 1];
            if (!entry) {
                return null;
            }
            return { clusters: entry.c.split(' '), lens: entry.l, bismillah: false };
        });
    }

    /** Splits a cluster into letter / vowel / repeat-count / qlqla. */
    function unitInfo(piece) {
        var text = piece;
        var qlqla = false;
        if (text.indexOf('ڇ') >= 0) {
            qlqla = true;
            text = text.replace(/ڇ/g, '');
        }
        var vowel = '';
        if (text && HARAKA.indexOf(text.charAt(text.length - 1)) >= 0) {
            vowel = text.charAt(text.length - 1);
            text = text.slice(0, -1);
        }
        var letter = '', uniform = true, count = 0, letters = '';
        for (var i = 0; i < text.length; i += 1) {
            var mapped = LETTER_ALIAS[text[i]] || text[i];
            letters += mapped;
            if (count === 0) {
                letter = mapped;
            } else if (mapped !== letter) {
                uniform = false;
            }
            count += 1;
        }
        return { letter: letter, uniform: uniform, count: count, vowel: vowel, qlqla: qlqla, letters: letters };
    }

    /** True when the extra letters are only repeats of the last kept one. */
    function doublingOnly(letters, base) {
        var ext = letters.slice(base.length);
        var last = base.charAt(base.length - 1);
        for (var i = 0; i < ext.length; i += 1) {
            if (ext.charAt(i) !== last) {
                return false;
            }
        }
        return ext.length > 0;
    }

    /** Alignment cost of one canonical cluster against one heard unit. */
    function unitCost(can, heard) {
        var a = unitInfo(can), b = unitInfo(heard);
        if (can === heard) {
            return 0;
        }
        if (a.letter === b.letter && a.uniform && b.uniform && a.count === b.count &&
            a.vowel === b.vowel && a.qlqla === b.qlqla) {
            return 0;   /* same sound, different glyph (ن/ں، و/ۥ…) */
        }
        /* the model often emits a merged cluster («ستَ») where the canonical
           text has two plain consonants («س» + «تَ»): let the first consonant
           absorb it — the following cluster then reads as one small miss
           instead of two noisy substitutions */
        if (a.vowel === '' && a.count > 0 && b.vowel !== '' &&
            b.letters.indexOf(a.letters) === 0 && b.letters.length > a.letters.length &&
            !doublingOnly(b.letters, a.letters)) {
            return 0;
        }
        if (a.letter && a.letter === b.letter && a.uniform && b.uniform) {
            var vowelCost = a.vowel === b.vowel ? 0 : 3;
            var countCost = a.count === b.count ? 0 : 2;
            var qlqlaCost = a.qlqla === b.qlqla ? 0 : 2;
            if (a.count === 0 || b.count === 0) {
                return 6;   /* madd run against a plain consonant */
            }
            return vowelCost + countCost + qlqlaCost || 2;
        }
        return 6;
    }

    /** Alignment cost used by the DP. A pair differing ONLY in a run length
     * (same letter, vowel and qlqla — a madd/ghunna hold the model cannot
     * grade) costs 0 here so the aligner keeps the LOCAL pairing: with the
     * raw unitCost (2) the DP abandoned «للَ»↔«لَ» and stole an exact «لَ»
     * much later, leaving the word's own clusters as phantom «missing»
     * notes («إِلَّا» heard as «ءِ لَ اا» split into 2 fake misses). The
     * untranscripted cost is still used for classification, so the pair
     * yields a length note — never a blocking miss. */
    function alignCost(can, heard) {
        var cost = unitCost(can, heard);
        if (cost === 2) {
            var a = unitInfo(can), b = unitInfo(heard);
            if (a.letter === b.letter && a.uniform && b.uniform &&
                a.vowel === b.vowel && a.qlqla === b.qlqla &&
                a.count !== b.count && a.count > 0 && b.count > 0) {
                return 0;
            }
        }
        return cost;
    }

    /** Needleman-Wunsch alignment; returns ops {type, c?, h?}.
     * Semi-global: leading and trailing HEARD units are free — the buffer
     * may open with stale fragments of earlier attempts and end with the
     * start of a new one; the aligner finds the cheapest window for the
     * canonical sequence inside it (which is also what makes repeated
     * attempts harmless instead of poisoning every later alignment).
     * Cell values are composite (cost * 1e6 + position weight) so that
     * equal-cost alignments prefer attributing sounds to the EARLIEST
     * position — otherwise a tail sounding like the next aya's tail is
     * misattributed (verified on 1:4 «…دِّينِ» vs 1:5 «…نَسْتَعِينُ»). */
    function alignUnits(clusters, heard) {
        var n = clusters.length, m = heard.length;
        var W = 1e6;
        var rows = [];
        for (var i = 0; i <= n; i += 1) {
            rows.push(new Float64Array(m + 1));
        }
        for (var j = 1; j <= m; j += 1) {
            rows[0][j] = 0;   /* free leading heard skip */
        }
        for (i = 1; i <= n; i += 1) {
            rows[i][0] = rows[i - 1][0] + GAP * W;
            for (j = 1; j <= m; j += 1) {
                var sub = rows[i - 1][j - 1] + alignCost(clusters[i - 1], heard[j - 1]) * W + i;
                var del = rows[i - 1][j] + GAP * W;
                var ins = rows[i][j - 1] + GAP * W;
                rows[i][j] = Math.min(sub, del, ins);
            }
        }
        var ops = [];
        /* best end position — trailing heard units are free too (the buffer
           may continue with the reciter's next attempt) */
        var endJ = 0;
        for (var e = 1; e <= m; e += 1) {
            if (rows[n][e] < rows[n][endJ]) {
                endJ = e;
            }
        }
        i = n; j = endJ;
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0) {
                var cost = alignCost(clusters[i - 1], heard[j - 1]);
                if (rows[i][j] === rows[i - 1][j - 1] + cost * W + i) {
                    var real = unitCost(clusters[i - 1], heard[j - 1]);
                    ops.push({
                        type: real === 0 ? 'match' : (real <= 3 ? 'near' : 'bad'),
                        c: i - 1,
                        h: j - 1
                    });
                    i -= 1;
                    j -= 1;
                    continue;
                }
            }
            if (i > 0 && rows[i][j] === rows[i - 1][j] + GAP * W) {
                ops.push({ type: 'miss', c: i - 1 });
                i -= 1;
                continue;
            }
            if (j > 0 && rows[i][j] === rows[i][j - 1] + GAP * W) {
                ops.push({ type: 'extra', h: j - 1 });
                j -= 1;
                continue;
            }
            if (i > 0) { ops.push({ type: 'miss', c: i - 1 }); i -= 1; } else { ops.push({ type: 'extra', h: j - 1 }); j -= 1; }
        }
        ops.reverse();
        return ops;
    }

    /**
     * Concatenates several aya tables into one sequence.
     * entries: [{s, a, canon, wiOffset?}] in reading order. refs[i] = {s, a, wi}
     * of clusters[i] (wi = 0-based word inside the aya, plus wiOffset when the
     * entry starts mid-aya), or null when the table cannot be attributed
     * (bismillah).
     */
    function buildSequence(entries) {
        var clusters = [];
        var refs = [];
        var ok = true;
        entries.forEach(function (entry) {
            var canon = entry.canon;
            clusters = clusters.concat(canon.clusters);
            if (!canon.lens || !canon.lens.length) {
                ok = false;
                return;
            }
            var sum = 0;
            var offset = entry.wiOffset || 0;
            canon.lens.forEach(function (len, wi) {
                sum += len;
                for (var k = 0; k < len; k += 1) {
                    refs.push({ s: entry.s, a: entry.a, wi: wi + offset });
                }
            });
            if (sum !== canon.clusters.length) {
                ok = false;
            }
        });
        return { clusters: clusters, refs: ok ? refs : null };
    }

    /** Note for one aligned pair (or null when acceptable).
     *  margin (optional) = the model's peak-minus-runner-up confidence for
     *  the heard unit: a low-confidence letter difference is a blur, not a
     *  mistake; a same-family difference is a non-blocking near note. */
    function classifyPair(expected, heard, margin) {
        if (expected === heard) {
            return null;
        }
        if (unitCost(expected, heard) === 0) {
            return null;   /* everything the cost model accepts raises no note */
        }
        var a = unitInfo(expected), b = unitInfo(heard);
        if (a.letter === b.letter && a.uniform && b.uniform && a.count === b.count &&
            a.vowel === b.vowel && a.qlqla === b.qlqla) {
            return null;
        }
        if (!a.letter || !a.uniform || !b.uniform || a.letter !== b.letter) {
            if (margin !== undefined && margin !== null && margin < LETTER_MARGIN_MIN) {
                return { kind: 'confidence', expected: expected, heard: heard, margin: margin };
            }
            return {
                kind: sameFamily(a.letter, b.letter) ? 'letterNear' : 'letter',
                expected: expected,
                heard: heard,
                margin: margin
            };
        }
        if (a.vowel !== b.vowel) {
            return { kind: 'vowel', expected: expected, heard: heard, margin: margin };
        }
        if (a.count !== b.count) {
            if (a.count > b.count && !a.vowel && MADD_LETTERS[a.letter]) {
                return { kind: 'maddShort', expected: expected, heard: heard, margin: margin };
            }
            if (a.count > b.count) {
                return { kind: 'shadda', expected: expected, heard: heard, margin: margin };
            }
            return { kind: 'maddLong', expected: expected, heard: heard, margin: margin };
        }
        if (a.qlqla !== b.qlqla) {
            return { kind: 'qlqla', expected: expected, heard: heard, margin: margin };
        }
        return null;
    }

    /**
     * Aligns heard units with the canonical sequence and groups deviations
     * per word. Leading/trailing regions the utterance did not cover are
     * trimmed; returns null when too little aligned. margins (optional) are
     * the per-unit confidences aligned with heardUnits (they travel with
     * the stream); the '#'-prefixed placeholder units are dropped together
     * with their margins so the indices stay aligned.
     */
    function analyzeSequence(sequence, heardUnits, margins) {
        if (!sequence || !sequence.clusters || !sequence.refs || !sequence.clusters.length) {
            return null;
        }
        var heard = [];
        var hMargins = [];
        (heardUnits || []).forEach(function (unit, unitIndex) {
            if (unit && unit.charAt(0) !== '#') {
                heard.push(unit);
                hMargins.push(margins ? margins[unitIndex] : undefined);
            }
        });
        if (!heard.length) {
            return null;
        }
        var ops = alignUnits(sequence.clusters, heard);
        /* coverage span: only ops that consumed a heard unit; leading and
           trailing misses are the parts of the aya the utterance did not
           cover (already recited / not yet recited) — never flagged */
        var first = -1, last = -1, alignedGood = 0;
        ops.forEach(function (op, index) {
            if (op.c === undefined || op.h === undefined) {
                return;
            }
            if (first < 0) {
                first = index;
            }
            last = index;
            if (op.type === 'match' || op.type === 'near') {
                alignedGood += 1;
            }
        });
        /* frontier guarantee: the alignment may have matched only a LATER
           phrase — leftover audio of an earlier aya in the buffer — and left
           the word under the caret entirely before the span, where its
           sounds are discarded as "not covered" and the word can never
           settle (seen live: «ٱلرَّحِيمِ» unmatchable while the buffer's
           old «لله رب العالمين» stretch kept winning). When the span starts
           beyond the first word's clusters, give that word a focused
           semi-global alignment of its own so what the reciter just said
           still counts. */
        var focusedOk = false;
        if (sequence.refs && sequence.refs[0]) {
            var frontierKey = sequence.refs[0].s + ':' + sequence.refs[0].a + ':' + sequence.refs[0].wi;
            var frontierEnd = 0;
            while (frontierEnd < sequence.refs.length && sequence.refs[frontierEnd] &&
                (sequence.refs[frontierEnd].s + ':' + sequence.refs[frontierEnd].a + ':' + sequence.refs[frontierEnd].wi) === frontierKey) {
                frontierEnd += 1;
            }
            var spanStartCluster = -1;
            for (var sAt = Math.max(0, first); sAt <= last; sAt += 1) {
                if (ops[sAt].c !== undefined) {
                    spanStartCluster = ops[sAt].c;
                    break;
                }
            }
            if (frontierEnd > 0 && (spanStartCluster < 0 || spanStartCluster >= frontierEnd)) {
                var focused = alignUnits(sequence.clusters.slice(0, frontierEnd), heard);
                var fFirst = -1, fLast = -1, fGood = 0;
                focused.forEach(function (op, index) {
                    if (op.c === undefined || op.h === undefined) {
                        return;
                    }
                    if (fFirst < 0) {
                        fFirst = index;
                    }
                    fLast = index;
                    if (op.type === 'match' || op.type === 'near') {
                        fGood += 1;
                    }
                });
                if (fFirst >= 0 && fGood > 0) {
                    ops = focused;
                    first = fFirst;
                    last = fLast;
                    alignedGood = fGood;
                    focusedOk = true;
                    sequence = {
                        clusters: sequence.clusters.slice(0, frontierEnd),
                        refs: sequence.refs.slice(0, frontierEnd)
                    };
                }
            }
        }
        if (first < 0) {
            return null;
        }
        if (!focusedOk && alignedGood < MIN_ALIGNED) {
            return null;
        }
        var keys = {};
        var flags = [];
        var words = {};
        for (var index = first; index <= last; index += 1) {
            var op = ops[index];
            if (op.c === undefined) {
                continue;   /* extra units are ignored for now */
            }
            var ref = sequence.refs[op.c];
            if (!ref) {
                continue;
            }
            var key = ref.s + ':' + ref.a + ':' + ref.wi;
            var stat = words[key] || (words[key] = { ref: ref, seen: 0, total: 0, clean: true, exact: 0, bad: 0, miss: 0, lead: 0, lenNear: 0, famNear: 0 });
            stat.seen += 1;
            stat.firstC = stat.firstC === undefined ? op.c : Math.min(stat.firstC, op.c);
            if (op.type === 'match') {
                stat.exact += 1;
            }
            if (op.h !== undefined) {
                stat.hFrom = stat.hFrom === undefined ? op.h : Math.min(stat.hFrom, op.h);
                stat.hTo = stat.hTo === undefined ? op.h : Math.max(stat.hTo, op.h);
            }
            var note = null;
            if (op.type === 'miss') {
                note = { kind: 'missing', expected: sequence.clusters[op.c], heard: null };
            } else if (op.h !== undefined) {
                note = classifyPair(sequence.clusters[op.c], heard[op.h], hMargins[op.h]);
            }
            if (!note) {
                continue;
            }
            /* a pair that differs only in a run length (same letter, vowel and
               qlqla; only the repeat count of a madd/ghunna hold differs) is
               evidence the letter was said — graded lengths are not reliable */
            if (op.type === 'near' && (note.kind === 'shadda' || note.kind === 'maddShort' || note.kind === 'maddLong')) {
                stat.lenNear += 1;
            }
            /* a same-family letter near-miss is HALF evidence the letter was
               said: single-cluster words like «ضَ» heard «ظَ» settle with a
               «حرف متقارب» note instead of freezing the cursor */
            if (note.kind === 'letterNear') {
                stat.famNear += 1;
            }
            if (note.kind === 'letter' || note.kind === 'missing') {
                stat.clean = false;
                if (note.kind === 'letter') {
                    stat.bad += 1;
                } else {
                    stat.miss += 1;
                }
            }
            var flag = keys[key];
            if (!flag) {
                flag = { ref: ref, notes: [] };
                keys[key] = flag;
                flags.push(flag);
            }
            flag.notes.push(note);
        }
        /* full cluster count per referenced word (across the whole sequence).
           Clusters that sit BEFORE the word's own first matched unit are the
           model clipping the word's onset (recitation start, breath after a
           pause): count them as small misses (lead) so the word can still
           settle once the rest matches — trailing gaps still mean "the
           utterance ended before this word". */
        sequence.refs.forEach(function (ref, clusterIndex) {
            if (!ref) {
                return;
            }
            var stat = words[ref.s + ':' + ref.a + ':' + ref.wi];
            if (!stat) {
                return;
            }
            stat.total += 1;
            if (stat.firstC !== undefined && clusterIndex < stat.firstC) {
                stat.lead += 1;
                stat.miss += 1;
                stat.clean = false;
            }
        });
        var wordList = Object.keys(words).map(function (key) {
            var stat = words[key];
            return {
                ref: stat.ref,
                total: stat.total,
                seen: stat.seen,
                clean: stat.clean,
                exact: stat.exact,
                bad: stat.bad,
                miss: stat.miss,
                lead: stat.lead,
                lenNear: stat.lenNear,
                famNear: stat.famNear,
                hFrom: stat.hFrom,
                hTo: stat.hTo
            };
        });
        return {
            flags: flags,
            words: wordList,
            stats: {
                clusters: sequence.clusters.length,
                heard: heard.length,
                aligned: alignedGood,
                flagged: flags.length
            }
        };
    }

    function clearCache() {
        canonCache = {};
    }

    window.QuranPhonemeCheck = {
        canonFor: canonFor,
        canonBismillah: function (sura) {
            return canonLoad(sura).then(function (obj) {
                return obj && obj.b ? obj.b : null;
            });
        },
        buildSequence: buildSequence,
        analyzeSequence: analyzeSequence,
        classifyPair: classifyPair,
        unitInfo: unitInfo,
        unitCost: unitCost,
        alignUnits: alignUnits,
        alignCost: alignCost,
        clearCache: clearCache,
        MARK_KINDS: MARK_KINDS,
        CANON_BASE: CANON_BASE
    };
})();
