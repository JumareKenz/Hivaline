/**
 * module.ts — Module bundle types
 *
 * Defines the contract for independently-built modules that can be loaded
 * into the HIVA runtime. Each module is a ZIP bundle containing manifest.json,
 * schema.json, knowledge assets, and optional logic/config files.
 */

import type { ModuleResponseLayer, ConfidenceTier } from './cso';

/* ─── manifest.json ─── */

export interface ModuleManifest {
  /** Unique module identifier (e.g. 'hiva-medichat-clinical'). */
  id: string;
  /** Human-readable module name. */
  name: string;
  /** Semantic version string. */
  version: string;
  /** Clinical/knowledge domain this module covers. */
  domain: string;
  /** Languages supported (ISO 639-1 codes). */
  languages: string[];
  /** Roles this module is intended for (e.g. ['chew', 'supervisor']). */
  targetRoles: string[];
  /** Offline capability flags. */
  offline: {
    /** Whether the module can function without network. */
    supported: boolean;
    /** Whether all required assets are bundled (vs. fetched on first use). */
    assetsBundled: boolean;
  };
  /** SHA-256 of the bundle contents (excluding signature). */
  contentHash?: string;
  /** ISO 8601 timestamp of when this module was compiled. */
  compiledAt?: string;
}

/* ─── schema.json ─── */

export interface ModuleIntentDeclaration {
  /** The intent string this module claims to handle (matches IntentLayer.intent). */
  intent: string;
  /** Required slot fields that must be present for this module to respond. */
  requiredSlots: string[];
  /** Optional slots that enhance the response if present. */
  optionalSlots?: string[];
}

export interface ModuleOutputShape {
  /** Whether this module guarantees a chunkId in its response. */
  providesChunkId: boolean;
  /** Whether this module provides source citations. */
  providesSources: boolean;
  /** Confidence tiers this module can produce. */
  confidenceTiers: ConfidenceTier[];
}

export interface ModuleSchema {
  /** Intents this module claims to handle. */
  intents: ModuleIntentDeclaration[];
  /** The output shape this module guarantees. */
  outputShape: ModuleOutputShape;
  /** Minimum CSO version this module is compatible with. */
  csoVersion?: string;
}

/* ─── config.json ─── */

export interface ModuleConfig {
  /** Retrieval strategy parameters. */
  retrieval?: {
    bm25Weight?: number;
    vectorWeight?: number;
    confidenceFloor?: number;
  };
  /** Escalation rules. */
  escalation?: {
    patterns?: Array<{ pattern: string; warning: string }>;
  };
  /** Safe fallback text when the module cannot produce a confident answer. */
  fallbackText?: string;
}

/* ─── Loaded Module (runtime object) ─── */

export interface ModuleAssets {
  chunks?: ArrayBuffer;
  embeddings?: ArrayBuffer;
  sources?: Array<{ name: string; url?: string; year?: number }>;
  rules?: Record<string, unknown>;
  workflows?: Record<string, unknown>;
  config?: ModuleConfig;
}

export interface HivaModule {
  manifest: ModuleManifest;
  schema: ModuleSchema;
  assets: ModuleAssets;
  /** Whether the signature was verified successfully. */
  signatureVerified: boolean;
}

/* ─── Module Execute Interface ─── */

import type { CognitiveStateObject } from './cso';

export interface ModuleExecuteResult {
  moduleResponse: ModuleResponseLayer;
  generationControl: {
    confidenceTier: ConfidenceTier;
    escalationFlag: boolean;
  };
  responseText: string;
  sources: Array<{ document: string; span?: string }>;
  suggestedFollowUps: string[];
  verified: boolean;
}

export interface ExecutableModule {
  module: HivaModule;
  execute(cso: CognitiveStateObject): Promise<ModuleExecuteResult>;
}

/* ─── Signature enforcement config ─── */

export type SignatureEnforcement = 'OFF' | 'WARN' | 'ENFORCE';
