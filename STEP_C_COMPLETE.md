# Step C: Legacy Path Removal - COMPLETE ✓

## Summary

**Approach**: Documentation + Validation (Conservative)

No code deletion was needed. The "legacy" 100-dim USE implementation was already removed/replaced in Step B. The current dual-path architecture (JS embedding + NativeRetriever) is intentional and correct.

## Changes Made

### 1. Added Deprecation Documentation ✓

**File**: `src/services/embeddingModel.ts`

**Change**: Added comprehensive deprecation notice at file header:
- Marks WebView embedding as "soft deprecated" for schema 3.0+
- Documents migration timeline (Phase 1 → Phase 2 → Phase 3)
- Clarifies when to use NativeRetriever vs. JS fallback
- Preserves backward compatibility for v2.2/v2.3 bundles

**Intent**: Developers understand this is fallback path, not primary path for new bundles.

---

### 2. Added Schema 3.0 Routing Validation ✓

**File**: `src/services/conversationEngine.ts` (lines 841-851)

**Change**: Added logging when schema 3.0 bundle uses JS embedding fallback:
```typescript
if (isSchema30) {
  console.info(
    '[ConversationEngine] Schema 3.0 bundle detected. ' +
    'For best performance, enable USE_NATIVE_RETRIEVER and use NativeRetrieverPlugin ' +
    '(ObjectBox + EmbeddingGemma-300M HNSW). Current path: JS embedding fallback.'
  );
}
```

**Intent**: Surface misconfigurations where schema 3.0 bundles aren't using optimal path.

---

## What Was NOT Removed (And Why)

### JS Embedding Path (embeddingModel.ts)
**Status**: ACTIVE FALLBACK - NOT LEGACY

**Reasons to keep**:
1. **Backward compatibility**: v2.2/v2.3 bundles in production require it
2. **Safety net**: If ObjectBox fails on some devices, graceful degradation
3. **Development flexibility**: Test with USE_NATIVE_RETRIEVER=false
4. **Gradual migration**: Users can opt into NativeRetriever without breaking existing deployments

**Migration path**:
- Phase 1 (current): Both paths active, NativeRetriever opt-in
- Phase 2 (future): NativeRetriever default for 3.0+, JS fallback for old bundles
- Phase 3 (long-term): Remove JS path when all bundles upgraded to 3.0+

---

### Dual-Path Architecture
**Status**: INTENTIONAL DESIGN

The current architecture supports:
- **Primary path**: NativeRetriever (ObjectBox + EmbeddingGemma) for schema 3.0+
- **Fallback path**: JS embedding (MiniLM/bge-m3) for v2.2/v2.3

This is **not technical debt** - it's a deliberate compatibility layer during migration.

---

## Verification

### No Legacy Code Found ✓

**Checked**:
- ✓ No 100-dim USE references (cleaned in Step B)
- ✓ No old NativeRetriever implementations
- ✓ No dead test files
- ✓ No commented-out retriever code
- ✓ No SQLite-based vector search remnants

**Result**: Codebase is clean. Only active, maintained code paths remain.

---

### Routing Logic Validation ✓

**Schema 2.2/2.3 bundles**:
- Uses JS embedding (MiniLM 384-dim or bge-m3 1024-dim)
- Correct behavior - no warning logged

**Schema 3.0 bundles with USE_NATIVE_RETRIEVER=true**:
- Uses NativeRetriever (EmbeddingGemma 256-dim)
- Optimal path - no warning needed

**Schema 3.0 bundles with USE_NATIVE_RETRIEVER=false**:
- Falls back to JS embedding
- **Logs informational message** suggesting NativeRetriever for better performance

---

## Files Modified

1. `src/services/embeddingModel.ts`
   - Added deprecation documentation
   - Clarified migration timeline

2. `src/services/conversationEngine.ts`
   - Added schema 3.0 routing validation
   - Logs when fallback path used for new bundles

3. `STEP_C_ANALYSIS.md` (new)
   - Documents decision process
   - Explains why no deletion needed

4. `STEP_C_COMPLETE.md` (this file)
   - Summary of Step C completion

---

## Next Steps

**Step C: COMPLETE** ✓

**Proceed to Step D**: Device Testing
- Build Android app with integrated NativeRetriever
- Run on-device numerical correctness test
- Verify cosine similarity > 0.999 for reference phrases
- Test recall quality with real .hiv bundle
- Measure latency (query embedding + HNSW search)
- Verify L2 normalization spot-checks pass

Only after Step D passes, consider Step C truly validated in production context.

---

## Conclusion

**Step C = Documentation, Not Deletion**

The "legacy path removal" step turned out to be:
- Documenting migration timeline
- Adding validation for optimal routing
- Preserving backward compatibility

**No code was deleted** because:
- The old 100-dim USE code was already removed in Step B
- The JS embedding path is an active fallback, not legacy
- Dual-path architecture is correct for gradual migration

**Result**: Clean codebase, clear intent, safe migration path.
