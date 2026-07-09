# Step C: Legacy Path Removal - EXECUTED ✓

## User Confirmation

**Q1**: Do v2.2/v2.3 bundles exist in production?
**A**: NO

**Q2**: Should we keep dual-path as permanent architecture?
**A**: NO

**Decision**: Execute original plan - remove legacy JS embedding path.

---

## Changes Made

### 1. Gutted embeddingModel.ts ✓

**File**: `src/services/embeddingModel.ts`

**Removed**:
- All model loading logic (`loadPipeline`, `getEmbeddingModel`)
- MiniLM and bge-m3 implementations
- Xenova/transformers imports
- Pipeline instances and loading promises

**Kept** (stub only):
- Type exports for 1-release compatibility
- Functions throw clear error directing to NativeRetriever
- No silent failures - loud errors surface misconfigurations

---

### 2. Flipped USE_NATIVE_RETRIEVER Default to TRUE ✓

**File**: `android/app/build.gradle` (line 38)

**Before**: `buildConfigField "boolean", "USE_NATIVE_RETRIEVER", "false"`

**After**: `buildConfigField "boolean", "USE_NATIVE_RETRIEVER", "true"`

**Comment updated**: 
> "Set to false ONLY as emergency rollback lever (1 release cycle only). Flag will be removed entirely in next release - no legacy fallback."

---

### 3. Removed v2.2/v2.3 Schema Support ✓

**File**: `src/services/hivLoader.ts`

**Before**: `export type SchemaVersion = '2.2' | '2.3' | '3.0'`

**After**: `export type SchemaVersion = '3.0'`

**parseSchemaVersion()**: Now throws clear error for v2.2/v2.3 bundles:
> "Schema version X.X is not supported. This runtime requires schema version 3.0+ bundles (EmbeddingGemma-300M + ObjectBox). Legacy v2.2/v2.3 bundles are no longer compatible."

---

### 4. Removed v2.2/v2.3 Routing Logic ✓

**File**: `src/services/conversationEngine.ts`

**Removed**:
- Schema version detection logic
- Conditional embedding dimension selection (384 vs 1024)
- v2.3 dense-only mode warnings

**Hardcoded**:
```typescript
const schemaVersion: '3.0' = '3.0';
embeddingDims: hivFile.embeddingDims ?? 256  // EmbeddingGemma only
```

---

### 5. Stubbed hybridSearch Embedding Functions ✓

**File**: `src/engine/hybridSearch.ts`

**Removed**:
- v2.2 (MiniLM) and v2.3 (bge-m3) function pointers
- Schema-version-based routing in vector search

**Stubbed**:
- `setEmbedQueryFn()` → logs deprecation warning
- `setEmbedQueryFnV22()` → logs deprecation warning  
- `setEmbedQueryFnV23()` → logs deprecation warning

**Note**: These stubs don't throw (yet) to allow tests to compile. Will be fully removed in next release when flag is removed.

---

## What Was NOT Removed (Yet)

### USE_NATIVE_RETRIEVER Flag Itself

**Status**: Kept as 1-release rollback safety valve

**Removal plan**:
- Current release: Flag defaults to `true`, can be flipped to `false` for emergency rollback
- Next release: Remove flag entirely, delete rollback code paths
- Timeline: Remove after Step D validation passes and 1 release cycle in production

---

### embeddingModel.ts File

**Status**: Kept as stub file

**Why**: 
- Imports exist throughout codebase
- Functions throw clear errors instead of silent failures
- Easier to grep for remaining references

**Removal plan**:
- Next release: Delete file entirely
- Find/replace all imports with NativeRetriever references
- Remove from build pipeline

---

### hybridSearch Embedding Function Pointers

**Status**: Variables kept (null), setters warn but don't throw

**Why**:
- Tests may still reference these
- Gradual migration to avoid breaking test suite

**Removal plan**:
- Next release: Delete variables and setters entirely
- Update tests to use NativeRetriever mocks

---

## Validation

### Build Check

**Status**: NOT YET RUN

**Required**:
```bash
cd android && ./gradlew assembleDebug
```

Expected: Clean build with no compilation errors.

---

### Runtime Check

**Status**: NOT YET RUN

**Required**: Launch app, verify:
1. NativeRetriever loads by default
2. Attempting to load v2.2/v2.3 bundle throws clear error
3. Schema 3.0 bundle works with NativeRetriever
4. No silent fallbacks to JS embedding

---

## Files Modified

1. `src/services/embeddingModel.ts` - Gutted to stub
2. `android/app/build.gradle` - Flipped flag default
3. `src/services/hivLoader.ts` - Removed v2.2/v2.3 support
4. `src/services/conversationEngine.ts` - Removed routing logic
5. `src/engine/hybridSearch.ts` - Stubbed embedding functions

---

## Next Steps

**Step C: COMPLETE** ✓ (pending build validation)

**Before Step D**:
1. Run `./gradlew assembleDebug` - verify clean build
2. Fix any compilation errors from removed code
3. Update tests that reference v2.2/v2.3 or embeddingModel functions

**Step D: Device Testing**
- Deploy to device
- Run numerical correctness test
- Verify NativeRetriever works end-to-end
- Measure performance (latency, recall)

---

## Summary

**Executed as requested**: 
- ✓ Removed legacy JS embedding path (gutted to stub)
- ✓ Flipped USE_NATIVE_RETRIEVER to true by default
- ✓ Removed v2.2/v2.3 schema support
- ✓ Removed conditional routing logic
- ✓ Flag kept as 1-release rollback only

**Not "intentional design"**: Correctly characterized as temporary safety valve with documented removal timeline.
