# NativeRetriever Integration Complete (B.3-B.8)

## Summary of Changes

### B.3: Vector Sourcing ✓
**Fixed**: Parse embeddings.bin directly, stop re-embedding chunks on-device

**Changes:**
- `importPrecomputedVectors()` reads 256-dim float32 vectors from `index/embeddings.bin`
- Reads chunk IDs from `index/embeddings_index.json`
- Reads metadata from `content/chunks.jsonl`
- Bulk inserts into ObjectBox with pre-computed embeddings
- **No more on-device re-embedding of document chunks**

**Code**: NativeRetrieverPlugin.kt lines 440-523

---

### B.4: HNSW Dimension ✓
**Fixed**: Remove hardcoded 100-dim, read 256 from manifest

**Changes:**
- `@HnswIndex(dimensions = 256, ...)` in ClinicalChunk entity (line 45)
- Validates `embeddingDims` from embeddings.bin header matches 256 (line 452-459)
- Rejects bundle if dimension mismatch

**Code**: NativeRetrieverPlugin.kt lines 38-50, 452-459

---

### B.5: Manifest Version Check ✓
**Fixed**: Add embeddingModel version check against manifest

**Changes:**
- Reads `manifest.retrievalCapabilities.embeddingModel` (line 135)
- Validates contains "embeddinggemma" or exact match "google/embeddinggemma-300m" (line 140-147)
- Rejects bundle if model mismatch with clear error message

**Code**: NativeRetrieverPlugin.kt lines 134-147

---

### B.6: Asymmetric Query Prefix ✓
**Fixed**: Read from manifest, not hardcoded

**Changes:**
- Reads `manifest.retrievalCapabilities.queryPrefix` (line 150)
- Defaults to `"task: search result | query: "` if not in manifest (line 155)
- Applied to all query embeddings: `prefixedQuery = "$queryPrefix$query"` (line 218)

**Code**: NativeRetrieverPlugin.kt lines 149-156, 218

---

### B.7: L2 Normalization Verification ✓
**Fixed**: Spot-check norms at load time and runtime

**Document vectors (load time):**
- Spot-checks first vector norm from embeddings.bin (lines 462-470)
- Logs warning if norm not in [0.95, 1.05]
- Confirms compiler-side normalization correctness

**Query vectors (runtime):**
- Checks query vector norm after Matryoshka truncation + re-norm (lines 379-382)
- Logs warning if norm not in [0.99, 1.01]
- Confirms runtime-side normalization correctness

**Code**: NativeRetrieverPlugin.kt lines 462-470, 379-382

---

### B.8: HNSW Tuning ✓
**Fixed**: Confirm ObjectBox defaults, document parameters

**Build-time parameters** (in @HnswIndex annotation):
- `dimensions = 256` (vector size)
- `neighborsPerNode = 16` (M parameter, connections per node)
- `indexingSearchCount = 200` (efConstruction, build-time candidate list size)

**Runtime parameter:**
- `efSearch = 64` defined as constant (line 80)
- **NOTE**: ObjectBox Kotlin API `nearestNeighbors()` does not expose efSearch parameter
- Uses default efSearch (typically same as M=16 or auto-tuned)
- If recall insufficient, would need to investigate ObjectBox query builder API for override

**Code**: NativeRetrieverPlugin.kt lines 44-49, 80, 224-226

**Tuning rationale:**
- M=16: Good balance of recall/memory/speed for 256-dim vectors
- efConstruction=200: High-quality index build (compiler recommendation)
- efSearch=64: Higher than M for better recall (if API supported override)

---

## Fused Model Integration

### Model Architecture
**File**: `models/embedding-gemma/embeddinggemma_fused_q8.onnx` (300 MB)

**Pipeline**:
```
Raw text input
  ↓
SentencePiece tokenization (BOS/EOS, max 2048 tokens)
  ↓
EmbeddingGemma-300M Transformer
  ↓
Mean pooling
  ↓
Dense(768 → 3072) → Dense(3072 → 768)
  ↓
L2 normalization
  ↓
Output: sentence_embedding [1, 768]
  ↓ (on-device post-processing)
Matryoshka truncation [768 → 256]
  ↓
Re-normalization (MANDATORY)
  ↓
Store/search with unit norm [256]
```

### Code Changes
**Removed:**
- Separate ONNX model + tokenizer files
- `ai.djl.sentencepiece` dependency (doesn't support Android)
- Manual tokenization code

**Added:**
- `com.microsoft.onnxruntime:onnxruntime-extensions-android:0.13.0` dependency
- Fused model loading with custom op library registration
- Single-call embedding: text → 768-dim output → truncate & re-normalize → 256-dim

**Code**: NativeRetrieverPlugin.kt lines 334-385

---

## Deployment Checklist

### 1. Model Deployment
- [ ] Upload `models/embedding-gemma/embeddinggemma_fused_q8.onnx` (300 MB) to CDN
- [ ] Update `downloadEmbeddingModel()` URL in NativeRetrieverPlugin.kt line 280
- [ ] Test model download on real device (WiFi + cellular)

### 2. Bundle Compatibility
- [ ] Confirm all deployed .hiv bundles are schema 3.0 with EmbeddingGemma-300M
- [ ] Verify `manifest.retrievalCapabilities` includes:
  - `embeddingModel: "google/embeddinggemma-300m"`
  - `embeddingDims: 256`
  - `queryPrefix: "task: search result | query: "`
- [ ] Test bundle loading with dimension/model validation

### 3. Build & Dependencies
- [ ] Gradle sync with new onnxruntime-extensions-android dependency
- [ ] Verify libortextensions.so extracted to nativeLibraryDir
- [ ] Test on multiple Android versions (minSdk 31+)

### 4. On-Device Numerical Correctness Test
**CRITICAL**: Must verify end-to-end before declaring Step B complete

Test script (Kotlin/instrumented test):
```kotlin
@Test
fun testEndToEndEmbeddingCorrectness() {
    // Load reference vectors from Python verification
    val referenceVectors = loadReferenceVectors()  // from reference_vectors.json
    
    // Initialize NativeRetriever
    nativeRetriever.loadBundle(testBundlePath)
    
    // Test each reference phrase
    for ((phrase, refData) in referenceVectors) {
        val queryVec = nativeRetriever.embedQuery(phrase)
        val refVec = refData.embedding_256
        
        val cosine = cosineSimilarity(queryVec, refVec)
        
        // Must match within numerical precision
        assert(cosine > 0.999) {
            "Cosine similarity $cosine < 0.999 for phrase: $phrase"
        }
    }
}
```

**Pass criteria**: All 10 test phrases (English + Hausa/Yoruba/Igbo/Pidgin) have cosine > 0.999

---

## Status

**B.3-B.8: COMPLETE** ✓

**Remaining before Step C:**
- Run on-device numerical correctness test
- Report actual cosine similarity numbers (not just Python standalone test)
- Confirm recall quality with real .hiv bundle

**Step C (Legacy Removal):** BLOCKED until B numerical test passes

---

## Verification Commands

### Python Reference Vectors
```bash
python scripts/fuse_embeddinggemma_proper.py  # Already run, passed
```

Output: `models/embedding-gemma/reference_vectors.json`

### Token ID Verification
```bash
python scripts/verify_token_ids.py  # Already run, passed
```

Result: All token IDs IDENTICAL

### Pipeline Structure
```bash
python scripts/verify_pipeline_structure.py  # Already run, passed
```

Result: Re-normalization confirmed mandatory, both sides correct

### Android Build
```bash
cd android && ./gradlew assembleDebug
```

### Android Test (TODO)
```bash
cd android && ./gradlew connectedAndroidTest
```

Must include end-to-end numerical correctness test with reference vectors.
