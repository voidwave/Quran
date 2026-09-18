# -*- coding: utf-8 -*-
"""Probe 2: alphabet vs tokens.txt, word-split consistency over whole Quran, sizes, tricky ayas."""
import sys
import io
import json
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

from quran_transcript import Aya, quran_phonetizer, MoshafAttributes
import quran_transcript as qt

moshaf = MoshafAttributes(
    rewaya="hafs",
    madd_monfasel_len=4,
    madd_mottasel_len=4,
    madd_mottasel_waqf=4,
    madd_aared_len=4,
)

import quran_transcript.alphabet as alph
print("== alphabet module names ==")
print([a for a in dir(alph) if not a.startswith("_")])

print("\n== tokens.txt load ==")
tokens_path = r"d:\voidwave.com apps\Quran\QuranHifz\tools\asr-models\zipformer-quran-phonemes\tokens.txt"
tok = []
with open(tokens_path, encoding="utf-8") as f:
    for line in f:
        parts = line.rstrip("\n").split(" ")
        if len(parts) == 2:
            tok.append(parts[0])
tok_set = set(tok)
print("tokens count:", len(tok_set))
from collections import Counter
char_freq = Counter()

print("\n== whole-quran word-split consistency ==")
t0 = time.time()
mismatches = []
total_chars = 0
num_ayat = 0
aya_counts = {}
from quran_transcript import Aya as AyaCls

# iterate suras via Aya
sura = 1
while True:
    try:
        a1 = AyaCls(sura, 1)
        info = a1.get()
        n = info.num_ayat_in_sura
    except Exception as e:
        break
    aya_counts[sura] = n
    sura += 1
print("suras found:", len(aya_counts), "total ayat:", sum(aya_counts.values()))

for s, n in aya_counts.items():
    for a in range(1, n + 1):
        info = AyaCls(s, a).get()
        ref = quran_phonetizer(info.uthmani, moshaf)
        ph = ref.phonemes
        total_chars += len(ph)
        num_ayat += 1
        char_freq.update(c for c in ph if c != " ")
        words_uth = info.uthmani_words
        words_ph = ph.split()
        if len(words_uth) != len(words_ph):
            mismatches.append((s, a, len(words_uth), len(words_ph), ph))

print("elapsed: %.1fs" % (time.time() - t0))
print("ayat processed:", num_ayat)
print("total phoneme chars:", total_chars)
print("word-count mismatch count:", len(mismatches))
for m in mismatches[:20]:
    print("  %d:%d uth=%d ph=%d  %r" % m)

used = set(char_freq)
print("\n== charset emit vs tokens.txt ==")
print("distinct phoneme chars emitted:", len(used))
print("in emitted not tokens:", sorted(used - tok_set))
print("in tokens not emitted:", sorted(tok_set - used))
print("freq of in-tokens-not-emitted:", {c: char_freq[c] for c in sorted(tok_set - used)})
print("rarest 15 emitted:", char_freq.most_common()[-15:])

print("\n== name-bearing ayas? check 1:1 vs bismillah ==")
info1 = AyaCls(1, 1).get()
print("1:1 uthmani:", repr(info1.uthmani))
print("1:1 bismillah_uthmani:", repr(info1.bismillah_uthmani))
print("1:1 phonemes:", repr(quran_phonetizer(info1.uthmani, moshaf).phonemes))
print("bismillah phonemes:", repr(quran_phonetizer(info1.bismillah_uthmani, moshaf).phonemes))

print("\n== tricky samples ==")
for (s, a) in [(2, 1), (27, 30), (112, 1), (114, 6), (75, 27), (18, 1)]:
    info = AyaCls(s, a).get()
    ref = quran_phonetizer(info.uthmani, moshaf)
    print("%d:%d" % (s, a), "->", repr(ref.phonemes))

print("\n== per-sura JSON size prototype (sura 2, 55, 114) ==")
for s in (2, 55, 114):
    n = aya_counts[s]
    ayat = []
    for a in range(1, n + 1):
        info = AyaCls(s, a).get()
        ref = quran_phonetizer(info.uthmani, moshaf)
        ayat.append(ref.phonemes)
    blob = json.dumps(ayat, ensure_ascii=False, separators=(",", ":"))
    print("sura %d: %d ayat, json bytes=%d utf8=%d" % (s, n, len(blob), len(blob.encode("utf-8"))))
