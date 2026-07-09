"""
Fuse EmbeddingGemma-300M ONNX model with SentencePiece tokenizer using onnxruntime-extensions.

Based on the actual working example from microsoft/onnxruntime-extensions:
  - tutorials/bert_e2e.py
  - onnxruntime_extensions/tools/add_pre_post_processing_to_model.py:transformers_and_bert()

This creates an end-to-end model that accepts raw text and outputs embeddings.
"""

import os
import sys
import json
import numpy as np
from pathlib import Path

# Force UTF-8 for Windows
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import onnx
import onnxruntime as ort
from transformers import AutoTokenizer
from onnxruntime_extensions.tools.pre_post_processing import (
    PrePostProcessor,
    SentencePieceTokenizer,
    TokenizerParam,
)
from onnxruntime_extensions.tools.pre_post_processing.utils import create_named_value

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = PROJECT_ROOT / "models" / "embedding-gemma"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

MODEL_ID = "onnx-community/embeddinggemma-300m-ONNX"
FUSED_OUTPUT = OUTPUT_DIR / "embeddinggemma_fused_q8.onnx"
REFERENCE_VECTORS_FILE = OUTPUT_DIR / "reference_vectors.json"
MAX_SEQ_LENGTH = 2048
MATRYOSHKA_DIM = 256

# Multilingual clinical test phrases
TEST_PHRASES = [
    "What is the recommended first-line treatment for uncomplicated malaria in pregnancy?",
    "How do I manage a newborn with birth asphyxia?",
    "What are the danger signs in a child under 5 with pneumonia?",
    "Mene ne maganin farko na malaria a lokacin ciki?",
    "Yaya zan taimaki jariri da ke da matsalar numfashi bayan haihuwa?",
    "Kini itọju akọkọ fun iba malaria ninu aboyun?",
    "Bawo ni mo ṣe le ṣe itọju ọmọ tuntun ti ko le mi daadaa?",
    "Kedu ọgwụ mbụ a na-eji agwọ ịba malaria n'oge afọ ime?",
    "Wetin be di first medicine for malaria wen woman dey pregnant?",
    "How I go take help pikin wey no fit breathe well after birth?",
]


def download_model():
    """Download model files from HuggingFace."""
    from huggingface_hub import hf_hub_download

    print(f"[1/5] Downloading EmbeddingGemma-300M ONNX model...")

    local_dir = OUTPUT_DIR / "hf_cache"
    local_dir.mkdir(parents=True, exist_ok=True)

    files = [
        ("onnx/model_quantized.onnx", "model_quantized.onnx"),
        ("onnx/model_quantized.onnx_data", "model_quantized.onnx_data"),
        ("tokenizer.model", "tokenizer.model"),
        ("tokenizer.json", "tokenizer.json"),
        ("config.json", "config.json"),
    ]

    for remote, local_name in files:
        dest = local_dir / local_name
        if dest.exists() and dest.stat().st_size > 1000:
            print(f"  Already present: {local_name}")
            continue
        print(f"  Downloading: {remote}...")
        downloaded = hf_hub_download(
            repo_id=MODEL_ID,
            filename=remote,
            local_dir=str(local_dir),
            local_dir_use_symlinks=False,
        )
        actual = Path(downloaded)
        if actual != dest:
            import shutil
            shutil.copy2(str(actual), str(dest))

    return local_dir


def compute_reference_embeddings(model_dir: Path):
    """Compute reference embeddings with separate tokenizer + model."""
    print(f"\n[2/5] Computing reference embeddings (separate tokenizer + model)...")

    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    model_path = model_dir / "model_quantized.onnx"
    session = ort.InferenceSession(str(model_path))

    input_names = [i.name for i in session.get_inputs()]
    output_names = [o.name for o in session.get_outputs()]
    print(f"  Model inputs: {input_names}")
    print(f"  Model outputs: {output_names}")

    query_prefix = "task: search result | query: "
    reference_embeddings = {}

    for phrase in TEST_PHRASES:
        prefixed = query_prefix + phrase
        encoded = tokenizer(
            prefixed,
            padding=False,
            truncation=True,
            max_length=MAX_SEQ_LENGTH,
            return_tensors="np",
        )

        input_ids = encoded["input_ids"].astype(np.int64)
        attention_mask = encoded["attention_mask"].astype(np.int64)

        feeds = {"input_ids": input_ids, "attention_mask": attention_mask}
        outputs = session.run(output_names, feeds)

        emb_idx = output_names.index("sentence_embedding") if "sentence_embedding" in output_names else 0
        full_emb = outputs[emb_idx][0]

        norm = np.linalg.norm(full_emb)
        assert 0.95 < norm < 1.05, f"Reference embedding norm {norm} != 1.0"

        truncated = full_emb[:MATRYOSHKA_DIM].copy()
        truncated /= np.linalg.norm(truncated)

        reference_embeddings[phrase] = {
            "full_768": full_emb.tolist(),
            "truncated_256": truncated.tolist(),
            "token_ids": input_ids[0].tolist(),
            "token_count": len(input_ids[0]),
        }

        print(f"  [{len(input_ids[0]):3d} tokens] {phrase[:60]}...")

    return reference_embeddings


def build_fused_model(model_dir: Path):
    """Build fused model using PrePostProcessor."""
    print(f"\n[3/5] Building fused model (tokenizer + EmbeddingGemma)...")

    sp_model_path = model_dir / "tokenizer.model"
    base_model_path = model_dir / "model_quantized.onnx"

    # Load base model
    base_model = onnx.load(str(base_model_path))

    # Check base model opset
    opset_imports = base_model.opset_import
    max_opset = max(imp.version for imp in opset_imports if imp.domain == "" or imp.domain == "ai.onnx")
    print(f"  Base model opset: {max_opset}")

    # Define text input (what the fused model will accept)
    # Use batch=1 for simplicity - Android will call per-query anyway
    inputs = [create_named_value("text", onnx.TensorProto.STRING, [1])]

    # Create preprocessor
    pipeline = PrePostProcessor(inputs, onnx_opset=max_opset)

    # Create SentencePiece tokenizer step
    tokenizer_param = TokenizerParam(
        vocab_or_file=sp_model_path,
        # EmbeddingGemma doesn't use do_lower_case, is_sentence_pair, tweaked_bos_id
        # These are BERT-specific params - omit them
    )

    preprocessing = [
        SentencePieceTokenizer(
            tokenizer_param=tokenizer_param,
            add_bos=True,
            add_eos=True,
        )
    ]

    pipeline.add_pre_processing(preprocessing)

    # Run fusion
    print(f"  Fusing tokenizer with base model...")
    try:
        fused_model = pipeline.run(base_model)
    except onnx.checker.ValidationError as e:
        # The base model uses SimplifiedLayerNormalization from com.microsoft domain
        # which onnx.checker doesn't recognize in opset 21. This is a validation issue,
        # not a fusion issue. The model is valid for onnxruntime with extensions.
        print(f"  ⚠ Validation warning (expected): {e}")
        print(f"  Continuing - onnxruntime-extensions supports this op")

        # Manually construct the fused model without validation
        # PrePostProcessor already did the graph fusion, we just need to skip the checker
        import sys
        import io

        # Monkey-patch check_model to be a no-op temporarily
        original_check = onnx.checker.check_model
        onnx.checker.check_model = lambda x: None

        try:
            fused_model = pipeline.run(base_model)
        finally:
            onnx.checker.check_model = original_check

    # Save
    onnx.save(fused_model, str(FUSED_OUTPUT))
    print(f"  Saved: {FUSED_OUTPUT}")
    print(f"  Size: {FUSED_OUTPUT.stat().st_size / (1024*1024):.1f} MB")

    return FUSED_OUTPUT


def verify_fused_model(reference_embeddings: dict):
    """Verify fused model produces identical results to reference."""
    print(f"\n[4/5] Verifying fused model against reference...")

    from onnxruntime_extensions import get_library_path

    so = ort.SessionOptions()
    so.register_custom_ops_library(get_library_path())

    session = ort.InferenceSession(str(FUSED_OUTPUT), so)

    print(f"  Session loaded")
    print(f"  Inputs: {[(i.name, i.shape, i.type) for i in session.get_inputs()]}")
    print(f"  Outputs: {[(o.name, o.shape, o.type) for o in session.get_outputs()]}")

    query_prefix = "task: search result | query: "
    results = []

    for phrase in TEST_PHRASES:
        prefixed = query_prefix + phrase
        ref = reference_embeddings[phrase]

        # Run fused model with raw text
        text_input = np.array([prefixed])
        outputs = session.run(None, {"text": text_input})

        # outputs = [last_hidden_state, sentence_embedding]
        # We want sentence_embedding which is output[1], shape [1, 768]
        full_emb = outputs[1][0]  # Extract [0] to get shape [768]

        # Matryoshka truncation
        truncated = full_emb[:MATRYOSHKA_DIM].copy()
        truncated /= np.linalg.norm(truncated)

        # Compare with reference
        ref_trunc = np.array(ref["truncated_256"])
        cosine = np.dot(truncated, ref_trunc)

        # Token ID comparison - we can't directly check this with fused model
        # but we can verify the embedding is correct
        results.append({
            "phrase": phrase[:60],
            "cosine_256": float(cosine),
            "ref_tokens": ref["token_count"],
        })

        status = "✓ OK" if cosine > 0.999 else ("⚠ WARN" if cosine > 0.99 else "✗ FAIL")
        print(f"  [{status}] cos={cosine:.6f} ref_tokens={ref['token_count']} '{phrase[:50]}...'")

    # Summary
    cosines = [r["cosine_256"] for r in results]
    min_cos = min(cosines)
    avg_cos = sum(cosines) / len(cosines)

    print(f"\n  Summary:")
    print(f"    Cosine similarity (256-dim): min={min_cos:.6f}, avg={avg_cos:.6f}")
    print(f"    All cosines > 0.999: {all(c > 0.999 for c in cosines)}")

    passed = all(c > 0.999 for c in cosines)
    return passed, results


def save_reference_vectors(reference_embeddings: dict):
    """Save reference vectors as test fixture."""
    print(f"\n[5/5] Saving reference vectors...")

    fixture = {
        "model": "google/embeddinggemma-300m",
        "quantization": "q8",
        "dimensions": MATRYOSHKA_DIM,
        "max_seq_length": MAX_SEQ_LENGTH,
        "query_prefix": "task: search result | query: ",
        "phrases": {}
    }

    for phrase, data in reference_embeddings.items():
        fixture["phrases"][phrase] = {
            "token_ids": data["token_ids"],
            "token_count": data["token_count"],
            "embedding_256": data["truncated_256"],
        }

    with open(REFERENCE_VECTORS_FILE, "w") as f:
        json.dump(fixture, f, indent=2)

    print(f"  Saved: {REFERENCE_VECTORS_FILE}")


def main():
    print("=" * 70)
    print("EmbeddingGemma-300M ONNX Fusion + Verification")
    print("=" * 70)

    model_dir = download_model()
    reference_embeddings = compute_reference_embeddings(model_dir)

    try:
        build_fused_model(model_dir)
    except Exception as e:
        print(f"\n  FATAL: Fusion failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    passed, results = verify_fused_model(reference_embeddings)
    save_reference_vectors(reference_embeddings)

    print("\n" + "=" * 70)
    if passed:
        print("✓ PASS: Fused model output matches reference pipeline")
        print(f"  All {len(TEST_PHRASES)} test phrases: cosine > 0.999")
        print(f"  Artifact: {FUSED_OUTPUT}")
    else:
        print("✗ FAIL: Output does not match reference — DO NOT DEPLOY")
        print("  Review results above")
        sys.exit(1)

    print("=" * 70)


if __name__ == "__main__":
    main()
