# bge-m3 ONNX Model Investigation

## Task Context
Need to verify browser-compatible quantized ONNX build of bge-m3 for dense-only embedding (1024-dim) to replace paraphrase-multilingual-MiniLM-L12-v2 (384-dim) for v2.3 schema bundles.

## Known Constraints
- **Sparse vectors NOT available**: Confirmed via Xenova/bge-m3 discussion #4 - ONNX conversion only exposes dense output
- **Dense-only scope**: v2.3 will use bge-m3 dense (1024-dim) + BM25 lexical (continuing from lexical.json, NOT sparse.json)
- **Runtime**: @xenova/transformers in browser/Capacitor environment

## Available ONNX Models

### Option 1: Xenova/bge-m3
- **Hub**: https://huggingface.co/Xenova/bge-m3
- **Maintained by**: Xenova (official transformers.js maintainer)
- **Known support**: Dense embeddings only (cls pooling)
- **Quantization**: Typically provides q8 quantized versions
- **Status**: RECOMMENDED - official transformers.js conversion

### Option 2: onnx-community/bge-m3
- **Hub**: https://huggingface.co/onnx-community/bge-m3
- **Maintained by**: ONNX community org
- **Status**: ALTERNATIVE - check if more recently maintained

## Integration Pattern

Based on existing MiniLM integration in embeddingModel.ts:

```typescript
const { pipeline, env } = await import('@xenova/transformers');
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';

// For bge-m3 (1024-dim dense)
const model = await pipeline('feature-extraction', 'bge-m3', {
  quantized: true,  // Use q8 quantized
  pooling: 'cls',    // CLS token pooling (not 'mean' like MiniLM)
  normalize: true
});
```

## Key Differences from MiniLM
1. **Pooling**: bge-m3 uses 'cls' pooling, MiniLM uses 'mean'
2. **Dimensions**: 1024 vs 384
3. **No query prefix needed**: bge-m3 doesn't require "query: " prefix (unlike smaller BGE variants)

## Model Size Estimates
- **MiniLM quantized**: 113MB (current)
- **bge-m3 quantized (q8)**: ~550MB estimated (needs verification)
- **bge-m3 quantized (q4)**: ~280MB estimated (if available)

## Next Steps
1. Download Xenova/bge-m3 quantized files to public/models/bge-m3/
2. Test actual model size and load time
3. Verify 1024-dim dense output
4. Measure inference latency
5. Document combined memory footprint (MiniLM + bge-m3 both resident)
