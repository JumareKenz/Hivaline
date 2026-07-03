import { vi } from 'vitest';

export const Filesystem = {
  stat: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  deleteFile: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
};

export const Directory = {
  Data: 'DATA',
  Documents: 'DOCUMENTS',
  Cache: 'CACHE',
};
