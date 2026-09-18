# -*- coding: utf-8 -*-
"""Probe 3: mappings semantics, per-word phoneme spans, vocab tokenizer validation."""
import io
import sys

REPORT = r"d:\voidwave.com apps\Quran\QuranHifz\tools\tmp-probe3-report.txt"
lines = []


def rep(msg):
    lines.append(str(msg))


from quran_transcript import Aya, quran_phonetizer, MoshafAttributes

moshaf = MoshafAttributes(
    rewaya="hafs",
    madd_monfasel_len=4,
    madd_mottasel_len=4,
    madd_mottasel_waqf=4,
    madd_aared_len=4,
)

TOKENS_PATH = r"d:\voidwave.com apps\Quran\QuranHifz\tools\asr-models\zipformer-quran-phonemes\tokens.txt"
vocab = {}
with open(TOKENS_PATH, encoding="utf-8") as f:
    for line in f:
        parts = line.rstrip("\n").split(" ")
        if len(parts) == 2 and parts[0] != "<blank>":
            vocab[parts[0]] = int(parts[1])
maxlen = max(len(t) for t in vocab)
rep("vocab size: %d, max token len: %d" % (len(vocab), maxlen))


def tokenize(s):
    out = []
    i = 0
    while i < len(s):
        c = s[i]
        if c == " ":
            out.append((" ", None))
            i += 1
            continue
        for L in range(min(maxlen, len(s) - i), 0, -1):
            seg = s[i : i + L]
            if seg in vocab:
                out.append((seg, vocab[seg]))
                i += L
                break
        else:
            raise ValueError("cannot tokenize at %d: %r" % (i, s[i : i + 10]))
    return out


# ---------- A) mappings semantics on 1:4 ----------
rep("\n===== A) mappings on 1:4 =====")
info = Aya(1, 4).get()
text = info.uthmani
ref = quran_phonetizer(text, moshaf)
ph = ref.phonemes
ph_ns = ph.replace(" ", "")
rep("uthmani: %r" % text)
rep("uthmani_words: %r" % (info.uthmani_words,))
rep("join==uthmani: %r" % (" ".join(info.uthmani_words) == text))
rep("phonemes: %r" % ph)
rep("len(text)=%d len(mappings)=%d" % (len(text), len(ref.mappings)))
for i in range(min(len(text), 16)):
    m = ref.mappings[i]
    a, b = m.pos
    rep(
        "  char[%d]=%r pos=%r deleted=%r tj=%r  ph[a:b]=%r  ns[a:b]=%r"
        % (i, text[i], m.pos, m.deleted, m.tajweed_rules, ph[a:b], ph_ns[a:b])
    )


# ---------- B) per-word spans ----------
def word_spans(info):
    """Return list of (char_start, char_end) per uthmani word + assert join."""
    assert " ".join(info.uthmani_words) == info.uthmani
    spans = []
    cur = 0
    for w in info.uthmani_words:
        spans.append((cur, cur + len(w)))
        cur += len(w) + 1
    return spans


def word_phonemes(info, ref, mode="with"):
    """mode: which index domain to use for slicing ('with' spaces or 'none')."""
    ph = ref.phonemes
    spans = word_spans(info)
    res = []
    for (ws, we) in spans:
        a = None
        b = None
        for ci in range(ws, we):
            m = ref.mappings[ci]
            if m.deleted:
                continue
            x, y = m.pos
            a = x if a is None else min(a, x)
            b = y if b is None else max(b, y)
        if a is None:
            res.append("")
        else:
            res.append(ph[a:b])
    return res


for (s, a) in [(1, 4), (2, 2), (1, 1), (2, 1), (112, 1), (27, 30)]:
    info = Aya(s, a).get()
    ref = quran_phonetizer(info.uthmani, moshaf)
    rep("\n===== B) %d:%d =====" % (s, a))
    rep("uthmani_words (%d): %r" % (len(info.uthmani_words), info.uthmani_words))
    rep("phonemes: %r" % ref.phonemes)
    wph = word_phonemes(info, ref)
    rep("word phoneme slices (%d):" % len(wph))
    for i, w in enumerate(wph):
        rep("  [%d] %r   <- %r" % (i, w, info.uthmani_words[i] if i < len(info.uthmani_words) else "?"))

# ---------- C) tokenizer sanity ----------
rep("\n===== C) tokenizer sanity =====")
ref14 = quran_phonetizer(Aya(1, 4).get().uthmani, moshaf)
toks = [t for t, _ in tokenize(ref14.phonemes)]
rep("1:4 tokens: %r" % toks)
toks2 = [t for t, _ in tokenize("ءَلِف لَااااااممممِۦۦۦۦۦۦم")]
rep("2:1 tokens: %r" % toks2)


# ---------- D) tokenization sample ----------
rep("\n===== D) tokenization sample (fast) =====")
sample = [(1, a) for a in range(1, 8)] + [(2, 1), (2, 2), (2, 3), (27, 30), (55, 1), (55, 2)] + [(112, a) for a in range(1, 5)] + [(114, a) for a in range(1, 7)]
fails = []
total_clusters = 0
for (s, a) in sample:
    info = Aya(s, a).get()
    ref = quran_phonetizer(info.uthmani, moshaf)
    try:
        toks = tokenize(ref.phonemes)
        total_clusters += sum(1 for t, _ in toks if t != " ")
        rep("  %d:%d -> %r" % (s, a, [t for t, _ in toks if t != " "]))
    except ValueError as e:
        fails.append((s, a, str(e)))
rep("cluster count: %d, failures: %d" % (total_clusters, len(fails)))
for f in fails[:10]:
    rep("  FAIL %d:%d %s" % f)

with io.open(REPORT, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("report written:", REPORT)
