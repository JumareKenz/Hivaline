import { vi } from 'vitest';

export const Network = {
  getStatus: vi.fn().mockResolvedValue({ connected: true, connectionType: 'wifi' }),
  addListener: vi.fn(),
  removeAllListeners: vi.fn(),
};
