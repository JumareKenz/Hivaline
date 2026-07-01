/**
 * moduleRegistry.test.ts — Tests for module registry, routing, and collision detection
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModuleRegistry } from '@/services/moduleRegistry';
import { createMediChatModule, MEDICHAT_INTENTS } from '@/services/mediChatModule';
import type { CognitiveStateObject } from '@/types/cso';
import type { ExecutableModule, HivaModule } from '@/types/module';
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
        answer: 'Treat uncomplicated malaria with ACT.',
        topics: ['malaria'],
      },
    },
    source: { document: 'SSCHCN 2020', span: 'Ch.4' },
    checksum: 'abc123',
    aspects: ['treatment', 'dosage'],
    ...overrides,
  };
}

function makeHivFile(): HIVFile {
  return {
    manifest: {
      version: '1.0.0',
      sha256: 'fake',
      size_kb: 100,
      languages: ['en'],
      chunk_count: 1,
      created_at: '2024-01-01',
      search_config: {
        bm25_weight: 0.5,
        vector_weight: 0.5,
        fusion: 'RRF',
        rrf_k: 60,
        type_boost: { faq: 1, drug_table: 1, decision_tree: 1, protocol: 1, danger_sign: 1, calculator: 1 },
      },
    },
    chunks: [makeChunk()],
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
    gapGraph: {},
  };
}

function makeExecutableModule(id: string, intents: string[]): ExecutableModule {
  const hivaModule: HivaModule = {
    manifest: {
      id,
      name: `Module ${id}`,
      version: '1.0.0',
      domain: 'test',
      languages: ['en'],
      targetRoles: ['chew'],
      offline: { supported: true, assetsBundled: true },
    },
    schema: {
      intents: intents.map(i => ({ intent: i, requiredSlots: [] })),
      outputShape: { providesChunkId: false, providesSources: false, confidenceTiers: ['HIGH'] },
    },
    assets: {},
    signatureVerified: false,
  };

  return {
    module: hivaModule,
    async execute() {
      return {
        moduleResponse: {
          chunkId: null, score: null, confidenceGateFired: false, vectorTier: 'none' as const,
          topBm25Score: null, topVectorScore: null, vectorGatePassed: false,
          source: undefined, chunkDisplayTitle: null,
        },
        generationControl: { confidenceTier: 'HIGH' as const, escalationFlag: false },
        responseText: `response from ${id}`,
        sources: [],
        suggestedFollowUps: [],
        verified: false,
      };
    },
  };
}

function makeMinimalCSO(intent: string, rawInput = 'test query'): CognitiveStateObject {
  return {
    identity: { role: 'chew', location: undefined, language: 'en', connectivityStatus: 'online' },
    request: { rawInput, translatedInput: undefined },
    intent: {
      intent,
      mappedIntent: 'clinical',
      slots: { patientAge: null, patientAgeMonths: null, patientWeight: null, patientWeightKg: null, chiefComplaint: null, currentDrug: null, gender: null },
      confidenceScore: 1.0,
      sentiment: 'calm',
      targetModuleId: undefined,
      correctionTopic: null,
    },
    memory: {
      turnBuffer: [],
      slotMemory: { patientAge: null, patientAgeMonths: null, patientWeight: null, patientWeightKg: null, chiefComplaint: null, currentDrug: null, gender: null },
      topicStack: [],
      coveredChunks: new Set(),
      coveredAspects: new Set(),
      currentTopic: null,
      turnCount: 0,
      pendingGaps: [],
      sentimentHistory: [],
    },
    moduleResponse: {
      chunkId: null, score: null, confidenceGateFired: false, vectorTier: 'none',
      topBm25Score: null, topVectorScore: null, vectorGatePassed: false,
      source: undefined, chunkDisplayTitle: null,
    },
    generationControl: { confidenceTier: 'HIGH', escalationFlag: false, groundingConstraint: 'hiv_content_only' },
    response: { text: '', sources: [], verified: false, suggestedFollowUps: [], type: 'clinical' },
  };
}

describe('ModuleRegistry', () => {
  let registry: ModuleRegistry;

  beforeEach(() => {
    registry = new ModuleRegistry();
  });

  describe('registerModule', () => {
    it('registers a module and maps its intents', () => {
      const mod = makeExecutableModule('mod-a', ['CUSTOM_INTENT']);
      registry.registerModule(mod);

      expect(registry.getClaimedIntents()).toContain('CUSTOM_INTENT');
      expect(registry.getRegisteredModules()).toHaveLength(1);
    });

    it('throws on intent collision between two modules', () => {
      const mediChat = createMediChatModule(makeHivFile());
      registry.registerModule(mediChat);

      const collider = makeExecutableModule('collider', ['CLINICAL']);

      expect(() => registry.registerModule(collider)).toThrow(
        /Intent collision.*"CLINICAL".*"hiva-medichat-clinical".*"collider"/
      );
    });

    it('throws when registering the same module id twice', () => {
      const mediChat = createMediChatModule(makeHivFile());
      registry.registerModule(mediChat);

      expect(() => registry.registerModule(mediChat)).toThrow('already registered');
    });
  });

  describe('routeToModule', () => {
    it('routes a CSO to the correct module by intent', () => {
      const mediChat = createMediChatModule(makeHivFile());
      registry.registerModule(mediChat);

      const cso = makeMinimalCSO('CLINICAL');
      const routed = registry.routeToModule(cso);

      expect(routed).not.toBeNull();
      expect(routed!.module.manifest.id).toBe('hiva-medichat-clinical');
    });

    it('returns null for an unregistered intent', () => {
      const mediChat = createMediChatModule(makeHivFile());
      registry.registerModule(mediChat);

      const cso = makeMinimalCSO('UNKNOWN_INTENT');
      const routed = registry.routeToModule(cso);

      expect(routed).toBeNull();
    });

    it('routes GREETING intent to null (not claimed by MediChat)', () => {
      const mediChat = createMediChatModule(makeHivFile());
      registry.registerModule(mediChat);

      const cso = makeMinimalCSO('GREETING');
      const routed = registry.routeToModule(cso);

      expect(routed).toBeNull();
    });

    it('routes to custom module when registered for a unique intent', () => {
      const custom = makeExecutableModule('custom-mod', ['CUSTOM_INTENT']);
      registry.registerModule(custom);

      const cso = makeMinimalCSO('CUSTOM_INTENT');
      const routed = registry.routeToModule(cso);

      expect(routed).not.toBeNull();
      expect(routed!.module.manifest.id).toBe('custom-mod');
    });
  });

  describe('unregisterModule', () => {
    it('removes module and frees its intents', () => {
      const mediChat = createMediChatModule(makeHivFile());
      registry.registerModule(mediChat);

      expect(registry.getClaimedIntents()).toContain('CLINICAL');

      registry.unregisterModule('hiva-medichat-clinical');

      expect(registry.getClaimedIntents()).not.toContain('CLINICAL');
      expect(registry.getRegisteredModules()).toHaveLength(0);
    });
  });

  describe('MediChat module claims all expected intents', () => {
    it('registers all MEDICHAT_INTENTS', () => {
      const mediChat = createMediChatModule(makeHivFile());
      registry.registerModule(mediChat);

      for (const intent of MEDICHAT_INTENTS) {
        expect(registry.getClaimedIntents()).toContain(intent);
      }
    });
  });
});

describe('MediChat module end-to-end routing', () => {
  it('routes a clinical query through registry and produces same response as direct engine', async () => {
    const hivFile = makeHivFile();

    // Direct engine response (baseline)
    const { ConversationEngine } = await import('@/services/conversationEngine');
    const directEngine = new ConversationEngine(hivFile);
    const directResponse = await directEngine.respond('how to treat malaria');

    // Module-routed response
    const registry = new ModuleRegistry();
    const mediChat = createMediChatModule(hivFile);
    registry.registerModule(mediChat);

    const cso = makeMinimalCSO('PROCEDURE', 'how to treat malaria');

    const routed = registry.routeToModule(cso);
    expect(routed).not.toBeNull();

    const result = await routed!.execute(cso);

    expect(result.responseText).toBe(directResponse.message);
    expect(result.verified).toBe(!!directResponse.chunkId);
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.suggestedFollowUps.length).toBeGreaterThan(0);
  });
});
