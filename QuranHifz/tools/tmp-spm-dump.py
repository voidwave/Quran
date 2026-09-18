"""tmp-spm-dump.py — dump tokenizer.model pieces + scores to sp-model.json
for the browser GOP pipeline. Also prints a few reference encodings used to
validate the JS SentencePiece port."""
import json
import sys

import sentencepiece as spm

MODEL = r"d:\voidwave.com apps\Quran\QuranHifz\tools\asr-models\fastconformer-quran-v8\tokenizer.model"
OUT = r"d:\voidwave.com apps\Quran\QuranHifz\tools\asr-models\fastconformer-quran-v8\sp-model.json"

sp = spm.SentencePieceProcessor(model_file=MODEL)
n = sp.get_piece_size()
pieces = [{"p": sp.id_to_piece(i), "s": sp.get_score(i)} for i in range(n)]
with open(OUT, "w", encoding="utf-8") as f:
    json.dump({"modelType": "BPE", "pieces": pieces}, f, ensure_ascii=False)
print("pieces:", n)

# reference encodings for JS-port validation (imlaei-ish samples seen in the
# model's own outputs on our test clips)
samples = [
    "مَالِكِ يَوْمِ الدِّينِ",
    "اهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ",
    "صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ",
    "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ",
    "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ",
]
ref = []
for text in samples:
    ids = sp.encode(text, out_type=int)
    ref.append({"text": text, "ids": ids, "pieces": [sp.id_to_piece(i) for i in ids]})
with open(OUT.replace("sp-model.json", "sp-encode-ref.json"), "w", encoding="utf-8") as f:
    json.dump(ref, f, ensure_ascii=False, indent=1)
print("ref samples:", len(ref))

# and the uthmani originals of two of them — what the app actually stores —
# to see how SP tokenizes the uthmani orthography (offline reference)
uthmani = [
    "مَـٰلِكِ يَوْمِ ٱلدِّينِ",
    "ٱهْدِنَا ٱلصِّرَٰطَ ٱلْمُسْتَقِيمَ",
]
for text in uthmani:
    ids = sp.encode(text, out_type=int)
    print("uthmani:", text)
    print("  pieces:", " | ".join(sp.id_to_piece(i) for i in ids))
