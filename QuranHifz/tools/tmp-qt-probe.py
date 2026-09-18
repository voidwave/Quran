# -*- coding: utf-8 -*-
"""Probe quran-transcript API: Aya fields, phonetizer output, explain_error export."""
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import quran_transcript as qt
from quran_transcript import Aya, quran_phonetizer, MoshafAttributes

print("== qt exports ==")
print([a for a in dir(qt) if not a.startswith("_")])

print("\n== Aya(1, 4) ==")
aya = Aya(1, 4)
info = aya.get()
print("info type:", type(info))
fields = [a for a in dir(info) if not a.startswith("_")]
print("fields:", fields)

text = None
for cand in ("uthmani_script", "uthmani_text", "uthmani", "text", "script"):
    if hasattr(info, cand):
        v = getattr(info, cand)
        if isinstance(v, str):
            print(f"{cand} = {v!r}")
            if text is None:
                text = v

print("\n== phonetize ==")
moshaf = MoshafAttributes(
    rewaya="hafs",
    madd_monfasel_len=4,
    madd_mottasel_len=4,
    madd_mottasel_waqf=4,
    madd_aared_len=4,
)
ref = quran_phonetizer(text, moshaf)
print("phonemes:", repr(ref.phonemes))
print("mappings type:", type(ref.mappings))
try:
    print("mappings head:", ref.mappings[:3])
except Exception as e:
    print("mappings slice err:", e)

print("\n== explain_error ==")
try:
    from quran_transcript import explain_error
    import inspect
    print("signature:", inspect.signature(explain_error))
except Exception as e:
    print("explain_error err:", e)
