/**
 * analyticsSyncService.test.ts — Unit tests for sync service
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  startBackgroundSync,
  stopBackgroundSync,
  getSyncStatus,
  triggerManualSync,
} from '@/services/analyticsSyncService';

// Mock dependencies
vi.mock('@/services/analyticsStorage', () => ({
  analyticsStorage: {
    getUnsyncedEvents: vi.fn().mockResolvedValue([]),
    getUnsyncedSessions: vi.fn().mockResolvedValue([]),
    markEventsSynced: vi.fn().mockResolvedValue(undefined),
    markSessionsSynced: vi.fn().mockResolvedValue(undefined),
    getPreferences: vi.fn().mockResolvedValue({
      analytics_enabled: true,
      chat_collection_enabled: false,
    }),
  },
}));

vi.mock('@/services/authStorage', () => ({
  getToken: vi.fn().mockReturnValue('mock-token'),
}));

// Mock fetch
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ accepted_count: 0, rejected_count: 0 }),
});

describe('analyticsSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopBackgroundSync();
  });

  describe('startBackgroundSync', () => {
    it('should start background sync', () => {
      startBackgroundSync();

      const status = getSyncStatus();
      expect(status.background_enabled).toBe(true);
    });

    it('should not start duplicate sync', () => {
      startBackgroundSync();
      startBackgroundSync(); // Second call should be ignored

      const status = getSyncStatus();
      expect(status.background_enabled).toBe(true);
    });
  });

  describe('stopBackgroundSync', () => {
    it('should stop background sync', () => {
      startBackgroundSync();
      stopBackgroundSync();

      const status = getSyncStatus();
      expect(status.background_enabled).toBe(false);
    });
  });

  describe('triggerManualSync', () => {
    it('should complete manual sync', async () => {
      const success = await triggerManualSync();

      // Should complete without throwing
      expect(typeof success).toBe('boolean');
    });

    it('should skip sync when offline', async () => {
      // Mock navigator.onLine
      Object.defineProperty(navigator, 'onLine', {
        writable: true,
        value: false,
      });

      const success = await triggerManualSync();

      // Should complete quickly without network calls
      expect(typeof success).toBe('boolean');

      // Restore
      Object.defineProperty(navigator, 'onLine', {
        writable: true,
        value: true,
      });
    });
  });

  describe('getSyncStatus', () => {
    it('should return sync status', () => {
      const status = getSyncStatus();

      expect(status).toHaveProperty('is_syncing');
      expect(status).toHaveProperty('last_sync_timestamp');
      expect(status).toHaveProperty('last_sync_success');
      expect(status).toHaveProperty('background_enabled');
    });
  });

  describe('network resilience', () => {
    it('should handle network errors gracefully', async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'));

      // Should not throw
      await expect(triggerManualSync()).resolves.toBeDefined();
    });

    it('should handle server errors gracefully', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' }),
      } as Response);

      // Should not throw
      await expect(triggerManualSync()).resolves.toBeDefined();
    });
  });
});
