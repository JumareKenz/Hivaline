#!/bin/bash
# Download LaBSE INT8 quantized model from Xenova
# Model: Xenova/LaBSE (browser-compatible ONNX)
# Size: 471MB INT8 quantized

echo "Downloading LaBSE INT8 model from Xenova..."
echo "This will take several minutes (471MB download)"

cd public/models/labse/onnx || exit 1

# Download quantized INT8 model (smallest variant, 471MB)
echo "Downloading model_quantized.onnx (471MB)..."
curl -L -C - -o model_quantized.onnx \
  "https://huggingface.co/Xenova/LaBSE/resolve/main/onnx/model_quantized.onnx"

echo ""
echo "Downloading tokenizer files..."

cd ..

# Download tokenizer files
curl -L -o tokenizer.json \
  "https://huggingface.co/Xenova/LaBSE/resolve/main/tokenizer.json"

curl -L -o tokenizer_config.json \
  "https://huggingface.co/Xenova/LaBSE/resolve/main/tokenizer_config.json"

curl -L -o special_tokens_map.json \
  "https://huggingface.co/Xenova/LaBSE/resolve/main/special_tokens_map.json"

curl -L -o config.json \
  "https://huggingface.co/Xenova/LaBSE/resolve/main/config.json"

echo ""
echo "✅ Download complete!"
echo ""
ls -lh onnx/
echo ""
echo "Total size:"
du -sh .
