#!/usr/bin/env python3
"""Quick upload - assumes already logged in or will use browser login"""

from huggingface_hub import HfApi
import os

model_file = r"C:\Users\INEWTON\Downloads\hiva_Q4_K_M.gguf"

if not os.path.exists(model_file):
    print(f"Error: {model_file} not found")
    exit(1)

size_mb = os.path.getsize(model_file) / (1024 ** 2)
print(f"Uploading {size_mb:.1f}MB to HuggingFace...")

api = HfApi()

# This will use existing token or prompt for login via browser
api.upload_file(
    path_or_fileobj=model_file,
    path_in_repo="lfm25_350m_medichat_v2_merged.Q4_K_M.gguf",
    repo_id="Kenzlejaze/hiva-medichat-v2-gguf",
    repo_type="model",
    commit_message="Fix: Re-quantized with embedded chat template"
)

print("✓ Upload complete!")
print("URL: https://huggingface.co/Kenzlejaze/hiva-medichat-v2-gguf")
