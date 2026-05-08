/**
 * voiceEngine.ts — Sherpa-ONNX WebAssembly voice engine (browser)
 * 
 * IMPORTANT: The current Sherpa-ONNX npm package provides a Node.js WASM build.
 * In the browser, Emscripten FS is NOT exported by default.
 * 
 * For full browser voice support, use a browser-specific WASM build with:
 *   -s EXPORTED_RUNTIME_METHODS=['FS'] -s FORCE_FILESYSTEM=1
 * 
 * Current behavior: gracefully degrades with user-friendly error message.
 */

export type VoiceEngineState = 'unloaded' | 'loading' | 'ready' | 'error';

class VoiceEngine {
  private state: VoiceEngineState = 'unloaded';
  private error: string | null = null;
  private sampleRate = 16000;
  private loadPromise: Promise<void> | null = null;

  getState(): VoiceEngineState { return this.state; }
  getError(): string | null { return this.error; }

  async init(): Promise<void> {
    if (this.state === 'ready') return;
    if (this.loadPromise) {
      await this.loadPromise;
      return;
    }
    this.loadPromise = this.doInit();
    await this.loadPromise;
  }

  private async doInit(): Promise<void> {
    this.state = 'loading';
    this.error = null;

    try {
      // Attempt to load Sherpa-ONNX WASM
      // Note: The npm build is Node.js-targeted. Browser builds need FS export.
      await this.loadSherpaOnnx();
      this.state = 'ready';
    } catch (err) {
      this.state = 'error';
      this.error = err instanceof Error ? err.message : 'Voice engine failed to initialize';
    }
  }

  private async loadSherpaOnnx(): Promise<void> {
    // Load WASM glue script
    await this.loadScript('./sherpa-onnx/sherpa-onnx.js');

    // Wait for module initialization
    const mod = (window as unknown as Record<string, unknown>).Module as
      | { ready: Promise<void> }
      | undefined;
    if (!mod) throw new Error('Sherpa-ONNX module not loaded');
    await mod.ready;

    // Load ASR + TTS APIs
    await this.loadScript('./sherpa-onnx/sherpa-onnx-asr.js');
    await this.loadScript('./sherpa-onnx/sherpa-onnx-tts.js');

    // Verify FS is available (browser builds often don't export FS)
    const fs = (mod as Record<string, unknown>).FS;
    if (!fs) {
      throw new Error(
        'Browser voice support requires a Sherpa-ONNX WASM build with FS export. ' +
        'The current npm package provides a Node.js build. ' +
        'Please use a browser-specific build compiled with: ' +
        '-s EXPORTED_RUNTIME_METHODS=["FS"] -s FORCE_FILESYSTEM=1'
      );
    }
  }

  private loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
  }

  /** Convert Blob → Float32Array at 16kHz mono */
  async decodeAudio(blob: Blob): Promise<Float32Array> {
    const ctx = new AudioContext({ sampleRate: this.sampleRate });
    try {
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
      return buf.getChannelData(0);
    } finally {
      await ctx.close();
    }
  }

  /** STT: audio Blob → text */
  async transcribe(_audioBlob: Blob): Promise<string> {
    if (this.state !== 'ready') {
      throw new Error(this.error ?? 'Voice engine not ready');
    }
    // TODO: Implement once browser WASM build with FS is available
    throw new Error('STT not yet implemented in browser build');
  }

  /** TTS: text → WAV Blob */
  async synthesize(_text: string): Promise<Blob> {
    if (this.state !== 'ready') {
      throw new Error(this.error ?? 'Voice engine not ready');
    }
    // TODO: Implement once browser WASM build with FS is available
    throw new Error('TTS not yet implemented in browser build');
  }

  unload(): void {
    this.state = 'unloaded';
    this.error = null;
    this.loadPromise = null;
  }
}

export const voiceEngine = new VoiceEngine();
