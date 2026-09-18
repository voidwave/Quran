/* ===========================================================================
 * quran-gop.js — in-browser pronunciation scoring (GOP) for the v8
 * FastConformer. Mirrors the upstream Python pipeline (tajweed/aligner.py +
 * gop_scorer.py):
 *
 *   normalize(uthmani)  → imlaei-ish text the tokenizer was trained on
 *   encode(text)        → SentencePiece BPE token ids (sp-model.json)
 *   forcedAlign(logprobs) → per-token CTC intervals (blank-interleaved
 *                           trellis, skip when seq[s] != blank && != seq[s-2])
 *   gop(...)            → per-token goodness of pronunciation:
 *                           logP(expected) - max logP(non-blank) at the
 *                           expected token's PEAK frame in its interval;
 *                           bands: > -0.5 ok, > -2.0 weak, <= -2.0 wrong
 *
 * Works in a worker (importScripts) and on the page. Data files live next to
 * the model: sp-model.json (pieces + scores) and tokens.txt (piece -> id).
 * =========================================================================== */
(function () {
    const SP_BASE = new URL('tools/asr-models/fastconformer-quran-v8/', self.location.href).href;
    const BLANK_ID = 1024;
    const OUTPUT_HOP_S = 0.080;

    let readyPromise = null;
    let pieceToId = null;
    let pieceScore = null;
    let wordIds = null;

    /* ---- uthmani -> the model's imlaei-ish orthography ------------------- */
    /* rules verified against the real vocab: 0 <unk> on all 81,812 words of
       quran-uthmani.xml (tools/tmp-spm-scan-quran.py) */
    function normalize(text) {
        return text
            .replace(/\u0671/g, '\u0627')            /* ٱ -> ا */
            .replace(/\u0640/g, '')                  /* tatweel -> removed */
            .replace(/\u0670/g, '\u0627')            /* ٰ -> ا */
            .replace(/\u0622/g, '\u0627')            /* آ -> ا */
            .replace(/[\u06D6-\u06ED]/g, '')         /* Quranic pause marks */
            .replace(/[\u0653-\u0658]/g, '');        /* madda / hamza marks */
    }

    /* ---- SentencePiece BPE ----------------------------------------------- */

    function load() {
        if (readyPromise) {
            return readyPromise;
        }
        readyPromise = Promise.all([
            fetch(SP_BASE + 'word-ids.json').then(function (r) { return r.json(); }),
            fetch(SP_BASE + 'tokens.txt').then(function (r) { return r.text(); }),
            fetch(SP_BASE + 'sp-model.json').then(function (r) { return r.json(); })
                .catch(function () { return { pieces: [] }; })
        ]).then(function (results) {
            /* precomputed ids for every word of the Quran (exact SentencePiece
               parity — its BPE merge history cannot be replayed from
               pieces+scores alone: intermediate pieces get pruned) */
            wordIds = new Map();
            const table = results[0].w || {};
            Object.keys(table).forEach(function (key) {
                wordIds.set(key, table[key]);
            });
            pieceToId = new Map();
            results[1].split(/\r?\n/).forEach(function (line) {
                const parts = line.split(/\s+/);
                if (parts.length >= 2) {
                    const id = parseInt(parts[parts.length - 1], 10);
                    const piece = parts.slice(0, parts.length - 1).join(' ');
                    if (!Number.isNaN(id)) {
                        pieceToId.set(piece, id);
                    }
                }
            });
            pieceScore = new Map();
            (results[2].pieces || []).forEach(function (entry) {
                pieceScore.set(entry.p, entry.s);
            });
            return true;
        });
        readyPromise.catch(function () {
            readyPromise = null;   /* allow a retry */
        });
        return readyPromise;
    }

    /** SentencePiece BPE encode: repeatedly merge the adjacent pair whose
     *  concatenation has the highest piece score. NOTE: kept only as a
     *  fallback for words outside the Quran — the precomputed table above is
     *  what the pipeline actually uses (exact parity with upstream). */
    function encode(text) {
        let symbols = Array.from('\u2581' + text.replace(/ /g, '\u2581'));
        let merged = true;
        while (merged) {
            merged = false;
            let bestAt = -1;
            let bestScore = -Infinity;
            for (let i = 0; i + 1 < symbols.length; i += 1) {
                const score = pieceScore.get(symbols[i] + symbols[i + 1]);
                if (score !== undefined && score > bestScore) {
                    bestScore = score;
                    bestAt = i;
                }
            }
            if (bestAt >= 0) {
                symbols.splice(bestAt, 2, symbols[bestAt] + symbols[bestAt + 1]);
                merged = true;
            }
        }
        const ids = [];
        symbols.forEach(function (piece) {
            const id = pieceToId.get(piece);
            if (id !== undefined) {
                ids.push(id);
            }
        });
        return ids;
    }

    /** Token ids of one uthmani word: normalize + exact table lookup (the
     *  fallback encoder runs only if both the table and sp-model miss). */
    function encodeWord(word) {
        const norm = normalize(word);
        if (wordIds) {
            const ids = wordIds.get(norm);
            if (ids) {
                return ids;
            }
        }
        return encode(norm);
    }

    /** Split the encoded reference into words: a piece starting with «▁»
     *  starts a new word. Returns [{ids, piece}] per word (piece joins the
     *  pieces of the word, stripped of the leading «▁»). */
    function encodeWords(text) {
        const words = text.split(' ');
        const out = [];
        let cursor = 0;
        words.forEach(function (word) {
            const ids = encodeWord(word);
            out.push({ text: word, ids: ids, at: cursor });
            cursor += ids.length;
        });
        return out;
    }

    /* ---- CTC forced alignment (port of tajweed/aligner.py) ---------------- */

    /**
     * logprobs: accessor (t, v) -> number over a (T, V) grid.
     * tokenIds: expected token sequence.
     * Returns per-token [startFrame, endFrame) (may be zero-width for tokens
     * the audio never reached — the unspoken tail).
     */
    function forcedAlign(T, V, lpAt, tokenIds) {
        const blankId = BLANK_ID;
        const seq = [blankId];
        tokenIds.forEach(function (id) {
            seq.push(id);
            seq.push(blankId);
        });
        const S = seq.length;
        if (S <= 2 || T < Math.ceil(S / 2)) {
            return tokenIds.map(function () { return [0, 0]; });
        }
        const NEG = -1e18;
        let prev = new Float64Array(S).fill(NEG);
        let cur = new Float64Array(S).fill(NEG);
        const back = [];
        for (let t = 0; t < T; t += 1) {
            back.push(new Int8Array(S));
        }
        prev[0] = lpAt(0, seq[0]);
        if (S > 1) {
            prev[1] = lpAt(0, seq[1]);
        }
        for (let t = 1; t < T; t += 1) {
            for (let s = 0; s < S; s += 1) {
                let best = prev[s];
                let bk = 0;
                if (s >= 1 && prev[s - 1] > best) {
                    best = prev[s - 1];
                    bk = -1;
                }
                if (s >= 2 && seq[s] !== blankId && seq[s] !== seq[s - 2] && prev[s - 2] > best) {
                    best = prev[s - 2];
                    bk = -2;
                }
                cur[s] = best + lpAt(t, seq[s]);
                back[t][s] = bk;
            }
            const swap = prev;
            prev = cur;
            cur = swap;
        }
        /* end at the last blank (S-1) or the last token (S-2) */
        let s = S - 1;
        if (S >= 2 && prev[S - 2] > prev[S - 1]) {
            s = S - 2;
        }
        const path = new Int32Array(T);
        path[T - 1] = s;
        for (let t = T - 1; t > 0; t -= 1) {
            s += back[t][s];
            path[t - 1] = s;
        }
        const intervals = [];
        let curTok = -1;
        let curStart = 0;
        for (let t = 0; t < T; t += 1) {
            const sym = seq[path[t]];
            if (sym === blankId) {
                continue;
            }
            const tokIdx = (path[t] - 1) >> 1;
            if (tokIdx !== curTok) {
                if (curTok >= 0) {
                    intervals.push([curStart, t]);
                }
                curTok = tokIdx;
                curStart = t;
            }
        }
        if (curTok >= 0) {
            intervals.push([curStart, T]);
        }
        while (intervals.length < tokenIds.length) {
            const last = intervals.length ? intervals[intervals.length - 1][1] : 0;
            intervals.push([last, last]);
        }
        return intervals.slice(0, tokenIds.length);
    }

    /* ---- GOP per token ---------------------------------------------------- */

    /** gop_scorer.gop_from_logprobs: at the frame where the expected token
     *  peaks inside its interval, gop = logP(expected) - max logP(non-blank
     *  incl. expected)  (<= 0; nearer 0 = clearer). */
    function gop(T, V, lpAt, tokenIds, intervals, blankId) {
        const out = [];
        tokenIds.forEach(function (id, i) {
            let a = intervals[i][0];
            let b = intervals[i][1];
            if (b <= a) {
                b = Math.min(T, a + 1);
            }
            let peakT = a;
            let peakVal = -Infinity;
            for (let t = a; t < b; t += 1) {
                const value = lpAt(t, id);
                if (value > peakVal) {
                    peakVal = value;
                    peakT = t;
                }
            }
            let top = -Infinity;
            for (let v = 0; v < V; v += 1) {
                if (v === (blankId === undefined ? BLANK_ID : blankId)) {
                    continue;
                }
                const value = lpAt(peakT, v);
                if (value > top) {
                    top = value;
                }
            }
            const value = peakVal - top;   /* <= 0 */
            out.push({
                id: id,
                gop: +value.toFixed(3),
                frames: intervals[i][1] - intervals[i][0],
                a: intervals[i][0],
                b: intervals[i][1],
                band: value > -0.5 ? 'ok' : (value > -2.0 ? 'weak' : 'wrong')
            });
        });
        return out;
    }

    /** Full analysis of one utterance against a normalized reference text.
     *  lpAt: (t, v) -> logprob. Returns per reference WORD:
     *    [{ min, mean, frames, tokens }]  (words with no audio get frames 0)
     *  The reference is usually LONGER than the utterance (the app sends the
     *  upcoming words): only the first `tokenBudget` tokens are aligned — the
     *  caller passes the number of tokens the decode actually heard (plus a
     *  little slack), because forcing far more tokens into the audio squeezes
     *  every interval and corrupts the GOP. Later words report frames 0 — the
     *  unspoken tail, never a mispronunciation. */
    function analyze(T, V, lpAt, referenceText, tokenBudget) {
        const words = referenceText.split(' ').filter(Boolean);
        const flatIds = [];
        const wordRanges = [];
        words.forEach(function (word) {
            const ids = encodeWord(word);
            wordRanges.push([flatIds.length, ids.length]);
            ids.forEach(function (id) { flatIds.push(id); });
        });
        if (!flatIds.length || T < 3) {
            return words.map(function () { return { min: 0, mean: 0, frames: 0, tokens: [] }; });
        }
        const maxTokens = Math.max(3, Math.min(T - 2, tokenBudget > 0 ? tokenBudget : T - 2));
        let used = 0;
        for (let wi = 0; wi < words.length; wi += 1) {
            const len = wordRanges[wi][1];
            if (used + len > maxTokens) {
                break;
            }
            used += len;
        }
        const intervals = forcedAlign(T, V, lpAt, flatIds.slice(0, used));
        const scores = gop(T, V, lpAt, flatIds.slice(0, used), intervals);
        return words.map(function (word, wi) {
            const range = wordRanges[wi];
            const parts = scores.slice(range[0], range[0] + range[1]);
            let frames = 0;
            let sum = 0;
            let min = Infinity;
            let count = 0;
            parts.forEach(function (entry) {
                frames += entry.frames;
                if (entry.frames > 0) {
                    sum += entry.gop;
                    count += 1;
                    min = Math.min(min, entry.gop);
                }
            });
            return {
                min: count ? +min.toFixed(3) : 0,
                mean: count ? +(sum / count).toFixed(3) : 0,
                frames: frames,
                tokens: parts.length,
                detail: parts
            };
        });
    }

    self.QuranGop = {
        normalize: normalize,
        load: load,
        encode: encode,
        encodeWord: encodeWord,
        encodeWords: encodeWords,
        forcedAlign: forcedAlign,
        gop: gop,
        analyze: analyze,
        BLANK_ID: BLANK_ID,
        OUTPUT_HOP_S: OUTPUT_HOP_S
    };
}());
