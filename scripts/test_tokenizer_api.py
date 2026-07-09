"""Test onnxruntime-extensions tokenizer API to find the correct approach."""

from pathlib import Path
from onnxruntime_extensions import get_library_path
import onnxruntime as ort

MODEL_DIR = Path("models/embedding-gemma/hf_cache")
sp_model_path = MODEL_DIR / "tokenizer.model"

print(f"SentencePiece model: {sp_model_path}")
print(f"Exists: {sp_model_path.exists()}")
print(f"Extensions library: {get_library_path()}")

# Try approach 1: OrtPyFunction (high-level API)
try:
    from onnxruntime_extensions import OrtPyFunction
    print("\n[Approach 1] OrtPyFunction available")

    # Create a tokenizer function
    # This should work but may not export to ONNX easily
except ImportError as e:
    print(f"\n[Approach 1] OrtPyFunction not available: {e}")

# Try approach 2: gen_processing_models
try:
    from onnxruntime_extensions.tools import add_pre_post_processing_to_model
    print("\n[Approach 2] add_pre_post_processing_to_model available")
    print(f"  Signature: {add_pre_post_processing_to_model.__doc__}")
except ImportError as e:
    print(f"\n[Approach 2] Not available: {e}")

# Try approach 3: Direct custom op with proper format
print("\n[Approach 3] Manual ONNX graph with SentencepieceTokenizer")
print("  Checking onnxruntime-extensions documentation...")

# The issue: SentencepieceTokenizer expects the model as a STRING attribute, not a tensor input
# Let me check the actual op definition
try:
    import onnx
    from onnx import helper

    # The correct approach: use the model path as an attribute, not an input
    print("\n[Approach 4] Use model path as attribute")
    print("  This is the correct approach for SentencepieceTokenizer")

    # Build minimal graph
    # SentencepieceTokenizer outputs: indices (int32), indices_shape (int64)
    # We need to reshape and create attention_mask manually
    graph_input = helper.make_tensor_value_info("text", onnx.TensorProto.STRING, [None])

    # Read SentencePiece model binary
    with open(sp_model_path, 'rb') as f:
        sp_model_bytes = f.read()

    # SentencepieceTokenizer node with model as attribute
    # Outputs: token_ids (int32, flat), token_shape (int64)
    # Note: padding_length might not be supported, truncation handled separately
    tokenizer_node = helper.make_node(
        "SentencepieceTokenizer",
        inputs=["text"],
        outputs=["token_ids_flat", "token_shape"],
        domain="com.microsoft.extensions",
        model=sp_model_bytes,  # Model binary as bytes attribute
        add_bos=True,
        add_eos=True,
    )

    # Reshape token_ids to [batch, seq_len]
    reshape_node = helper.make_node(
        "Reshape",
        inputs=["token_ids_flat", "token_shape"],
        outputs=["input_ids_int32"]
    )

    # Cast to int64 for model compatibility
    cast_node = helper.make_node(
        "Cast",
        inputs=["input_ids_int32"],
        outputs=["input_ids"],
        to=onnx.TensorProto.INT64
    )

    # Create attention_mask (all 1s, same shape)
    # Get shape of input_ids
    shape_node = helper.make_node(
        "Shape",
        inputs=["input_ids"],
        outputs=["ids_shape"]
    )

    # ConstantOfShape to create all-1 tensor
    ones_node = helper.make_node(
        "ConstantOfShape",
        inputs=["ids_shape"],
        outputs=["attention_mask"],
        value=helper.make_tensor("value", onnx.TensorProto.INT64, [1], [1])
    )

    graph_output_ids = helper.make_tensor_value_info("input_ids", onnx.TensorProto.INT64, [None, None])
    graph_output_mask = helper.make_tensor_value_info("attention_mask", onnx.TensorProto.INT64, [None, None])

    graph = helper.make_graph(
        [tokenizer_node, reshape_node, cast_node, shape_node, ones_node],
        "sentencepiece_tokenizer",
        [graph_input],
        [graph_output_ids, graph_output_mask],
    )

    opset_imports = [
        helper.make_opsetid("", 17),
        helper.make_opsetid("com.microsoft.extensions", 1),
    ]

    model = helper.make_model(graph, opset_imports=opset_imports)
    model.ir_version = 8

    output_path = Path("models/embedding-gemma/tokenizer_test.onnx")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(model, str(output_path))

    print(f"  Created test tokenizer: {output_path}")

    # Try to load it
    so = ort.SessionOptions()
    so.register_custom_ops_library(get_library_path())

    session = ort.InferenceSession(str(output_path), so)
    print(f"  SUCCESS: Session created")
    print(f"  Inputs: {[i.name for i in session.get_inputs()]}")
    print(f"  Outputs: {[o.name for o in session.get_outputs()]}")

    # Test it
    import numpy as np
    result = session.run(None, {"text": np.array(["Hello world"])})
    print(f"  Test encoding: {result[0][0][:10]}... (first 10 tokens)")
    print(f"  Token count: {len(result[0][0])}")

except Exception as e:
    print(f"\n[Approach 4] Failed: {e}")
    import traceback
    traceback.print_exc()
