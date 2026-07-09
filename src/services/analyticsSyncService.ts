/**
 * analyticsSyncService.ts — Background sync manager for analytics
 *
 * Handles:
 * 1. Periodic background sync (every 5 minutes)
 * 2. Batch uploads to compiler backend
 * 3. Retry logic with exponential backoff
 * 4. Network state awareness (only sync when online)
 * 5. Manual sync trigger
 *
 * Design: fail-safe, never blocks app operations
 */

import { analyticsStorage } from './analyticsStorage';
import { getToken } from './authStorage';
import type {
  EventsSyncRequest,
  EventsSyncResponse,
  ChatSessionsSyncRequest,
  ChatSessionsSyncResponse,
} from '@/types/analytics';

// ============================================================================
// CONFIGURATION
// ============================================================================

const BACKEND_URL = 'https://compiler.hiva.ng/api/hiv/analytics';
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const BATCH_SIZE_EVENTS = 500;
const BATCH_SIZE_SESSIONS = 100;

// ============================================================================
// SYNC STATE
// ============================================================================

let syncIntervalId: ReturnType<typeof setInterval> | null = null;
let isSyncing = false;
let lastSyncTimestamp: string | null = null;
let lastSyncSuccess = true;

// ============================================================================
// NETWORK DETECTION
// ============================================================================

function isOnline(): boolean {
  return navigator.onLine;
}

// ============================================================================
// DEVICE ID (for backend validation)
// ============================================================================

const DEVICE_ID_KEY = 'hiva_device_id';
const DEVICE_ID_SALT = 'hiva-analytics-2026';

function getDeviceId(): string {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = `device_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

async function hashDeviceId(deviceId: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(deviceId + DEVICE_ID_SALT);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================================
// SYNC OPERATIONS
// ============================================================================

/**
 * Sync analytics events to backend
 */
async function syncEvents(): Promise<{ success: boolean; synced: number }> {
  try {
    const events = await analyticsStorage.getUnsyncedEvents(BATCH_SIZE_EVENTS);
    if (events.length === 0) {
      return { success: true, synced: 0 };
    }

    const deviceId = getDeviceId();
    const hashedDeviceId = await hashDeviceId(deviceId);

    // Map LocalAnalyticsEvent to QueryAnalyticsEvent (remove local fields)
    const payload: EventsSyncRequest = {
      device_id: hashedDeviceId,
      events: events.map((e) => ({
        device_id: e.device_id,
        session_id: e.session_id,
        category: e.category,
        intent: e.intent,
        language_mode: e.language_mode,
        query_word_count: e.query_word_count,
        is_followup: e.is_followup,
        followup_count: e.followup_count,
        result_count: e.result_count,
        has_referral_trigger: e.has_referral_trigger,
        confidence_tier: e.confidence_tier,
        response_time_ms: e.response_time_ms,
        timestamp: e.timestamp,
      })),
    };

    const token = getToken();
    const response = await fetch(`${BACKEND_URL}/events/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.warn(`[AnalyticsSyncService] Events sync failed: ${response.status}`);

      // Increment retry attempts
      await analyticsStorage.incrementEventSyncAttempts(events.map((e) => e.id));

      return { success: false, synced: 0 };
    }

    const result: EventsSyncResponse = await response.json();

    if (result.accepted_count > 0) {
      // Mark first N events as synced
      const syncedIds = events.slice(0, result.accepted_count).map((e) => e.id);
      await analyticsStorage.markEventsSynced(syncedIds);
    }

    console.log(`[AnalyticsSyncService] Synced ${result.accepted_count} events`);
    return { success: true, synced: result.accepted_count };
  } catch (err) {
    console.error('[AnalyticsSyncService] Events sync error:', err);
    return { success: false, synced: 0 };
  }
}

/**
 * Sync chat sessions to backend
 */
async function syncSessions(): Promise<{ success: boolean; synced: number }> {
  try {
    const sessions = await analyticsStorage.getUnsyncedSessions(BATCH_SIZE_SESSIONS);
    if (sessions.length === 0) {
      return { success: true, synced: 0 };
    }

    const deviceId = getDeviceId();
    const hashedDeviceId = await hashDeviceId(deviceId);

    // Map LocalChatSession to ChatSession (remove local fields)
    const payload: ChatSessionsSyncRequest = {
      device_id: hashedDeviceId,
      sessions: sessions.map((s) => ({
        device_id: s.device_id,
        session_id: s.session_id,
        messages: s.messages,
        primary_category: s.primary_category,
        topics: s.topics,
        user_rating: s.user_rating,
        user_feedback: s.user_feedback,
        duration_seconds: s.duration_seconds,
        message_count: s.message_count,
        started_at: s.started_at,
        ended_at: s.ended_at,
        collected_at: s.collected_at,
      })),
    };

    const token = getToken();
    const response = await fetch(`${BACKEND_URL}/chat/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.warn(`[AnalyticsSyncService] Sessions sync failed: ${response.status}`);
      return { success: false, synced: 0 };
    }

    const result: ChatSessionsSyncResponse = await response.json();

    if (result.accepted_count > 0) {
      const syncedIds = sessions.slice(0, result.accepted_count).map((s) => s.id);
      await analyticsStorage.markSessionsSynced(syncedIds);
    }

    console.log(`[AnalyticsSyncService] Synced ${result.accepted_count} sessions`);
    return { success: true, synced: result.accepted_count };
  } catch (err) {
    console.error('[AnalyticsSyncService] Sessions sync error:', err);
    return { success: false, synced: 0 };
  }
}

/**
 * Perform complete sync (events + sessions)
 */
async function performSync(): Promise<void> {
  if (isSyncing) {
    console.log('[AnalyticsSyncService] Sync already in progress, skipping');
    return;
  }

  if (!isOnline()) {
    console.log('[AnalyticsSyncService] Offline, skipping sync');
    return;
  }

  isSyncing = true;
  lastSyncSuccess = true;

  try {
    // Check if analytics enabled
    const prefs = await analyticsStorage.getPreferences();
    if (!prefs.analytics_enabled) {
      console.log('[AnalyticsSyncService] Analytics disabled, skipping sync');
      return;
    }

    // Sync events
    const eventsResult = await syncEvents();
    if (!eventsResult.success) {
      lastSyncSuccess = false;
    }

    // Sync sessions (only if consent given)
    if (prefs.chat_collection_enabled) {
      const sessionsResult = await syncSessions();
      if (!sessionsResult.success) {
        lastSyncSuccess = false;
      }
    }

    lastSyncTimestamp = new Date().toISOString();
    console.log('[AnalyticsSyncService] Sync completed:', {
      success: lastSyncSuccess,
      timestamp: lastSyncTimestamp,
    });
  } catch (err) {
    console.error('[AnalyticsSyncService] Sync error:', err);
    lastSyncSuccess = false;
  } finally {
    isSyncing = false;
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Start background sync (auto-sync every 5 minutes)
 */
export function startBackgroundSync(): void {
  if (syncIntervalId) {
    console.log('[AnalyticsSyncService] Background sync already running');
    return;
  }

  console.log('[AnalyticsSyncService] Starting background sync');

  // Initial sync after 10 seconds
  setTimeout(() => {
    performSync().catch((err) => {
      console.error('[AnalyticsSyncService] Initial sync failed:', err);
    });
  }, 10_000);

  // Periodic sync
  syncIntervalId = setInterval(() => {
    performSync().catch((err) => {
      console.error('[AnalyticsSyncService] Periodic sync failed:', err);
    });
  }, SYNC_INTERVAL_MS);
}

/**
 * Stop background sync
 */
export function stopBackgroundSync(): void {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
    console.log('[AnalyticsSyncService] Background sync stopped');
  }
}

/**
 * Trigger manual sync
 */
export async function triggerManualSync(): Promise<boolean> {
  console.log('[AnalyticsSyncService] Manual sync triggered');
  await performSync();
  return lastSyncSuccess;
}

/**
 * Get sync status
 */
export function getSyncStatus() {
  return {
    is_syncing: isSyncing,
    last_sync_timestamp: lastSyncTimestamp,
    last_sync_success: lastSyncSuccess,
    background_enabled: syncIntervalId !== null,
  };
}

/**
 * Initialize sync service
 * Call once at app startup
 */
export async function initSync(): Promise<void> {
  try {
    // Start background sync
    startBackgroundSync();

    // Listen for online/offline events
    window.addEventListener('online', () => {
      console.log('[AnalyticsSyncService] Network online, triggering sync');
      performSync().catch(console.error);
    });

    console.log('[AnalyticsSyncService] Sync service initialized');
  } catch (err) {
    console.error('[AnalyticsSyncService] Failed to initialize:', err);
  }
}
