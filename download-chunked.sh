#!/usr/bin/env bash
#
# Chunked, resumable downloader for large model files
# Downloads in 100MB chunks with progress persistence
#

set -euo pipefail

URL="$1"
OUTPUT="$2"
EXPECTED_SIZE="${3:-0}"
CHUNK_SIZE=$((100 * 1024 * 1024))  # 100MB chunks

PROGRESS_FILE="${OUTPUT}.progress"
TEMP_FILE="${OUTPUT}.tmp"

# Get file size from server
get_remote_size() {
    curl -sI "$URL" | grep -i content-length | awk '{print $2}' | tr -d '\r'
}

# Initialize or resume
if [ -f "$PROGRESS_FILE" ]; then
    DOWNLOADED=$(cat "$PROGRESS_FILE")
    echo "Resuming from byte $DOWNLOADED"
else
    DOWNLOADED=0
    echo "Starting fresh download"
fi

# Get total size
if [ "$EXPECTED_SIZE" -eq 0 ]; then
    TOTAL_SIZE=$(get_remote_size)
else
    TOTAL_SIZE=$EXPECTED_SIZE
fi

echo "File size: $((TOTAL_SIZE / 1024 / 1024))MB"
echo "Chunk size: $((CHUNK_SIZE / 1024 / 1024))MB"

# Ensure temp file exists
touch "$TEMP_FILE"

# Download loop
while [ $DOWNLOADED -lt $TOTAL_SIZE ]; do
    END=$((DOWNLOADED + CHUNK_SIZE - 1))
    if [ $END -ge $TOTAL_SIZE ]; then
        END=$((TOTAL_SIZE - 1))
    fi

    PERCENT=$((100 * DOWNLOADED / TOTAL_SIZE))
    echo "[$PERCENT%] Downloading bytes $DOWNLOADED-$END..."

    # Download this chunk with retry
    RETRY=0
    MAX_RETRIES=3
    while [ $RETRY -lt $MAX_RETRIES ]; do
        if curl -f -L -r "$DOWNLOADED-$END" "$URL" >> "$TEMP_FILE" 2>/dev/null; then
            # Verify chunk was written
            ACTUAL_SIZE=$(stat -c%s "$TEMP_FILE" 2>/dev/null || stat -f%z "$TEMP_FILE" 2>/dev/null || echo 0)
            EXPECTED_CURRENT=$((END + 1))

            if [ $ACTUAL_SIZE -eq $EXPECTED_CURRENT ]; then
                # Success - update progress
                DOWNLOADED=$EXPECTED_CURRENT
                echo "$DOWNLOADED" > "$PROGRESS_FILE"
                echo "  ✓ Chunk complete ($((ACTUAL_SIZE / 1024 / 1024))MB total)"
                break
            else
                echo "  ⚠ Size mismatch: expected $EXPECTED_CURRENT, got $ACTUAL_SIZE"
                RETRY=$((RETRY + 1))
            fi
        else
            echo "  ✗ Download failed (attempt $((RETRY + 1))/$MAX_RETRIES)"
            RETRY=$((RETRY + 1))
            sleep 2
        fi
    done

    if [ $RETRY -eq $MAX_RETRIES ]; then
        echo "ERROR: Failed to download chunk after $MAX_RETRIES attempts"
        exit 1
    fi
done

# Move completed download
mv "$TEMP_FILE" "$OUTPUT"
rm -f "$PROGRESS_FILE"

echo "✅ Download complete: $OUTPUT"
stat -c "Size: %s bytes" "$OUTPUT" 2>/dev/null || stat -f "Size: %z bytes" "$OUTPUT" 2>/dev/null
