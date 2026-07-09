"""Test just the SentencepieceTokenizer op output to understand its format."""

from pathlib import Path
import onnx
from onnx import helper
import onnxruntime as ort
from onnxruntime_extensions import get_library_path
import numpy as np

MODEL_DIR = Path("models/embedding-gemma/hf_cache")
sp_model_path = MODEL_DIR / "tokenizer.model"

# Read SentencePiece model binary
with open(sp_model_path, 'rb') as f:
    sp_model_bytes = f.read()

# Build minimal graph - just the tokenizer op, see what it actually outputs
graph_input = helper.make_tensor_value_info("text", onnx.TensorProto.STRING, [None])

tokenizer_node = helper.make_node(
    "SentencepieceTokenizer",
    inputs=["text"],
    outputs=["token_ids", "token_shape"],
    domain="com.microsoft.extensions",
    model=sp_model_bytes,
    add_bos=True,
    add_eos=True,
)

# Declare outputs as INT32 and INT64
output_ids = helper.make_tensor_value_info("token_ids", onnx.TensorProto.INT32, [None])
output_shape = helper.make_tensor_value_info("token_shape", onnx.TensorProto.INT64, [None])

graph = helper.make_graph(
    [tokenizer_node],
    "sp_test",
    [graph_input],
    [output_ids, output_shape],
)

opset_imports = [
    helper.make_opsetid("", 17),
    helper.make_opsetid("com.microsoft.extensions", 1),
]

model = helper.make_model(graph, opset_imports=opset_imports)
model.ir_version = 8

output_path = Path("models/embedding-gemma/tokenizer_simple.onnx")
onnx.save(model, str(output_path))

print(f"Created: {output_path}")

# Load and test
so = ort.SessionOptions()
so.register_custom_ops_library(get_library_path())

session = ort.InferenceSession(str(output_path), so)
print(f"Inputs: {[(i.name, i.shape, i.type) for i in session.get_inputs()]}")
print(f"Outputs: {[(o.name, o.shape, o.type) for o in session.get_outputs()]}")

# Test
try:
    test_text = np.array(["Hello world"])
    print(f"\nInput: {test_text}")
    result = session.run(None, {"text": test_text})
    print(f"Output 0 (token_ids): shape={result[0].shape}, dtype={result[0].dtype}")
    print(f"  Data: {result[0]}")
    print(f"Output 1 (token_shape): shape={result[1].shape}, dtype={result[1].dtype}")
    print(f"  Data: {result[1]}")
except Exception as e:
    print(f"ERROR: {e}")
    import traceback
    traceback.print_exc()
