/**
 * nativeTTSService.ts — Native Android TTS bridge (PocketTTS via sherpa-onnx)
 *
 * Interfaces with NativeTTSPlugin.kt for offline text-to-speech synthesis.
 * Fallback to Web Speech API if native TTS unavailable.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

interface NativeTTSSynthesizeResult {
  samples: number[];
  sampleRate: number;
  numSamples: number;
}

interface NativeTTSAvailability {
  available: boolean;
  sampleRate: number;
}

class NativeTTSService {
  private isNativeAvailable = false;
  private sampleRate = 24000;

  async init(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      console.log('[NativeTTS] Not on native platform, Web Speech API fallback');
      return;
    }

    try {
      const NativeTTS = registerPlugin<any>('NativeTTS');
      const result = (await NativeTTS.isAvailable()) as NativeTTSAvailability;

      this.isNativeAvailable = result.available;
      this.sampleRate = result.sampleRate;

      if (this.isNativeAvailable) {
        console.log(`[NativeTTS] PocketTTS available (${this.sampleRate}Hz)`);
      } else {
        console.warn('[NativeTTS] PocketTTS not initialized');
      }
    } catch (err) {
      console.error('[NativeTTS] Failed to check availability:', err);
      this.isNativeAvailable = false;
    }
  }

  async synthesize(text: string): Promise<AudioBuffer | null> {
    if (!this.isNativeAvailable) {
      throw new Error('Native TTS not available');
    }

    try {
      const NativeTTS = registerPlugin<any>('NativeTTS');
      const result = (await NativeTTS.synthesize({ text })) as NativeTTSSynthesizeResult;

      // Convert samples to AudioBuffer for Web Audio API playback
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = audioContext.createBuffer(
        1, // mono
        result.numSamples,
        result.sampleRate
      );

      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < result.samples.length; i++) {
        channelData[i] = result.samples[i];
      }

      return audioBuffer;
    } catch (err) {
      console.error('[NativeTTS] Synthesis failed:', err);
      throw err;
    }
  }

  isAvailable(): boolean {
    return this.isNativeAvailable;
  }

  getSampleRate(): number {
    return this.sampleRate;
  }
}

export const nativeTTSService = new NativeTTSService();
