# -*- coding: utf-8 -*-
"""Build canonical phoneme*cluster* tables for the whole Quran using quran-transcript.

v2 output per sura file `QuranText/QuranPhonemes/<sura>.json`:
  {
    "b": <bismillah cluster string> | null,
    "w": [n_words, ...],              # uthmani word count per aya (sanity / slicing info)
    "a": [ {"c": "<clusters space-separated>", "l": [clusters_in_word_0, ...]}, ... ]
  }
`c` holds the aya's phoneme string tokenized (greedy longest match) against the
zipformer vocab (tokens.txt); `l` maps each cluster to its Uthmani word via the
phonetizer's char->phoneme mappings (cluster start index assigned to the word whose
char span maps onto it).  Sum(l) == number of clusters in `c`.

meta.json: generation config + validation stats (tokenization failures, empty word
slices, word-count mismatches, sizes).

Run with Python 3.12:
  C:\\Users\\majed\\AppData\\Local\\Programs\\Python\\Python312\\python.exe
  QuranHifz/tools/build-quran-phonemes.py
Log: QuranHifz/tools/tmp-phonemes-build.log
"""
import io
import json
import os
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))  # d:\...\Quran
OUT_DIR = os.path.join(ROOT, "QuranText", "QuranPhonemes")
LOG_PATH = os.path.join(HERE, "tmp-phonemes-build.log")
TOKENS_PATH = os.path.join(HERE, "asr-models", "zipformer-quran-phonemes", "tokens.txt")

from quran_transcript import Aya, quran_phonetizer, MoshafAttributes
import quran_transcript

log_lines = []


def log(msg):
    log_lines.append(str(msg))


# ---------- vocabulary ----------
vocab = {}
with open(TOKENS_PATH, encoding="utf-8") as f:
    for line in f:
        parts = line.rstrip("\n").split(" ")
        if len(parts) == 2 and parts[0] != "<blank>":
            vocab[parts[0]] = int(parts[1])
MAX_LEN = max(len(t) for t in vocab)


def tokenize(s):
    """Greedy longest-match; returns list of (token, ph_start, ph_end) incl. spaces."""
    out = []
    i = 0
    n = len(s)
    while i < n:
        c = s[i]
        if c == " ":
            out.append((" ", i, i + 1))
            i += 1
            continue
        for L in range(min(MAX_LEN, n - i), 0, -1):
            seg = s[i : i + L]
            if seg in vocab:
                out.append((seg, i, i + L))
                i += L
                break
        else:
            raise ValueError("cannot tokenize at %d: %r" % (i, s[i : i + 12]))
    return out


def word_char_spans(info):
    """(char_start, char_end) per uthmani word; asserts words join with single spaces."""
    assert " ".join(info.uthmani_words) == info.uthmani
    spans = []
    cur = 0
    for w in info.uthmani_words:
        spans.append((cur, cur + len(w)))
        cur += len(w) + 1
    return spans


def word_phoneme_spans(info, ref):
    """Phoneme-string spans (with spaces domain) per word via mappings."""
    spans = []
    for (ws, we) in word_char_spans(info):
        a = None
        b = None
        for ci in range(ws, we):
            m = ref.mappings[ci]
            if m.deleted:
                continue
            x, y = m.pos
            a = x if a is None else min(a, x)
            b = y if b is None else max(b, y)
        spans.append((a, b))
    return spans


def aya_entry(info, ref):
    """Return {"c": clusters string, "l": [clusters per word]} + validation info."""
    toks = tokenize(ref.phonemes)
    clusters = [(t, s0, s1) for (t, s0, s1) in toks if t != " "]
    wspans = word_phoneme_spans(info, ref)
    # assign each cluster to a word: word whose phoneme span contains cluster start
    counts = [0] * len(wspans)
    for (t, s0, s1) in clusters:
        widx = None
        for wi, (a, b) in enumerate(wspans):
            if a is None:
                continue
            if a <= s0 < b:
                widx = wi
                break
        if widx is None:
            # fallback: nearest following word with a span, else previous, else 0
            for wi, (a, b) in enumerate(wspans):
                if a is not None and s0 < a:
                    widx = wi
                    break
            if widx is None:
                for wi in range(len(wspans) - 1, -1, -1):
                    if wspans[wi][0] is not None:
                        widx = wi
                        break
            if widx is None:
                widx = 0
        counts[widx] += 1
    return {
        "c": " ".join(t for (t, _, _) in clusters),
        "l": counts,
    }


def main():
    t0 = time.time()
    log("build v2 (clusters) — quran-transcript %s" % getattr(quran_transcript, "__version__", "?"))
    log("vocab: %d tokens, max len %d" % (len(vocab), MAX_LEN))

    moshaf = MoshafAttributes(
        rewaya="hafs",
        madd_monfasel_len=4,
        madd_mottasel_len=4,
        madd_mottasel_waqf=4,
        madd_aared_len=4,
    )

    os.makedirs(OUT_DIR, exist_ok=True)

    tok_failures = []
    word_count_mismatches = 0
    empty_word_slices = 0
    total_clusters = 0
    total_words = 0
    total_ayat = 0
    total_bytes = 0
    sura_sizes = []

    for sura in range(1, 115):
        info1 = Aya(sura, 1).get()
        n = info1.num_ayat_in_sura
        ayat = []
        counts_w = []
        for a in range(1, n + 1):
            info = Aya(sura, a).get()
            ref = quran_phonetizer(info.uthmani, moshaf)
            try:
                entry = aya_entry(info, ref)
            except ValueError as e:
                tok_failures.append({"sura": sura, "aya": a, "error": str(e)})
                log("TOKENIZE FAIL %d:%d %s" % (sura, a, e))
                continue
            if len(entry["l"]) != len(info.uthmani_words):
                word_count_mismatches += 1
            empty_word_slices += sum(1 for x in entry["l"] if x == 0)
            total_clusters += sum(entry["l"])
            total_words += len(entry["l"])
            ayat.append(entry)
            counts_w.append(len(info.uthmani_words))
            total_ayat += 1

        bismillah = None
        if sura != 1:
            b_uth = getattr(info1, "bismillah_uthmani", None)
            if b_uth:
                bref = quran_phonetizer(b_uth, moshaf)
                btoks = tokenize(bref.phonemes)
                bismillah = " ".join(t for (t, _, _) in btoks if t != " ")

        blob = json.dumps(
            {"b": bismillah, "w": counts_w, "a": ayat},
            ensure_ascii=False,
            separators=(",", ":"),
        )
        data = blob.encode("utf-8")
        with open(os.path.join(OUT_DIR, "%d.json" % sura), "wb") as f:
            f.write(data)
        total_bytes += len(data)
        sura_sizes.append((sura, n, len(data)))

    log("\n== sizes ==")
    log("total: %d bytes (%.2f MB)" % (total_bytes, total_bytes / 1048576))
    log("largest: %r" % sorted(sura_sizes, key=lambda x: -x[2])[:6])

    log("\n== validation ==")
    log("ayat: %d, clusters: %d, words: %d" % (total_ayat, total_clusters, total_words))
    log("tokenization failures: %d" % len(tok_failures))
    log("word-count mismatches (len(l) vs uthmani_words): %d" % word_count_mismatches)
    log(
        "empty word slices (word got no cluster): %d (%.3f%%)"
        % (empty_word_slices, 100.0 * empty_word_slices / max(1, total_words))
    )

    # samples
    log("\n== samples ==")
    for (s, a) in [(1, 1), (1, 4), (2, 1), (2, 2), (27, 30), (112, 1), (114, 6)]:
        with open(os.path.join(OUT_DIR, "%d.json" % s), "rb") as f:
            obj = json.loads(f.read().decode("utf-8"))
        e = obj["a"][a - 1]
        log("%d:%d  c=%r" % (s, a, e["c"]))
        log("       l=%r (w=%d)" % (e["l"], obj["w"][a - 1]))

    meta = {
        "generated": time.strftime("%Y-%m-%d %H:%M:%S"),
        "source": "quran-transcript %s (MIT)" % getattr(quran_transcript, "__version__", "?"),
        "format": "v2-clusters: {b, w, a:[{c,l}]}",
        "moshaf": {
            "rewaya": "hafs",
            "madd_monfasel_len": 4,
            "madd_mottasel_len": 4,
            "madd_mottasel_waqf": 4,
            "madd_aared_len": 4,
        },
        "vocab_tokens": len(vocab),
        "ayat": total_ayat,
        "clusters": total_clusters,
        "words": total_words,
        "tokenization_failures": tok_failures,
        "word_count_mismatches": word_count_mismatches,
        "empty_word_slices": empty_word_slices,
        "total_bytes": total_bytes,
    }
    with open(os.path.join(OUT_DIR, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)

    log("\nelapsed: %.1fs" % (time.time() - t0))
    log("DONE -> %s" % OUT_DIR)


if __name__ == "__main__":
    try:
        main()
    finally:
        with io.open(LOG_PATH, "w", encoding="utf-8") as f:
            f.write("\n".join(log_lines))
