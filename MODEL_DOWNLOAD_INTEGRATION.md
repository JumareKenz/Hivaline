# Model Download Integration Guide

## Overview

The Edge Brain model (Qwen2.5-1.5B-Instruct, 892 MB) is now downloaded on first launch instead of being bundled with the APK. This reduces the APK size from ~900+ MB to ~50-60 MB.

## Architecture

### Components

1. **`modelDownloader.ts`** - Core download service
   - `isModelDownloaded()` - Check if model exists and is complete
   - `downloadModel(onProgress?, wifiOnly?)` - Download with progress tracking
   - `cancelDownload()` - Cancel ongoing download
   - `deleteModel()` - Free up space
   - `getModelInfo()` - Get model file stats

2. **`ModelDownloadModal.tsx`** - React UI component
   - Shows download prompt with size info
   - Progress bar with speed/ETA
   - WiFi-only toggle
   - Cancel button

3. **`useModelDownload.ts`** - React hook
   - Checks model on app launch
   - Shows modal automatically if model is missing
   - Manages download state

4. **`edgeBrainService.ts`** (updated)
   - Now checks `isModelDownloaded()` before loading
   - Throws error if model is missing

## Integration Steps

### Option A: Automatic (Recommended)

Add to your main App component:

```tsx
import { useModelDownload } from './hooks/useModelDownload';
import { ModelDownloadModal } from './components/ModelDownloadModal';

function App() {
  const { showDownloadModal, setShowDownloadModal, modelReady } = useModelDownload();

  return (
    <>
      <ModelDownloadModal
        isOpen={showDownloadModal}
        onDidDismiss={(success) => {
          setShowDownloadModal(false);
          if (success) {
            console.log('Model downloaded successfully');
          }
        }}
      />
      {/* Your app content */}
    </>
  );
}
```

**Behavior:**
- On first launch, checks if model exists
- If missing, shows download modal automatically
- User can download or skip (template mode only)
- On success, model is ready for Edge Brain generation

### Option B: Manual Trigger

Show download modal when user enables Edge Brain in settings:

```tsx
import { useState } from 'react';
import { ModelDownloadModal } from './components/ModelDownloadModal';

function SettingsPage() {
  const [showDownload, setShowDownload] = useState(false);

  return (
    <>
      <IonButton onClick={() => setShowDownload(true)}>
        Download Edge Brain Model
      </IonButton>

      <ModelDownloadModal
        isOpen={showDownload}
        onDidDismiss={(success) => {
          setShowDownload(false);
          // Handle success/failure
        }}
      />
    </>
  );
}
```

## User Experience Flow

### First Launch (No Model)

1. App starts, checks model → missing
2. Modal appears: "Edge Brain Setup"
3. Shows model info (size, benefits, WiFi toggle)
4. User clicks "Download Now" or "Skip"

**If Download:**
- Progress bar shows % complete, speed, ETA
- Can cancel anytime
- On success: modal closes, model ready
- On error: shows error, can retry

**If Skip:**
- App works in template-only mode
- No Edge Brain generation (fallback to structured templates)
- Can download later from settings

### Subsequent Launches (Model Downloaded)

- No modal shown
- Model loads silently on first generation call
- Full Edge Brain functionality available

## File Locations

### Development (adb push)
```
/data/data/com.hiva.runtime/files/models/edge-brain/model.gguf
```

### Production (downloaded)
Same location, written by Capacitor Filesystem API:
```typescript
Directory.Data + 'models/edge-brain/model.gguf'
```

## Download Details

### Network Requirements

- **WiFi recommended** (892 MB)
- Toggle available to allow cellular
- Checks network status before starting
- Fails gracefully if no connection

### Progress Tracking

```typescript
interface DownloadProgress {
  bytesDownloaded: number;      // Current bytes
  totalBytes: number;           // Total size
  percentComplete: number;      // 0-100
  speedMBps: number;            // Download speed
  estimatedSecondsRemaining: number;  // ETA
}
```

### Resume Capability

- Current implementation: NO resume (restarts from 0 if cancelled)
- Future enhancement: Use partial file + HTTP Range headers

### Error Handling

- No internet → "No internet connection"
- WiFi-only + cellular → "WiFi required. Please connect to WiFi and try again."
- HTTP error → "HTTP 404: Not Found"
- Disk full → Capacitor throws error, shown to user

## Model Hosting

### Current (Development)
```
https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_0_4_4.gguf
```

**Pros:** Free, no setup needed
**Cons:** Slower, rate-limited, not guaranteed uptime

### Production Recommendations

**Option 1: Your Own CDN**
- Upload model to AWS S3 / Google Cloud Storage / Azure Blob
- Enable CloudFront / Cloud CDN for fast global delivery
- Update `MODEL_CONFIG.url` in `modelDownloader.ts`
- **Cost:** ~$0.01 per download (892 MB transfer)

**Option 2: Firebase Storage**
- Upload to Firebase Storage
- Use Firebase SDK for download (built-in resume support)
- **Cost:** Free tier covers ~5,500 downloads/month

**Option 3: App Bundle (Expansion Files)**
- Google Play expansion files (up to 2 GB)
- Model delivered with app, but separate from APK
- No download on first launch
- **Downside:** Requires Google Play Store

### Recommended: AWS S3 + CloudFront

```bash
# Upload model
aws s3 cp models/Qwen2.5-1.5B-Instruct-Q4_0_4_4.gguf \
  s3://your-bucket/models/edge-brain/model.gguf \
  --content-type application/octet-stream

# Enable public read
aws s3api put-object-acl \
  --bucket your-bucket \
  --key models/edge-brain/model.gguf \
  --acl public-read

# CloudFront URL (update in modelDownloader.ts):
https://your-cdn.cloudfront.net/models/edge-brain/model.gguf
```

## Testing

### Unit Tests

```bash
npm test -- src/__tests__/services/modelDownloader.test.ts
```

### Manual Testing

1. **First launch with no model:**
   ```bash
   # Clear model file
   adb shell run-as com.hiva.runtime rm -rf files/models/edge-brain/model.gguf
   
   # Restart app
   adb shell am force-stop com.hiva.runtime
   adb shell am start com.hiva.runtime/.MainActivity
   ```
   
   Expected: Download modal appears

2. **Download success:**
   - Click "Download Now"
   - Observe progress bar
   - Wait for completion
   - Modal closes, check logs for "Model downloaded successfully"

3. **Cancel download:**
   - Start download
   - Click "Cancel Download"
   - Check that download stops

4. **WiFi-only enforcement:**
   - Disable WiFi, enable cellular
   - Try to download
   - Expected: Error message "WiFi required..."

5. **Skip download:**
   - Click "Skip (Template Mode Only)"
   - App works, but no Edge Brain generation
   - Check logs for "Model not downloaded" when generation is attempted

## Troubleshooting

### "Model not downloaded" error

**Cause:** `edgeBrainService.loadEdgeBrain()` called but model file missing

**Fix:** Show download modal to user

```typescript
import { isModelDownloaded } from './services/modelDownloader';

// Before generation
const downloaded = await isModelDownloaded();
if (!downloaded) {
  setShowDownloadModal(true);
  return;
}
```

### Download fails with HTTP error

**Cause:** HuggingFace rate limit or server issue

**Fix:** Use your own CDN (see Model Hosting above)

### Download succeeds but load fails

**Cause:** Partial/corrupt download

**Fix:** Delete and re-download

```typescript
import { deleteModel, downloadModel } from './services/modelDownloader';

await deleteModel();
await downloadModel(onProgress);
```

### APK size is still large

**Cause:** Model bundled in assets

**Fix:** Ensure model is NOT in `android/app/src/main/assets/` or `public/assets/`

## Performance

### Download Time Estimates

| Connection | Speed | Duration |
|-----------|-------|----------|
| WiFi (50 Mbps) | 6.25 MB/s | ~2.5 minutes |
| WiFi (100 Mbps) | 12.5 MB/s | ~1.2 minutes |
| 4G LTE | 3-5 MB/s | ~3-5 minutes |
| 5G | 10-20 MB/s | ~1-2 minutes |

### Storage Requirements

- Model file: 892 MB
- Model + KV cache (runtime): ~1.3 GB
- Recommended free space: 2 GB minimum

## Future Enhancements

### 1. Resume Support
```typescript
// Check partial file, use HTTP Range headers
const partialSize = await getPartialFileSize();
const response = await fetch(url, {
  headers: { 'Range': `bytes=${partialSize}-` }
});
```

### 2. Background Download
```typescript
// Use Capacitor Background Task plugin
import { BackgroundTask } from '@capacitor-community/background-task';
```

### 3. Model Variants
```typescript
// Offer smaller model for low-end devices
const MODEL_VARIANTS = {
  'high': 'Qwen2.5-1.5B-Instruct-Q4_0_4_4.gguf',  // 892 MB
  'medium': 'Qwen2.5-1.5B-Instruct-Q4_0_4_8.gguf',  // 700 MB
  'low': 'SmolLM2-360M-Instruct-Q4_K_M.gguf',  // 220 MB
};
```

### 4. Delta Updates
```typescript
// If model version changes, download only diff
// Requires server-side support
```

## Migration from Bundled Model

**If you previously bundled the model in the APK:**

1. Remove model from `android/app/src/main/assets/models/`
2. Update `EdgeBrainPlugin.kt` to use internal storage path only
3. Add download modal to your app
4. Users will need to download on first launch after update

**Alternatively (smoother UX):**

1. Keep bundled model in v1.0
2. Copy bundled model to internal storage on first launch
3. In v1.1, remove bundled model, rely on download modal

## Summary

- ✅ APK size reduced from ~900 MB to ~50 MB
- ✅ User downloads model on first launch (~2-5 min on WiFi)
- ✅ Progress tracking with speed/ETA
- ✅ WiFi-only option to save mobile data
- ✅ Can skip and use template-only mode
- ✅ Graceful error handling
- ⏳ Resume capability (future enhancement)
- ⏳ Background download (future enhancement)

**Production checklist:**
- [ ] Host model on your own CDN (AWS S3 + CloudFront recommended)
- [ ] Update `MODEL_CONFIG.url` in `modelDownloader.ts`
- [ ] Add `useModelDownload()` hook to App component
- [ ] Test on real device with various network conditions
- [ ] Monitor download success rate in production
