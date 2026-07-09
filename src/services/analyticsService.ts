/**
 * analyticsService.ts — High-level analytics collection API
 *
 * Privacy-first analytics layer that:
 * 1. Tracks anonymous usage patterns (no PHI)
 * 2. Collects full chat sessions (with consent)
 * 3. Manages user consent preferences
 * 4. Generates device IDs with SHA-256 hashing
 *
 * Design principle: All methods are fail-safe. Analytics failures
 * never propagate to the main application.
 */

import { analyticsStorage } from './analyticsStorage';
import type {
  QueryAnalyticsEvent,
  ChatSession,
  QueryCategory,
  QueryIntent,
  LanguageMode,
  UserAnalyticsPreferences,
  ChatMessage,
} from '@/types/analytics';

// ============================================================================
// DEVICE ID MANAGEMENT
// ============================================================================

const DEVICE_ID_KEY = 'hiva_device_id';
const DEVICE_ID_SALT = 'hiva-analytics-2026'; // For SHA-256 hashing

/**
 * Get or generate persistent device ID
 */
function getDeviceId(): string {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = `device_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

/**
 * Hash device ID with SHA-256 for privacy
 */
async function hashDeviceId(deviceId: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(deviceId + DEVICE_ID_SALT);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================================
// SESSION TRACKING
// ============================================================================

let currentSessionId: string | null = null;
let sessionStartTime: number | null = null;
let sessionMessages: ChatMessage[] = [];
let sessionTopics: Set<string> = new Set();

/**
 * Get or create current session ID
 */
function getSessionId(): string {
  if (!currentSessionId) {
    currentSessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    sessionStartTime = Date.now();
    sessionMessages = [];
    sessionTopics = new Set();
  }
  return currentSessionId;
}

/**
 * Reset session (start new conversation)
 */
export function resetSession(): void {
  currentSessionId = null;
  sessionStartTime = null;
  sessionMessages = [];
  sessionTopics.clear();
}

// ============================================================================
// ANONYMOUS QUERY ANALYTICS (No Consent Required)
// ============================================================================

export interface TrackQueryParams {
  query: string;                      // Only used for word count, not stored
  category: QueryCategory;
  intent: QueryIntent;
  languageMode: LanguageMode;
  isFollowup: boolean;
  followupCount: number;
  resultCount: number;
  hasReferralTrigger: boolean;
  confidenceTier: 'high' | 'medium' | 'low' | 'unknown';
  responseTimeMs: number;
}

/**
 * Track anonymous query analytics
 * Safe to call without checking consent - returns silently if disabled
 */
export async function trackQuery(params: TrackQueryParams): Promise<void> {
  try {
    // Check if analytics enabled
    const prefs = await analyticsStorage.getPreferences();
    if (!prefs.analytics_enabled) {
      return;
    }

    const deviceId = getDeviceId();
    const hashedDeviceId = await hashDeviceId(deviceId);
    const sessionId = getSessionId();

    const event: QueryAnalyticsEvent = {
      device_id: hashedDeviceId,
      session_id: sessionId,
      category: params.category,
      intent: params.intent,
      language_mode: params.languageMode,
      query_word_count: params.query.trim().split(/\s+/).length,
      is_followup: params.isFollowup,
      followup_count: params.followupCount,
      result_count: params.resultCount,
      has_referral_trigger: params.hasReferralTrigger,
      confidence_tier: params.confidenceTier,
      response_time_ms: params.responseTimeMs,
      timestamp: new Date().toISOString(),
    };

    await analyticsStorage.insertEvent(event);
    console.log('[AnalyticsService] Query tracked:', { category: params.category, intent: params.intent });
  } catch (err) {
    // Fail silently - analytics errors never break app
    console.warn('[AnalyticsService] Failed to track query:', err);
  }
}

// ============================================================================
// CHAT SESSION COLLECTION (Consent Required)
// ============================================================================

/**
 * Add message to current session buffer
 */
export function recordMessage(role: 'user' | 'assistant', content: string): void {
  try {
    sessionMessages.push({
      role,
      content,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[AnalyticsService] Failed to record message:', err);
  }
}

/**
 * Add topic to session metadata
 */
export function recordTopic(topic: string): void {
  try {
    sessionTopics.add(topic);
  } catch (err) {
    console.warn('[AnalyticsService] Failed to record topic:', err);
  }
}

export interface SubmitSessionParams {
  primaryCategory: QueryCategory;
  userRating?: number;              // 1-5 stars
  userFeedback?: string;
}

/**
 * Submit current session for collection
 * Only works if user has granted consent
 */
export async function submitSession(params: SubmitSessionParams): Promise<boolean> {
  try {
    // Check consent
    const prefs = await analyticsStorage.getPreferences();
    if (!prefs.chat_collection_enabled) {
      console.log('[AnalyticsService] Chat collection disabled, skipping session');
      return false;
    }

    if (sessionMessages.length === 0) {
      console.log('[AnalyticsService] No messages in session, skipping');
      return false;
    }

    const deviceId = getDeviceId();
    const hashedDeviceId = await hashDeviceId(deviceId);
    const sessionId = getSessionId();
    const now = new Date().toISOString();
    const durationSeconds = sessionStartTime
      ? Math.floor((Date.now() - sessionStartTime) / 1000)
      : 0;

    const session: ChatSession = {
      device_id: hashedDeviceId,
      session_id: sessionId,
      messages: [...sessionMessages],
      primary_category: params.primaryCategory,
      topics: Array.from(sessionTopics),
      user_rating: params.userRating,
      user_feedback: params.userFeedback,
      duration_seconds: durationSeconds,
      message_count: sessionMessages.length,
      started_at: sessionStartTime ? new Date(sessionStartTime).toISOString() : now,
      ended_at: now,
      collected_at: now,
    };

    await analyticsStorage.insertSession(session);
    console.log('[AnalyticsService] Session submitted:', {
      session_id: sessionId,
      message_count: sessionMessages.length,
      duration: durationSeconds,
    });

    // Clear session buffer
    resetSession();
    return true;
  } catch (err) {
    console.warn('[AnalyticsService] Failed to submit session:', err);
    return false;
  }
}

// ============================================================================
// CONSENT MANAGEMENT
// ============================================================================

/**
 * Get current user preferences
 */
export async function getPreferences(): Promise<UserAnalyticsPreferences> {
  try {
    return await analyticsStorage.getPreferences();
  } catch (err) {
    console.error('[AnalyticsService] Failed to get preferences:', err);
    // Return safe defaults
    return {
      chat_collection_enabled: false,
      analytics_enabled: true,
      consent_version: 'v1.0',
      consent_timestamp: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    };
  }
}

/**
 * Update analytics preferences
 */
export async function updatePreferences(
  updates: Partial<UserAnalyticsPreferences>
): Promise<void> {
  try {
    await analyticsStorage.updatePreferences(updates);
    console.log('[AnalyticsService] Preferences updated:', updates);
  } catch (err) {
    console.error('[AnalyticsService] Failed to update preferences:', err);
    throw err;
  }
}

/**
 * Enable chat collection (explicit opt-in)
 */
export async function enableChatCollection(): Promise<void> {
  await updatePreferences({
    chat_collection_enabled: true,
    consent_timestamp: new Date().toISOString(),
    consent_version: 'v1.0',
  });
}

/**
 * Disable chat collection (opt-out)
 */
export async function disableChatCollection(): Promise<void> {
  await updatePreferences({
    chat_collection_enabled: false,
  });
}

/**
 * Disable all analytics
 */
export async function disableAnalytics(): Promise<void> {
  await updatePreferences({
    analytics_enabled: false,
    chat_collection_enabled: false,
  });
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Get analytics summary
 */
export async function getSummary() {
  try {
    return await analyticsStorage.getSummary();
  } catch (err) {
    console.error('[AnalyticsService] Failed to get summary:', err);
    return {
      total_events: 0,
      total_sessions: 0,
      pending_sync_events: 0,
      pending_sync_sessions: 0,
      sync_success_rate: 0,
    };
  }
}

/**
 * Clear all analytics data
 */
export async function clearAllData(): Promise<void> {
  try {
    await analyticsStorage.clearAll();
    resetSession();
    console.log('[AnalyticsService] All analytics data cleared');
  } catch (err) {
    console.error('[AnalyticsService] Failed to clear data:', err);
    throw err;
  }
}

/**
 * Initialize analytics system
 * Call once at app startup
 */
export async function initAnalytics(): Promise<void> {
  try {
    await analyticsStorage.init();
    console.log('[AnalyticsService] Analytics initialized');
  } catch (err) {
    console.error('[AnalyticsService] Failed to initialize:', err);
  }
}
