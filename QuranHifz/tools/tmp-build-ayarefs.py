"""tmp-build-ayarefs.py — reference encodings for the actual app pipeline:
uthmani XML aya text -> normalize -> real sentencepiece encode.
Output: tools/asr-models/fastconformer-quran-v8/aya-refs.json
"""
import json

import xml.etree.ElementTree as ET

import sentencepiece as spm

MODEL = r"d:\voidwave.com apps\Quran\QuranHifz\tools\asr-models\fastconformer-quran-v8\tokenizer.model"
XML = r"d:\voidwave.com apps\Quran\QuranText\Quran\quran-uthmani.xml"
OUT = r"d:\voidwave.com apps\Quran\QuranHifz\tools\asr-models\fastconformer-quran-v8\aya-refs.json"

sp = spm.SentencePieceProcessor(model_file=MODEL)

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
out = []
for sura in root.iter("sura"):
    if sura.get("index") != "1":
        continue
    for aya in sura.iter("aya"):
        text = norm(aya.get("text", ""))
        out.append({
            "sura": 1,
            "aya": int(aya.get("index")),
            "text": text,
            "ids": sp.encode(text, out_type=int),
        })

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print("written", OUT, "ayas:", len(out))
print("aya4 ids:", out[3]["ids"])
print("aya4 text:", out[3]["text"])
