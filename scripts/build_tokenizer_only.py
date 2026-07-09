"""
Build a standalone SentencePiece tokenizer ONNX graph.

This tokenizer graph:
- Input: text (string)
- Output: input_ids (int64 [1, seq_len]), attention_mask (int64 [1, seq_len])
- Handles: BOS/EOS tokens, truncation to 2048 tokens, Matryoshka prefix

On Android, this runs as a separate session before the model session.
Two sessions is functionally identical to fused-graph, just 2 session.run() calls.
"""

from pathlib import Path
import onnx
from onnx import helper, TensorProto
import onnxruntime as ort
from onnxruntime_extensions import get_library_path
import numpy as np

MODEL_DIR = Path("models/embedding-gemma/hf_cache")
OUTPUT_DIR = Path("models/embedding-gemma")
sp_model_path = MODEL_DIR / "tokenizer.model"
output_path = OUTPUT_DIR / "tokenizer.onnx"

# Read SentencePiece model binary
with open(sp_model_path, 'rb') as f:
    sp_model_bytes = f.read()

print(f"Building standalone tokenizer ONNX graph...")
print(f"  SentencePiece model: {sp_model_path} ({len(sp_model_bytes)} bytes)")

# Graph input: text (batch of strings)
graph_input = helper.make_tensor_value_info("text", TensorProto.STRING, [None])

# SentencepieceTokenizer custom op
# Based on onnxruntime-extensions source, this op:
# - Takes string input
# - Outputs token_ids (int32, flat 1D array) and optionally indices
# The signature varies by version - let's use the simplest form
sp_node = helper.make_node(
    "SentencepieceTokenizer",
    inputs=["text"],
    outputs=["token_ids_flat"],
    domain="com.microsoft.extensions",
    model=sp_model_bytes,
    add_bos=True,
    add_eos=True,
)

# The output is a flat 1D int32 array of all tokens from all batch items
# We need to:
# 1. Reshape to [batch, seq_len] - but we don't know seq_len ahead of time
# 2. Truncate to max 2048 tokens
# 3. Cast to int64 for model compatibility
# 4. Create attention_mask (all 1s)

# For now, assume batch=1 and handle variable seq_len
# Reshape to [1, -1] (infer sequence length)
reshape_shape = helper.make_tensor("reshape_shape", TensorProto.INT64, [2], [1, -1])
reshape_node = helper.make_node(
    "Reshape",
    inputs=["token_ids_flat", "reshape_shape"],
    outputs=["tokens_2d_int32"]
)

# Get sequence length (shape[1])
shape_node = helper.make_node(
    "Shape",
    inputs=["tokens_2d_int32"],
    outputs=["tokens_shape"]
)

gather_indices = helper.make_tensor("gather_idx_1", TensorProto.INT64, [1], [1])
gather_seqlen_node = helper.make_node(
    "Gather",
    inputs=["tokens_shape", "gather_idx_1"],
    outputs=["seq_len_scalar"]
)

# Truncate to max 2048 if needed
# Compare seq_len with 2048
max_len = helper.make_tensor("max_len", TensorProto.INT64, [1], [2048])
min_node = helper.make_node(
    "Min",
    inputs=["seq_len_scalar", "max_len"],
    outputs=["actual_len"]
)

# Slice tokens_2d_int32 to [:, :actual_len]
# Slice(data, starts, ends, axes, steps)
starts = helper.make_tensor("slice_starts", TensorProto.INT64, [2], [0, 0])
axes = helper.make_tensor("slice_axes", TensorProto.INT64, [2], [0, 1])
# ends = [1, actual_len] - need to construct this dynamically
one_const = helper.make_tensor("one", TensorProto.INT64, [1], [1])

# Concatenate [1, actual_len] for ends
# First unsqueeze actual_len to [1]
unsqueeze_axes = helper.make_tensor("unsqueeze_axes", TensorProto.INT64, [1], [0])
unsqueeze_node = helper.make_node(
    "Unsqueeze",
    inputs=["actual_len", "unsqueeze_axes"],
    outputs=["actual_len_1d"]
)

concat_node = helper.make_node(
    "Concat",
    inputs=["one", "actual_len_1d"],
    outputs=["slice_ends"],
    axis=0
)

slice_node = helper.make_node(
    "Slice",
    inputs=["tokens_2d_int32", "slice_starts", "slice_ends", "slice_axes"],
    outputs=["tokens_truncated_int32"]
)

# Cast to int64
cast_node = helper.make_node(
    "Cast",
    inputs=["tokens_truncated_int32"],
    outputs=["input_ids"],
    to=TensorProto.INT64
)

# Create attention_mask (all 1s, same shape as input_ids)
shape_ids_node = helper.make_node(
    "Shape",
    inputs=["input_ids"],
    outputs=["ids_shape"]
)

ones_value = helper.make_tensor("ones_value", TensorProto.INT64, [1], [1])
constantofshape_node = helper.make_node(
    "ConstantOfShape",
    inputs=["ids_shape"],
    outputs=["attention_mask"],
    value=ones_value
)

# Graph outputs
output_ids = helper.make_tensor_value_info("input_ids", TensorProto.INT64, [1, None])
output_mask = helper.make_tensor_value_info("attention_mask", TensorProto.INT64, [1, None])

# Build graph
graph = helper.make_graph(
    nodes=[
        sp_node,
        reshape_node,
        shape_node,
        gather_seqlen_node,
        min_node,
        unsqueeze_node,
        concat_node,
        slice_node,
        cast_node,
        shape_ids_node,
        constantofshape_node,
    ],
    name="sentencepiece_tokenizer",
    inputs=[graph_input],
    outputs=[output_ids, output_mask],
    initializer=[reshape_shape, gather_indices, max_len, starts, axes, one_const, unsqueeze_axes, ones_value],
)

# Create model
opset_imports = [
    helper.make_opsetid("", 17),
    helper.make_opsetid("com.microsoft.extensions", 1),
]

model = helper.make_model(graph, opset_imports=opset_imports)
model.ir_version = 8

onnx.save(model, str(output_path))
print(f"  Saved: {output_path}")
print(f"  Size: {output_path.stat().st_size / 1024:.1f} KB")

# Verify by loading and testing
print(f"\n  Verifying...")
so = ort.SessionOptions()
so.register_custom_ops_library(get_library_path())

session = ort.InferenceSession(str(output_path), so)
print(f"    Session loaded")
print(f"    Inputs: {[(i.name, i.shape, i.type) for i in session.get_inputs()]}")
print(f"    Outputs: {[(o.name, o.shape, o.type) for o in session.get_outputs()]}")

# Test inference
test_phrases = [
    "What is malaria?",
    "task: search result | query: What is the recommended first-line treatment for uncomplicated malaria in pregnancy?",
    "task: search result | query: " + ("very long query " * 300),  # Test truncation
]

for phrase in test_phrases:
    try:
        result = session.run(None, {"text": np.array([phrase])})
        input_ids = result[0]
        attention_mask = result[1]
        print(f"    ✓ '{phrase[:50]}...' → {input_ids.shape[1]} tokens")
        assert input_ids.shape == attention_mask.shape, "Shape mismatch"
        assert input_ids.shape[1] <= 2048, f"Not truncated: {input_ids.shape[1]} tokens"
        assert np.all(attention_mask == 1), "Attention mask not all 1s"
    except Exception as e:
        print(f"    ✗ '{phrase[:50]}...' → ERROR: {e}")
        raise

print(f"\n  SUCCESS: Tokenizer graph is valid and working")
print(f"  Deploy: Copy {output_path} to Android assets")
