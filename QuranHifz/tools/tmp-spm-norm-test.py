"""tmp-spm-norm-test.py — find the exact uthmani -> imlaei normalisation by
encoding real uthmani ayat and listing any <unk> pieces left."""
import sentencepiece as spm

MODEL = r"d:\voidwave.com apps\Quran\QuranHifz\tools\asr-models\fastconformer-quran-v8\tokenizer.model"
sp = spm.SentencePieceProcessor(model_file=MODEL)

TATWEEL = "\u0640"
SUPERSCRIPT_ALEF = "\u0670"
ALEF_WASLA = "\u0671"
ALEF_MADDA = "\u0622"

def norm(text):
    t = text
    t = t.replace(ALEF_WASLA, "\u0627")     # ٱ -> ا
    t = t.replace(TATWEEL, "")              # ـ -> (removed)
    t = t.replace(SUPERSCRIPT_ALEF, "\u0627")  # ٰ -> ا
    t = t.replace(ALEF_MADDA, "\u0627")     # آ -> ا
    return t

texts = [
    "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ",
    "ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ",
    "ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ",
    "مَـٰلِكِ يَوْمِ ٱلدِّينِ",
    "إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ",
    "ٱهْدِنَا ٱلصِّرَٰطَ ٱلْمُسْتَقِيمَ",
    "صِرَٰطَ ٱلَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ ٱلْمَغْضُوبِ عَلَيْهِمْ وَلَا ٱلضَّآلِّينَ",
    "قُلْ هُوَ ٱللَّهُ أَحَدٌ",
    "عَلَىٰ صِرَٰطٍ مُّسْتَقِيمٍ",
]

bad_chars = {}
for raw in texts:
    text = norm(raw)
    ids = sp.encode(text, out_type=int)
    unks = [i for i in ids if i == 0]
    mark = "OK " if not unks else "UNK"
    print(mark, text)
    if unks:
        # find which characters fed the unk pieces: simple per-char probe
        for ch in set(text):
            if ch in "\u0621\u0622\u0623\u0625\u0627\u0649\u0648\u064a\u064b\u064c\u064d\u064e\u064f\u0650\u0651\u0652\u0670\u0653\u0654\u0655":
                one = sp.encode(ch, out_type=int)
                if 0 in one:
                    bad_chars[ch] = hex(ord(ch))
print("chars producing unk:", bad_chars)
print("vocab sanity chunks:")
for probe in ["عَلَى", "إِلَى", "الَّذِي", "هُدًى", "مُوسَى", "عِيسَى"]:
    ids = sp.encode(probe, out_type=int)
    print(probe, "->", " ".join(sp.id_to_piece(i) for i in ids), "UNK" if 0 in ids else "")
