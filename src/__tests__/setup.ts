/**
 * Vitest test setup
 */

import { vi } from 'vitest';
import '@testing-library/jest-dom';

// Mock @capacitor/preferences with an in-memory store so authStorage is
// deterministic in jsdom (no native bridge, no localStorage prefixing quirks).
vi.mock('@capacitor/preferences', () => {
  let store: Record<string, string> = {};
  return {
    Preferences: {
      get: vi.fn(async ({ key }: { key: string }) => ({ value: key in store ? store[key] : null })),
      set: vi.fn(async ({ key, value }: { key: string; value: string }) => { store[key] = value; }),
      remove: vi.fn(async ({ key }: { key: string }) => { delete store[key]; }),
      clear: vi.fn(async () => { store = {}; }),
      keys: vi.fn(async () => ({ keys: Object.keys(store) })),
    },
  };
});

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock sessionStorage
const sessionStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();

Object.defineProperty(window, 'sessionStorage', { value: sessionStorageMock });

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock speechSynthesis
const speechSynthesisMock = {
  speak: vi.fn(),
  cancel: vi.fn(),
  getVoices: vi.fn().mockReturnValue([
    {
      voiceURI: 'mock-voice-1',
      name: 'Mock Voice 1',
      lang: 'en-US',
      default: true,
    },
    {
      voiceURI: 'mock-voice-2',
      name: 'Mock Voice 2',
      lang: 'en-GB',
      default: false,
    },
  ]),
  pause: vi.fn(),
  resume: vi.fn(),
  onvoiceschanged: null as (() => void) | null,
};

Object.defineProperty(window, 'speechSynthesis', {
  value: speechSynthesisMock,
  writable: true,
});

// Mock SpeechSynthesisUtterance
class SpeechSynthesisUtteranceMock {
  text = '';
  voice: SpeechSynthesisVoice | null = null;
  rate = 1;
  pitch = 1;
  volume = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

Object.defineProperty(window, 'SpeechSynthesisUtterance', {
  value: SpeechSynthesisUtteranceMock,
  writable: true,
});

// Mock SpeechRecognition / webkitSpeechRecognition
class MockSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = '';
  onstart: (() => void) | null = null;
  onresult: ((e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;

  start() {
    this.onstart?.();
  }

  stop() {
    this.onend?.();
  }

  abort() {
    this.onerror?.({ error: 'aborted' });
    this.onend?.();
  }
}

Object.defineProperty(window, 'SpeechRecognition', {
  value: MockSpeechRecognition,
  writable: true,
});

Object.defineProperty(window, 'webkitSpeechRecognition', {
  value: MockSpeechRecognition,
  writable: true,
});

// Mock @capacitor/filesystem (used by modelDownloader)
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    stat: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    deleteFile: vi.fn(),
    mkdir: vi.fn(),
    readdir: vi.fn(),
  },
  Directory: {
    Data: 'DATA',
    Documents: 'DOCUMENTS',
    Cache: 'CACHE',
  },
}));

// Mock @capacitor/network (used by modelDownloader)
vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus: vi.fn().mockResolvedValue({ connected: true, connectionType: 'wifi' }),
    addListener: vi.fn(),
    removeAllListeners: vi.fn(),
  },
}));
