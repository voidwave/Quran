/* ===========================================================================
 * memorize-core.js — pure logic for the "live recitation" assistant.
 *
 * Nothing in this file touches the DOM, the microphone or the network: it
 * turns the expected verse text plus a stream of recognized words into
 * decisions ("this word was recited", "this word is wrong", "the reciter
 * jumped to another verse"). That split keeps the hard part testable from
 * Node (QuranHifz/tools/test-memorize-core.mjs) without a browser.
 *
 * The approach follows Tarteel-style recitation trackers: never try to align
 * raw audio; normalize both sides to diacritic-free Arabic words, score word
 * pairs with the Levenshtein distance, and align the heard sequence to the
 * expected sequence with a modified Needleman-Wunsch pass. Because the text
 * is known in advance, small recognition errors are tolerable — the aligner
 * only has to locate progress, not transcribe perfectly.
 *
 * Loaded as a classic script in the page (window.QuranMemorizeCore) and as a
 * CommonJS module in tests (module.exports).
 * =========================================================================== */

(function (root, factory) {
    'use strict';
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.QuranMemorizeCore = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* -----------------------------------------------------------------------
     * Arabic normalization
     * -------------------------------------------------------------------- */

    /* A word that scores at or above this is a confident match ("ok"); a
     * lower positive score is a match we reveal but mark as uncertain. */
    const STRONG_SIM = 0.8;

    /* Disjointed letters (muqatta'at) that open 29 surahs. They are never
     * pronounced as a normal word, so missing one is not a mistake. */
    const MUQATTAAT = new Set([
        'الم', 'المص', 'الر', 'المر', 'كهيعص', 'طه', 'طس', 'طسم',
        'يس', 'ص', 'حم', 'عسق', 'حمعسق', 'ق', 'ن'
    ]);

    /* Phrases a reciter commonly says although they are not part of the
     * selected passage (the start-of-recitation basmala / isti'adha). */
    const IGNORE_PHRASES = [
        ['بسم', 'الله', 'الرحمان', 'الرحيم'],
        ['بسم', 'الله', 'الرحمن', 'الرحيم'],
        ['اعوذ', 'بالله', 'من', 'الشيطان', 'الرجيم']
    ];

    /* The short-vowel marks the pronunciation check compares. */
    const VOWEL_MARKS = new Set(['\u064E', '\u064F', '\u0650', '\u0652']);

    /**
     * The sequence of short-vowel marks a word is written with (fatha, damma,
     * kasra, sukun). Two recitations of the same word with different vowels
     * ("أَنْعَمْتَ" vs "أَنْعَمْتُ") keep the same letters but differ here —
     * this is the hook the pronunciation check hangs on. Words without marks
     * (coarse transcripts) return '' and are simply not judged.
     */
    function vowelSignature(rawWord) {
        if (!rawWord) {
            return '';
        }
        let signature = '';
        const text = String(rawWord);
        for (let i = 0; i < text.length; i += 1) {
            const ch = text.charAt(i);
            if (VOWEL_MARKS.has(ch)) {
                signature += ch;
            }
        }
        return signature;
    }

    /**
     * Folds one written word to the comparison form: no diacritics, no
     * Quranic annotation marks, no tatweel, uniform alef/hamza/ta-marbuta
     * spellings. Returns '' when the word was nothing but marks (a waqf
     * sign standing on its own, etc.).
     */
    function normalizeToken(text) {
        if (!text) {
            return '';
        }
        let word = String(text);

        // Standalone ligatures worth expanding (ASR engines occasionally
        // emit them); the honorific ligatures carry no recitable letters.
        word = word.replace(/\uFDFD/g, ' بسم الله الرحمن الرحيم ');
        word = word.replace(/\uFDF2/g, ' الله ');
        word = word.replace(/[\uFDFA\uFDFB]/g, ' ');

        // Diacritics, the dagger (superscript) alef, tatweel, Quranic
        // annotation marks and honorific marks all go. Modern spellings —
        // what recognizers write — either keep the long vowel as ا
        // ("العالمين" vs "العلمين": one letter, still a strong match) or
        // drop it entirely ("ذلك", "الرحمن").
        word = word.replace(/[\u0640\u0670\u064B-\u065F\u0610-\u061A\u06D6-\u06ED]/g, '');

        // Uniform letter shapes.
        word = word.replace(/[\u0622\u0623\u0625\u0671-\u0673\u0675]/g, 'ا');
        word = word.replace(/[\u0626\u0624]/g, 'ء');
        word = word.replace(/\u0629/g, 'ه');
        word = word.replace(/\u0649/g, 'ي');

        // Everything that is not a letter or a space goes (punctuation,
        // digits, joiners, leftover symbols).
        word = word.replace(/[^\p{L}\s]/gu, '');
        word = word.replace(/\s+/g, ' ').trim().toLowerCase();

        return word;
    }

    /** Splits raw text on whitespace (keeps empty results out). */
    function splitWords(text) {
        return String(text || '').split(/\s+/).filter(Boolean);
    }

    /** Normalizes a whole string and returns its non-empty tokens. */
    function tokenize(text) {
        return normalizeToken(text).split(' ').filter(Boolean);
    }

    /**
     * Like flattenTokens, but keeps the vowel signature of every raw word so
     * the tracker can compare pronunciation (see vowelSignature).
     */
    function flattenTokenParts(input) {
        const parts = [];
        (Array.isArray(input) ? input : [input]).forEach(function (piece) {
            splitWords(piece).forEach(function (rawWord) {
                const norm = normalizeToken(rawWord);
                if (!norm) {
                    return;
                }
                const words = norm.split(' ');
                words.forEach(function (word, k) {
                    parts.push({ norm: word, sig: k === 0 ? vowelSignature(rawWord) : '' });
                });
            });
        });
        return parts;
    }

    /**
     * Normalizes a list of raw pieces (a transcript, a phrase, already-split
     * words) and flattens everything into one list of comparison words.
     */
    function flattenTokens(input) {
        return flattenTokenParts(input).map(function (part) { return part.norm; });
    }

    /**
     * Builds the tracker's word list from the expected verses.
     *
     * `verses` is [{ s, a, text }] in reading order. Each returned item is
     * one rendered word:
     *   { s, a, wi, raw, norm, meta, soft, wbw }
     * - wi   : 0-based word index inside its verse (rendering lookups)
     * - raw  : the word exactly as written (with diacritics)
     * - norm : normalized comparison form ('' → meta)
     * - meta : true for standalone signs (waqf marks) that are rendered but
     *          never matched
     * - soft : true for muqatta'at, whose omission is not a mistake
     * - wbw  : 1-based word number for the word-audio files of quran.com
     *          (counts only recitable words), 0 for meta
     */
    function buildItems(verses) {
        const items = [];
        verses.forEach(function (verse) {
            const raw = splitWords(verse.text);
            let ordinal = 0;
            raw.forEach(function (word, wi) {
                const norm = normalizeToken(word);
                const meta = norm === '';
                if (!meta) {
                    ordinal += 1;
                }
                items.push({
                    s: verse.s,
                    a: verse.a,
                    wi: wi,
                    raw: word,
                    norm: norm,
                    sig: vowelSignature(word),
                    meta: meta,
                    soft: !meta && wi === 0 && MUQATTAAT.has(norm),
                    wbw: meta ? 0 : ordinal
                });
            });
        });
        return items;
    }

    /* -----------------------------------------------------------------------
     * Scoring
     * -------------------------------------------------------------------- */

    /** Classic Levenshtein edit distance with two rolling rows. */
    function levenshtein(a, b) {
        if (a === b) {
            return 0;
        }
        if (!a.length) {
            return b.length;
        }
        if (!b.length) {
            return a.length;
        }
        let prev = new Array(b.length + 1);
        let next = new Array(b.length + 1);
        for (let j = 0; j <= b.length; j += 1) {
            prev[j] = j;
        }
        for (let i = 1; i <= a.length; i += 1) {
            next[0] = i;
            const ca = a.charCodeAt(i - 1);
            for (let j = 1; j <= b.length; j += 1) {
                const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
                next[j] = Math.min(
                    prev[j] + 1,        // delete from a
                    next[j - 1] + 1,    // insert into a
                    prev[j - 1] + cost  // substitute
                );
            }
            const swap = prev;
            prev = next;
            next = swap;
        }
        return prev[b.length];
    }

    /**
     * Scores how well a heard word matches an expected word, 0..1.
     * 0 means "not the same word". The edit budget grows with word length so
     * that short words must be almost exact while long words tolerate the
     * one-or-two letter noise a recognizer adds ("الرحمان"/"الرحمن").
     */
    function wordScore(heard, expected) {
        if (!heard || !expected) {
            return 0;
        }
        if (heard === expected) {
            return 1;
        }
        const longest = Math.max(heard.length, expected.length);
        const distance = levenshtein(heard, expected);
        const budget = longest <= 2 ? 0 : (longest <= 8 ? 1 : 2);
        if (distance > budget) {
            return 0;
        }
        const score = 1 - distance / longest;

        // A lone Alef inserted or dropped is a spelling convention — the
        // Uthmani print keeps the long vowel as a dagger mark ("مَـٰلِكِ",
        // "صِرَٰطَ") while recognizers write it as ا. Not a word difference…
        if (score < STRONG_SIM && distance === 1 && Math.abs(heard.length - expected.length) === 1) {
            const longer = heard.length > expected.length ? heard : expected;
            const shorter = heard.length > expected.length ? expected : heard;
            // …but only from three letters up: "قال"/"قل" are real words.
            if (shorter.length >= 3) {
                for (let i = 0; i < longer.length; i += 1) {
                    if (longer.charAt(i) === 'ا' && longer.slice(0, i) + longer.slice(i + 1) === shorter) {
                        return 0.86;
                    }
                }
            }
        }

        return score;
    }

    /* -----------------------------------------------------------------------
     * Needleman-Wunsch word alignment
     * -------------------------------------------------------------------- */

    const MATCH_BASE = 1; // a positive word score contributes 1 + sim
    const GAP_COST = -0.6; // skipping a word on either side

    /**
     * Aligns the heard words to expected items in [fromIdx, toIdx).
     *
     * Returns:
     *   pairs  : [{ type:'match'|'substitute'|'extra'|'miss', h?, item?, score? }]
     *            'match'  heard h is expected item (score > 0)
     *            'substitute' heard h was recited where item was expected
     *            'extra'  heard h has no counterpart (noise)
     *            'miss'   item has no counterpart (skipped by the reciter)
     *   confidence : matched heard words / heard words heard
     *   strongCount: matches at or above STRONG_SIM
     *   lastMatched: highest item index that was matched (or -1)
     *   firstMatched: lowest item index that was matched (or -1)
     */
    function alignUtterance(heard, items, fromIdx, toIdx, options) {
        const opts = options || {};
        const from = Math.max(0, fromIdx | 0);
        const to = Math.min(items.length, toIdx | 0);

        // Positions of the matchable (non-meta) items inside the window.
        const positions = [];
        for (let i = from; i < to; i += 1) {
            if (!items[i].meta) {
                positions.push(i);
            }
        }

        const empty = {
            pairs: [], confidence: 0, strongCount: 0,
            lastMatched: -1, firstMatched: -1
        };
        const heardWords = heard.filter(Boolean);
        if (!positions.length || !heardWords.length) {
            return empty;
        }

        const H = heardWords.length;
        const E = positions.length;

        // score[i * (E + 1) + j]; trace[i][j] = 0 diag, 1 up, 2 left.
        const width = E + 1;
        const score = new Float64Array((H + 1) * width);
        const trace = new Uint8Array((H + 1) * width);

        // Leading gaps are real: the reciter may start mid-passage or the
        // chunk may begin after a skipped verse, so the border accumulates
        // gap costs (standard global alignment).
        for (let i = 1; i <= H; i += 1) {
            score[i * width] = GAP_COST * i;
            trace[i * width] = 1;
        }
        for (let j = 1; j <= E; j += 1) {
            score[j] = GAP_COST * j;
            trace[j] = 2;
        }

        for (let i = 1; i <= H; i += 1) {
            const heardWord = heardWords[i - 1];
            for (let j = 1; j <= E; j += 1) {
                const sim = wordScore(heardWord, items[positions[j - 1]].norm);
                // Only real matches travel diagonally. A word said *instead
                // of* another arrives as an adjacent extra+miss pair and is
                // merged into a substitution after the traceback, so noise
                // can never be paired into the text just to save cost.
                const diag = sim > 0
                    ? score[(i - 1) * width + (j - 1)] + MATCH_BASE + sim
                    : -Infinity;
                const up = score[(i - 1) * width + j] + GAP_COST;   // heard word extra
                const left = score[i * width + (j - 1)] + GAP_COST; // expected word skipped

                if (diag >= up && diag >= left) {
                    score[i * width + j] = diag;
                    trace[i * width + j] = 0;
                } else if (up >= left) {
                    score[i * width + j] = up;
                    trace[i * width + j] = 1;
                } else {
                    score[i * width + j] = left;
                    trace[i * width + j] = 2;
                }
            }
        }

        // Traceback.
        const pairs = [];
        let i = H;
        let j = E;
        while (i > 0 || j > 0) {
            const direction = (i > 0 && j > 0) ? trace[i * width + j] : (i > 0 ? 1 : 2);
            if (i > 0 && j > 0 && direction === 0) {
                const itemIdx = positions[j - 1];
                pairs.push({
                    type: 'match',
                    h: i - 1,
                    item: itemIdx,
                    score: wordScore(heardWords[i - 1], items[itemIdx].norm)
                });
                i -= 1;
                j -= 1;
            } else if (i > 0 && (j === 0 || direction === 1)) {
                pairs.push({ type: 'extra', h: i - 1 });
                i -= 1;
            } else {
                pairs.push({ type: 'miss', item: positions[j - 1] });
                j -= 1;
            }
        }
        pairs.reverse();

        // A global alignment consumes every expected word on its path, so
        // whatever follows the last real pairing arrives as pure trailing
        // gaps — those words have simply not been reached yet. Drop them.
        // (Substitutions — "said THIS where THAT was expected" — are merged
        // by the tracker, which knows which words are already settled.)
        while (pairs.length && pairs[pairs.length - 1].type === 'miss') {
            pairs.pop();
        }

        let matchedHeard = 0;
        let strongCount = 0;
        let lastMatched = -1;
        let firstMatched = -1;
        pairs.forEach(function (pair) {
            if (pair.type === 'match') {
                matchedHeard += 1;
                if (pair.score >= STRONG_SIM) {
                    strongCount += 1;
                }
                if (firstMatched === -1 || pair.item < firstMatched) {
                    firstMatched = pair.item;
                }
                if (pair.item > lastMatched) {
                    lastMatched = pair.item;
                }
            }
        });

        return {
            pairs: pairs,
            confidence: matchedHeard / H,
            strongCount: strongCount,
            lastMatched: lastMatched,
            firstMatched: firstMatched
        };
    }

    /* -----------------------------------------------------------------------
     * Ignorable phrases (basmala / isti'adha)
     * -------------------------------------------------------------------- */

    /**
     * True when the expected words begin with this opening phrase (any
     * accepted spelling), i.e. the passage itself starts with it.
     */
    function startsWithPhrase(expectedNorm, phrase) {
        if (expectedNorm.length < phrase.length) {
            return false;
        }
        for (let k = 0; k < phrase.length; k += 1) {
            if (wordScore(expectedNorm[k], phrase[k]) < STRONG_SIM) {
                return false;
            }
        }
        return true;
    }

    /**
     * Removes common opening phrases (basmala / isti'adha) from a heard-token
     * list — but only when the expected text just ahead does not itself begin
     * with one (a passage that starts at surah 1 ayah 1 legitimately expects
     * the basmala). The signatures are spliced in lockstep so indices stay
     * aligned. Returns { words, sigs }.
     */
    function stripIgnorable(heard, sigs, expectedNorm) {
        const tokens = heard.slice();
        const tokenSigs = Array.isArray(sigs) ? sigs.slice() : [];
        const expectsOpening = IGNORE_PHRASES.some(function (phrase) {
            return startsWithPhrase(expectedNorm, phrase);
        });
        if (expectsOpening) {
            return { words: tokens, sigs: tokenSigs };
        }
        IGNORE_PHRASES.forEach(function (phrase) {
            for (let start = tokens.length - phrase.length; start >= 0; start -= 1) {
                let same = true;
                for (let k = 0; k < phrase.length; k += 1) {
                    if (wordScore(tokens[start + k], phrase[k]) < STRONG_SIM) {
                        same = false;
                        break;
                    }
                }
                if (same) {
                    tokens.splice(start, phrase.length);
                    if (tokenSigs.length) {
                        tokenSigs.splice(start, phrase.length);
                    }
                }
            }
        });
        return { words: tokens, sigs: tokenSigs };
    }

    /* -----------------------------------------------------------------------
     * RecitationTracker — the state machine the UI drives
     * -------------------------------------------------------------------- */

    const DEFAULTS = {
        strongSim: STRONG_SIM,
        back: 8,            // how far behind the cursor a repeat may match
        fwd: 60,            // how far ahead of the cursor words may still match
        searchConf: 0.45,   // below this a chunk counts as low-confidence
        searchStrongNeeded: 3, // strong matches required to relocate
        jumpGuard: 2,       // a first match farther than this needs a solid chunk
        minMatchSim: 0.55,  // weaker soundalikes than this are treated as noise
        checkPronunciation: true // compare vowel marks when both sides have them
    };

    /**
     * Tracks one recitation over one flat list of expected words.
     *
     * Word states: 'pending' | 'meta' (rendered, never matched) | 'ok' |
     * 'unclear' (matched weakly or passed over) | 'sub' (wrong word) |
     * 'skip' (user jumped past it) | 'revealed' (manual tap).
     * Every mutating call returns a list of ops for the UI to apply:
     *   { op:'peek',   i, score }   tentative reveal while speech is streamed
     *   { op:'ok',     i, score }   word recited correctly
     *   { op:'weak',   i }          match is real but uncertain
     *   { op:'sub',    i, heard }   a different word was recited here
     *   { op:'miss',   i }          expected word not heard (skipped)
     *   { op:'soft',   i }          muqatta'at passed over — not a mistake
     *   { op:'extra',  heard }      heard noise with no counterpart
     *   { op:'repeat', i }          reciter repeated an earlier word
     *   { op:'fixed',  i }          a previous error was recited correctly
     *   { op:'pronounce', i, expected, heard }  same word, different harakat
     *   { op:'cursor', i }          caret moved
     *   { op:'skip',   from, to }   range jumped over by the reciter
     *   { op:'reset',  from }       states from `from` on are pending again
     *   { op:'relocate', i }        search found the recitation here
     *   { op:'lowconf' }            chunk understood, but nothing matched
     *   { op:'hold' }               chunk matched only text beyond the current word
     *   { op:'complete' }           every matchable word has a verdict
     */
    function createTracker(items, options) {
        const opts = Object.assign({}, DEFAULTS, options || {});

        const states = items.map(function (item) {
            return item.meta ? 'meta' : 'pending';
        });

        const tracker = {
            items: items,
            states: states,
            cursor: firstPendingFrom(0),
            stats: { strong: 0, weak: 0, subs: 0, misses: 0, extras: 0, repeats: 0 },
            done: false,
            _lastMatched: -1
        };

        function firstPendingFrom(index) {
            for (let i = index; i < items.length; i += 1) {
                if (states[i] === 'pending') {
                    return i;
                }
            }
            return items.length;
        }

        function setState(index, state) {
            if (!items[index].meta) {
                states[index] = state;
            }
        }

        function expectedNorm(fromIdx, count) {
            const out = [];
            for (let i = fromIdx; i < items.length && out.length < count; i += 1) {
                if (!items[i].meta) {
                    out.push(items[i].norm);
                }
            }
            return out;
        }

        /**
         * Turns "he said THIS where THAT was expected" into explicit
         * substitutions: an extra spoken word adjoining an expected word that
         * has not been settled yet. Already-committed words are ignored (they
         * are repeats or alignment window artefacts), and runs with more than
         * one extra OR more than one miss stay as plain gaps — a lone garbage
         * word must never fuse with a far-away skipped word and settle it.
         */
        function withSubstitutions(pairs) {
            const fresh = pairs.filter(function (pair) {
                return pair.type !== 'miss'
                    || states[pair.item] === 'pending'
                    || states[pair.item] === 'unclear';
            });
            const merged = [];
            let i = 0;
            while (i < fresh.length) {
                const pair = fresh[i];
                if (pair.type !== 'extra' && pair.type !== 'miss') {
                    merged.push(pair);
                    i += 1;
                    continue;
                }
                let end = i;
                while (end < fresh.length && (fresh[end].type === 'extra' || fresh[end].type === 'miss')) {
                    end += 1;
                }
                const run = fresh.slice(i, end);
                const extras = run.filter(function (p) { return p.type === 'extra'; });
                const misses = run.filter(function (p) { return p.type === 'miss'; });
                if (extras.length === 1 && misses.length === 1) {
                    const extra = extras[0];
                    const extraPos = run.indexOf(extra);
                    // The expected word the spoken one stood for: the one
                    // right after it in the alignment, else the one before.
                    const nextPair = run[extraPos + 1];
                    const target = (nextPair && nextPair.type === 'miss') ? nextPair : run[extraPos - 1];
                    run.forEach(function (runPair) {
                        if (runPair === extra) {
                            return;
                        }
                        if (runPair === target) {
                            merged.push({ type: 'substitute', h: extra.h, item: target.item, score: 0 });
                            return;
                        }
                        merged.push(runPair);
                    });
                } else {
                    run.forEach(function (runPair) { merged.push(runPair); });
                }
                i = end;
            }
            return merged;
        }

        /**
         * Drops weak soundalike matches entirely: below the floor a pair is
         * far more likely to be a hallucinated rhyme (the ASR inventing an
         * ending) than a real reading, and letting one commit would mark
         * everything before it as passed over.
         */
        function pruneWeakMatches(pairs) {
            const floor = opts.minMatchSim === undefined ? 0.55 : opts.minMatchSim;
            return pairs.filter(function (pair) {
                return !(pair.type === 'match' && pair.score < floor);
            });
        }

        function completionOps(ops) {
            if (tracker.done) {
                return ops;
            }
            const remaining = firstPendingFrom(0);
            if (remaining >= items.length) {
                tracker.done = true;
                ops.push({ op: 'complete' });
            }
            return ops;
        }

        /**
         * A quick pass over the still-uncommitted part of the stream: reveal
         * words the recognizer is confident about *tentatively* (the UI shows
         * them dimmed). finalize() has the last word.
         */
        tracker.optimistic = function (rawTokens) {
            const ops = [];
            if (tracker.done) {
                return ops;
            }
            // Interim results arrive cumulatively within one chunk; the
            // caller passes only the words it has not sent yet.
            const tokens = flattenTokens(rawTokens);
            let from = tracker._peekCursor === undefined ? tracker.cursor : tracker._peekCursor;
            tokens.forEach(function (token) {
                for (let i = from; i < items.length && i <= from + 8; i += 1) {
                    if (items[i].meta) {
                        continue;
                    }
                    const score = wordScore(token, items[i].norm);
                    if (score >= opts.strongSim) {
                        if (states[i] === 'pending') {
                            ops.push({ op: 'peek', i: i, score: score });
                        }
                        from = i + 1;
                        tracker._peekCursor = from;
                        return;
                    }
                }
            });
            return ops;
        };

        function advanceCursor(ops) {
            const next = firstPendingFrom(tracker.cursor);
            if (next !== tracker.cursor) {
                tracker.cursor = next;
                ops.push({ op: 'cursor', i: next });
            }
        }

        /**
         * "Stay on the word you are on": a commitment may only happen in an
         * unbroken run that starts at the current word. The first pending
         * word in the alignment that was not matched blocks everything
         * beyond it — later matches are ignored (no auto-skip, no forward
         * jump). A wrong or skipped attempt on the blocking word is shown
         * as feedback but never settled, so that word must be recited
         * correctly before the recitation can move on.
         */
        function clampToChain(pairs, heardWords, ops) {
            const matched = new Set();
            pairs.forEach(function (pair) {
                if (pair.type === 'match') {
                    matched.add(pair.item);
                }
            });
            let limit = tracker.cursor;
            while (limit < items.length) {
                if (states[limit] !== 'pending' || items[limit].soft || matched.has(limit)) {
                    limit += 1;
                    continue;
                }
                break;
            }
            if (limit >= items.length) {
                return pairs;   // the whole run chains — nothing to hold back
            }
            let beyond = false;
            const kept = [];
            pairs.forEach(function (pair) {
                if (pair.type !== 'match' && pair.type !== 'miss' && pair.type !== 'substitute') {
                    kept.push(pair);
                    return;
                }
                if (pair.item < limit) {
                    kept.push(pair);
                    return;
                }
                if (pair.item === limit) {
                    /* the word under the cursor: say what was heard there,
                       but keep it pending — it must be read correctly */
                    if (pair.type === 'substitute') {
                        ops.push({ op: 'sub', i: pair.item, heard: heardWords[pair.h] || '' });
                    } else if (pair.type === 'miss') {
                        ops.push({ op: 'miss', i: pair.item });
                    }
                } else if (pair.type === 'match') {
                    beyond = true;
                }
            });
            if (beyond) {
                /* the reciter ran ahead of the marked word: explain why
                   nothing revealed rather than discarding it silently */
                ops.push({ op: 'hold' });
            }
            return kept;
        }

        function applyPairs(pairs, heardWords, ops, heardSigs) {
            const preCursor = tracker.cursor;
            pairs = clampToChain(pairs, heardWords, ops);
            let committed = false;
            let maxCommitted = tracker._lastMatched;

            pairs.forEach(function (pair) {
                if (pair.type === 'match') {
                    const index = pair.item;
                    const strong = pair.score >= opts.strongSim;
                    if (states[index] === 'ok') {
                        tracker.stats.repeats += 1;
                        ops.push({ op: 'repeat', i: index });
                    } else {
                        // First commit, or an upgrade of an earlier verdict
                        // (an error the reciter has just corrected).
                        ops.push(states[index] === 'pending'
                            ? { op: 'ok', i: index, score: pair.score }
                            : { op: 'fixed', i: index, score: pair.score });
                        setState(index, strong ? 'ok' : 'unclear');
                        if (!strong) {
                            ops.push({ op: 'weak', i: index });
                        }
                        tracker.stats[strong ? 'strong' : 'weak'] += 1;
                        // Same word, different vowels — a pronunciation note.
                        if (opts.checkPronunciation !== false && heardSigs
                            && items[index].sig && heardSigs[pair.h]) {
                            const expectedSig = items[index].sig;
                            const heardSig = heardSigs[pair.h];
                            if (expectedSig !== heardSig && expectedSig.length === heardSig.length) {
                                ops.push({ op: 'pronounce', i: index, expected: expectedSig, heard: heardSig });
                            }
                        }
                    }
                    if (index > tracker._lastMatched) {
                        tracker._lastMatched = index;
                    }
                    maxCommitted = Math.max(maxCommitted, index);
                    /* Only a solid reading lets words be declared "passed
                       over"; a weak soundalike must not advance the text. */
                    if (strong) {
                        committed = true;
                    }
                } else if (pair.type === 'substitute') {
                    const index = pair.item;
                    if (states[index] !== 'pending' && states[index] !== 'unclear') {
                        return; // a settled word is not re-judged
                    }
                    const heard = heardWords[pair.h] || '';
                    ops.push({ op: 'sub', i: index, heard: heard });
                    setState(index, 'sub');
                    tracker.stats.subs += 1;
                    if (index > tracker._lastMatched) {
                        tracker._lastMatched = index;
                    }
                    maxCommitted = Math.max(maxCommitted, index);
                    committed = true;
                } else if (pair.type === 'miss') {
                    const index = pair.item;
                    if (states[index] !== 'pending') {
                        return; // already settled — never downgrade it
                    }
                    ops.push(items[index].soft
                        ? { op: 'soft', i: index }
                        : { op: 'miss', i: index });
                    if (!items[index].soft) {
                        setState(index, 'unclear');
                        tracker.stats.misses += 1;
                    } else {
                        setState(index, 'ok');
                    }
                    maxCommitted = Math.max(maxCommitted, index);
                } else if (pair.type === 'extra') {
                    ops.push({ op: 'extra', heard: heardWords[pair.h] || '' });
                    tracker.stats.extras += 1;
                }
            });

            if (committed && maxCommitted >= preCursor) {
                // Words between the old cursor and the furthest commitment
                // that met no op at all were passed over (the reciter started
                // mid-passage, or the aligner had no reason to report a
                // leading gap).
                for (let i = preCursor; i <= maxCommitted; i += 1) {
                    if (!items[i].meta && states[i] === 'pending') {
                        ops.push(items[i].soft ? { op: 'soft', i: i } : { op: 'miss', i: i });
                        setState(i, items[i].soft ? 'ok' : 'unclear');
                        if (!items[i].soft) {
                            tracker.stats.misses += 1;
                        }
                    }
                }
                tracker.cursor = firstPendingFrom(maxCommitted + 1);
                ops.push({ op: 'cursor', i: tracker.cursor });
            }
        }

        /** Full-range search: locate where the reciter actually is. */
        function tryRelocate(heardWords, heardSigs, ops) {
            const result = alignUtterance(heardWords, items, 0, items.length, opts);
            const cleaned = pruneWeakMatches(withSubstitutions(result.pairs));

            /* Metrics come from the pruned pairs so a discarded soundalike
               cannot lift a noise chunk over the relocation bar. */
            let strongCount = 0;
            let matchedHeard = 0;
            let first = -1;
            cleaned.forEach(function (pair) {
                if (pair.type === 'match') {
                    matchedHeard += 1;
                    if (pair.score >= opts.strongSim) {
                        strongCount += 1;
                    }
                    if (first === -1 || pair.item < first) {
                        first = pair.item;
                    }
                } else if (pair.type === 'substitute') {
                    matchedHeard += 1;
                }
            });
            const confidence = heardWords.length ? matchedHeard / heardWords.length : 0;
            if (first === -1 || strongCount < opts.searchStrongNeeded || confidence < 0.5) {
                return false;
            }

            if (first > tracker.cursor) {
                /* Forward jumps are refused: "stay on the word you are on".
                   A chunk that only matches text further ahead is treated
                   as a failed attempt at the current position, never as a
                   relocation — the reciter must finish the marked word. */
                return false;
            }
            if (first < tracker.cursor) {
                // The reciter went back / restarted a passage.
                for (let i = first; i < items.length; i += 1) {
                    if (!items[i].meta && states[i] !== 'pending') {
                        setState(i, 'pending');
                    }
                }
                tracker.cursor = first;
                /* the old furthest-commit mark is stale after a reset — a
                   leftover value here used to mark every pending word up
                   to it as missed and park the cursor at its end */
                tracker._lastMatched = first - 1;
                ops.push({ op: 'reset', from: first });
                ops.push({ op: 'relocate', i: tracker.cursor });
            } else {
                ops.push({ op: 'relocate', i: first });
            }

            // Apply the located matches so the revealed text stays in sync.
            const forward = cleaned.filter(function (pair) {
                return (pair.type === 'match' || pair.type === 'substitute' || pair.type === 'miss')
                    && pair.item >= tracker.cursor;
            });
            applyPairs(forward, heardWords, ops, heardSigs);

            /* the chain clamp decides how far the recitation may advance —
               never jump the cursor past a word that was not matched */
            advanceCursor(ops);
            return true;
        }

        /**
         * Evaluates one finished utterance (the recognizer's final result
         * for a chunk of speech, or what accumulated before a pause).
         */
        tracker.finalize = function (rawTokens) {
            const ops = [];
            if (tracker.done) {
                return ops;
            }

            // The optimistic pass was only ever tentative, so the whole
            // chunk is evaluated here; the peek pointer restarts with the
            // next chunk.
            tracker._peekCursor = undefined;
            const heardParts = flattenTokenParts(rawTokens);
            let heardWords = heardParts.map(function (part) { return part.norm; });
            let heardSigs = heardParts.map(function (part) { return part.sig; });
            const stripped = stripIgnorable(heardWords, heardSigs, expectedNorm(tracker.cursor, 6));
            heardWords = stripped.words;
            heardSigs = stripped.sigs;

            if (!heardWords.length) {
                return ops; // silence — nothing to say about it
            }

            const from = Math.max(0, tracker.cursor - opts.back);
            const to = Math.min(items.length, tracker.cursor + opts.fwd);
            const result = alignUtterance(heardWords, items, from, to, opts);
            const pairs = pruneWeakMatches(withSubstitutions(result.pairs));

            /* Metrics are recomputed from the pruned pairs: a discarded
               soundalike must not inflate confidence and sneak a noise
               chunk past the relocation gate below. */
            let strongCount = 0;
            let matchedHeard = 0;
            pairs.forEach(function (pair) {
                if (pair.type === 'match') {
                    matchedHeard += 1;
                    if (pair.score >= opts.strongSim) {
                        strongCount += 1;
                    }
                } else if (pair.type === 'substitute') {
                    matchedHeard += 1;
                }
            });
            const confidence = heardWords.length ? matchedHeard / heardWords.length : 0;
            const recognized = strongCount > 0 || pairs.some(function (pair) {
                return pair.type === 'substitute';
            });

            /* A chunk whose first match lies well ahead of the cursor, with
               nothing settled in between, is far more likely to be a
               hallucinated rhyme word than a real jump: the ASR invents
               soundalike endings all the time. Big claims must carry the
               same evidence a relocation would demand. */
            const farFirst = result.firstMatched > tracker.cursor + (opts.jumpGuard === undefined ? 2 : opts.jumpGuard);
            const solidClaim = strongCount >= opts.searchStrongNeeded && confidence >= 0.5;

            if ((!recognized && confidence < opts.searchConf) || (farFirst && !solidClaim)) {
                // Nothing matched near the cursor. Either the reciter jumped
                // somewhere else in the passage (most likely) or this was
                // noise — a full-range search tells the two apart. Trying it
                // straight away keeps words of the new position from being
                // thrown away while a "low streak" accumulates.
                if (tryRelocate(heardWords, heardSigs, ops)) {
                    return completionOps(ops);
                }
                ops.push({ op: 'lowconf' });
                return ops;
            }

            applyPairs(pairs, heardWords, ops, heardSigs);
            advanceCursor(ops);
            return completionOps(ops);
        };

        /** Marks a word manually (tap / long-press in practice mode). */
        tracker.manualReveal = function (index) {
            if (items[index] && !items[index].meta && states[index] === 'pending') {
                setState(index, 'revealed');
                return [{ op: 'manual', i: index }];
            }
            return [];
        };

        tracker.reset = function () {
            items.forEach(function (item, i) {
                if (!item.meta) {
                    states[i] = 'pending';
                }
            });
            tracker.cursor = firstPendingFrom(0);
            tracker.stats = { strong: 0, weak: 0, subs: 0, misses: 0, extras: 0, repeats: 0 };
            tracker.done = false;
            tracker._lastMatched = -1;
            tracker._peekCursor = undefined;
            return [{ op: 'reset', from: 0 }];
        };

        tracker.summary = function () {
            const total = items.filter(function (item) { return !item.meta; }).length;
            const ok = tracker.stats.strong;
            return {
                total: total,
                strong: tracker.stats.strong,
                weak: tracker.stats.weak,
                subs: tracker.stats.subs,
                misses: tracker.stats.misses,
                repeats: tracker.stats.repeats,
                done: tracker.done
            };
        };

        return tracker;
    }

    return {
        STRONG_SIM: STRONG_SIM,
        MUQATTAAT: MUQATTAAT,
        IGNORE_PHRASES: IGNORE_PHRASES,
        normalizeToken: normalizeToken,
        vowelSignature: vowelSignature,
        splitWords: splitWords,
        tokenize: tokenize,
        flattenTokens: flattenTokens,
        flattenTokenParts: flattenTokenParts,
        buildItems: buildItems,
        levenshtein: levenshtein,
        wordScore: wordScore,
        alignUtterance: alignUtterance,
        stripIgnorable: stripIgnorable,
        createTracker: createTracker
    };
});
