/**
 * cso.ts — Cognitive State Object
 *
 * A per-query contract that flows through every stage of a single query's
 * lifecycle. Each layer corresponds to an ownership boundary in the pipeline.
 */

import type { IntentType } from './hiv';
import type { Turn, Sentiment, SlotMemory } from '@/engine/sessionState';
import type { VectorTier } from '@/engine/hybridSearch';

/* ─── Layer 1: Identity ─── */

export interface IdentityLayer {
  /** User role from auth context (e.g. 'chew', 'supervisor'). */
  role: string | undefined;
  /** TODO: location is not currently captured in auth or session — stub for future task. */
  location: string | undefined;
  /** Language code for this query (e.g. 'en'). */
  language: string;
  /** Whether the device has network connectivity at query time. */
  connectivityStatus: 'online' | 'offline';
}

/* ─── Layer 2: Request ─── */

export interface RequestLayer {
  /** The raw user input string as received. */
  rawInput: string;
  /** Translated input if the query was transformed for retrieval purposes. */
  translatedInput: string | undefined;
  /** Translation metadata (language detected, latency, errors) if translation was attempted. */
  translation?: {
    language: 'en' | 'ha' | 'yo' | 'ig' | 'pid' | 'unknown';
    translatedQuery: string | null;
    latencyMs: number;
    error: string | null;
  };
}

/* ─── Layer 3: Intent ─── */

export interface IntentLayer {
  /** Classified intent string from classifyIntent(). */
  intent: string;
  /** Mapped intent type for backward-compatible response shape. */
  mappedIntent: IntentType;
  /** Extracted patient/clinical slots from the query. */
  slots: SlotMemory;
  /** Confidence score — not currently computed by the regex classifier; always 1.0. */
  confidenceScore: number;
  /** Sentiment detected in the query. */
  sentiment: Sentiment | string;
  /** Target module id — not currently implemented; reserved for module routing. */
  targetModuleId: string | undefined;
  /** Correction topic if the user is correcting a prior assumption. */
  correctionTopic: string | null;
}

/* ─── Layer 4: Memory ─── */

export interface MemoryLayer {
  /** Rolling buffer of the last N conversation turns. */
  turnBuffer: Turn[];
  /** Active patient/record slot memory (shared reference to SessionState.slotMemory). */
  slotMemory: SlotMemory;
  /** Stack of previous topics for drift tracking. */
  topicStack: string[];
  /** Set of chunk IDs already served in this session. */
  coveredChunks: Set<string>;
  /** Set of aspects already shown in this session. */
  coveredAspects: Set<string>;
  /** Current conversational topic. */
  currentTopic: string | null;
  /** Total number of turns in this session. */
  turnCount: number;
  /** Pending uncovered aspect gaps. */
  pendingGaps: string[];
  /** Recent sentiment readings. */
  sentimentHistory: Sentiment[];
}

/* ─── Layer 5: Module Response ─── */

export interface ModuleResponseLayer {
  /** The retrieved chunk ID (null if search returned no result). */
  chunkId: string | null;
  /** The fused search score for the top result. */
  score: number | null;
  /** Whether the confidence gate fired (rejected the result as too low). */
  confidenceGateFired: boolean;
  /** Which vector search tier served this query. */
  vectorTier: VectorTier;
  /** Top BM25 score from diagnostics. */
  topBm25Score: number | null;
  /** Top vector score from diagnostics. */
  topVectorScore: number | null;
  /** Whether the vector gate passed (vector results included in fusion). */
  vectorGatePassed: boolean;
  /** Source attribution from the matched chunk. */
  source: { document: string; span?: string } | undefined;
  /** The display title of the matched chunk. */
  chunkDisplayTitle: string | null;
}

/* ─── Layer 6: Generation Control ─── */

export type ConfidenceTier = 'LOW' | 'MEDIUM' | 'HIGH';

export interface GenerationControlLayer {
  /** Confidence tier derived from the search confidence gate. */
  confidenceTier: ConfidenceTier;
  /** Whether the response requires escalation (danger sign detected). */
  escalationFlag: boolean;
  /** Grounding constraint: response must be sourced from the .hiv content. */
  groundingConstraint: 'hiv_content_only';
}

/* ─── Layer 7: Response ─── */

export interface ResponseLayer {
  /** Final assembled response text. */
  text: string;
  /** Source citations array. */
  sources: Array<{ document: string; span?: string }>;
  /** Whether the response was verified against a known chunk. */
  verified: boolean;
  /** Suggested follow-up chips. */
  suggestedFollowUps: string[];
  /** Response type classification. */
  type: IntentType;
  /** True when a MEDIUM-tier verification notice was appended to the response. */
  verificationFlag: boolean;
}

/* ─── Top-level CSO ─── */

export interface CognitiveStateObject {
  identity: IdentityLayer;
  request: RequestLayer;
  intent: IntentLayer;
  memory: MemoryLayer;
  moduleResponse: ModuleResponseLayer;
  generationControl: GenerationControlLayer;
  response: ResponseLayer;
}
