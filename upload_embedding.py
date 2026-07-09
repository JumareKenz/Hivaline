#!/usr/bin/env python3
"""Upload EmbeddingGemma model to HuggingFace"""

from huggingface_hub import HfApi
import os

# EmbeddingGemma model file
model_file = r"models\embedding-gemma\embeddinggemma_fused_q8.onnx"

if not os.path.exists(model_file):
    print(f"Error: {model_file} not found")
    print("Make sure you're in the hivarun directory")
    exit(1)

size_mb = os.path.getsize(model_file) / (1024 ** 2)
print(f"Uploading EmbeddingGemma {size_mb:.1f}MB to HuggingFace...")

api = HfApi()

# Create repo if it doesn't exist
repo_id = "Kenzlejaze/hiva-models"
try:
    api.create_repo(repo_id=repo_id, repo_type="model", exist_ok=True)
    print(f"✓ Repo {repo_id} ready")
except Exception as e:
    print(f"Note: {e}")

# Upload
print("Uploading...")
api.upload_file(
    path_or_fileobj=model_file,
    path_in_repo="embeddinggemma_fused_q8.onnx",
    repo_id=repo_id,
    repo_type="model",
    commit_message="Add EmbeddingGemma-300M fused ONNX model for retrieval"
)

print("\n✓ Upload complete!")
print(f"Model URL: https://huggingface.co/{repo_id}/blob/main/embeddinggemma_fused_q8.onnx")
print(f"\nThe app is now configured to download from:")
print(f"https://huggingface.co/{repo_id}/resolve/main/embeddinggemma_fused_q8.onnx")
