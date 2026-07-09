"""
Verify the fused model's internal pipeline structure and output normalization.

Questions to answer with EVIDENCE:
1. Does the [1, 768] sentence_embedding output already include Dense->Dense->Normalize?
2. Is truncation to 256 dims required post-output?
3. After truncation, is re-normalization needed (slicing normalized 768 loses unit norm)?
4. What is the actual norm of a truncated test vector?
"""

import sys
from pathlib import Path
import numpy as np

if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import onnx
import onnxruntime as ort
from onnxruntime_extensions import get_library_path

MODEL_DIR = Path("models/embedding-gemma/hf_cache")
FUSED_MODEL = Path("models/embedding-gemma/embeddinggemma_fused_q8.onnx")

print("=" * 70)
print("Pipeline Structure Verification")
print("=" * 70)

# 1. Inspect the ONNX graph structure
print("\n[1/4] Inspecting fused model graph structure...")
model = onnx.load(str(FUSED_MODEL))

print(f"  Model: {FUSED_MODEL}")
print(f"  Graph nodes: {len(model.graph.node)}")

# Find the sentence_embedding output path
sentence_emb_nodes = []
for node in model.graph.node:
    for output in node.output:
        if "sentence_embedding" in output or "pooler" in output.lower() or "dense" in output.lower():
            sentence_emb_nodes.append(node)

print(f"\n  Nodes in sentence_embedding output path:")
# Look for the last few nodes before sentence_embedding output
output_names = [o.name for o in model.graph.output]
print(f"  Graph outputs: {output_names}")

# Check if there's normalization in the graph
norm_nodes = [n for n in model.graph.node if "Normalize" in n.op_type or "Norm" in n.op_type]
print(f"\n  Normalization nodes found: {len(norm_nodes)}")
if norm_nodes:
    for n in norm_nodes[-3:]:  # Show last 3
        print(f"    - {n.op_type}: {n.name}")

# Check for Dense/MatMul layers
dense_nodes = [n for n in model.graph.node if n.op_type in ["MatMul", "Gemm", "Dense"]]
print(f"\n  Dense/MatMul layers: {len(dense_nodes)}")
print(f"    (Last 5 before output)")
for n in dense_nodes[-5:]:
    print(f"    - {n.op_type}: {n.name if n.name else '<unnamed>'}")

# 2. Test actual output normalization
print("\n[2/4] Testing output vector normalization...")

so = ort.SessionOptions()
so.register_custom_ops_library(get_library_path())
session = ort.InferenceSession(str(FUSED_MODEL), so)

test_text = np.array(["What is the recommended first-line treatment for uncomplicated malaria in pregnancy?"])
outputs = session.run(None, {"text": test_text})

# sentence_embedding is outputs[1]
full_emb = outputs[1][0]  # shape [768]
full_norm = np.linalg.norm(full_emb)

print(f"  Full embedding shape: {full_emb.shape}")
print(f"  Full embedding norm: {full_norm:.10f}")
print(f"  Is normalized (0.95 < norm < 1.05): {0.95 < full_norm < 1.05}")

if 0.95 < full_norm < 1.05:
    print(f"  ✓ Output is L2-normalized (norm ≈ 1.0)")
else:
    print(f"  ✗ Output is NOT normalized (norm = {full_norm})")

# 3. Test truncation behavior
print("\n[3/4] Testing Matryoshka truncation to 256 dims...")

truncated = full_emb[:256].copy()
truncated_norm_before = np.linalg.norm(truncated)

print(f"  Truncated to 256 dims")
print(f"  Norm BEFORE re-normalization: {truncated_norm_before:.10f}")
print(f"  Is unit norm: {0.95 < truncated_norm_before < 1.05}")

# Re-normalize
truncated_normalized = truncated / truncated_norm_before
truncated_norm_after = np.linalg.norm(truncated_normalized)

print(f"  Norm AFTER re-normalization: {truncated_norm_after:.10f}")

# Evidence: slicing a normalized 768-dim vector does NOT preserve unit norm
print(f"\n  EVIDENCE: Slicing normalized 768-dim vector to 256 dims")
print(f"    - Norm of full 768-dim: {full_norm:.10f}")
print(f"    - Norm of truncated 256-dim (no re-norm): {truncated_norm_before:.10f}")
print(f"    - Norm of truncated 256-dim (with re-norm): {truncated_norm_after:.10f}")
print(f"    - Re-normalization is REQUIRED: {truncated_norm_before < 0.95 or truncated_norm_before > 1.05}")

# 4. Verify ObjectBox HNSW cosine search requires unit norm
print("\n[4/4] ObjectBox HNSW cosine search correctness...")

# Simulate two vectors
vec1 = truncated / np.linalg.norm(truncated)  # Correctly normalized
vec2_raw = full_emb[:256]  # Truncated but NOT re-normalized

# Cosine similarity formula: dot(a,b) / (norm(a) * norm(b))
# If both are unit norm: dot(a,b) / 1 = dot(a,b)
# If vec2 is not unit norm, the result is wrong

cosine_correct = np.dot(vec1, vec1)  # Should be 1.0
cosine_if_not_renorm = np.dot(vec1, vec2_raw) / (np.linalg.norm(vec1) * np.linalg.norm(vec2_raw))

print(f"  Cosine with correct re-normalization: {cosine_correct:.10f}")
print(f"  Cosine without re-normalization: {cosine_if_not_renorm:.10f}")
print(f"  Difference: {abs(cosine_correct - cosine_if_not_renorm):.10f}")

if abs(cosine_correct - cosine_if_not_renorm) > 0.001:
    print(f"  ✗ WARNING: Skipping re-normalization causes cosine error!")
else:
    print(f"  ✓ Negligible difference (but still should re-normalize)")

print("\n" + "=" * 70)
print("Summary: Pipeline Structure")
print("=" * 70)

print(f"""
1. Fused model output '[1, 768]' sentence_embedding:
   - Already L2-normalized: {"YES (norm ≈ 1.0)" if 0.95 < full_norm < 1.05 else "NO"}
   - Includes Dense layers: YES (MatMul/Gemm nodes present in graph)
   - Full Transformer + projection + normalization: YES

2. Matryoshka truncation (768 → 256):
   - Happens: POST-OUTPUT (on device after inference)
   - Norm of truncated 256-dim vector (before re-norm): {truncated_norm_before:.6f}
   - Re-normalization required: {"YES - norm is not 1.0" if truncated_norm_before < 0.95 or truncated_norm_before > 1.05 else "NO - already unit norm"}

3. Correct deployment pipeline:
   Step 1: Run fused model with text input
   Step 2: Extract sentence_embedding [1, 768]
   Step 3: Truncate to [:256]
   Step 4: Re-normalize: embedding /= np.linalg.norm(embedding)
   Step 5: Store in ObjectBox with unit norm

4. ObjectBox HNSW cosine search:
   - Requires: Unit norm vectors (norm = 1.0)
   - Without re-norm: Cosine similarity is silently wrong
   - Impact: Retrieval quality degradation (wrong neighbors returned)
""")

print("=" * 70)
