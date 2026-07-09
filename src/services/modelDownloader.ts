/**
 * Edge Brain Model Downloader
 *
 * Handles on-device model download with:
 * - Progress tracking
 * - Resume capability
 * - WiFi-only option
 * - User consent modal
 */

import { Filesystem, Directory } from '@capacitor/filesystem';
import { Network } from '@capacitor/network';

// Model configuration
const MODEL_CONFIG = {
  url: 'https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_0_4_4.gguf',
  filename: 'model.gguf',
  expectedSizeMB: 892,
  expectedSizeBytes: 935_329_792, // Approximate
  path: 'models/edge-brain',
};

// LEAP / LFM2.5-350M model configuration (USE_LEAP_BACKEND=true path)
// FIXED: Using LFM2.5 Q4_K_M with embedded chat template (quantized from F16 fix)
const LEAP_MODEL_CONFIG = {
  url: 'https://huggingface.co/Kenzlejaze/hiva-medichat-v2-gguf/resolve/main/lfm25_350m_medichat_v2_merged.Q4_K_M.gguf',
  filename: 'model.gguf',
  expectedSizeMB: 219,
  expectedSizeBytes: 229_311_776,
  path: 'models/lfm25',
};
// NOTE: Model was re-converted with chat template embedded in GGUF metadata (2026-07-09)
// Previous version crashed at common_chat_templates_init() due to missing chat template

let leapDownloadInProgress = false;
let leapController: AbortController | null = null;

export interface DownloadProgress {
  bytesDownloaded: number;
  totalBytes: number;
  percentComplete: number;
  speedMBps: number;
  estimatedSecondsRemaining: number;
}

export interface ModelDownloadResult {
  success: boolean;
  path?: string;
  error?: string;
}

// Download state
let downloadInProgress = false;
let currentController: AbortController | null = null;

/**
 * Check if model file exists and is complete
 */
export async function isModelDownloaded(): Promise<boolean> {
  try {
    const result = await Filesystem.stat({
      path: `${MODEL_CONFIG.path}/${MODEL_CONFIG.filename}`,
      directory: Directory.Data,
    });

    // Check if file exists and size is reasonable (within 10% of expected)
    const sizeOk = result.size > MODEL_CONFIG.expectedSizeBytes * 0.9 &&
                   result.size < MODEL_CONFIG.expectedSizeBytes * 1.1;

    return sizeOk;
  } catch (error) {
    // File doesn't exist
    return false;
  }
}

/**
 * Get current network status
 */
async function getNetworkStatus(): Promise<{ connected: boolean; wifi: boolean }> {
  try {
    const status = await Network.getStatus();
    return {
      connected: status.connected,
      wifi: status.connectionType === 'wifi',
    };
  } catch (error) {
    // Assume connected if network plugin fails
    console.warn('[ModelDownloader] Could not get network status:', error);
    return { connected: true, wifi: false };
  }
}

/**
 * Download model with progress tracking
 *
 * Uses chunked writing to avoid memory issues with large files.
 * Writes chunks directly to filesystem instead of loading entire file into memory.
 *
 * @param onProgress - Callback for progress updates
 * @param wifiOnly - Only download on WiFi connection
 * @returns Result with success status and path
 */
export async function downloadModel(
  onProgress?: (progress: DownloadProgress) => void,
  wifiOnly: boolean = true
): Promise<ModelDownloadResult> {
  if (downloadInProgress) {
    return { success: false, error: 'Download already in progress' };
  }

  // Check network
  const network = await getNetworkStatus();
  if (!network.connected) {
    return { success: false, error: 'No internet connection' };
  }
  if (wifiOnly && !network.wifi) {
    return { success: false, error: 'WiFi required. Please connect to WiFi and try again.' };
  }

  downloadInProgress = true;
  currentController = new AbortController();

  const finalPath = `${MODEL_CONFIG.path}/${MODEL_CONFIG.filename}`;
  const tempPath = `${MODEL_CONFIG.path}/${MODEL_CONFIG.filename}.tmp`;

  try {
    console.log('[ModelDownloader] Starting download:', MODEL_CONFIG.url);

    // Ensure directory exists — ignore error if it already exists (OS-PLUG-FILE-0010)
    try {
      await Filesystem.mkdir({ path: MODEL_CONFIG.path, directory: Directory.Data, recursive: true });
    } catch (e: any) {
      if (!e?.message?.includes('already exists')) throw e;
    }

    // Check if final file already exists
    try {
      const stat = await Filesystem.stat({
        path: finalPath,
        directory: Directory.Data,
      });
      console.log('[ModelDownloader] File already exists:', stat.size, 'bytes');

      // Validate size
      const sizeOk = stat.size > MODEL_CONFIG.expectedSizeBytes * 0.9 &&
                     stat.size < MODEL_CONFIG.expectedSizeBytes * 1.1;

      if (sizeOk) {
        downloadInProgress = false;
        return { success: true, path: finalPath };
      } else {
        console.log('[ModelDownloader] Existing file has wrong size, re-downloading');
        await Filesystem.deleteFile({ path: finalPath, directory: Directory.Data });
      }
    } catch {
      // File doesn't exist, continue with download
    }

    // Download using fetch with progress tracking
    const response = await fetch(MODEL_CONFIG.url, {
      signal: currentController.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }

    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    const totalBytes = contentLength || MODEL_CONFIG.expectedSizeBytes;

    console.log('[ModelDownloader] Content length:', totalBytes, 'bytes');

    let bytesDownloaded = 0;
    const startTime = Date.now();
    const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks for writing
    let buffer: Uint8Array[] = [];
    let bufferSize = 0;

    // Delete temp file if exists
    try {
      await Filesystem.deleteFile({ path: tempPath, directory: Directory.Data });
    } catch {
      // Ignore if doesn't exist
    }

    while (true) {
      const { done, value } = await reader.read();

      if (value) {
        buffer.push(value);
        bufferSize += value.length;
        bytesDownloaded += value.length;

        // Calculate and report progress
        if (onProgress) {
          const elapsed = (Date.now() - startTime) / 1000; // seconds
          const speedMBps = (bytesDownloaded / 1024 / 1024) / elapsed;
          const remainingBytes = totalBytes - bytesDownloaded;
          const estimatedSecondsRemaining = remainingBytes / (bytesDownloaded / elapsed);

          onProgress({
            bytesDownloaded,
            totalBytes,
            percentComplete: (bytesDownloaded / totalBytes) * 100,
            speedMBps,
            estimatedSecondsRemaining: Math.max(0, estimatedSecondsRemaining),
          });
        }

        // Write chunk when buffer reaches threshold or download complete
        if (bufferSize >= CHUNK_SIZE || done) {
          const combinedChunk = combineUint8Arrays(buffer);
          const base64Chunk = arrayBufferToBase64(combinedChunk.buffer as ArrayBuffer);

          await Filesystem.appendFile({
            path: tempPath,
            data: base64Chunk,
            directory: Directory.Data,
          });

          console.log(`[ModelDownloader] Wrote chunk: ${bufferSize} bytes (${bytesDownloaded}/${totalBytes})`);

          buffer = [];
          bufferSize = 0;
        }
      }

      if (done) break;
    }

    // Rename temp file to final name
    console.log('[ModelDownloader] Download complete, renaming temp file');

    // Delete final path if exists (shouldn't, but just in case)
    try {
      await Filesystem.deleteFile({ path: finalPath, directory: Directory.Data });
    } catch {
      // Ignore
    }

    // Rename temp to final
    await Filesystem.rename({
      from: tempPath,
      to: finalPath,
      directory: Directory.Data,
    });

    console.log('[ModelDownloader] Model downloaded successfully:', finalPath);

    downloadInProgress = false;
    currentController = null;

    return { success: true, path: finalPath };
  } catch (error: any) {
    downloadInProgress = false;
    currentController = null;

    // Clean up temp file on error
    try {
      await Filesystem.deleteFile({ path: tempPath, directory: Directory.Data });
    } catch {
      // Ignore cleanup errors
    }

    if (error.name === 'AbortError') {
      console.log('[ModelDownloader] Download cancelled by user');
      return { success: false, error: 'Download cancelled by user' };
    }

    console.error('[ModelDownloader] Download failed:', error);
    return { success: false, error: error.message || 'Download failed' };
  }
}

// Helper: Combine multiple Uint8Arrays into one
function combineUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Check if LEAP/LFM2.5-350M model is downloaded and complete.
 * Auto-cleans corrupt files (wrong size).
 */
export async function isLeapModelDownloaded(): Promise<boolean> {
  try {
    const result = await Filesystem.stat({
      path: `${LEAP_MODEL_CONFIG.path}/${LEAP_MODEL_CONFIG.filename}`,
      directory: Directory.Data,
    });
    const sizeOk = result.size > LEAP_MODEL_CONFIG.expectedSizeBytes * 0.9 &&
                   result.size < LEAP_MODEL_CONFIG.expectedSizeBytes * 1.1;

    // Auto-cleanup corrupt model
    if (!sizeOk) {
      console.log(`[LEAP Download] isLeapModelDownloaded: corrupt model detected (${result.size} bytes). Auto-deleting.`);
      try {
        await Filesystem.deleteFile({
          path: `${LEAP_MODEL_CONFIG.path}/${LEAP_MODEL_CONFIG.filename}`,
          directory: Directory.Data,
        });
      } catch (e) {
        console.warn('[LEAP Download] Failed to auto-delete corrupt model:', e);
      }
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Download the LEAP/LFM2.5-350M model with progress tracking.
 * Writes to models/lfm25/model.gguf in Directory.Data (= context.filesDir on Android).
 */
export async function downloadLeapModel(
  onProgress?: (progress: DownloadProgress) => void,
  wifiOnly: boolean = true,
): Promise<ModelDownloadResult> {
  if (leapDownloadInProgress) {
    return { success: false, error: 'Download already in progress' };
  }

  const network = await getNetworkStatus();
  if (!network.connected) {
    return { success: false, error: 'No internet connection' };
  }
  if (wifiOnly && !network.wifi) {
    return { success: false, error: 'WiFi required. Please connect to WiFi and try again.' };
  }

  leapDownloadInProgress = true;
  leapController = new AbortController();

  const finalPath = `${LEAP_MODEL_CONFIG.path}/${LEAP_MODEL_CONFIG.filename}`;
  const tempPath = `${LEAP_MODEL_CONFIG.path}/${LEAP_MODEL_CONFIG.filename}.tmp`;
  let currentDownloadedBytes = 0;  // Track for error logging

  try {
    // Ignore error if directory already exists (OS-PLUG-FILE-0010)
    try {
      await Filesystem.mkdir({ path: LEAP_MODEL_CONFIG.path, directory: Directory.Data, recursive: true });
    } catch (e: any) {
      if (!e?.message?.includes('already exists')) throw e;
    }

    try {
      const stat = await Filesystem.stat({ path: finalPath, directory: Directory.Data });
      const sizeOk = stat.size > LEAP_MODEL_CONFIG.expectedSizeBytes * 0.9 &&
                     stat.size < LEAP_MODEL_CONFIG.expectedSizeBytes * 1.1;
      if (sizeOk) {
        leapDownloadInProgress = false;
        return { success: true, path: finalPath };
      }
      // Corrupt/incomplete model detected - auto-cleanup
      console.log(`[LEAP Download] Corrupt model detected (${stat.size} bytes, expected ${LEAP_MODEL_CONFIG.expectedSizeBytes}). Auto-deleting.`);
      await Filesystem.deleteFile({ path: finalPath, directory: Directory.Data });
    } catch {
      // File doesn't exist yet
    }


    // Check if we can resume from existing .tmp file
    let resumeFromBytes = 0;
    try {
      const tmpStat = await Filesystem.stat({ path: tempPath, directory: Directory.Data });

      // Validate .tmp file isn't corrupt (oversized = previous corruption bug)
      if (tmpStat.size > LEAP_MODEL_CONFIG.expectedSizeBytes * 1.05) {
        console.log(`[LEAP Download] Corrupt .tmp detected (${tmpStat.size} bytes > expected ${LEAP_MODEL_CONFIG.expectedSizeBytes}). Deleting.`);
        await Filesystem.deleteFile({ path: tempPath, directory: Directory.Data });
        resumeFromBytes = 0;
      } else {
        resumeFromBytes = tmpStat.size;
        console.log(`[LEAP Download] Resuming from ${resumeFromBytes} bytes (${(resumeFromBytes / 1024 / 1024).toFixed(1)} MB)`);
      }
    } catch {
      // No existing .tmp file, start fresh
    }

    // Use Range header to resume download
    const headers: Record<string, string> = {};
    if (resumeFromBytes > 0) {
      headers['Range'] = `bytes=${resumeFromBytes}-`;
    }

    const response = await fetch(LEAP_MODEL_CONFIG.url, { signal: leapController.signal, headers });
    if (!response.ok && response.status !== 206) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // If we requested Range but server returned 200 (full file), it doesn't support resume
    // Delete the .tmp file and start fresh to avoid corruption
    if (resumeFromBytes > 0 && response.status === 200) {
      console.log('[LEAP Download] Server does not support resume (HTTP 200), starting fresh');
      try { await Filesystem.deleteFile({ path: tempPath, directory: Directory.Data }); } catch { /* ignore */ }
      resumeFromBytes = 0;
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is not readable');

    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    const totalBytes = (response.status === 206 ? resumeFromBytes : 0) + contentLength || LEAP_MODEL_CONFIG.expectedSizeBytes;

    let bytesDownloaded = (response.status === 206 ? resumeFromBytes : 0);
    currentDownloadedBytes = resumeFromBytes;  // Update for error logging
    const startTime = Date.now();
    const CHUNK_SIZE = 5 * 1024 * 1024;
    let buffer: Uint8Array[] = [];
    let bufferSize = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        buffer.push(value);
        bufferSize += value.length;
        bytesDownloaded += value.length;
        currentDownloadedBytes = bytesDownloaded;

        if (onProgress) {
          const elapsed = (Date.now() - startTime) / 1000;
          const speedMBps = (bytesDownloaded / 1024 / 1024) / elapsed;
          onProgress({
            bytesDownloaded,
            totalBytes,
            percentComplete: (bytesDownloaded / totalBytes) * 100,
            speedMBps,
            estimatedSecondsRemaining: Math.max(0, (totalBytes - bytesDownloaded) / (bytesDownloaded / elapsed)),
          });
        }

        if (bufferSize >= CHUNK_SIZE) {
          const combined = combineUint8Arrays(buffer);
          await Filesystem.appendFile({
            path: tempPath,
            data: arrayBufferToBase64(combined.buffer as ArrayBuffer),
            directory: Directory.Data,
          });
          console.log(`[LEAP Download] Wrote chunk: ${bufferSize} bytes (total: ${bytesDownloaded}/${totalBytes}, ${((bytesDownloaded/totalBytes)*100).toFixed(1)}%)`);
          buffer = [];
          bufferSize = 0;
        }
      }
      if (done) {
        // Flush any remaining buffered data
        if (bufferSize > 0) {
          const combined = combineUint8Arrays(buffer);
          await Filesystem.appendFile({
            path: tempPath,
            data: arrayBufferToBase64(combined.buffer as ArrayBuffer),
            directory: Directory.Data,
          });
          console.log(`[LEAP Download] Wrote final chunk: ${bufferSize} bytes (total: ${bytesDownloaded}/${totalBytes})`);
          buffer = [];
          bufferSize = 0;
        }
        console.log(`[LEAP Download] Stream done. bytesDownloaded=${bytesDownloaded}, totalBytes=${totalBytes}`);
        break;
      }
    }

    // Verify final file size before renaming
    const tmpStat = await Filesystem.stat({ path: tempPath, directory: Directory.Data });
    console.log(`[LEAP Download] Complete. Final .tmp size: ${tmpStat.size} bytes (expected: ${totalBytes})`);

    if (tmpStat.size < totalBytes * 0.98) {
      throw new Error(`Download incomplete: ${tmpStat.size} bytes received, expected ${totalBytes} bytes`);
    }

    try { await Filesystem.deleteFile({ path: finalPath, directory: Directory.Data }); } catch { /* ignore */ }
    await Filesystem.rename({ from: tempPath, to: finalPath, directory: Directory.Data });

    console.log(`[LEAP Download] Model downloaded successfully: ${finalPath}`);
    leapDownloadInProgress = false;
    leapController = null;
    return { success: true, path: finalPath };
  } catch (error: any) {
    leapDownloadInProgress = false;
    leapController = null;

    // Only delete .tmp file on explicit abort (user cancellation)
    // For network errors, keep the file to allow resume on next attempt
    if (error.name === 'AbortError') {
      try { await Filesystem.deleteFile({ path: tempPath, directory: Directory.Data }); } catch { /* ignore */ }
      return { success: false, error: 'Download cancelled by user' };
    }

    // For other errors, log but keep .tmp file for resume
    console.log(`[LEAP Download] Error (will retry from ${currentDownloadedBytes} bytes): ${error.message}`);
    return { success: false, error: error.message || 'Download failed' };
  }
}

/**
 * Cancel ongoing LEAP model download.
 */
export function cancelLeapDownload(): void {
  if (leapController) {
    leapController.abort();
    leapController = null;
  }
  leapDownloadInProgress = false;
}

/**
 * Cancel ongoing download
 */
export function cancelDownload(): void {
  if (currentController) {
    currentController.abort();
    currentController = null;
  }
  downloadInProgress = false;
}

/**
 * Delete downloaded model (free up space)
 */
export async function deleteModel(): Promise<boolean> {
  try {
    await Filesystem.deleteFile({
      path: `${MODEL_CONFIG.path}/${MODEL_CONFIG.filename}`,
      directory: Directory.Data,
    });
    console.log('[ModelDownloader] Model deleted successfully');
    return true;
  } catch (error) {
    console.error('[ModelDownloader] Failed to delete model:', error);
    return false;
  }
}

/**
 * Get model file info
 */
export async function getModelInfo(): Promise<{
  exists: boolean;
  sizeMB?: number;
  path?: string;
}> {
  try {
    const stat = await Filesystem.stat({
      path: `${MODEL_CONFIG.path}/${MODEL_CONFIG.filename}`,
      directory: Directory.Data,
    });

    return {
      exists: true,
      sizeMB: stat.size / 1024 / 1024,
      path: stat.uri,
    };
  } catch (error) {
    return { exists: false };
  }
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Format seconds to human-readable time
 */
export function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

// Helper: Convert ArrayBuffer to base64
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
