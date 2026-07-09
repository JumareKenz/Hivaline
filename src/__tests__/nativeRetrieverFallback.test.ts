/**
 * Rigorous retrieval regression suite for the NativeRetriever-idle bug.
 *
 * Background:
 *   download from compiler.hiva.chat fails → NativeRetriever status stays 'idle'
 *   → isNativeRetrieverReady() returns false forever
 *   → old guard `if (nativeRawText === null && await isNativeRetrieverReady() === false)`
 *     fired on EVERY query that had no template-assembled answer
 *   → every such query returned "I'm still loading the clinical guidelines"
 *
 * Fix (conversationEngine.ts ~line 549):
 *   guard changed to `getNativeRetrieverStatus() === 'loading'`
 *   so idle/error states fall through to EdgeBrain with JS chunk evidence.
 *
 * This suite simulates a real CHEW session: greetings, clinical queries,
 * follow-ups, dangerous presentations, and out-of-scope queries.
 * All tests run with NativeRetriever in status='idle' (download failed).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock @capacitor/core before any import that calls registerPlugin ──────────
vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({
    isReady: vi.fn().mockResolvedValue({ ready: false }),
    isEmbeddingModelDownloaded: vi.fn().mockResolvedValue({ downloaded: false, path: '', sizeMB: 0 }),
    search: vi.fn().mockResolvedValue({ results: [] }),
    loadBundle: vi.fn().mockRejectedValue(new Error('network error')),
    unload: vi.fn().mockResolvedValue({ success: true }),
    downloadEmbeddingModel: vi.fn().mockRejectedValue(new Error('network error')),
  }),
  Capacitor: { isNativePlatform: () => true },
}));

// EdgeBrain: model loaded and generating real answers
vi.mock('@/services/edgeBrainService', () => ({
  isEdgeBrainReady: vi.fn().mockResolvedValue(true),
  generateGrounded: vi.fn().mockImplementation((_evidence: string, query: string) => {
    const q = query.toLowerCase();
    if (q.includes('malaria'))
      return Promise.resolve({ text: 'Malaria is caused by Plasmodium parasites. Treat with ACT (artemether-lumefantrine). Ensure full 3-day course.', tokenCount: 30, durationMs: 700, tokensPerSecond: 42.8 });
    if (q.includes('refer'))
      return Promise.resolve({ text: 'Refer immediately if: convulsions, unconsciousness, inability to drink, severe anaemia, or hyperparasitaemia.', tokenCount: 22, durationMs: 600, tokensPerSecond: 36.7 });
    if (q.includes('dose') || q.includes('dosage'))
      return Promise.resolve({ text: 'Artemether-lumefantrine: 1 tablet twice daily for 3 days for 5–14 kg. Confirm weight before dosing.', tokenCount: 20, durationMs: 550, tokensPerSecond: 36.4 });
    if (q.includes('diarrhea') || q.includes('diarrhoea'))
      return Promise.resolve({ text: 'For diarrhoea: give ORS, zinc supplementation for 10 days, continue breastfeeding. Refer if blood in stool or signs of severe dehydration.', tokenCount: 28, durationMs: 650, tokensPerSecond: 43.1 });
    if (q.includes('pneumonia'))
      return Promise.resolve({ text: 'Pneumonia: fast breathing + chest indrawing. Give amoxicillin for 5 days. Refer if severe (oxygen saturation <90%, severe chest indrawing).', tokenCount: 26, durationMs: 620, tokensPerSecond: 41.9 });
    return Promise.resolve({ text: 'Based on clinical guidelines, assess the patient carefully and refer if danger signs are present.', tokenCount: 18, durationMs: 500, tokensPerSecond: 36.0 });
  }),
  checkGrounding: vi.fn().mockReturnValue({ grounded: true, score: 0.88, unmatchedTerms: [] }),
}));

// Translation: passthrough for English queries
vi.mock('@/services/queryTranslator', () => ({
  prepareQueryForEmbedding: vi.fn().mockImplementation((q: string) =>
    Promise.resolve({ translatedQuery: null, language: 'en', latencyMs: 0, error: null, originalQuery: q }),
  ),
}));

// Embedding model not ready — matches production state when download failed
vi.mock('@/services/modelManager', () => ({
  isEmbeddingModelReady: vi.fn().mockReturnValue(false),
}));
vi.mock('@/services/embeddingModel', () => ({
  embedQuery: vi.fn().mockRejectedValue(new Error('model not ready')),
}));

// Silent analytics and logging
vi.mock('@/services/analyticsService', () => ({
  trackQuery: vi.fn().mockResolvedValue(undefined),
  recordMessage: vi.fn(),
  recordTopic: vi.fn(),
}));
vi.mock('@/services/queryLogger', () => ({ logQuery: vi.fn() }));
vi.mock('@/services/telemetry', () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

// ── Fixture: a realistic multi-topic .hiva bundle ─────────────────────────────
function buildMockHivFile() {
  const chunks = [
    {
      id: 'malaria-overview',
      type: 'clinical',
      display_title: 'Malaria Overview',
      aspects: ['overview', 'treatment', 'referral'],
      trigger_phrases: { en: ['malaria', 'fever chills', 'plasmodium', 'act'] },
      source: { document: 'IMCI Guidelines 2023' },
      content: {
        en: {
          answer: 'Malaria is caused by Plasmodium parasites transmitted by Anopheles mosquitoes. First-line treatment is artemisinin-based combination therapy (ACT). Ensure full 3-day adherence.',
          referral: 'Refer if convulsions, unconsciousness, inability to drink, severe anaemia, or hyperparasitaemia (>5% parasitaemia).',
          follow_up_questions: ["What's the dose for a child?", 'When should I refer?', 'How to prevent malaria?'],
        },
      },
    },
    {
      id: 'malaria-dosage',
      type: 'drug_table',
      display_title: 'Malaria Drug Dosages',
      aspects: ['dosage'],
      trigger_phrases: { en: ['dose', 'dosage', 'artemether', 'lumefantrine', 'how much'] },
      source: { document: 'IMCI Guidelines 2023' },
      content: {
        en: {
          answer: 'Artemether-lumefantrine dosing by weight: 5–14 kg: 1 tab twice daily × 3 days; 15–24 kg: 2 tabs twice daily × 3 days; 25–34 kg: 3 tabs twice daily × 3 days.',
          dosage_rules: [{
            basis: 'weight',
            brackets: [
              { min_kg: 5, max_kg: 14, dose: '1 tablet twice daily for 3 days' },
              { min_kg: 15, max_kg: 24, dose: '2 tablets twice daily for 3 days' },
              { min_kg: 25, max_kg: 34, dose: '3 tablets twice daily for 3 days' },
            ],
          }],
        },
      },
    },
    {
      id: 'diarrhea-overview',
      type: 'clinical',
      display_title: 'Diarrhoea Management',
      aspects: ['overview', 'treatment'],
      trigger_phrases: { en: ['diarrhea', 'diarrhoea', 'loose stool', 'ors'] },
      source: { document: 'IMCI Guidelines 2023' },
      content: {
        en: {
          answer: 'Diarrhoea management: give ORS (oral rehydration salts), zinc for 10 days, continue breastfeeding. Refer if blood in stool or signs of severe dehydration (sunken eyes, very slow skin pinch).',
          follow_up_questions: ['How to prepare ORS?', 'When to refer?', 'Zinc dose?'],
        },
      },
    },
    {
      id: 'pneumonia-overview',
      type: 'clinical',
      display_title: 'Pneumonia Assessment',
      aspects: ['overview', 'treatment', 'referral'],
      trigger_phrases: { en: ['pneumonia', 'chest indrawing', 'fast breathing', 'amoxicillin'] },
      source: { document: 'IMCI Guidelines 2023' },
      content: {
        en: {
          answer: 'Pneumonia: assess for fast breathing (≥50 bpm in 2–11 months, ≥40 bpm in 1–5 years) and chest indrawing. Give amoxicillin 40 mg/kg/day for 5 days. Refer if severe (SpO2 <90%, severe chest indrawing, unable to feed).',
          follow_up_questions: ['Amoxicillin dose?', 'Severe pneumonia criteria?', 'When to refer?'],
        },
      },
    },
  ];

  // 384-dim zero vectors — BM25 is the primary retrieval path here
  const dims = 384;
  const embeddings = chunks.map(() => new Array(dims).fill(0));

  // BM25 index keyed by language code, then by term
  const bm25Index = {
    en: {
      index: {
        malaria: [
          { chunk_id: 'malaria-overview', score: 8.5 },
          { chunk_id: 'malaria-dosage', score: 3.2 },
        ],
        fever: [{ chunk_id: 'malaria-overview', score: 5.1 }],
        plasmodium: [{ chunk_id: 'malaria-overview', score: 9.2 }],
        artemisinin: [
          { chunk_id: 'malaria-dosage', score: 8.8 },
          { chunk_id: 'malaria-overview', score: 5.0 },
        ],
        act: [
          { chunk_id: 'malaria-dosage', score: 7.5 },
          { chunk_id: 'malaria-overview', score: 6.0 },
        ],
        dose: [
          { chunk_id: 'malaria-dosage', score: 7.0 },
          { chunk_id: 'diarrhea-overview', score: 2.1 },
        ],
        dosage: [{ chunk_id: 'malaria-dosage', score: 8.0 }],
        lumefantrine: [{ chunk_id: 'malaria-dosage', score: 9.0 }],
        artemether: [{ chunk_id: 'malaria-dosage', score: 9.0 }],
        refer: [
          { chunk_id: 'malaria-overview', score: 4.5 },
          { chunk_id: 'pneumonia-overview', score: 4.0 },
        ],
        diarrhea: [{ chunk_id: 'diarrhea-overview', score: 8.5 }],
        diarrhoea: [{ chunk_id: 'diarrhea-overview', score: 8.5 }],
        ors: [{ chunk_id: 'diarrhea-overview', score: 9.0 }],
        pneumonia: [{ chunk_id: 'pneumonia-overview', score: 9.5 }],
        breathing: [{ chunk_id: 'pneumonia-overview', score: 6.0 }],
        amoxicillin: [{ chunk_id: 'pneumonia-overview', score: 9.0 }],
        chest: [{ chunk_id: 'pneumonia-overview', score: 5.5 }],
      },
    },
  };

  return {
    manifest: { schema_version: '3.0', version: '3.0', name: 'HIVA Test Bundle', created_at: '' },
    chunks,
    embeddings,
    embeddingChunkIds: chunks.map(c => c.id),
    embeddingDims: dims,
    lexicalIndex: bm25Index,
    queryProxies: {},
    gapGraph: {
      'malaria-overview': [
        { to: 'malaria-dosage', score: 0.9, label: "What's the dose?" },
      ],
      'malaria-dosage': [
        { to: 'malaria-overview', score: 0.7, label: 'Malaria overview' },
      ],
    },
    rules: {
      coverage_manifest: {
        topics: {
          malaria: { aspects_covered: ['overview', 'treatment', 'referral', 'dosage'] },
          diarrhea: { aspects_covered: ['overview', 'treatment'] },
          pneumonia: { aspects_covered: ['overview', 'treatment', 'referral'] },
        },
      },
    },
    variantEmbeddings: null,
    variantEmbeddingsIndex: null,
    variantCount: 0,
  } as any;
}

// ── Helper to create a fresh engine (module reset between describe blocks) ────
async function makeEngine() {
  const { ConversationEngine } = await import('@/services/conversationEngine');
  return new ConversationEngine(buildMockHivFile());
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: Core regression — loading message must NEVER appear
// ─────────────────────────────────────────────────────────────────────────────
describe('Regression: loading message must never appear with NativeRetriever idle', () => {
  beforeEach(() => vi.resetModules());

  const LOADING_RE = /still loading|still preparing|please ask again/i;

  const clinicalQueries = [
    'What is malaria',
    'How do I treat malaria',
    'When should I refer a malaria patient',
    'What is the dose for malaria',
    'Diarrhea management',
    'How to treat diarrhoea',
    'Pneumonia assessment',
    'Fast breathing in a child',
    'How do I treat pneumonia',
    'What is artemether lumefantrine dose',
  ];

  for (const query of clinicalQueries) {
    it(`does not return loading message for: "${query}"`, async () => {
      const engine = await makeEngine();
      const result = await engine.respond(query);
      expect(result.message).not.toMatch(LOADING_RE);
      expect(result.message.length).toBeGreaterThan(20);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: Clinical answer quality — responses must contain substance
// ─────────────────────────────────────────────────────────────────────────────
describe('Clinical answer quality with NativeRetriever idle', () => {
  beforeEach(() => vi.resetModules());

  it('malaria query returns clinical content mentioning treatment', async () => {
    const engine = await makeEngine();
    const result = await engine.respond('What is malaria');

    // Must not be a loading or generic fallback
    expect(result.message).not.toMatch(/still loading|please ask again/i);
    // Must contain clinical substance from either template or EdgeBrain
    const hasClinical = /malaria|plasmodium|artemisinin|ACT|treatment|parasite/i.test(result.message);
    expect(hasClinical).toBe(true);
    expect(result.chunkId).toBeTruthy();
  });

  it('dosage query returns weight-based dosing information', async () => {
    const engine = await makeEngine();
    const result = await engine.respond('What is the dose for artemether lumefantrine');

    expect(result.message).not.toMatch(/still loading|please ask again/i);
    const hasDosing = /dose|dosage|tablet|kg|daily|\d+\s*(mg|tab)/i.test(result.message);
    expect(hasDosing).toBe(true);
  });

  it('diarrhoea query returns ORS/zinc guidance', async () => {
    const engine = await makeEngine();
    const result = await engine.respond('How do I manage diarrhea in a child');

    expect(result.message).not.toMatch(/still loading|please ask again/i);
    const hasDiarrheaContent = /ors|zinc|rehydrat|diarr|stool|breastfeed/i.test(result.message);
    expect(hasDiarrheaContent).toBe(true);
  });

  it('pneumonia query returns breathing criteria or treatment', async () => {
    const engine = await makeEngine();
    const result = await engine.respond('How do I assess and treat pneumonia');

    expect(result.message).not.toMatch(/still loading|please ask again/i);
    const hasPneumoniaContent = /pneumonia|breathing|chest|amoxicillin|indrawing|bpm/i.test(result.message);
    expect(hasPneumoniaContent).toBe(true);
  });

  it('referral query returns referral criteria', async () => {
    const engine = await makeEngine();
    const result = await engine.respond('When should I refer a malaria patient');

    expect(result.message).not.toMatch(/still loading|please ask again/i);
    const hasReferral = /refer|convuls|unconscious|severe|danger/i.test(result.message);
    expect(hasReferral).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: CHEW session simulation — multi-turn conversation
// ─────────────────────────────────────────────────────────────────────────────
describe('CHEW session simulation — multi-turn conversation', () => {
  beforeEach(() => vi.resetModules());

  it('full malaria session: greeting → diagnosis → dose → referral', async () => {
    const engine = await makeEngine();
    const LOADING_RE = /still loading|still preparing|please ask again/i;

    // Turn 1: Greeting
    const t1 = await engine.respond('Hello');
    expect(t1.type).toBe('greeting');
    expect(t1.message).not.toMatch(LOADING_RE);

    // Turn 2: Clinical presentation
    const t2 = await engine.respond('I have a patient with fever and chills, could be malaria');
    expect(t2.message).not.toMatch(LOADING_RE);
    expect(t2.message.length).toBeGreaterThan(20);

    // Turn 3: Dosage follow-up
    const t3 = await engine.respond("What's the dose?");
    expect(t3.message).not.toMatch(LOADING_RE);
    expect(t3.message.length).toBeGreaterThan(20);

    // Turn 4: Referral criteria
    const t4 = await engine.respond('When should I refer?');
    expect(t4.message).not.toMatch(LOADING_RE);
    expect(t4.message.length).toBeGreaterThan(20);

    // Turn 5: Social close
    const t5 = await engine.respond('Thanks');
    expect(t5.message).not.toMatch(LOADING_RE);
  });

  it('diarrhea session: clinical query → follow-up → thanks', async () => {
    const engine = await makeEngine();
    const LOADING_RE = /still loading|still preparing|please ask again/i;

    const t1 = await engine.respond('Child with diarrhoea, no blood in stool');
    expect(t1.message).not.toMatch(LOADING_RE);
    expect(t1.message.length).toBeGreaterThan(20);

    const t2 = await engine.respond('How do I prepare ORS?');
    expect(t2.message).not.toMatch(LOADING_RE);

    const t3 = await engine.respond('Thank you');
    expect(t3.message).not.toMatch(LOADING_RE);
  });

  it('does not return loading message on 5 consecutive distinct queries', async () => {
    const engine = await makeEngine();
    const queries = [
      'What is malaria',
      'How to treat pneumonia',
      'Diarrhea management',
      'What is the malaria dose',
      'When to refer malaria',
    ];
    for (const q of queries) {
      const result = await engine.respond(q);
      expect(result.message, `Failed for query: "${q}"`).not.toMatch(/still loading|please ask again/i);
      expect(result.message.length, `Short response for: "${q}"`).toBeGreaterThan(20);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4: Danger sign escalation
// ─────────────────────────────────────────────────────────────────────────────
describe('Danger sign escalation with NativeRetriever idle', () => {
  beforeEach(() => vi.resetModules());

  it('convulsion query triggers escalation warning', async () => {
    const engine = await makeEngine();
    const result = await engine.respond('Patient is convulsing, has malaria');

    expect(result.message).not.toMatch(/still loading|please ask again/i);
    // Escalation flag triggers ⚠️ prefix
    expect(result.message).toMatch(/⚠️|convuls|danger|refer|emergency/i);
  });

  it('breathing failure query triggers escalation', async () => {
    const engine = await makeEngine();
    const result = await engine.respond('Child stopped breathing');

    expect(result.message).not.toMatch(/still loading|please ask again/i);
    expect(result.message).toMatch(/⚠️|breath|emergency|danger/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5: Out-of-scope and greeting routing
// ─────────────────────────────────────────────────────────────────────────────
describe('Routing: out-of-scope and greetings', () => {
  beforeEach(() => vi.resetModules());

  it('greeting routes correctly and is not clinical', async () => {
    const engine = await makeEngine();
    const result = await engine.respond('Hello');
    expect(result.type).toBe('greeting');
    expect(result.message).not.toMatch(/still loading|please ask again/i);
  });

  it('out-of-scope query returns helpful boundary message', async () => {
    const engine = await makeEngine();
    const result = await engine.respond('What is the price of petrol in Lagos');
    expect(result.message).not.toMatch(/still loading|please ask again/i);
    expect(result.type).toBe('fallback');
  });

  it('social acknowledgment does not return loading message', async () => {
    const engine = await makeEngine();
    await engine.respond('What is malaria'); // establish topic
    const result = await engine.respond('Thanks');
    expect(result.message).not.toMatch(/still loading|please ask again/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6: NativeRetriever loading state — transient message is still shown
// ─────────────────────────────────────────────────────────────────────────────
describe('NativeRetriever actively loading — transient message is acceptable', () => {
  it('responds with something meaningful while loading (not an error)', async () => {
    vi.resetModules();

    vi.doMock('@/services/nativeRetrieverService', () => ({
      isNativeRetrieverReady: vi.fn().mockResolvedValue(false),
      getNativeRetrieverStatus: vi.fn().mockReturnValue('loading'),
      nativeSearch: vi.fn().mockResolvedValue([]),
    }));

    const { ConversationEngine } = await import('@/services/conversationEngine');
    const engine = new ConversationEngine(buildMockHivFile());
    const result = await engine.respond('What is malaria');

    // BM25 finds the chunk and template assembly succeeds → never hits the guard
    // OR guard fires and returns transient → both are valid outcomes while loading
    expect(result.message).toBeDefined();
    expect(result.message.length).toBeGreaterThan(5);
    // What must NOT happen: a JS error or empty string
    expect(result.message).not.toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 7: Follow-up chips present on successful responses
// ─────────────────────────────────────────────────────────────────────────────
describe('Follow-up chips present on clinical responses', () => {
  beforeEach(() => vi.resetModules());

  it('malaria response includes suggested follow-ups', async () => {
    const engine = await makeEngine();
    const result = await engine.respond('What is malaria');
    expect(Array.isArray(result.suggestedFollowUps)).toBe(true);
    expect((result.suggestedFollowUps ?? []).length).toBeGreaterThan(0);
  });

  it('dosage response includes suggested follow-ups', async () => {
    const engine = await makeEngine();
    const result = await engine.respond('What is the artemether dose');
    expect(Array.isArray(result.suggestedFollowUps)).toBe(true);
  });
});
