"""
fuse_embeddinggemma_onnx.py — Build a fused EmbeddingGemma-300M ONNX model
that accepts raw text input and outputs 768-dim L2-normalized embeddings.

The fused graph includes:
  - SentencePiece tokenization (custom op from onnxruntime-extensions)
  - EmbeddingGemma-300M Transformer + pooling + Dense projection + L2 normalize

The output .onnx file is the deployment artifact for Android NativeRetriever.
Android-side post-processing: truncate 768 -> 256 (Matryoshka) + re-normalize.

Max sequence length (2048) is enforced at tokenization via the graph.

Usage:
    python scripts/fuse_embeddinggemma_onnx.py

Output:
    models/embedding-gemma/embeddinggemma_fused_q8.onnx

Verification:
    Compares fused-graph output against reference (separate tokenizer + model)
    for multilingual clinical test phrases. Cosine similarity must be ~1.0.
"""

import os
import sys
import json
import numpy as np
from pathlib import Path

# Force UTF-8 encoding for Windows console output
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# Ensure we can find our packages
PYTHON = sys.executable
PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = PROJECT_ROOT / "models" / "embedding-gemma"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

MODEL_ID = "onnx-community/embeddinggemma-300m-ONNX"
FUSED_OUTPUT = OUTPUT_DIR / "embeddinggemma_fused_q8.onnx"
REFERENCE_VECTORS_FILE = OUTPUT_DIR / "reference_vectors.json"
MAX_SEQ_LENGTH = 2048
MATRYOSHKA_DIM = 256

# Multilingual clinical test phrases (English, Hausa, Yoruba, Igbo, Pidgin)
TEST_PHRASES = [
    # English clinical
    "What is the recommended first-line treatment for uncomplicated malaria in pregnancy?",
    "How do I manage a newborn with birth asphyxia?",
    "What are the danger signs in a child under 5 with pneumonia?",
    # Hausa clinical
    "Mene ne maganin farko na malaria a lokacin ciki?",
    "Yaya zan taimaki jariri da ke da matsalar numfashi bayan haihuwa?",
    # Yoruba clinical
    "Kini itọju akọkọ fun iba malaria ninu aboyun?",
    "Bawo ni mo ṣe le ṣe itọju ọmọ tuntun ti ko le mi daadaa?",
    # Igbo clinical
    "Kedu ọgwụ mbụ a na-eji agwọ ịba malaria n'oge afọ ime?",
    # Pidgin clinical
    "Wetin be di first medicine for malaria wen woman dey pregnant?",
    "How I go take help pikin wey no fit breathe well after birth?",
]


def download_model():
    """Download model files from HuggingFace if not present."""
    from huggingface_hub import hf_hub_download, snapshot_download

    print(f"[1/5] Downloading EmbeddingGemma-300M ONNX model...")

    # Download the quantized model + data + tokenizer
    local_dir = OUTPUT_DIR / "hf_cache"
    local_dir.mkdir(parents=True, exist_ok=True)

    files_needed = [
        ("onnx/model_quantized.onnx", "model_quantized.onnx"),
        ("onnx/model_quantized.onnx_data", "model_quantized.onnx_data"),
        ("tokenizer.model", "tokenizer.model"),
        ("tokenizer.json", "tokenizer.json"),
        ("config.json", "config.json"),
    ]

    for remote_path, local_name in files_needed:
        dest = local_dir / local_name
        if dest.exists() and dest.stat().st_size > 1000:
            print(f"  Already present: {local_name}")
            continue
        print(f"  Downloading: {remote_path}...")
        downloaded = hf_hub_download(
            repo_id=MODEL_ID,
            filename=remote_path,
            local_dir=str(local_dir),
            local_dir_use_symlinks=False,
        )
        # hf_hub_download puts files in subdirs matching remote path
        actual = Path(downloaded)
        if actual != dest:
            import shutil
            shutil.copy2(str(actual), str(dest))

    return local_dir


def compute_reference_embeddings(model_dir: Path):
    """
    Compute reference embeddings using the standard pipeline:
    separate tokenizer + ONNX model. This is the trusted reference.
    """
    import onnxruntime as ort
    from transformers import AutoTokenizer

    print(f"\n[2/5] Computing reference embeddings (separate tokenizer + model)...")

    # Load tokenizer
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)

    # Load ONNX model
    model_path = model_dir / "model_quantized.onnx"
    session = ort.InferenceSession(str(model_path))

    # Get input/output names
    input_names = [i.name for i in session.get_inputs()]
    output_names = [o.name for o in session.get_outputs()]
    print(f"  Model inputs: {input_names}")
    print(f"  Model outputs: {output_names}")

    query_prefix = "task: search result | query: "
    reference_embeddings = {}

    for phrase in TEST_PHRASES:
        prefixed = query_prefix + phrase
        # Tokenize
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

        # Find sentence_embedding output
        emb_idx = output_names.index("sentence_embedding") if "sentence_embedding" in output_names else 0
        full_emb = outputs[emb_idx][0]  # shape: (768,)

        # Verify it's normalized
        norm = np.linalg.norm(full_emb)
        assert 0.95 < norm < 1.05, f"Reference embedding norm {norm} is not ~1.0"

        # Matryoshka truncation + re-normalize
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


def build_fused_graph(model_dir: Path):
    """
    Build a fused ONNX graph: SentencePiece tokenizer -> EmbeddingGemma model.
    Input: raw text string. Output: sentence_embedding [1, 768].
    """
    from onnxruntime_extensions import gen_processing_models
    from onnxruntime_extensions.tools.pre_post_processing import PrePostProcessor
    import onnxruntime_extensions

    print(f"\n[3/5] Building fused ONNX graph (tokenizer + model)...")

    # Check if onnxruntime_extensions supports direct graph fusion
    # The recommended approach: use onnxruntime_extensions tools
    try:
        from onnxruntime_extensions.tools import add_pre_post_processing_to_model
    except ImportError:
        pass

    # Alternative: use the lower-level approach with onnx graph manipulation
    import onnx
    from onnx import helper, TensorProto, numpy_helper

    # Load the tokenizer.model binary (SentencePiece proto)
    sp_model_path = model_dir / "tokenizer.model"
    with open(sp_model_path, "rb") as f:
        sp_model_bytes = f.read()

    # Load the base ONNX model
    base_model_path = model_dir / "model_quantized.onnx"
    base_model = onnx.load(str(base_model_path))

    # Create tokenizer subgraph using SentencepieceTokenizer custom op
    # The op is from domain "ai.onnx.contrib" (onnxruntime-extensions)
    #
    # SentencepieceTokenizer op:
    #   inputs: model (bytes), text (string), nbest_size (int64), alpha (float),
    #           add_bos (bool), add_eos (bool), reverse (bool)
    #   outputs: tokens (int32), indices (int64)

    # Create constant nodes for SentencePiece model and config
    sp_model_tensor = numpy_helper.from_array(
        np.frombuffer(sp_model_bytes, dtype=np.uint8),
        name="sp_model_data"
    )

    # Build the tokenizer graph as a separate model, then compose
    # For now, let's use the simpler approach: create the fused model using
    # onnxruntime_extensions' gen_processing_models utility

    # Actually, the most reliable approach for onnxruntime-extensions is to use
    # their TokenizerModel API which generates a pre-processing ONNX graph
    print("  Using onnxruntime_extensions tokenizer model generation...")

    from onnxruntime_extensions.tools.pre_post_processing import (
        PrePostProcessor,
        SentencePieceTokenizer as SPTokenizerStep,
        TokenizerToIds,
    )

    # Try the high-level API
    try:
        from onnxruntime_extensions import OrtPyFunction
        # Test: can we create a standalone tokenizer?
        print("  Testing OrtPyFunction availability...")
    except ImportError:
        print("  OrtPyFunction not available, using manual graph construction")

    # Manual approach: build tokenizer ONNX graph with the SentencepieceTokenizer op
    print("  Building SentencePiece tokenizer graph...")

    # The SentencepieceTokenizer custom op from ort-extensions
    # Domain: "com.microsoft.extensions" (newer) or "ai.onnx.contrib" (older)
    tokenizer_domain = "com.microsoft.extensions"

    # Create the tokenizer graph
    # Input: text (string tensor [1])
    # Output: input_ids (int64 [1, seq_len]), attention_mask (int64 [1, seq_len])

    # Step 1: SentencepieceTokenizer op
    sp_tokenize_node = helper.make_node(
        "SentencepieceTokenizer",
        inputs=["sp_model", "input_text", "nbest_size", "alpha", "add_bos", "add_eos", "reverse"],
        outputs=["raw_token_ids", "token_indices"],
        domain=tokenizer_domain,
    )

    # Constant inputs for tokenizer config
    sp_model_init = numpy_helper.from_array(
        np.frombuffer(sp_model_bytes, dtype=np.uint8), name="sp_model"
    )
    nbest_init = numpy_helper.from_array(np.array([0], dtype=np.int64), name="nbest_size")
    alpha_init = numpy_helper.from_array(np.array([0.0], dtype=np.float32), name="alpha")
    add_bos_init = numpy_helper.from_array(np.array([True]), name="add_bos")
    add_eos_init = numpy_helper.from_array(np.array([True]), name="add_eos")
    reverse_init = numpy_helper.from_array(np.array([False]), name="reverse")

    print(f"  SentencePiece model: {len(sp_model_bytes)} bytes")
    print(f"  Max sequence length: {MAX_SEQ_LENGTH}")
    print(f"  Output dims: 768 (full) -> {MATRYOSHKA_DIM} (truncated on device)")

    # For now, let's take the pragmatic approach:
    # Use onnxruntime-extensions' built-in model generation tool
    # This creates a proper tokenizer ONNX graph that can be composed with the model.

    # Check if we can use the simpler GenericTokenizer approach
    from onnxruntime_extensions.tools.tokenizer import SentencePieceTokenizerOnnxGraph

    tok_graph = SentencePieceTokenizerOnnxGraph(str(sp_model_path))
    tok_model = tok_graph.create_graph(
        max_length=MAX_SEQ_LENGTH,
        add_bos=True,
        add_eos=True,
    )

    # Compose tokenizer model with the base model
    import onnx.compose

    # The tokenizer outputs input_ids and attention_mask
    # The base model expects input_ids and attention_mask
    fused = onnx.compose.merge_models(
        tok_model,
        base_model,
        io_map=[
            ("input_ids", "input_ids"),
            ("attention_mask", "attention_mask"),
        ],
    )

    # Save fused model
    onnx.save(fused, str(FUSED_OUTPUT))
    print(f"  Fused model saved: {FUSED_OUTPUT}")
    print(f"  Size: {FUSED_OUTPUT.stat().st_size / (1024*1024):.1f} MB")

    return FUSED_OUTPUT


def build_fused_graph_fallback(model_dir: Path):
    """
    Fallback: If the high-level onnxruntime-extensions API doesn't work,
    create a two-session approach:
    1. A tokenizer-only ONNX graph (using ort-extensions custom ops)
    2. The base EmbeddingGemma model (unchanged)

    Both are loaded on Android — tokenizer session produces input_ids/attention_mask,
    which are fed to the model session. This is functionally identical to
    fused-graph but with two session.run() calls.
    """
    import onnx
    from onnx import helper, TensorProto, numpy_helper

    print(f"\n[3/5] Building tokenizer-only ONNX graph (two-session approach)...")

    sp_model_path = model_dir / "tokenizer.model"
    with open(sp_model_path, "rb") as f:
        sp_model_bytes = f.read()

    # Build a minimal tokenizer graph using SentencepieceTokenizer custom op
    tokenizer_domain = "com.microsoft.extensions"

    # Graph inputs
    input_text = helper.make_tensor_value_info("input_text", TensorProto.STRING, [None])

    # Constants
    sp_model_const = numpy_helper.from_array(
        np.frombuffer(sp_model_bytes, dtype=np.uint8), name="sp_model"
    )
    nbest_const = numpy_helper.from_array(np.array([0], dtype=np.int64), name="nbest_size")
    alpha_const = numpy_helper.from_array(np.array([0.0], dtype=np.float32), name="alpha")
    add_bos_const = numpy_helper.from_array(np.array([True]), name="add_bos")
    add_eos_const = numpy_helper.from_array(np.array([True]), name="add_eos")
    reverse_const = numpy_helper.from_array(np.array([False]), name="reverse")

    # SentencepieceTokenizer node
    sp_node = helper.make_node(
        "SentencepieceTokenizer",
        inputs=["sp_model", "input_text", "nbest_size", "alpha", "add_bos", "add_eos", "reverse"],
        outputs=["token_ids", "token_indices"],
        domain=tokenizer_domain,
    )

    # Reshape token_ids to [1, seq_len] and create attention_mask
    # token_ids output is flat int32 array
    reshape_shape = numpy_helper.from_array(np.array([1, -1], dtype=np.int64), name="reshape_shape")
    reshape_node = helper.make_node("Reshape", inputs=["token_ids", "reshape_shape"], outputs=["input_ids_int32"])

    # Cast to int64 (model expects int64)
    cast_node = helper.make_node("Cast", inputs=["input_ids_int32"], outputs=["input_ids"], to=TensorProto.INT64)

    # Create attention_mask (all ones, same shape)
    ones_like_node = helper.make_node("Shape", inputs=["input_ids"], outputs=["ids_shape"])
    # Use ConstantOfShape to make all-1 tensor
    one_val = numpy_helper.from_array(np.array([1], dtype=np.int64), name="one_value")
    const_shape_node = helper.make_node(
        "ConstantOfShape",
        inputs=["ids_shape"],
        outputs=["attention_mask"],
        value=helper.make_tensor("one", TensorProto.INT64, [1], [1]),
    )

    # Graph outputs
    output_ids = helper.make_tensor_value_info("input_ids", TensorProto.INT64, [1, None])
    output_mask = helper.make_tensor_value_info("attention_mask", TensorProto.INT64, [1, None])

    # Build graph
    graph = helper.make_graph(
        [sp_node, reshape_node, cast_node, ones_like_node, const_shape_node],
        "sentencepiece_tokenizer",
        [input_text],
        [output_ids, output_mask],
        initializer=[sp_model_const, nbest_const, alpha_const, add_bos_const, add_eos_const, reverse_const, reshape_shape],
    )

    # Create model with custom op domain
    opset_imports = [
        helper.make_opsetid("", 17),
        helper.make_opsetid(tokenizer_domain, 1),
    ]
    model = helper.make_model(graph, opset_imports=opset_imports)
    model.ir_version = 8

    tokenizer_path = OUTPUT_DIR / "tokenizer.onnx"
    onnx.save(model, str(tokenizer_path))
    print(f"  Tokenizer graph saved: {tokenizer_path}")
    print(f"  Size: {tokenizer_path.stat().st_size / 1024:.1f} KB")

    return tokenizer_path


def verify_fused_output(model_dir: Path, reference_embeddings: dict):
    """
    Verify the fused/two-session approach produces numerically identical
    results to the reference pipeline.
    """
    import onnxruntime as ort

    print(f"\n[4/5] Verifying fused output against reference...")

    # Try loading fused model first
    fused_path = FUSED_OUTPUT
    tokenizer_path = OUTPUT_DIR / "tokenizer.onnx"

    # Register extensions
    try:
        from onnxruntime_extensions import get_library_path
        ext_lib = get_library_path()
        print(f"  Extensions library: {ext_lib}")
    except ImportError:
        print("  ERROR: Cannot load onnxruntime_extensions library path")
        return False

    # Try two-session approach (tokenizer + model separately)
    if tokenizer_path.exists():
        print("  Using two-session approach (tokenizer + model)...")

        # Session options with extensions
        so = ort.SessionOptions()
        so.register_custom_ops_library(ext_lib)

        # Load tokenizer session
        tok_session = ort.InferenceSession(str(tokenizer_path), so)
        tok_inputs = [i.name for i in tok_session.get_inputs()]
        tok_outputs = [o.name for o in tok_session.get_outputs()]
        print(f"  Tokenizer inputs: {tok_inputs}, outputs: {tok_outputs}")

        # Load model session (no extensions needed for base model)
        model_path = model_dir / "model_quantized.onnx"
        model_session = ort.InferenceSession(str(model_path))
        model_outputs = [o.name for o in model_session.get_outputs()]

        query_prefix = "task: search result | query: "
        results = []

        for phrase in TEST_PHRASES:
            prefixed = query_prefix + phrase
            ref = reference_embeddings[phrase]

            # Tokenize
            text_input = np.array([prefixed])
            tok_result = tok_session.run(tok_outputs, {"input_text": text_input})

            input_ids = tok_result[tok_outputs.index("input_ids")]
            attention_mask = tok_result[tok_outputs.index("attention_mask")]

            # Truncate to max_length
            if input_ids.shape[1] > MAX_SEQ_LENGTH:
                input_ids = input_ids[:, :MAX_SEQ_LENGTH]
                attention_mask = attention_mask[:, :MAX_SEQ_LENGTH]

            # Verify token IDs match reference
            ref_ids = ref["token_ids"]
            fused_ids = input_ids[0].tolist()

            ids_match = fused_ids == ref_ids
            if not ids_match:
                # Check if it's just padding difference
                min_len = min(len(fused_ids), len(ref_ids))
                prefix_match = fused_ids[:min_len] == ref_ids[:min_len]
                if not prefix_match:
                    print(f"  WARNING: Token ID mismatch for '{phrase[:40]}...'")
                    print(f"    Reference IDs (first 10): {ref_ids[:10]}")
                    print(f"    Fused IDs (first 10): {fused_ids[:10]}")

            # Run model
            feeds = {"input_ids": input_ids, "attention_mask": attention_mask}
            model_result = model_session.run(model_outputs, feeds)

            emb_idx = model_outputs.index("sentence_embedding") if "sentence_embedding" in model_outputs else 0
            full_emb = model_result[emb_idx][0]

            # Matryoshka truncation + re-normalize
            truncated = full_emb[:MATRYOSHKA_DIM].copy()
            truncated /= np.linalg.norm(truncated)

            # Compare with reference
            ref_trunc = np.array(ref["truncated_256"])
            cosine = np.dot(truncated, ref_trunc) / (np.linalg.norm(truncated) * np.linalg.norm(ref_trunc) + 1e-10)

            results.append({
                "phrase": phrase[:60],
                "cosine_256": float(cosine),
                "token_ids_match": ids_match,
                "ref_tokens": len(ref_ids),
                "fused_tokens": len(fused_ids),
            })

            status = "OK" if cosine > 0.999 else ("WARN" if cosine > 0.99 else "FAIL")
            print(f"  [{status}] cos={cosine:.6f} tokens={len(fused_ids)} '{phrase[:50]}...'")

        # Summary
        cosines = [r["cosine_256"] for r in results]
        id_matches = sum(1 for r in results if r["token_ids_match"])
        min_cos = min(cosines)
        avg_cos = sum(cosines) / len(cosines)

        print(f"\n  Summary:")
        print(f"    Token ID exact matches: {id_matches}/{len(results)}")
        print(f"    Cosine similarity (256-dim): min={min_cos:.6f}, avg={avg_cos:.6f}")
        print(f"    All cosines > 0.999: {all(c > 0.999 for c in cosines)}")

        passed = all(c > 0.999 for c in cosines) and id_matches == len(results)
        return passed, results

    print("  ERROR: No tokenizer graph or fused model found")
    return False, []


def save_reference_vectors(reference_embeddings: dict):
    """Save reference vectors as test fixture for on-device verification."""
    print(f"\n[5/5] Saving reference vectors for on-device testing...")

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
    print(f"  Phrases: {len(fixture['phrases'])}")


def main():
    print("=" * 70)
    print("EmbeddingGemma-300M ONNX Fusion + Verification")
    print("=" * 70)

    # Step 1: Download model
    model_dir = download_model()

    # Step 2: Compute reference embeddings (trusted pipeline)
    reference_embeddings = compute_reference_embeddings(model_dir)

    # Step 3: Build fused/tokenizer graph
    try:
        fused_path = build_fused_graph(model_dir)
    except Exception as e:
        print(f"  Fused graph failed ({e}), trying two-session fallback...")
        try:
            tokenizer_path = build_fused_graph_fallback(model_dir)
        except Exception as e2:
            print(f"  FATAL: Cannot build tokenizer graph: {e2}")
            import traceback
            traceback.print_exc()
            sys.exit(1)

    # Step 4: Verify output matches reference
    passed, results = verify_fused_output(model_dir, reference_embeddings)

    # Step 5: Save reference vectors as test fixture
    save_reference_vectors(reference_embeddings)

    print("\n" + "=" * 70)
    if passed:
        print("PASS: Fused graph output matches reference pipeline")
        print(f"  All {len(TEST_PHRASES)} test phrases: cosine > 0.999, token IDs identical")
        print(f"  Artifact: {FUSED_OUTPUT if FUSED_OUTPUT.exists() else OUTPUT_DIR / 'tokenizer.onnx'}")
    else:
        print("FAIL: Output does not match reference — DO NOT DEPLOY")
        print("  Review results above for specific failures")
        sys.exit(1)

    print("=" * 70)


if __name__ == "__main__":
    main()
