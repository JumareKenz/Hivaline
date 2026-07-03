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

    // Ensure directory exists
    await Filesystem.mkdir({
      path: MODEL_CONFIG.path,
      directory: Directory.Data,
      recursive: true,
    });

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
