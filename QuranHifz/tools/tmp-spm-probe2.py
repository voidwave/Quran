"""tmp-spm-probe2.py — why does «َالِ» tokenize when its splits are absent?"""
import sentencepiece as spm

MODEL = r"d:\voidwave.com apps\Quran\QuranHifz\tools\asr-models\fastconformer-quran-v8\tokenizer.model"
sp = spm.SentencePieceProcessor(model_file=MODEL)

def show(text, label):
    ids = sp.encode(text, out_type=int)
    print(label, repr(text), "->", [(i, sp.id_to_piece(i)) for i in ids])

show("\u064e\u0627\u0644\u0650", "alif-lam-kasra piece?")
show("\u064e\u0627", "fatha+alif")
show("\u064e\u0627\u0644", "fatha+alif+lam")
show("\u0627\u0644\u0650", "alif+lam+kasra")
show("\u0645\u064e\u0627\u0644\u0650\u0643\u0650", "maliki")
show("\u0627\u0644", "alif+lam")

# what does id 845 really hold?
print("id 845:", repr(sp.id_to_piece(845)), "score", sp.get_score(845))
for pid in (25, 845, 4, 27):
    print(pid, repr(sp.id_to_piece(pid)))

# list pieces containing alef+lam+kasra-ish
hits = [(i, sp.id_to_piece(i), round(sp.get_score(i), 2)) for i in range(sp.get_piece_size())
        if "\u0627\u0644" in sp.id_to_piece(i) and "\u0650" in sp.id_to_piece(i)]
print("pieces containing alif-lam + kasra:")
for h in hits[:30]:
    print("  ", h)

# and pieces that are exactly fatha + something
hits2 = [(i, sp.id_to_piece(i), round(sp.get_score(i), 2)) for i in range(sp.get_piece_size())
         if sp.id_to_piece(i).startswith("\u064e") and len(sp.id_to_piece(i)) > 1]
print("pieces starting with fatha (len>1):")
for h in hits2[:30]:
    print("  ", h, [hex(ord(c)) for c in h[1]])
