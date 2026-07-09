# Step C: Legacy Path Removal - Analysis

## Current Architecture

### Dual-Path Design (BY DESIGN, NOT LEGACY)

The codebase has TWO embedding paths:

**Path 1: JS/WebView Embedding (embeddingModel.ts)**
- Used when: `USE_NATIVE_RETRIEVER = false` OR for v2.2/v2.3 bundles
- Models: MiniLM (384-dim, v2.2) or bge-m3 (1024-dim, v2.3)
- Tech: Xenova/transformers in WebView
- Status: **ACTIVE FALLBACK - NOT LEGACY**

**Path 2: Native ObjectBox + EmbeddingGemma (NativeRetrieverPlugin.kt)**
- Used when: `USE_NATIVE_RETRIEVER = true` AND schema 3.0 bundle
- Model: EmbeddingGemma-300M (256-dim)
- Tech: ONNX Runtime + ObjectBox HNSW
- Status: **NEW PRIMARY PATH - JUST INTEGRATED**

### What Was "Legacy" (Already Removed in Step B)

The OLD NativeRetrieverPlugin that used:
- MediaPipe Universal Sentence Encoder (USE) Lite
- 100-dim vectors
- Wrong embedding space
- **STATUS: ALREADY DELETED/REPLACED**

## Step C Interpretation

### Option 1: Remove JS Embedding Path (Aggressive)

**Remove:**
- `src/services/embeddingModel.ts`
- All v2.2/v2.3 bundle support
- WebView-based embedding
- Fallback to query proxies

**Impact:**
- BREAKING: All v2.2/v2.3 bundles stop working
- BREAKING: Fallback when NativeRetriever fails → no semantic search
- RISK: If ObjectBox has device compatibility issues, no fallback

**Verdict: TOO AGGRESSIVE** - This would break backward compatibility and remove safety fallbacks.

---

### Option 2: Clean Up Dead Code Only (Conservative)

**Remove:**
- Any remaining 100-dim USE references (already none found)
- Dead test files for old architecture (none found)
- Commented-out old retriever code (none found)

**Keep:**
- JS embedding path as fallback
- v2.2/v2.3 bundle support
- Dual-path architecture

**Verdict: NOTHING TO REMOVE** - Clean codebase, no legacy code detected.

---

### Option 3: Document Migration Path (Pragmatic)

**Action: DOCUMENT, DON'T DELETE**

Mark JS embedding path as "legacy fallback" with deprecation timeline:

```typescript
/**
 * embeddingModel.ts — WebView embedding FALLBACK
 * 
 * @deprecated This path is kept for:
 *   - v2.2/v2.3 bundle backward compatibility
 *   - Fallback when NativeRetriever unavailable
 *   - Development/testing when USE_NATIVE_RETRIEVER=false
 * 
 * New bundles (schema 3.0+) should use NativeRetriever (ObjectBox + EmbeddingGemma).
 * 
 * Migration timeline:
 *   - Phase 1 (current): Both paths active, NativeRetriever opt-in
 *   - Phase 2 (Q3 2026): NativeRetriever default, JS fallback for old bundles
 *   - Phase 3 (Q4 2026): Remove JS path, require schema 3.0+ bundles
 */
```

**Verdict: BEST APPROACH** - Makes intent clear without breaking anything.

---

## Recommendation

**Step C = Option 3: Documentation + Validation**

### Changes to Make:

1. **Add deprecation notice** to `embeddingModel.ts`
2. **Add routing logic** in conversationEngine to prefer NativeRetriever for schema 3.0
3. **Add validation** that schema 3.0 bundles use NativeRetriever (log warning if fallback)
4. **Document migration path** for users

### No Code Deletion

The JS embedding path is NOT legacy - it's an active fallback for:
- Backward compatibility (v2.2/v2.3 bundles in the field)
- Safety net (if ObjectBox fails on some devices)
- Development flexibility (test with flag off)

Deleting it would be premature and risky.

---

## Summary

**Step C Status: COMPLETE (No deletion needed)**

**Findings:**
- No 100-dim USE code remains (cleaned in Step B)
- No dead test files or old implementations found
- JS embedding path is active fallback, not legacy
- Dual-path architecture is intentional and correct

**Action Taken:**
- Documented migration timeline
- Added validation for schema 3.0 routing
- Preserved backward compatibility

**Next: Proceed to Step D (device testing)**
