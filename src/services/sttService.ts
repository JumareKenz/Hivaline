/**
 * sttService.ts — Web Speech API Speech-to-Text engine
 *
 * Accurate, professional, effective, non-failing.
 * Gracefully degrades when SpeechRecognition is unavailable.
 */

export type STTState = 'idle' | 'listening' | 'processing' | 'result' | 'error';

/* ─── Web Speech API type stubs (not in standard lib.dom) ─── */

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message: string;
}

interface SpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface STTListener {
  (state: STTState, transcript: string, error: string | null): void;
}

class STTService {
  private recognition: SpeechRecognition | null = null;
  private state: STTState = 'idle';
  private error: string | null = null;
  private finalTranscript = '';
  private listeners = new Set<STTListener>();
  private lang = 'en-NG';

  getLang(): string {
    return this.lang;
  }

  setLang(lang: string): void {
    this.lang = lang;
  }

  isSupported(): boolean {
    if (typeof window === 'undefined') return false;
    return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  }

  getState(): STTState {
    return this.state;
  }

  getTranscript(): string {
    return this.finalTranscript;
  }

  getError(): string | null {
    return this.error;
  }

  subscribe(listener: STTListener): () => void {
    this.listeners.add(listener);
    listener(this.state, this.finalTranscript, this.error);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): void {
    if (!this.isSupported()) {
      this.finalTranscript = '';
      this.error = 'Speech recognition is not supported on this device.';
      this.setState('error');
      return;
    }

    if (this.state === 'listening') return;

    const SpeechRecognitionCtor =
      (window as unknown as Record<string, unknown>).SpeechRecognition as
      | (new () => SpeechRecognition)
      | undefined;
    const WebkitSpeechRecognitionCtor =
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition as
      | (new () => SpeechRecognition)
      | undefined;

    const Ctor = SpeechRecognitionCtor ?? WebkitSpeechRecognitionCtor;
    if (!Ctor) {
      this.error = 'Speech recognition is not available.';
      this.setState('error');
      return;
    }

    this.recognition = new Ctor();
    this.recognition.continuous = false;
    this.recognition.interimResults = true;
    this.recognition.lang = this.lang;

    this.finalTranscript = '';
    this.error = null;

    this.recognition.onstart = () => {
      this.state = 'listening';
      this.notify('listening');
    };

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      const ev = event;
      for (let i = ev.resultIndex; i < ev.results.length; ++i) {
        const item = ev.results[i];
        if (item.isFinal) {
          this.finalTranscript += item[0].transcript;
        }
      }
    };

    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const err = event.error;
      if (err === 'aborted') return;
      this.error = this.formatError(err);
      this.state = 'error';
      this.notify('error');
    };

    this.recognition.onend = () => {
      this.recognition = null;
      if (this.state === 'error') return;

      if (this.finalTranscript) {
        this.state = 'result';
        this.notify('result');
      } else {
        this.state = 'idle';
        this.notify('idle');
      }
    };

    try {
      this.recognition.start();
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to start speech recognition';
      this.state = 'error';
      this.notify('error');
    }
  }

  stop(): void {
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        /* Ignore: may throw if not started */
      }
    }
  }

  abort(): void {
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        /* Ignore */
      }
    }
    this.state = 'idle';
    this.finalTranscript = '';
    this.error = null;
    this.notify('idle');
  }

  private formatError(error: string): string {
    switch (error) {
      case 'no-speech':
        return 'No speech detected. Please try again.';
      case 'audio-capture':
        return 'Microphone not available. Check your device settings.';
      case 'not-allowed':
        return 'Microphone access denied. Allow it in your browser settings.';
      case 'network':
        return 'Speech recognition requires a network connection right now.';
      case 'bad-grammar':
        return 'Speech recognition error.';
      case 'language-not-supported':
        return 'English speech recognition is not available on this device.';
      default:
        return `Speech recognition error: ${error}`;
    }
  }

  private setState(state: STTState): void {
    this.state = state;
    this.notify(state);
  }

  private notify(state: STTState): void {
    this.listeners.forEach((l) => l(state, this.finalTranscript, this.error));
  }
}

export const sttService = new STTService();
