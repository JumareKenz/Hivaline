/**
 * ttsService.test.ts — Text-to-Speech engine unit tests
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
  if (synth.onvoiceschanged) {
    synth.onvoiceschanged();
  }
});

describe('ttsService', () => {
  it('reports availability when speechSynthesis exists', () => {
    const state = ttsService.getState();
    expect(state.isAvailable).toBe(true);
  });

  it('auto-selects an English voice', () => {
    const state = ttsService.getState();
    expect(state.selectedVoiceURI).not.toBeNull();
    const selected = state.voices.find((v) => v.uri === state.selectedVoiceURI);
    expect(selected?.lang.toLowerCase()).toMatch(/^en/);
  });

  it('speaks cleaned text when enabled', () => {
    ttsService.speak('Hello **world**');
    const synth = getMockSynth();
    expect(synth.speak).toHaveBeenCalledOnce();

    const utterance = synth.speak.mock.calls[0][0] as SpeechSynthesisUtterance;
    expect(utterance.text).toBe('Hello world');
  });

  it('cancels previous speech before new utterance', () => {
    ttsService.speak('First');
    ttsService.speak('Second');
    const synth = getMockSynth();
    expect(synth.cancel).toHaveBeenCalled();
    expect(synth.speak).toHaveBeenCalledTimes(2);
  });

  it('does not speak when disabled', () => {
    ttsService.setEnabled(false);
    ttsService.speak('Hello');
    const synth = getMockSynth();
    expect(synth.speak).not.toHaveBeenCalled();
    ttsService.setEnabled(true);
  });

  it('notifies subscribers on state change', () => {
    const listener = vi.fn();
    const unsub = ttsService.subscribe(listener);

    expect(listener).toHaveBeenCalled();

    ttsService.setEnabled(false);
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);

    unsub();
  });

  it('strips markdown from text before speaking', () => {
    ttsService.speak('# Heading\n* bullet `code`');
    const synth = getMockSynth();
    const utterance = synth.speak.mock.calls[0][0] as SpeechSynthesisUtterance;
    expect(utterance.text).not.toContain('#');
    expect(utterance.text).not.toContain('*');
    expect(utterance.text).not.toContain('`');
  });
});
