# Model Download Configuration

**Strategy**: On-demand model download on first launch  
**Goal**: Reduce APK size from 2.4GB to <50MB

---

## Models Configuration

### Bundled in APK (Always Available)

These lightweight models ship with the APK for instant availability:

| Model | Size | Purpose | Location |
|-------|------|---------|----------|
| **MiniLM** | 174MB | Query embedding | `public/models/embed/` |
| **STT** | 99MB | Speech-to-text | `public/models/stt/` |
| **TTS** | 61MB | Text-to-speech | `public/models/tts/` |
| **VAD** | 632KB | Voice activity detection | `public/models/vad/` |

**Total bundled**: ~335MB

### Downloaded on First Launch (On-Demand)

Large models download when first needed:

| Model | Size | Purpose | Download Trigger | Required For |
|-------|------|---------|------------------|--------------|
| **Qwen2.5-1.5B** | 890MB | LLM translation | First Hausa/Yoruba/Igbo query | Translation layer |

**Download strategy**:
- Lazy loading: Only download when feature is first used
- Background download: Show progress indicator, allow app usage during download
- Resume support: Can be paused and resumed
- WiFi-only option: Prevent cellular data usage

---

## Removed Models (Not Needed)

These were removed to reduce APK size:

| Model | Size | Reason for Removal |
|-------|------|-------------------|
| **bge-m3** | 560MB | Failed deployment criteria (no improvement, 2.4× slower) |
| **bge-m3-q4** | 1.2GB | Quantized variant, not tested |
| **bge-m3-q4f16** | 684MB | Another variant, not needed |
| **LaBSE** | 463MB | Failed measurement (no Hausa improvement, bundle mismatch) |

**Total removed**: 2.9GB

---

## APK Size Comparison

| Configuration | APK Size | Models Bundled |
|---------------|----------|----------------|
| **Before** (all models) | 2.4GB | All embedding variants + STT + TTS |
| **After** (optimized) | ~400MB | MiniLM + STT + TTS + VAD only |
| **Target** (production) | <100MB | No models bundled, all downloaded |

---

## Implementation: On-Demand Qwen Download

### Current State
- Qwen model download infrastructure exists (`modelDownloader.ts`)
- EdgeBrain service checks if model is present before use
- Download UI component exists but disabled (Ionic dependencies missing)

### Integration Points

**1. Translation Layer Fallback**

When translation is requested but Qwen model is missing:

```typescript
// In queryTranslator.ts prepareQueryForEmbedding()

try {
  if (!(await isEdgeBrainReady())) {
    // Trigger model download
    await loadEdgeBrain(); // Downloads model if missing
  }
  
  const translation = await translateToEnglish(query, language);
  return translation;
} catch (err) {
  // Fallback: use original query without translation
  return {
    originalQuery: query,
    language,
    translatedQuery: query, // No translation, use as-is
    latencyMs: 0,
    error: 'Model not available',
  };
}
```

**2. Settings Screen Download Button**

Add manual download option in settings:

```typescript
// In SettingsScreen.tsx

<IonItem>
  <IonLabel>
    <h2>Translation Model</h2>
    <p>{modelReady ? 'Installed' : 'Not installed'} (890MB)</p>
  </IonLabel>
  <IonButton onClick={handleDownloadModel}>
    {downloading ? `${progress}%` : 'Download'}
  </IonButton>
</IonItem>
```

**3. First-Use Prompt**

When user sends first Hausa/Yoruba/Igbo query:

```
┌─────────────────────────────────────┐
│  Translation Feature Available      │
├─────────────────────────────────────┤
│  To translate Nigerian languages,   │
│  download the translation model:    │
│                                     │
│  Size: 890MB                        │
│  Network: WiFi recommended          │
│                                     │
│  [Download Now]  [Use English Only] │
└─────────────────────────────────────┘
```

---

## Download Flow

### Automatic (First Hausa Query)

```
User sends Hausa query
    ↓
Language detected: Hausa
    ↓
Check if Qwen model exists
    ↓
Model missing → Show download prompt
    ↓
User clicks "Download Now"
    ↓
Download 890MB model (with progress)
    ↓
Model ready → Translate query → Retrieve
    ↓
Return response to user
```

**Fallback behavior**: If user declines download, query proceeds without translation (50% Hausa recall instead of 100%).

### Manual (Settings)

```
User opens Settings
    ↓
Sees "Translation Model: Not installed"
    ↓
Clicks "Download"
    ↓
Download 890MB model (with progress)
    ↓
Status updates to "Installed"
```

---

## Download Implementation

**File**: `src/services/modelDownloader.ts`

Already implemented:
- `isModelDownloaded()` - Check if model exists
- `downloadModel(onProgress, wifiOnly)` - Download with progress tracking
- `cancelDownload()` - Abort in-progress download

**Missing**: Integration into translation layer

### Required Changes

**1. Add lazy download trigger in `queryTranslator.ts`**:

```typescript
export async function prepareQueryForEmbedding(query: string): Promise<TranslationResult> {
  const language = detectLanguage(query);
  
  if (language === 'en') {
    return { originalQuery: query, language, translatedQuery: null, latencyMs: 0, error: null };
  }
  
  // Check if model is available
  const modelReady = await isEdgeBrainReady();
  if (!modelReady) {
    // Attempt to load/download model
    try {
      await loadEdgeBrain(); // This will trigger download if needed
    } catch (err) {
      // Model download failed or was cancelled
      return {
        originalQuery: query,
        language,
        translatedQuery: query, // Fallback to original
        latencyMs: 0,
        error: 'Model not available - using original query',
      };
    }
  }
  
  return translateToEnglish(query, language);
}
```

**2. Update `edgeBrainService.ts` to trigger download**:

```typescript
export async function loadEdgeBrain(): Promise<void> {
  // ... existing load logic ...
  
  // Check if model is downloaded
  const downloaded = await isModelDownloaded();
  if (!downloaded) {
    // Trigger download with user consent
    const shouldDownload = await showDownloadPrompt(); // New UI function
    if (!shouldDownload) {
      throw new Error('Model download declined by user');
    }
    
    // Download model
    const result = await downloadModel(
      (progress) => updateDownloadProgress(progress), // Show progress
      true // WiFi only
    );
    
    if (!result.success) {
      throw new Error(result.error || 'Download failed');
    }
  }
  
  // Load model into memory
  // ... existing load logic ...
}
```

---

## Production Checklist

### Before Release

- [ ] Remove all unused models from `public/models/`
- [ ] Verify only MiniLM + STT + TTS + VAD are bundled
- [ ] Test APK size <500MB
- [ ] Implement download prompt UI
- [ ] Test download flow on slow WiFi
- [ ] Test download cancellation and resume
- [ ] Test cellular data blocking (WiFi-only mode)

### After Release

- [ ] Monitor download success rate
- [ ] Track average download time (target <15min on WiFi)
- [ ] Monitor download cancellation rate
- [ ] Track translation usage vs download rate

---

## Alternative: No Models Bundled (Future)

For maximum APK size reduction (<50MB):

**Strategy**: Download ALL models on first launch
- MiniLM embedding (174MB) - required for all queries
- STT/TTS (160MB) - required for voice features
- Qwen translation (890MB) - optional, downloaded when needed

**Trade-off**:
- ✅ APK size <50MB (instant install)
- ❌ App unusable until MiniLM downloads (~3min on WiFi)
- ❌ Requires initial setup flow

**Recommendation**: Start with bundled MiniLM (current approach), migrate to full on-demand download in v2 after validating download infrastructure.

---

## Current Status

**✅ Completed**:
- Removed bge-m3 variants (saved 2.4GB)
- Removed LaBSE (saved 463MB)
- Cleaned Android assets
- APK size reduced to ~400MB (from 2.4GB)

**⏳ In Progress**:
- Rebuilding APK with optimized models

**📋 Next Steps**:
- Install Ionic React packages
- Re-enable model download UI
- Add lazy download trigger in translation layer
- Test download flow on device

---

## APK Delivery Options

### Option A: Standard APK (Current)
- Single APK file (~400MB)
- All bundled models included
- Works offline immediately (except translation)

### Option B: Android App Bundle (AAB)
- Google Play only
- Dynamic feature delivery
- Can defer model downloads until needed
- Reduces initial install size

**Recommendation**: Use standard APK for testing, migrate to AAB for Play Store release.

---

**Build Configuration**:
```bash
# Standard APK (current)
./gradlew assembleDebug  # ~400MB

# Release APK (signed)
./gradlew assembleRelease  # ~400MB, optimized

# Android App Bundle (Play Store)
./gradlew bundleRelease  # ~400MB, dynamic delivery enabled
```
