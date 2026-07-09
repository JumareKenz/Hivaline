"""
Verify that the tokenizer path used by the fused model produces IDENTICAL
token IDs to the reference Python transformers.AutoTokenizer.

This is a MANDATORY verification step. Subtly incorrect tokenization does not
crash - it silently shifts token IDs and corrupts every embedding in a way
that passes shape/norm checks but causes unexplained retrieval degradation.
"""

import sys
from pathlib import Path
import numpy as np

if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from transformers import AutoTokenizer
import sentencepiece as spm

MODEL_DIR = Path("models/embedding-gemma/hf_cache")
MODEL_ID = "onnx-community/embeddinggemma-300m-ONNX"
MAX_SEQ_LENGTH = 2048

# Same test phrases from verification
TEST_PHRASES = [
    "What is the recommended first-line treatment for uncomplicated malaria in pregnancy?",
    "How do I manage a newborn with birth asphyxia?",
    "Mene ne maganin farko na malaria a lokacin ciki?",
    "Yaya zan taimaki jariri da ke da matsalar numfashi bayan haihuwa?",
    "Kini itọju akọkọ fun iba malaria ninu aboyun?",
    "Bawo ni mo ṣe le ṣe itọju ọmọ tuntun ti ko le mi daadaa?",
    "Kedu ọgwụ mbụ a na-eji agwọ ịba malaria n'oge afọ ime?",
    "Wetin be di first medicine for malaria wen woman dey pregnant?",
]

QUERY_PREFIX = "task: search result | query: "

print("=" * 70)
print("Token ID Verification: Fused Tokenizer vs Reference")
print("=" * 70)

# Reference tokenizer (HuggingFace transformers)
print(f"\n[1/2] Loading reference tokenizer...")
ref_tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
print(f"  Loaded: transformers.AutoTokenizer('{MODEL_ID}')")
print(f"  Vocab size: {ref_tokenizer.vocab_size}")
print(f"  BOS token: {ref_tokenizer.bos_token} (id={ref_tokenizer.bos_token_id})")
print(f"  EOS token: {ref_tokenizer.eos_token} (id={ref_tokenizer.eos_token_id})")

# SentencePiece tokenizer (what the fused model uses)
print(f"\n[2/2] Loading SentencePiece tokenizer (fused model path)...")
sp_model_path = MODEL_DIR / "tokenizer.model"
sp_tokenizer = spm.SentencePieceProcessor()
sp_tokenizer.Load(str(sp_model_path))
print(f"  Loaded: sentencepiece from {sp_model_path}")
print(f"  Vocab size: {sp_tokenizer.vocab_size()}")
print(f"  BOS token: {sp_tokenizer.bos_id()}")
print(f"  EOS token: {sp_tokenizer.eos_id()}")

print("\n" + "=" * 70)
print("Token ID Comparison")
print("=" * 70)

all_match = True
detailed_examples = []

for i, phrase in enumerate(TEST_PHRASES):
    prefixed = QUERY_PREFIX + phrase

    # Reference tokenization
    ref_encoded = ref_tokenizer(
        prefixed,
        padding=False,
        truncation=True,
        max_length=MAX_SEQ_LENGTH,
        return_tensors="np",
    )
    ref_ids = ref_encoded["input_ids"][0].tolist()

    # SentencePiece tokenization (mimics what fused model does)
    # add_bos=True, add_eos=True to match PrePostProcessor behavior
    sp_ids = sp_tokenizer.Encode(prefixed, add_bos=True, add_eos=True)

    # Truncate to max length (fused model should do this)
    if len(sp_ids) > MAX_SEQ_LENGTH:
        sp_ids = sp_ids[:MAX_SEQ_LENGTH]

    # Compare
    match = ref_ids == sp_ids
    all_match = all_match and match

    status = "✓ MATCH" if match else "✗ MISMATCH"
    print(f"\n[{i+1}/{len(TEST_PHRASES)}] {status}")
    print(f"  Text: '{phrase[:60]}...'")
    print(f"  Reference length: {len(ref_ids)} tokens")
    print(f"  SentencePiece length: {len(sp_ids)} tokens")

    if not match:
        print(f"  ERROR: Token IDs do not match!")
        print(f"  Reference IDs (first 20): {ref_ids[:20]}")
        print(f"  SentencePiece IDs (first 20): {sp_ids[:20]}")

        # Find first difference
        for j in range(min(len(ref_ids), len(sp_ids))):
            if ref_ids[j] != sp_ids[j]:
                print(f"  First difference at position {j}: ref={ref_ids[j]} vs sp={sp_ids[j]}")
                break
    else:
        # Store detailed examples for first 2 matches
        if len(detailed_examples) < 2:
            detailed_examples.append({
                "phrase": phrase,
                "ref_ids": ref_ids,
                "sp_ids": sp_ids,
            })

# Show detailed token ID arrays for first 2 examples
print("\n" + "=" * 70)
print("Detailed Token ID Arrays (first 2 examples)")
print("=" * 70)

for i, ex in enumerate(detailed_examples):
    print(f"\nExample {i+1}: '{ex['phrase'][:60]}...'")
    print(f"  Reference token IDs: {ex['ref_ids']}")
    print(f"  SentencePiece token IDs: {ex['sp_ids']}")
    print(f"  Arrays are identical: {ex['ref_ids'] == ex['sp_ids']}")

# Final verdict
print("\n" + "=" * 70)
if all_match:
    print("✓ PASS: All token ID sequences are IDENTICAL")
    print(f"  Verified {len(TEST_PHRASES)} multilingual clinical phrases")
    print("  Tokenization is correct - safe to deploy")
else:
    print("✗ FAIL: Token ID mismatch detected")
    print("  DO NOT DEPLOY - tokenization is incorrect")
    print("  This will cause silent embedding corruption")
    sys.exit(1)

print("=" * 70)
