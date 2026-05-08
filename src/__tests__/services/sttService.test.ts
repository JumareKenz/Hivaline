/**
 * sttService.test.ts — Speech-to-Text engine unit tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sttService } from '@/services/sttService';

let lastMockInstance: MockSpeechRecognition | null = null;

class MockSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = '';
  onstart: (() => void) | null = null;
  onresult: ((e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;

  constructor() {
    lastMockInstance = this;
  }

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

beforeEach(() => {
  sttService.abort();
  lastMockInstance = null;

  (window as unknown as Record<string, unknown>).SpeechRecognition = MockSpeechRecognition;
  (window as unknown as Record<string, unknown>).webkitSpeechRecognition = MockSpeechRecognition;
});

afterEach(() => {
  sttService.abort();
});

describe('sttService', () => {
  it('reports availability when SpeechRecognition exists', () => {
    expect(sttService.isSupported()).toBe(true);
  });

  it('starts listening and fires listening state', () => {
    const listener = vi.fn();
    sttService.subscribe(listener);
    sttService.start();

    expect(listener).toHaveBeenCalledWith('listening', '', null);
  });

  it('returns final transcript on result', () => {
    const listener = vi.fn();
    sttService.subscribe(listener);
    sttService.start();

    const mock = lastMockInstance;
    expect(mock).not.toBeNull();

    mock!.onresult?.({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: 'patient has fever' } }],
    });
    mock!.onend?.();

    const resultCall = listener.mock.calls.find((c) => c[0] === 'result');
    expect(resultCall).toBeDefined();
    expect(resultCall![1]).toBe('patient has fever');
  });

  it('transitions to idle when no speech is detected', () => {
    const listener = vi.fn();
    sttService.subscribe(listener);
    sttService.start();

    const mock = lastMockInstance;
    mock!.onend?.();

    const idleCall = listener.mock.calls.find((c) => c[0] === 'idle');
    expect(idleCall).toBeDefined();
  });

  it('reports error on no-speech', () => {
    const listener = vi.fn();
    sttService.subscribe(listener);
    sttService.start();

    const mock = lastMockInstance;
    mock!.onerror?.({ error: 'no-speech' });

    const errorCall = listener.mock.calls.find((c) => c[0] === 'error');
    expect(errorCall).toBeDefined();
    expect(errorCall![2]).toContain('No speech detected');
  });

  it('reports error on not-allowed', () => {
    const listener = vi.fn();
    sttService.subscribe(listener);
    sttService.start();

    const mock = lastMockInstance;
    mock!.onerror?.({ error: 'not-allowed' });

    const errorCall = listener.mock.calls.find((c) => c[0] === 'error');
    expect(errorCall![2]).toContain('denied');
  });

  it('ignores aborted errors', () => {
    const listener = vi.fn();
    sttService.subscribe(listener);
    sttService.start();

    const mock = lastMockInstance;
    mock!.onerror?.({ error: 'aborted' });
    mock!.onend?.();

    const errorCalls = listener.mock.calls.filter((c) => c[0] === 'error');
    expect(errorCalls.length).toBe(0);
  });

  it('cancels via abort()', () => {
    sttService.start();
    const mock = lastMockInstance;
    expect(mock).not.toBeNull();

    sttService.abort();
    expect(sttService.getState()).toBe('idle');
    expect(sttService.getTranscript()).toBe('');
  });

  it('does not start twice concurrently', () => {
    sttService.start();
    const firstMock = lastMockInstance;

    sttService.start();
    expect(lastMockInstance).toBe(firstMock);
  });
});
