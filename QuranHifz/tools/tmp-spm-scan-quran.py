"""tmp-spm-scan-quran.py — scan the whole uthmani Quran text the app ships
(QuranText/Quran/quran-uthmani.xml), find every character that still encodes
as <unk> after the base normalisation, and derive the final rule set."""
import re
import xml.etree.ElementTree as ET

import sentencepiece as spm

MODEL = r"d:\voidwave.com apps\Quran\QuranHifz\tools\asr-models\fastconformer-quran-v8\tokenizer.model"
XML = r"d:\voidwave.com apps\Quran\QuranText\Quran\quran-uthmani.xml"

sp = spm.SentencePieceProcessor(model_file=MODEL)

TATWEEL = "\u0640"
SUPERSCRIPT_ALEF = "\u0670"
ALEF_WASLA = "\u0671"
ALEF_MADDA = "\u0622"


def norm(text, extra_strip=""):
    t = text
    t = t.replace(ALEF_WASLA, "\u0627")
    t = t.replace(TATWEEL, "")
    t = t.replace(SUPERSCRIPT_ALEF, "\u0627")
    t = t.replace(ALEF_MADDA, "\u0627")
    if extra_strip:
        t = "".join(c for c in t if c not in extra_strip)
    return t


tree = ET.parse(XML)
root = tree.getroot()
words = []
for aya in root.iter("aya"):
    words.extend(aya.get("text", "").split())
print("ayat total words:", len(words))

# chars that individually encode as unk (after base norm)
probe_chars = sorted(set("".join(words)))
unk_chars = {}
for ch in probe_chars:
    if ch in "\u064b\u064c\u064d\u064e\u064f\u0650\u0651\u0652\u0653\u0654\u0655\u0640":
        continue  # harakat / shadda / madda / hamza marks — check within words only
    ids = sp.encode(norm(ch), out_type=int)
    if not norm(ch) or 0 in ids:
        unk_chars[ch] = hex(ord(ch))
print("single chars encoding as unk (base norm):", unk_chars)

# exhaustive word scan: which words still contain unk, and why
bad = 0
bad_examples = []
bad_char_counter = {}
for w in words:
    ids = sp.encode(norm(w), out_type=int)
    if 0 in ids:
        bad += 1
        if len(bad_examples) < 25:
            bad_examples.append((w, [hex(ord(c)) for c in w]))
        for c in w:
            bad_char_counter[c] = bad_char_counter.get(c, 0) + 1
print("words with unk:", bad, "of", len(words))
for w, cps in bad_examples:
    print("  ", repr(w), cps)
print("chars in bad words:", {hex(ord(k)): v for k, v in sorted(bad_char_counter.items(), key=lambda x: -x[1])[:12]})

# try stripping Quranic annotation range + madda/hamza marks
EXTRA = set(chr(c) for c in range(0x06D6, 0x06EE)) | {"\u0653", "\u0654", "\u0655", "\u0656", "\u0657", "\u0658"}
bad2 = 0
for w in words:
    ids = sp.encode(norm(w, EXTRA), out_type=int)
    if 0 in ids:
        bad2 += 1
print("words with unk after extended strip:", bad2)
