"""tmp-build-wordids.py — precompute SentencePiece token ids for every word
of the shipped uthmani Quran, using the REAL sentencepiece library (exact
parity with the upstream aligner — its BPE merge history cannot be
reconstructed from sp-model.json alone).

Outputs tools/asr-models/fastconformer-quran-v8/word-ids.json:
    { "w": { "<normalized word>": [ids...] }, "midBar": N }
"midBar" = number of vocab pieces containing a word-marker «▁» anywhere but
position 0 — if 0, word-independent tokenization is exact for this vocab.
"""
import json

import xml.etree.ElementTree as ET

import sentencepiece as spm

MODEL = r"d:\voidwave.com apps\Quran\QuranHifz\tools\asr-models\fastconformer-quran-v8\tokenizer.model"
XML = r"d:\voidwave.com apps\Quran\QuranText\Quran\quran-uthmani.xml"
OUT = r"d:\voidwave.com apps\Quran\QuranHifz\tools\asr-models\fastconformer-quran-v8\word-ids.json"

sp = spm.SentencePieceProcessor(model_file=MODEL)

mid_bar = sum(1 for i in range(sp.get_piece_size()) if sp.id_to_piece(i).find("\u2581", 1) > 0)
print("pieces with mid «▁»:", mid_bar)

TATWEEL = "\u0640"

def norm(text):
    return (text
            .replace("\u0671", "\u0627")
            .replace(TATWEEL, "")
            .replace("\u0670", "\u0627")
            .replace("\u0622", "\u0627")
            .replace("\u06D6", "").replace("\u06D7", "").replace("\u06D8", "")
            .replace("\u06D9", "").replace("\u06DA", "").replace("\u06DB", "")
            .replace("\u06DC", "").replace("\u06DD", "").replace("\u06DE", "")
            .replace("\u06DF", "").replace("\u06E0", "").replace("\u06E1", "")
            .replace("\u06E2", "").replace("\u06E3", "").replace("\u06E4", "")
            .replace("\u06E5", "").replace("\u06E6", "").replace("\u06E7", "")
            .replace("\u06E8", "").replace("\u06E9", "").replace("\u06EA", "")
            .replace("\u06EB", "").replace("\u06EC", "").replace("\u06ED", "")
            .replace("\u0653", "").replace("\u0654", "").replace("\u0655", "")
            .replace("\u0656", "").replace("\u0657", "").replace("\u0658", ""))

root = ET.parse(XML).getroot()
words = set()
for aya in root.iter("aya"):
    for w in aya.get("text", "").split():
        words.add(norm(w))
print("unique normalized words:", len(words))

table = {}
unk_words = []
for w in sorted(words):
    ids = sp.encode(w, out_type=int)
    if 0 in ids:
        unk_words.append(w)
    table[w] = ids
print("words with unk:", len(unk_words), unk_words[:5])

with open(OUT, "w", encoding="utf-8") as f:
    json.dump({"midBar": mid_bar, "w": table}, f, ensure_ascii=False, separators=(",", ":"))
import os
print("written ->", OUT, round(os.path.getsize(OUT) / 1024), "KB")
