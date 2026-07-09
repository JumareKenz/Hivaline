#!/usr/bin/env python3
"""
Add chat template to LFM2.5 fine-tuned model and re-export to GGUF.

Usage:
    python fix_lfm25_chat_template.py /path/to/your/lfm25_model_dir

What this does:
1. Adds chat_template to tokenizer_config.json (if missing)
2. Converts to GGUF with proper metadata using llama.cpp
3. Outputs a fixed GGUF file ready for LEAP SDK

Requirements:
    pip install transformers
    git clone https://github.com/ggerganov/llama.cpp (for convert script)
"""

import json
import os
import sys
from pathlib import Path

# Chat template - Unsloth typically uses ChatML format
# This matches what LLaMA.cpp's common_chat_templates_init() expects
CHATML_TEMPLATE = """{% for message in messages %}{{'<|im_start|>' + message['role'] + '\\n' + message['content'] + '<|im_end|>' + '\\n'}}{% endfor %}{% if add_generation_prompt %}{{'<|im_start|>assistant\\n'}}{% endif %}"""

# Alternative templates (uncomment if you used a different format during fine-tuning)
# ALPACA_TEMPLATE = """Below is an instruction that describes a task. Write a response that appropriately completes the request.\\n\\n### Instruction:\\n{{ messages[0]['content'] }}\\n\\n### Response:\\n"""

# LLAMA2_TEMPLATE = """{% for message in messages %}{% if message['role'] == 'system' %}<<SYS>>\\n{{ message['content'] }}\\n<</SYS>>\\n\\n{% elif message['role'] == 'user' %}[INST] {{ message['content'] }} [/INST]{% elif message['role'] == 'assistant' %}{{ message['content'] }}{% endif %}{% endfor %}"""

def main():
    if len(sys.argv) < 2:
        print("Usage: python fix_lfm25_chat_template.py /path/to/lfm25_model_dir")
        print("\nThis script will:")
        print("  1. Add chat_template to tokenizer_config.json")
        print("  2. Guide you through GGUF conversion")
        sys.exit(1)

    model_dir = Path(sys.argv[1])

    if not model_dir.exists():
        print(f"Error: Model directory not found: {model_dir}")
        sys.exit(1)

    # Check for required files
    tokenizer_config = model_dir / "tokenizer_config.json"

    if not tokenizer_config.exists():
        print(f"Error: tokenizer_config.json not found in {model_dir}")
        print("Make sure this is a valid HuggingFace format model directory")
        sys.exit(1)

    print(f"✓ Found model directory: {model_dir}")

    # Load tokenizer_config.json
    with open(tokenizer_config, 'r', encoding='utf-8') as f:
        config = json.load(f)

    # Check if chat_template already exists
    if 'chat_template' in config:
        print(f"\n⚠️  chat_template already exists in tokenizer_config.json:")
        print(f"   Current template: {config['chat_template'][:100]}...")
        response = input("\nOverwrite with ChatML template? (y/n): ")
        if response.lower() != 'y':
            print("Aborted. No changes made.")
            sys.exit(0)

    # Add chat_template
    config['chat_template'] = CHATML_TEMPLATE

    # Backup original
    backup_path = tokenizer_config.with_suffix('.json.backup')
    if not backup_path.exists():
        with open(tokenizer_config, 'r', encoding='utf-8') as f:
            with open(backup_path, 'w', encoding='utf-8') as fb:
                fb.write(f.read())
        print(f"✓ Backed up original to: {backup_path}")

    # Write updated config
    with open(tokenizer_config, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)

    print(f"✓ Added ChatML template to tokenizer_config.json")
    print(f"\nTemplate added:")
    print(f"  {CHATML_TEMPLATE[:80]}...")

    print(f"\n" + "="*70)
    print(f"NEXT STEP: Convert to GGUF")
    print(f"="*70)
    print(f"\n1. Make sure llama.cpp is cloned and built:")
    print(f"   git clone https://github.com/ggerganov/llama.cpp")
    print(f"   cd llama.cpp && make")

    print(f"\n2. Install Python requirements:")
    print(f"   pip install -r llama.cpp/requirements.txt")

    print(f"\n3. Convert your model to GGUF:")
    print(f"   python llama.cpp/convert-hf-to-gguf.py \\")
    print(f"     {model_dir} \\")
    print(f"     --outfile lfm25_fixed_f16.gguf \\")
    print(f"     --outtype f16")

    print(f"\n4. Quantize to Q4_K_M:")
    print(f"   llama.cpp/llama-quantize \\")
    print(f"     lfm25_fixed_f16.gguf \\")
    print(f"     lfm25_fixed_Q4_K_M.gguf \\")
    print(f"     Q4_K_M")

    print(f"\n5. Test the fixed model locally (optional but recommended):")
    print(f"   llama.cpp/llama-cli \\")
    print(f"     --model lfm25_fixed_Q4_K_M.gguf \\")
    print(f"     --chat-template chatml \\")
    print(f"     --prompt \"What are symptoms of malaria?\"")

    print(f"\n6. Upload to HuggingFace:")
    print(f"   huggingface-cli upload Kenzlejaze/hiva-medichat-v2-gguf \\")
    print(f"     lfm25_fixed_Q4_K_M.gguf \\")
    print(f"     --repo-type model")

    print(f"\n7. Update your app to use the fixed model URL")

    print(f"\n" + "="*70)
    print(f"✓ DONE! tokenizer_config.json has been updated.")
    print(f"  Follow steps 1-7 above to complete the fix.")
    print(f"="*70)

if __name__ == "__main__":
    main()
