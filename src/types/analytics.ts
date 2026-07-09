/**
 * analytics.ts — TypeScript types for analytics system
 *
 * Matches backend API schemas from hiva-compiler
 * Two-stream architecture: anonymous events + consent-gated sessions
 */

// ============================================================================
// ANONYMOUS QUERY ANALYTICS (No PHI, No Consent Required)
// ============================================================================

export type QueryCategory =
  | 'malaria'
  | 'diarrhea'
  | 'pneumonia'
  | 'fever'
  | 'nutrition'
  | 'immunization'
  | 'newborn_care'
  | 'maternal_health'
  | 'tb'
  | 'hiv'
  | 'covid'
  | 'general'
  | 'out_of_scope';

export type QueryIntent =
  | 'symptom_check'
  | 'diagnosis_support'
  | 'treatment_dosage'
  | 'referral_criteria'
  | 'prevention_advice'
  | 'drug_information'
  | 'protocol_lookup'
  | 'general_inquiry';

export type LanguageMode =
  | 'english'
  | 'pidgin'
  | 'mixed'
  | 'other';

export interface QueryAnalyticsEvent {
  // Identity (pseudonymized)
  device_id: string;                // SHA-256 hash of actual device ID
  session_id: string;               // Unique per-session UUID

  // Query metadata (NO full query text for privacy)
  category: QueryCategory;
  intent: QueryIntent;
  language_mode: LanguageMode;
  query_word_count: number;         // Length indicator, not content

  // Session context
  is_followup: boolean;
  followup_count: number;

  // Results metadata
  result_count: number;
  has_referral_trigger: boolean;
  confidence_tier: 'high' | 'medium' | 'low' | 'unknown';

  // Performance
  response_time_ms: number;

  // Timestamps (ISO 8601)
  timestamp: string;                // When query was made
}

// ============================================================================
// CHAT SESSION COLLECTION (Explicit Consent Required)
// ============================================================================

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;                // ISO 8601
}

export interface ChatSession {
  // Identity
  device_id: string;                // SHA-256 hash
  session_id: string;               // Matches QueryAnalyticsEvent.session_id

  // Full conversation (consent-gated)
  messages: ChatMessage[];

  // Classification
  primary_category: QueryCategory;
  topics: string[];                 // e.g., ["fever management", "dosage calculation"]

  // Quality signals
  user_rating?: number;             // 1-5 stars, optional
  user_feedback?: string;           // Free text feedback, optional

  // Session metadata
  duration_seconds: number;
  message_count: number;

  // Timestamps
  started_at: string;               // ISO 8601
  ended_at: string;                 // ISO 8601
  collected_at: string;             // When sync happened
}

// ============================================================================
// USER CONSENT & PREFERENCES
// ============================================================================

export interface UserAnalyticsPreferences {
  // Consent flags
  chat_collection_enabled: boolean;   // Opt-in for full chat collection
  analytics_enabled: boolean;         // Master switch (default: true)

  // Audit trail
  consent_version: string;            // e.g., "v1.0"
  consent_timestamp: string;          // ISO 8601
  last_updated: string;               // ISO 8601
}

// ============================================================================
// SYNC PAYLOADS (Batched uploads to compiler backend)
// ============================================================================

export interface EventsSyncRequest {
  events: QueryAnalyticsEvent[];
  device_id: string;                  // For server-side validation
}

export interface EventsSyncResponse {
  accepted_count: number;
  rejected_count: number;
  errors?: string[];
}

export interface ChatSessionsSyncRequest {
  sessions: ChatSession[];
  device_id: string;
}

export interface ChatSessionsSyncResponse {
  accepted_count: number;
  rejected_count: number;
  errors?: string[];
}

// ============================================================================
// LOCAL STORAGE MODELS (SQLite schema)
// ============================================================================

export interface LocalAnalyticsEvent extends QueryAnalyticsEvent {
  id: number;                         // Local auto-increment ID
  synced: boolean;                    // Upload status
  sync_attempts: number;              // Retry count
  created_at: string;                 // Local creation time
}

export interface LocalChatSession extends ChatSession {
  id: number;                         // Local auto-increment ID
  synced: boolean;
  sync_attempts: number;
  created_at: string;
}

// ============================================================================
// ANALYTICS SERVICE CONFIG
// ============================================================================

export interface AnalyticsConfig {
  enabled: boolean;
  backend_url: string;
  sync_interval_ms: number;           // Default: 5 minutes
  batch_size_events: number;          // Default: 500
  batch_size_sessions: number;        // Default: 100
  max_retry_attempts: number;         // Default: 3
  device_id_salt: string;             // For SHA-256 hashing
}

// ============================================================================
// HELPER TYPES
// ============================================================================

export interface AnalyticsSummary {
  total_events: number;
  total_sessions: number;
  pending_sync_events: number;
  pending_sync_sessions: number;
  last_sync_timestamp?: string;
  sync_success_rate: number;
}

export type AnalyticsError =
  | 'STORAGE_ERROR'
  | 'NETWORK_ERROR'
  | 'CONSENT_REQUIRED'
  | 'INVALID_DATA'
  | 'SYNC_FAILED';
