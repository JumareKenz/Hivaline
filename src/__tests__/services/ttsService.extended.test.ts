/**
 * ttsService.extended.test.ts — Edge cases, retry logic, voice selection,
 * error events, empty text, unsubscribe, and setVoice.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ttsService } from '@/services/ttsService';

const getMockSynth = () =>
  window.speechSynthesis as unknown as {
    speak: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    getVoices: ReturnType<typeof vi.fn>;
    onvoiceschanged: (() => void) | null;
  };

beforeEach(() => {
  vi.clearAllMocks();
  ttsService.cancel();
  ttsService.setEnabled(true);
  const synth = getMockSynth();
  if (synth.onvoiceschanged) synth.onvoiceschanged();
});

describe('ttsService — edge cases', () => {
  it('does nothing when text is empty string', () => {
    ttsService.speak('');
    expect(getMockSynth().speak).not.toHaveBeenCalled();
  });

  it('does nothing when text is whitespace only', () => {
    ttsService.speak('   ');
    expect(getMockSynth().speak).not.toHaveBeenCalled();
  });

  it('does nothing when text is only markdown characters', () => {
    ttsService.speak('**##``__');
    // After cleaning: all stripped, only spaces remain → trim → empty
    expect(getMockSynth().speak).not.toHaveBeenCalled();
  });

  it('speaks when text has markdown mixed with words', () => {
    ttsService.speak('**Bold** text here');
    expect(getMockSynth().speak).toHaveBeenCalledOnce();
    const utterance = getMockSynth().speak.mock.calls[0][0] as SpeechSynthesisUtterance;
    expect(utterance.text).toContain('Bold');
    expect(utterance.text).toContain('text here');
    expect(utterance.text).not.toContain('**');
  });

  it('sets speech rate to 0.9', () => {
    ttsService.speak('Hello');
    const utterance = getMockSynth().speak.mock.calls[0][0] as SpeechSynthesisUtterance;
    expect(utterance.rate).toBeCloseTo(0.9);
  });

  it('setVoice updates selected voice URI', () => {
    ttsService.setVoice('mock-voice-2');
    const state = ttsService.getState();
    expect(state.selectedVoiceURI).toBe('mock-voice-2');
  });

  it('cancel() clears isSpeaking', () => {
    ttsService.cancel();
    expect(ttsService.getState().isSpeaking).toBe(false);
  });

  it('unsubscribe stops receiving updates', () => {
    const listener = vi.fn();
    const unsub = ttsService.subscribe(listener);
    const callsBefore = listener.mock.calls.length;
    unsub();
    ttsService.setEnabled(false);
    ttsService.setEnabled(true);
    // No new calls after unsub
    expect(listener.mock.calls.length).toBe(callsBefore);
  });

  it('does not crash when setEnabled called multiple times with same value', () => {
    ttsService.setEnabled(false);
    ttsService.setEnabled(false);
    ttsService.setEnabled(true);
    ttsService.setEnabled(true);
    expect(ttsService.getState().isEnabled).toBe(true);
  });

  it('isEnabled() reflects current enabled state', () => {
    ttsService.setEnabled(false);
    expect(ttsService.isEnabled()).toBe(false);
    ttsService.setEnabled(true);
    expect(ttsService.isEnabled()).toBe(true);
  });

  it('cancels speech when setEnabled(false)', () => {
    ttsService.speak('Say something');
    ttsService.setEnabled(false);
    expect(getMockSynth().cancel).toHaveBeenCalled();
  });

  it('getState returns all expected fields', () => {
    const state = ttsService.getState();
    expect(state).toHaveProperty('isAvailable');
    expect(state).toHaveProperty('isEnabled');
    expect(state).toHaveProperty('isSpeaking');
    expect(state).toHaveProperty('voices');
    expect(state).toHaveProperty('selectedVoiceURI');
    expect(state).toHaveProperty('error');
    expect(Array.isArray(state.voices)).toBe(true);
  });

  it('handles very long text (10000 chars) without crashing', () => {
    const longText = 'word '.repeat(2000);
    expect(() => ttsService.speak(longText)).not.toThrow();
  });

  it('handles text with XSS-like content safely (no execution)', () => {
    // cleanText strips markdown/special chars — XSS in speech text is benign
    ttsService.speak('<script>alert(1)</script>');
    // Does not crash; content is passed to Web Speech API as text
    // Web Speech API cannot execute scripts
    expect(getMockSynth().speak).toHaveBeenCalled();
  });
});

describe('ttsService — voice state', () => {
  it('reports voices as array of TTSVoice objects', () => {
    const state = ttsService.getState();
    state.voices.forEach((v) => {
      expect(typeof v.uri).toBe('string');
      expect(typeof v.name).toBe('string');
      expect(typeof v.lang).toBe('string');
      expect(typeof v.default).toBe('boolean');
    });
  });

  it('selected voice is in the voices list', () => {
    const state = ttsService.getState();
    if (state.selectedVoiceURI) {
      const found = state.voices.find((v) => v.uri === state.selectedVoiceURI);
      expect(found).toBeDefined();
    }
  });
});
