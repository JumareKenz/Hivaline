import { vi } from 'vitest';

export const registerPlugin = vi.fn((_pluginName: string) => {
  return {
    loadModel: vi.fn().mockResolvedValue({ success: true, loadTimeMs: 1000 }),
    generate: vi.fn().mockResolvedValue({ text: 'Translation: mock translation', tokenCount: 10, durationMs: 500, tokensPerSecond: 20 }),
    isModelLoaded: vi.fn().mockResolvedValue({ loaded: true }),
    unloadModel: vi.fn().mockResolvedValue({ success: true }),
    getModelInfo: vi.fn().mockResolvedValue({ exists: true, path: '/mock/path', sizeMB: 990, loaded: true }),
  };
});
