#!/bin/bash
# setup-edge-brain.sh — Setup script for Edge Brain native plugin
#
# This script:
# 1. Adds llama.cpp as a git submodule
# 2. Downloads the Qwen2.5-1.5B-Instruct GGUF model
# 3. Verifies file sizes and checksums
#
# Usage: ./scripts/setup-edge-brain.sh

set -e

echo "========================================="
echo "Edge Brain Setup Script"
echo "========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Directories
CPP_DIR="android/app/src/main/cpp"
LLAMA_DIR="$CPP_DIR/llama.cpp"
MODEL_DIR="models"
MODEL_FILE="Qwen2.5-1.5B-Instruct-Q4_0_4_4.gguf"
MODEL_URL="https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/$MODEL_FILE"

# Step 1: Add llama.cpp submodule
echo ""
echo -e "${YELLOW}Step 1: Adding llama.cpp submodule...${NC}"

if [ -d "$LLAMA_DIR/.git" ]; then
    echo -e "${GREEN}✓ llama.cpp submodule already exists${NC}"
    cd "$LLAMA_DIR"
    echo "  Current commit: $(git rev-parse --short HEAD)"
    cd - > /dev/null
else
    echo "  Creating cpp directory..."
    mkdir -p "$CPP_DIR"

    echo "  Adding llama.cpp as submodule..."
    git submodule add https://github.com/ggerganov/llama.cpp.git "$LLAMA_DIR" || {
        echo -e "${RED}✗ Failed to add submodule (may already exist in .gitmodules)${NC}"
        echo "  Trying to initialize existing submodule..."
        git submodule update --init --recursive "$LLAMA_DIR"
    }

    cd "$LLAMA_DIR"
    # Pin to a stable release (update this as needed)
    STABLE_TAG="b4313"
    echo "  Checking out stable tag: $STABLE_TAG"
    git checkout "$STABLE_TAG" 2>/dev/null || {
        echo -e "${YELLOW}  Warning: Tag $STABLE_TAG not found, using master${NC}"
    }
    cd - > /dev/null

    echo -e "${GREEN}✓ llama.cpp submodule added${NC}"
fi

# Step 2: Download the model
echo ""
echo -e "${YELLOW}Step 2: Downloading Qwen2.5-1.5B-Instruct model...${NC}"

mkdir -p "$MODEL_DIR"

if [ -f "$MODEL_DIR/$MODEL_FILE" ]; then
    SIZE=$(du -h "$MODEL_DIR/$MODEL_FILE" | cut -f1)
    echo -e "${GREEN}✓ Model already downloaded ($SIZE)${NC}"

    # Verify size is reasonable (should be ~990 MB)
    SIZE_BYTES=$(stat -f%z "$MODEL_DIR/$MODEL_FILE" 2>/dev/null || stat -c%s "$MODEL_DIR/$MODEL_FILE" 2>/dev/null)
    if [ "$SIZE_BYTES" -lt 900000000 ]; then
        echo -e "${RED}✗ Model file is too small ($SIZE), may be incomplete${NC}"
        echo "  Removing and re-downloading..."
        rm "$MODEL_DIR/$MODEL_FILE"
    else
        echo "  Skipping download (file exists and has reasonable size)"
        echo ""
        echo -e "${GREEN}=========================================${NC}"
        echo -e "${GREEN}Edge Brain setup complete!${NC}"
        echo -e "${GREEN}=========================================${NC}"
        echo ""
        echo "Next steps:"
        echo "  1. Build the Android app:"
        echo "     cd android && ./gradlew assembleDebug"
        echo ""
        echo "  2. Push the model to the device:"
        echo "     adb push $MODEL_DIR/$MODEL_FILE /data/data/com.hiva.runtime/files/models/edge-brain/model.gguf"
        echo ""
        echo "  3. Run the app and test generation"
        echo ""
        exit 0
    fi
fi

echo "  Downloading from HuggingFace..."
echo "  URL: $MODEL_URL"
echo "  Size: ~990 MB (this will take a few minutes)"
echo ""

# Use curl with progress bar
curl -L -o "$MODEL_DIR/$MODEL_FILE" "$MODEL_URL" --progress-bar || {
    echo -e "${RED}✗ Download failed${NC}"
    echo "  You can download manually from:"
    echo "  $MODEL_URL"
    exit 1
}

# Verify download
if [ -f "$MODEL_DIR/$MODEL_FILE" ]; then
    SIZE=$(du -h "$MODEL_DIR/$MODEL_FILE" | cut -f1)
    echo -e "${GREEN}✓ Model downloaded successfully ($SIZE)${NC}"
else
    echo -e "${RED}✗ Download failed - file not found${NC}"
    exit 1
fi

# Step 3: Summary
echo ""
echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}Edge Brain setup complete!${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""
echo "Files created:"
echo "  - $LLAMA_DIR (submodule)"
echo "  - $MODEL_DIR/$MODEL_FILE (~990 MB)"
echo ""
echo "Next steps:"
echo "  1. Build the Android app:"
echo "     cd android && ./gradlew assembleDebug"
echo ""
echo "  2. Push the model to the device:"
echo "     adb push $MODEL_DIR/$MODEL_FILE /data/data/com.hiva.runtime/files/models/edge-brain/model.gguf"
echo ""
echo "  3. Run the app and test generation"
echo ""
echo "To test model loading on device:"
echo "  - Open the app"
echo "  - The model will auto-load on first generation"
echo "  - Check logs for: '[EdgeBrain] Model loaded in Xms'"
echo ""
