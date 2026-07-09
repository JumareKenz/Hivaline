"""Test OrtPyFunction API for creating tokenizer."""

from pathlib import Path
from onnxruntime_extensions import OrtPyFunction, SpmTokenizer
import numpy as np

MODEL_DIR = Path("models/embedding-gemma/hf_cache")
sp_model_path = MODEL_DIR / "tokenizer.model"

print(f"Testing SentencePieceTokenizer with OrtPyFunction...")
print(f"Model: {sp_model_path}")

# Create tokenizer using OrtPyFunction
try:
    # Check what's available
    print(f"\nAvailable: {dir(OrtPyFunction)}")

    # Try to create a SentencePiece tokenizer
    tokenizer = SpmTokenizer(str(sp_model_path))
    print(f"Created tokenizer: {tokenizer}")

    # Test encoding
    test_text = "Hello world"
    result = tokenizer.encode(test_text)
    print(f"Encoded '{test_text}': {result}")

except Exception as e:
    print(f"ERROR: {e}")
    import traceback
    traceback.print_exc()

# Alternative: use onnxruntime-extensions' pre_post_processing tools
print("\n\nTrying add_pre_post_processing_to_model...")
try:
    from onnxruntime_extensions.tools import add_pre_post_processing_to_model
    from onnxruntime_extensions.tools.add_pre_post_processing_to_model import NLPTaskType
    import onnx

    # Load base model
    base_model_path = MODEL_DIR / "model_quantized.onnx"
    base_model = onnx.load(str(base_model_path))

    print(f"Loaded base model: {base_model_path}")
    print(f"Base inputs: {[i.name for i in base_model.graph.input]}")
    print(f"Base outputs: {[o.name for o in base_model.graph.output]}")

    # This API can add tokenization pre-processing
    print("\nadd_pre_post_processing_to_model API:")
    print(add_pre_post_processing_to_model.__doc__)

except Exception as e:
    print(f"ERROR: {e}")
    import traceback
    traceback.print_exc()
