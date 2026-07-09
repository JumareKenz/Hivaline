#!/usr/bin/env python3
"""
Upload fixed LFM2.5 Q4_K_M model to HuggingFace
"""

from huggingface_hub import HfApi, login
import os

# Model file
model_file = r"C:\Users\INEWTON\Downloads\hiva_Q4_K_M.gguf"

# Check file exists
if not os.path.exists(model_file):
    print(f"Error: Model file not found at {model_file}")
    exit(1)

file_size_mb = os.path.getsize(model_file) / (1024 ** 2)
print(f"Found model file: {file_size_mb:.1f}MB")

# Login (will prompt for token if not logged in)
print("\nLogging in to HuggingFace...")
print("You'll need your HuggingFace token (get it from https://huggingface.co/settings/tokens)")
print("Make sure the token has 'write' permissions!\n")

try:
    login()
    print("✓ Logged in successfully!")
except Exception as e:
    print(f"Login failed: {e}")
    print("\nManual login: Run this in your browser:")
    print("https://huggingface.co/settings/tokens")
    print("Create a token with 'write' access, then try again.")
    exit(1)

# Upload
api = HfApi()

repo_id = "Kenzlejaze/hiva-medichat-v2-gguf"
filename_on_hub = "lfm25_350m_medichat_v2_merged.Q4_K_M.gguf"

print(f"\nUploading to {repo_id}/{filename_on_hub}...")
print("This will REPLACE the broken model file with the fixed version.")
print(f"File size: {file_size_mb:.1f}MB")

try:
    api.upload_file(
        path_or_fileobj=model_file,
        path_in_repo=filename_on_hub,
        repo_id=repo_id,
        repo_type="model",
        commit_message="Fix: Re-quantized from F16 with embedded chat template (resolves common_chat_templates_init crash)"
    )

    print("\n✓ Upload successful!")
    print(f"Model URL: https://huggingface.co/{repo_id}/blob/main/{filename_on_hub}")
    print("\nNext steps:")
    print("1. Verify upload at https://huggingface.co/Kenzlejaze/hiva-medichat-v2-gguf")
    print("2. Check file size is ~219MB")
    print("3. Rebuild the app (modelDownloader.ts is already updated)")

except Exception as e:
    print(f"\n✗ Upload failed: {e}")
    print("\nTroubleshooting:")
    print("- Make sure you have write access to the repo")
    print("- Check your internet connection")
    print("- Try re-logging in with a fresh token")
    exit(1)
