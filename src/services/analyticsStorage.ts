/**
 * analyticsStorage.ts — SQLite storage for analytics data
 *
 * Uses sql.js for local persistence of:
 * 1. Anonymous query analytics events
 * 2. Consent-gated chat sessions
 * 3. User analytics preferences
 *
 * Offline-first: all data stored locally, synced when online
 */

import initSqlJs, { type Database } from 'sql.js';
import type {
  LocalAnalyticsEvent,
  LocalChatSession,
  UserAnalyticsPreferences,
  QueryAnalyticsEvent,
  ChatSession,
} from '@/types/analytics';

const DB_NAME = 'hiva_analytics.db';
const SCHEMA_VERSION = 1;

class AnalyticsStorage {
  private db: Database | null = null;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize SQLite database and create schema if needed
   */
  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        // Check if we're on native platform - use simple localStorage fallback for now
        // TODO: Migrate to Capacitor SQLite plugin for production
        const isNative = typeof (window as any).Capacitor !== 'undefined';

        if (isNative) {
          console.log('[AnalyticsStorage] Running on native - using localStorage fallback');
          // Just mark as initialized, use localStorage directly for preferences
          this.db = null;
          return;
        }

        const SQL = await initSqlJs({
          locateFile: (file) => `https://sql.js.org/dist/${file}`,
        });

        // Try to load existing database from localStorage
        const saved = localStorage.getItem(DB_NAME);
        if (saved) {
          const buffer = new Uint8Array(JSON.parse(saved));
          this.db = new SQL.Database(buffer);
          console.log('[AnalyticsStorage] Loaded existing database');
        } else {
          this.db = new SQL.Database();
          console.log('[AnalyticsStorage] Created new database');
        }

        await this.createSchema();
        await this.runMigrations();
      } catch (err) {
        console.error('[AnalyticsStorage] Init failed:', err);
        throw err;
      }
    })();

    return this.initPromise;
  }

  /**
   * Create database schema (idempotent)
   */
  private async createSchema(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    // Schema version tracking
    this.db.run(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // Anonymous query analytics events
    this.db.run(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        category TEXT NOT NULL,
        intent TEXT NOT NULL,
        language_mode TEXT NOT NULL,
        query_word_count INTEGER NOT NULL,
        is_followup INTEGER NOT NULL,
        followup_count INTEGER NOT NULL,
        result_count INTEGER NOT NULL,
        has_referral_trigger INTEGER NOT NULL,
        confidence_tier TEXT NOT NULL,
        response_time_ms INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        synced INTEGER DEFAULT 0,
        sync_attempts INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        INDEX idx_synced (synced),
        INDEX idx_session (session_id),
        INDEX idx_timestamp (timestamp)
      )
    `);

    // Chat sessions (consent-gated)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        session_id TEXT NOT NULL UNIQUE,
        messages TEXT NOT NULL,
        primary_category TEXT NOT NULL,
        topics TEXT NOT NULL,
        user_rating INTEGER,
        user_feedback TEXT,
        duration_seconds INTEGER NOT NULL,
        message_count INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        collected_at TEXT NOT NULL,
        synced INTEGER DEFAULT 0,
        sync_attempts INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        INDEX idx_synced (synced),
        INDEX idx_session (session_id)
      )
    `);

    // User preferences
    this.db.run(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        chat_collection_enabled INTEGER DEFAULT 0,
        analytics_enabled INTEGER DEFAULT 1,
        consent_version TEXT DEFAULT 'v1.0',
        consent_timestamp TEXT,
        last_updated TEXT NOT NULL
      )
    `);

    // Initialize default preferences if not exists
    this.db.run(`
      INSERT OR IGNORE INTO user_preferences (id, last_updated)
      VALUES (1, datetime('now'))
    `);

    this.saveToLocalStorage();
  }

  /**
   * Run schema migrations
   */
  private async runMigrations(): Promise<void> {
    if (!this.db) return;

    const result = this.db.exec(
      `SELECT value FROM schema_meta WHERE key = 'version'`
    );
    const currentVersion = result[0]?.values[0]?.[0] as number | undefined ?? 0;

    if (currentVersion < SCHEMA_VERSION) {
      // Future migrations go here
      console.log(`[AnalyticsStorage] Migrating schema from v${currentVersion} to v${SCHEMA_VERSION}`);

      this.db.run(
        `INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('version', ?)`,
        [SCHEMA_VERSION]
      );

      this.saveToLocalStorage();
    }
  }

  /**
   * Persist database to localStorage
   */
  private saveToLocalStorage(): void {
    if (!this.db) return;
    try {
      const data = this.db.export();
      const buffer = Array.from(data);
      localStorage.setItem(DB_NAME, JSON.stringify(buffer));
    } catch (err) {
      console.error('[AnalyticsStorage] Failed to save to localStorage:', err);
    }
  }

  // ============================================================================
  // ANALYTICS EVENTS
  // ============================================================================

  /**
   * Insert analytics event
   */
  async insertEvent(event: QueryAnalyticsEvent): Promise<number> {
    await this.init();
    if (!this.db) return 0; // Native: no SQL.js, events not persisted locally

    this.db.run(
      `INSERT INTO analytics_events (
        device_id, session_id, category, intent, language_mode,
        query_word_count, is_followup, followup_count, result_count,
        has_referral_trigger, confidence_tier, response_time_ms,
        timestamp, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        event.device_id,
        event.session_id,
        event.category,
        event.intent,
        event.language_mode,
        event.query_word_count,
        event.is_followup ? 1 : 0,
        event.followup_count,
        event.result_count,
        event.has_referral_trigger ? 1 : 0,
        event.confidence_tier,
        event.response_time_ms,
        event.timestamp,
      ]
    );

    const result = this.db.exec('SELECT last_insert_rowid()');
    const id = result[0].values[0][0] as number;

    this.saveToLocalStorage();
    return id;
  }

  /**
   * Get unsynced events (for batch upload)
   */
  async getUnsyncedEvents(limit: number = 500): Promise<LocalAnalyticsEvent[]> {
    await this.init();
    if (!this.db) return [];

    const result = this.db.exec(
      `SELECT * FROM analytics_events WHERE synced = 0 ORDER BY created_at ASC LIMIT ?`,
      [limit]
    );

    if (!result[0]) return [];
    return this.mapRowsToEvents(result[0]);
  }

  /**
   * Mark events as synced
   */
  async markEventsSynced(ids: number[]): Promise<void> {
    await this.init();
    if (!this.db || ids.length === 0) return;

    const placeholders = ids.map(() => '?').join(',');
    this.db.run(
      `UPDATE analytics_events SET synced = 1 WHERE id IN (${placeholders})`,
      ids
    );

    this.saveToLocalStorage();
  }

  /**
   * Increment sync attempt count for failed events
   */
  async incrementEventSyncAttempts(ids: number[]): Promise<void> {
    await this.init();
    if (!this.db || ids.length === 0) return;

    const placeholders = ids.map(() => '?').join(',');
    this.db.run(
      `UPDATE analytics_events SET sync_attempts = sync_attempts + 1 WHERE id IN (${placeholders})`,
      ids
    );

    this.saveToLocalStorage();
  }

  // ============================================================================
  // CHAT SESSIONS
  // ============================================================================

  /**
   * Insert chat session (only if consent given)
   */
  async insertSession(session: ChatSession): Promise<number> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    // Check consent
    const prefs = await this.getPreferences();
    if (!prefs.chat_collection_enabled) {
      throw new Error('Chat collection consent not granted');
    }

    this.db.run(
      `INSERT INTO chat_sessions (
        device_id, session_id, messages, primary_category, topics,
        user_rating, user_feedback, duration_seconds, message_count,
        started_at, ended_at, collected_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        session.device_id,
        session.session_id,
        JSON.stringify(session.messages),
        session.primary_category,
        JSON.stringify(session.topics),
        session.user_rating ?? null,
        session.user_feedback ?? null,
        session.duration_seconds,
        session.message_count,
        session.started_at,
        session.ended_at,
        session.collected_at,
      ]
    );

    const result = this.db.exec('SELECT last_insert_rowid()');
    const id = result[0].values[0][0] as number;

    this.saveToLocalStorage();
    return id;
  }

  /**
   * Get unsynced sessions
   */
  async getUnsyncedSessions(limit: number = 100): Promise<LocalChatSession[]> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const result = this.db.exec(
      `SELECT * FROM chat_sessions WHERE synced = 0 ORDER BY created_at ASC LIMIT ?`,
      [limit]
    );

    if (!result[0]) return [];
    return this.mapRowsToSessions(result[0]);
  }

  /**
   * Mark sessions as synced
   */
  async markSessionsSynced(ids: number[]): Promise<void> {
    await this.init();
    if (!this.db || ids.length === 0) return;

    const placeholders = ids.map(() => '?').join(',');
    this.db.run(
      `UPDATE chat_sessions SET synced = 1 WHERE id IN (${placeholders})`,
      ids
    );

    this.saveToLocalStorage();
  }

  // ============================================================================
  // USER PREFERENCES
  // ============================================================================

  /**
   * Get user analytics preferences
   */
  async getPreferences(): Promise<UserAnalyticsPreferences> {
    await this.init();

    // Native fallback: use localStorage
    if (!this.db) {
      const stored = localStorage.getItem('analytics_preferences');
      if (stored) {
        try {
          return JSON.parse(stored);
        } catch (e) {
          console.error('[AnalyticsStorage] Failed to parse preferences:', e);
        }
      }
      // Return defaults
      return {
        chat_collection_enabled: false,
        analytics_enabled: true,
        consent_version: 'v1.0',
        consent_timestamp: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      };
    }

    const result = this.db.exec(`SELECT * FROM user_preferences WHERE id = 1`);

    if (!result[0] || result[0].values.length === 0) {
      // Return defaults
      return {
        chat_collection_enabled: false,
        analytics_enabled: true,
        consent_version: 'v1.0',
        consent_timestamp: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      };
    }

    const row = result[0].values[0];
    return {
      chat_collection_enabled: row[1] === 1,
      analytics_enabled: row[2] === 1,
      consent_version: row[3] as string,
      consent_timestamp: row[4] as string,
      last_updated: row[5] as string,
    };
  }

  /**
   * Update user preferences
   */
  async updatePreferences(prefs: Partial<UserAnalyticsPreferences>): Promise<void> {
    await this.init();

    // Native fallback: use localStorage
    if (!this.db) {
      const current = await this.getPreferences();
      const updated = {
        ...current,
        ...prefs,
        last_updated: new Date().toISOString(),
      };
      localStorage.setItem('analytics_preferences', JSON.stringify(updated));
      console.log('[AnalyticsStorage] Updated preferences (localStorage):', updated);
      return;
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (prefs.chat_collection_enabled !== undefined) {
      updates.push('chat_collection_enabled = ?');
      values.push(prefs.chat_collection_enabled ? 1 : 0);
    }

    if (prefs.analytics_enabled !== undefined) {
      updates.push('analytics_enabled = ?');
      values.push(prefs.analytics_enabled ? 1 : 0);
    }

    if (prefs.consent_version !== undefined) {
      updates.push('consent_version = ?');
      values.push(prefs.consent_version);
    }

    if (prefs.consent_timestamp !== undefined) {
      updates.push('consent_timestamp = ?');
      values.push(prefs.consent_timestamp);
    }

    updates.push('last_updated = datetime(\'now\')');

    if (updates.length > 0) {
      this.db.run(
        `UPDATE user_preferences SET ${updates.join(', ')} WHERE id = 1`,
        values as (string | number | null | Uint8Array)[]
      );

      this.saveToLocalStorage();
    }
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================

  /**
   * Get storage summary
   */
  async getSummary() {
    await this.init();

    // Native fallback: return zeros (localStorage doesn't track events/sessions)
    if (!this.db) {
      return {
        total_events: 0,
        total_sessions: 0,
        pending_sync_events: 0,
        pending_sync_sessions: 0,
        sync_success_rate: 1.0,
      };
    }

    const totalEvents = this.db.exec(
      'SELECT COUNT(*) FROM analytics_events'
    )[0].values[0][0] as number;

    const unsyncedEvents = this.db.exec(
      'SELECT COUNT(*) FROM analytics_events WHERE synced = 0'
    )[0].values[0][0] as number;

    const syncedEvents = totalEvents - unsyncedEvents;
    const syncSuccessRate = totalEvents > 0 ? syncedEvents / totalEvents : 1.0;

    const totalSessions = this.db.exec(
      'SELECT COUNT(*) FROM chat_sessions'
    )[0].values[0][0] as number;

    const unsyncedSessions = this.db.exec(
      'SELECT COUNT(*) FROM chat_sessions WHERE synced = 0'
    )[0].values[0][0] as number;

    return {
      total_events: totalEvents,
      total_sessions: totalSessions,
      pending_sync_events: unsyncedEvents,
      pending_sync_sessions: unsyncedSessions,
      sync_success_rate: syncSuccessRate,
    };
  }

  /**
   * Clear all analytics data (for testing or user request)
   */
  async clearAll(): Promise<void> {
    await this.init();
    if (!this.db) return;

    this.db.run('DELETE FROM analytics_events');
    this.db.run('DELETE FROM chat_sessions');
    this.saveToLocalStorage();
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private mapRowsToEvents(result: { columns: string[]; values: unknown[][] }): LocalAnalyticsEvent[] {
    return result.values.map((row) => ({
      id: row[0] as number,
      device_id: row[1] as string,
      session_id: row[2] as string,
      category: row[3] as LocalAnalyticsEvent['category'],
      intent: row[4] as LocalAnalyticsEvent['intent'],
      language_mode: row[5] as LocalAnalyticsEvent['language_mode'],
      query_word_count: row[6] as number,
      is_followup: row[7] === 1,
      followup_count: row[8] as number,
      result_count: row[9] as number,
      has_referral_trigger: row[10] === 1,
      confidence_tier: row[11] as LocalAnalyticsEvent['confidence_tier'],
      response_time_ms: row[12] as number,
      timestamp: row[13] as string,
      synced: row[14] === 1,
      sync_attempts: row[15] as number,
      created_at: row[16] as string,
    }));
  }

  private mapRowsToSessions(result: { columns: string[]; values: unknown[][] }): LocalChatSession[] {
    return result.values.map((row) => ({
      id: row[0] as number,
      device_id: row[1] as string,
      session_id: row[2] as string,
      messages: JSON.parse(row[3] as string),
      primary_category: row[4] as LocalChatSession['primary_category'],
      topics: JSON.parse(row[5] as string),
      user_rating: row[6] as number | undefined,
      user_feedback: row[7] as string | undefined,
      duration_seconds: row[8] as number,
      message_count: row[9] as number,
      started_at: row[10] as string,
      ended_at: row[11] as string,
      collected_at: row[12] as string,
      synced: row[13] === 1,
      sync_attempts: row[14] as number,
      created_at: row[15] as string,
    }));
  }
}

// Singleton instance
export const analyticsStorage = new AnalyticsStorage();
