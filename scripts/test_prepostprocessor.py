"""Test PrePostProcessor with SentencePieceTokenizer step."""

from pathlib import Path
import onnx
from onnxruntime_extensions.tools.add_pre_post_processing_to_model import (
    PrePostProcessor,
    SentencePieceTokenizer,
    TokenizerParam,
)

MODEL_DIR = Path("models/embedding-gemma/hf_cache")
sp_model_path = MODEL_DIR / "tokenizer.model"
base_model_path = MODEL_DIR / "model_quantized.onnx"
output_path = Path("models/embedding-gemma/fused_prepostprocessor.onnx")

print("Creating fused model with PrePostProcessor...")
print(f"  Tokenizer: {sp_model_path}")
print(f"  Base model: {base_model_path}")

# Load base model
base_model = onnx.load(str(base_model_path))

# Define the raw text input (what the fused model will accept)
text_input = onnx.helper.make_tensor_value_info("text", onnx.TensorProto.STRING, [None])

# Create preprocessor with opset 21 to match base model
processor = PrePostProcessor(inputs=[text_input], onnx_opset=21)

# Add SentencePiece tokenizer as preprocessing step
# This should:
# 1. Take raw text input
# 2. Tokenize with SentencePiece
# 3. Feed token IDs + attention mask to the base model
try:
    # Create TokenizerParam with SentencePiece model
    tokenizer_param = TokenizerParam(vocab_or_file=sp_model_path)

    tokenizer_step = SentencePieceTokenizer(
        tokenizer_param=tokenizer_param,
        add_bos=True,
        add_eos=True,
        name="sp_tokenizer",  # Give it an explicit name
    )

    # The tokenizer step needs to know its input name
    processor.add_pre_processing([tokenizer_step])

    # Export fused model
    fused_model = processor.run(base_model)
    onnx.save(fused_model, str(output_path))

    print(f"  SUCCESS: Fused model saved to {output_path}")
    print(f"  Size: {output_path.stat().st_size / (1024*1024):.1f} MB")

    # Verify model structure
    print(f"\n  Model structure:")
    print(f"    Inputs: {[i.name for i in fused_model.graph.input]}")
    print(f"    Outputs: {[o.name for o in fused_model.graph.output]}")

    # Try to load it
    import onnxruntime as ort
    from onnxruntime_extensions import get_library_path

    so = ort.SessionOptions()
    so.register_custom_ops_library(get_library_path())

    session = ort.InferenceSession(str(output_path), so)
    print(f"\n  Session loaded successfully")
    print(f"    Session inputs: {[(i.name, i.shape, i.type) for i in session.get_inputs()]}")
    print(f"    Session outputs: {[(o.name, o.shape, o.type) for o in session.get_outputs()]}")

    # Test inference
    import numpy as np
    test_text = np.array(["Hello world"])
    result = session.run(None, {"text": test_text})
    print(f"\n  Test inference SUCCESS")
    print(f"    Input: {test_text}")
    print(f"    Output shape: {result[0].shape if len(result) > 0 else 'none'}")

except Exception as e:
    print(f"ERROR: {e}")
    import traceback
    traceback.print_exc()
