/**
 * cso.test.ts — Unit tests for CognitiveStateObject construction
 *
 * Validates that the CSO is populated correctly at each layer, and that
 * no layer contains data another layer owns.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationEngine } from '@/services/conversationEngine';
import type { CognitiveStateObject } from '@/types/cso';
import type { HIVFile, HIVChunk } from '@/types/hiv';

vi.mock('@/services/telemetry', () => ({
  reportError: vi.fn(),
}));
vi.mock('@/services/queryLogger', () => ({
  logQuery: vi.fn(),
}));
vi.mock('@/services/modelManager', () => ({
  isEmbeddingModelReady: () => false,
  warmupEmbeddingModel: vi.fn(),
  subscribeModelState: vi.fn(),
  getModelState: () => ({ status: 'idle', progress: 0 }),
}));
vi.mock('@/services/embeddingModel', () => ({
  embedQuery: vi.fn(),
  isModelLoaded: () => false,
}));

function makeChunk(overrides: Partial<HIVChunk> = {}): HIVChunk {
  return {
    id: 'chunk-malaria-01',
    type: 'faq',
    display_title: 'Malaria Treatment',
    trigger_phrases: { en: ['malaria treatment', 'how to treat malaria'] },
    content: {
      en: {
        answer: 'Treat uncomplicated malaria with ACT (Artemisinin-based Combination Therapy).',
        topics: ['malaria'],
        follow_up_questions: ['What is the dose?', 'When to refer?'],
      },
    },
    source: { document: 'SSCHCN 2020', span: 'Ch.4' },
    checksum: 'abc123',
    aspects: ['treatment', 'dosage'],
    ...overrides,
  };
}

function makeHivFile(chunks: HIVChunk[] = [makeChunk()]): HIVFile {
  return {
    manifest: {
      version: '1.0.0',
      sha256: 'fake',
      size_kb: 100,
      languages: ['en'],
      chunk_count: chunks.length,
      created_at: '2024-01-01',
      search_config: {
        bm25_weight: 0.5,
        vector_weight: 0.5,
        fusion: 'RRF',
        rrf_k: 60,
        type_boost: { faq: 1, drug_table: 1, decision_tree: 1, protocol: 1, danger_sign: 1, calculator: 1 },
      },
    },
    chunks,
    embeddings: [],
    embeddingMeta: [],
    embeddingChunkIds: [],
    lexicalIndex: {
      en: {
        index: {
          malaria: [{ chunk_id: 'chunk-malaria-01', score: 5.0 }],
          treatment: [{ chunk_id: 'chunk-malaria-01', score: 3.0 }],
          treat: [{ chunk_id: 'chunk-malaria-01', score: 2.5 }],
        },
      },
    },
    sources: { sources: [] },
    rules: {},
    i18n: {},
    gapGraph: {
      'chunk-malaria-01': [{ to: 'chunk-malaria-02', score: 0.8, label: 'dosage' }],
    },
  };
}

describe('CognitiveStateObject construction', () => {
  let engine: ConversationEngine;

  beforeEach(() => {
    engine = new ConversationEngine(makeHivFile());
  });

  it('populates all 7 layers on a successful clinical query', async () => {
    const response = await engine.respond('how to treat malaria');
    const cso = engine.getLastCSO();

    expect(cso).not.toBeNull();
    expect(response.message).toBeTruthy();

    // All layers present
    expect(cso!.identity).toBeDefined();
    expect(cso!.request).toBeDefined();
    expect(cso!.intent).toBeDefined();
    expect(cso!.memory).toBeDefined();
    expect(cso!.moduleResponse).toBeDefined();
    expect(cso!.generationControl).toBeDefined();
    expect(cso!.response).toBeDefined();
  });

  describe('Layer 1: Identity', () => {
    it('has role, language, and connectivity', async () => {
      await engine.respond('how to treat malaria');
      const cso = engine.getLastCSO()!;

      expect(cso.identity.role).toBe('chew');
      expect(cso.identity.language).toBe('en');
      expect(['online', 'offline']).toContain(cso.identity.connectivityStatus);
    });

    it('location is undefined (not yet implemented)', async () => {
      await engine.respond('malaria');
      const cso = engine.getLastCSO()!;
      expect(cso.identity.location).toBeUndefined();
    });
  });

  describe('Layer 2: Request', () => {
    it('captures raw input exactly as provided', async () => {
      await engine.respond('How to treat malaria?');
      const cso = engine.getLastCSO()!;

      expect(cso.request.rawInput).toBe('How to treat malaria?');
    });

    it('populates translatedInput with rewritten query on clinical queries', async () => {
      await engine.respond('how to treat malaria');
      const cso = engine.getLastCSO()!;

      expect(cso.request.translatedInput).toBeDefined();
      expect(typeof cso.request.translatedInput).toBe('string');
    });

    it('leaves translatedInput undefined for greeting (no rewrite needed)', async () => {
      await engine.respond('hello');
      const cso = engine.getLastCSO()!;

      expect(cso.request.translatedInput).toBeUndefined();
    });
  });

  describe('Layer 3: Intent', () => {
    it('classifies clinical intent correctly', async () => {
      await engine.respond('how to treat malaria');
      const cso = engine.getLastCSO()!;

      expect(cso.intent.intent).toBe('PROCEDURE');
      expect(cso.intent.confidenceScore).toBe(1.0);
    });

    it('captures sentiment', async () => {
      await engine.respond('please help me with malaria emergency');
      const cso = engine.getLastCSO()!;

      expect(cso.intent.sentiment).toBe('panic');
    });

    it('captures correction topic when user corrects', async () => {
      // First query to establish topic
      await engine.respond('how to treat malaria');
      // Correction query
      await engine.respond('no I meant TB');
      const cso = engine.getLastCSO()!;

      expect(cso.intent.correctionTopic).not.toBeNull();
    });

    it('slots are populated from message', async () => {
      await engine.respond('my patient is 5 years old with malaria weighing 15kg');
      const cso = engine.getLastCSO()!;

      expect(cso.intent.slots.patientAge).toBe('5 year');
      expect(cso.intent.slots.patientWeightKg).toBe(15);
    });

    it('targetModuleId is undefined (not yet implemented)', async () => {
      await engine.respond('malaria treatment');
      const cso = engine.getLastCSO()!;
      expect(cso.intent.targetModuleId).toBeUndefined();
    });
  });

  describe('Layer 4: Memory', () => {
    it('contains session state fields', async () => {
      await engine.respond('how to treat malaria');
      const cso = engine.getLastCSO()!;

      expect(cso.memory.turnCount).toBeGreaterThan(0);
      expect(cso.memory.coveredChunks).toBeInstanceOf(Set);
      expect(cso.memory.coveredAspects).toBeInstanceOf(Set);
      expect(Array.isArray(cso.memory.turnBuffer)).toBe(true);
      expect(Array.isArray(cso.memory.topicStack)).toBe(true);
      expect(Array.isArray(cso.memory.pendingGaps)).toBe(true);
      expect(Array.isArray(cso.memory.sentimentHistory)).toBe(true);
    });

    it('does NOT contain module response data', async () => {
      await engine.respond('malaria treatment');
      const cso = engine.getLastCSO()!;

      const memoryKeys = Object.keys(cso.memory);
      expect(memoryKeys).not.toContain('chunkId');
      expect(memoryKeys).not.toContain('score');
      expect(memoryKeys).not.toContain('confidenceGateFired');
    });
  });

  describe('Layer 5: Module Response', () => {
    it('contains chunk info on successful retrieval', async () => {
      await engine.respond('how to treat malaria');
      const cso = engine.getLastCSO()!;

      expect(cso.moduleResponse.chunkId).toBe('chunk-malaria-01');
      expect(cso.moduleResponse.score).toBeGreaterThan(0);
      expect(cso.moduleResponse.confidenceGateFired).toBe(false);
      expect(cso.moduleResponse.source).toBeDefined();
      expect(cso.moduleResponse.source!.document).toBe('SSCHCN 2020');
    });

    it('does NOT contain raw session history', async () => {
      await engine.respond('malaria treatment');
      const cso = engine.getLastCSO()!;

      const moduleKeys = Object.keys(cso.moduleResponse);
      expect(moduleKeys).not.toContain('turnBuffer');
      expect(moduleKeys).not.toContain('slotMemory');
      expect(moduleKeys).not.toContain('topicStack');
      expect(moduleKeys).not.toContain('sentimentHistory');
    });

    it('has null chunkId on fallback (greeting)', async () => {
      await engine.respond('hello');
      const cso = engine.getLastCSO()!;

      expect(cso.moduleResponse.chunkId).toBeNull();
    });
  });

  describe('Layer 6: Generation Control', () => {
    it('reports HIGH confidence when gate passes', async () => {
      await engine.respond('how to treat malaria');
      const cso = engine.getLastCSO()!;

      expect(cso.generationControl.confidenceTier).toBe('HIGH');
      expect(cso.generationControl.groundingConstraint).toBe('hiv_content_only');
    });

    it('reports LOW confidence on confidence gate fire', async () => {
      // Use a query that won't match anything in BM25 to trigger confidence gate
      const emptyEngine = new ConversationEngine(makeHivFile([]));
      await emptyEngine.respond('how to treat malaria');
      const cso = emptyEngine.getLastCSO()!;

      expect(cso.generationControl.confidenceTier).toBe('LOW');
    });

    it('sets escalation flag on danger sign detection', async () => {
      await engine.respond('patient is having convulsions and malaria');
      const cso = engine.getLastCSO()!;

      expect(cso.generationControl.escalationFlag).toBe(true);
    });

    it('does NOT contain response text', async () => {
      await engine.respond('malaria treatment');
      const cso = engine.getLastCSO()!;

      const genKeys = Object.keys(cso.generationControl);
      expect(genKeys).not.toContain('text');
      expect(genKeys).not.toContain('message');
      expect(genKeys).not.toContain('suggestedFollowUps');
    });
  });

  describe('Layer 7: Response', () => {
    it('contains final text and sources', async () => {
      await engine.respond('how to treat malaria');
      const cso = engine.getLastCSO()!;

      expect(cso.response.text).toBeTruthy();
      expect(cso.response.text.length).toBeGreaterThan(10);
      expect(cso.response.sources.length).toBeGreaterThan(0);
      expect(cso.response.sources[0].document).toBe('SSCHCN 2020');
      expect(cso.response.verified).toBe(true);
      expect(Array.isArray(cso.response.suggestedFollowUps)).toBe(true);
    });

    it('matches the returned EngineResponse message', async () => {
      const response = await engine.respond('how to treat malaria');
      const cso = engine.getLastCSO()!;

      expect(cso.response.text).toBe(response.message);
      expect(cso.response.type).toBe(response.type);
    });

    it('does NOT contain raw query or slots', async () => {
      await engine.respond('malaria treatment');
      const cso = engine.getLastCSO()!;

      const responseKeys = Object.keys(cso.response);
      expect(responseKeys).not.toContain('rawInput');
      expect(responseKeys).not.toContain('slots');
      expect(responseKeys).not.toContain('intent');
    });
  });

  describe('cross-layer ownership', () => {
    it('intent layer does not contain chunk search results', async () => {
      await engine.respond('malaria treatment');
      const cso = engine.getLastCSO()!;

      const intentKeys = Object.keys(cso.intent);
      expect(intentKeys).not.toContain('chunkId');
      expect(intentKeys).not.toContain('score');
      expect(intentKeys).not.toContain('vectorTier');
    });

    it('module response does not contain final assembled text', async () => {
      await engine.respond('malaria treatment');
      const cso = engine.getLastCSO()!;

      const moduleKeys = Object.keys(cso.moduleResponse);
      expect(moduleKeys).not.toContain('text');
      expect(moduleKeys).not.toContain('message');
    });

    it('identity layer does not contain clinical data', async () => {
      await engine.respond('malaria treatment');
      const cso = engine.getLastCSO()!;

      const identityKeys = Object.keys(cso.identity);
      expect(identityKeys).not.toContain('slotMemory');
      expect(identityKeys).not.toContain('turnBuffer');
      expect(identityKeys).not.toContain('chunkId');
    });
  });
});
