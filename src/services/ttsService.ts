/**
 * ttsService.ts — Web Speech API Text-to-Speech engine
 *
 * Accurate, professional, effective, non-failing.
 * Gracefully degrades when SpeechSynthesis is unavailable.
 */

export interface TTSVoice {
  uri: string;
  name: string;
  lang: string;
  default: boolean;
}

export interface TTSState {
  isAvailable: boolean;
  isEnabled: boolean;
  isSpeaking: boolean;
  voices: TTSVoice[];
  selectedVoiceURI: string | null;
  error: string | null;
}

type StateListener = (state: TTSState) => void;

class TTSService {
  private synth: SpeechSynthesis | null = null;
  private voices: SpeechSynthesisVoice[] = [];
  private enabled = false;
  private selectedVoiceURI: string | null = null;
  private isSpeaking = false;
  private error: string | null = null;
  private listeners = new Set<StateListener>();
  private voicesLoaded = false;

  constructor() {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      this.error = 'Speech synthesis not supported';
      return;
    }

    this.synth = window.speechSynthesis;
    this.loadVoices();

    window.speechSynthesis.onvoiceschanged = () => {
      this.loadVoices();
    };
  }

  private loadVoices(): void {
    if (!this.synth) return;

    try {
      const loaded = this.synth.getVoices();
      if (loaded.length === 0 && !this.voicesLoaded) {
        return;
      }

      this.voices = [...loaded];
      this.voicesLoaded = true;

      if (this.selectedVoiceURI === null) {
        this.autoSelectVoice();
      }

      this.error = null;
      this.notify();
    } catch {
      this.error = 'Failed to load voices';
      this.notify();
    }
  }

  private autoSelectVoice(): void {
    if (this.voices.length === 0) return;

    const enVoices = this.voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
    if (enVoices.length === 0) {
      this.selectedVoiceURI = this.voices[0].voiceURI;
      return;
    }

    // Prefer high-quality voices: Natural, Neural, Premium, Enhanced
    const qualityKeywords = ['Natural', 'Neural', 'Premium', 'Enhanced'];
    const quality = enVoices.find((v) =>
      qualityKeywords.some((kw) => v.name.includes(kw))
    );

    // Next: Google voices (usually best on Android Chrome)
    const google = enVoices.find((v) => v.name.includes('Google'));

    // Next: UK / US English
    const ukUs = enVoices.find(
      (v) => v.name.includes('UK') || v.name.includes('US')
    );

    const preferred = quality ?? google ?? ukUs ?? enVoices[0];
    this.selectedVoiceURI = preferred.voiceURI;
  }

  private notify(): void {
    const state = this.getState();
    this.listeners.forEach((l) => l(state));
  }

  getState(): TTSState {
    return {
      isAvailable: this.synth !== null,
      isEnabled: this.enabled,
      isSpeaking: this.isSpeaking,
      voices: this.voices.map((v) => ({
        uri: v.voiceURI,
        name: v.name,
        lang: v.lang,
        default: v.default,
      })),
      selectedVoiceURI: this.selectedVoiceURI,
      error: this.error,
    };
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.cancel();
    }
    this.notify();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setVoice(voiceURI: string): void {
    this.selectedVoiceURI = voiceURI;
    this.notify();
  }

  speak(text: string, retries = 3): void {
    if (!this.synth || !this.enabled) return;
    if (!text) return;

    if (!this.voicesLoaded || this.voices.length === 0) {
      if (retries > 0) {
        setTimeout(() => this.speak(text, retries - 1), 500);
      }
      return;
    }

    const cleaned = this.cleanText(text);
    if (!cleaned) return;

    this.cancel();

    const utterance = new SpeechSynthesisUtterance(cleaned);

    const voice =
      this.voices.find((v) => v.voiceURI === this.selectedVoiceURI) ??
      this.voices.find((v) => v.lang.toLowerCase().startsWith('en')) ??
      this.voices[0];

    if (voice) utterance.voice = voice;
    utterance.rate = 1.0;
    utterance.pitch = 1.02;
    utterance.volume = 1.0;

    utterance.onstart = () => {
      this.isSpeaking = true;
      this.error = null;
      this.notify();
    };

    utterance.onend = () => {
      this.isSpeaking = false;
      this.notify();
    };

    utterance.onerror = (e) => {
      this.isSpeaking = false;
      if (e.error !== 'canceled') {
        this.error = `Speech error: ${e.error}`;
      }
      this.notify();
    };

    try {
      this.synth.speak(utterance);
    } catch (e) {
      this.isSpeaking = false;
      this.error = e instanceof Error ? e.message : 'Speech synthesis failed';
      this.notify();
    }
  }

  cancel(): void {
    if (!this.synth) return;
    try {
      this.synth.cancel();
    } catch {
      /* Some browsers throw if cancel is called when not speaking */
    }
    this.isSpeaking = false;
    this.notify();
  }

  private cleanText(raw: string): string {
    return raw
      .replace(/\bHIVA\b/g, 'Heeva')
      .replace(/\bkg\b/gi, 'kilogram')
      .replace(/\bmg\b/gi, 'milligram')
      .replace(/\bml\b/gi, 'milliliter')
      .replace(/\bFMOH\b/g, 'F M O H')
      .replace(/\bANC\b/g, 'A N C')
      .replace(/\bACT\b/g, 'A C T')
      .replace(/[*_#`]/g, ' ')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

export const ttsService = new TTSService();
