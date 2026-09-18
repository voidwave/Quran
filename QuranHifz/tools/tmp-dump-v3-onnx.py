"""tmp-dump-v3-onnx.py — print the v3 streaming-CTC ONNX contract (inputs,
outputs, metadata) so the JS driver can be verified against it."""
import json
import sys

import onnx

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PATH = r"d:\voidwave.com apps\Quran\QuranHifz\tools\asr-models\zipformer-p-arabic-v3\zipformer_p_arabic_v3.1.int8.onnx"

model = onnx.load(PATH)
graph = model.graph

meta = {p.key: p.value for p in model.metadata_props}
print("metadata:", json.dumps(meta, ensure_ascii=False))

def shape_of(vi):
    dims = []
    for d in vi.type.tensor_type.shape.dim:
        dims.append(d.dim_value if d.HasField("dim_value") else d.dim_param)
    return dims

inputs = [(i.name, shape_of(i)) for i in graph.input]
outputs = [(o.name, shape_of(o)) for o in graph.output]
print("input count:", len(inputs))
print("output count:", len(outputs))
for name, shape in inputs[:6]:
    print("  IN ", name, shape)
print("  ...")
special = [x for x in inputs if not x[0].startswith("cached_")]
print("special inputs:", special)
for name, shape in outputs[:6]:
    print("  OUT", name, shape)
print("  ...")
special_out = [x for x in outputs if not x[0].startswith("new_")]
print("special outputs:", special_out)

names = [n for n, _ in inputs if n.startswith("cached_")]
kinds = {}
for n in names:
    kind = n.split("_")[1]
    kinds[kind] = kinds.get(kind, 0) + 1
print("cache kinds:", kinds)
if names:
    print("cache name examples:", names[:6], "...", names[-3:])
