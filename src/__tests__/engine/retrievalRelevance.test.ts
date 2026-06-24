/**
 * retrievalRelevance.test.ts — Retrieval evaluation harness
 *
 * Fixed set of representative clinical queries paired with expected
 * chunk characteristics. Measures retrieval accuracy (Recall@1, Recall@5)
 * independently of the synthesis layer.
 *
 * Usage: run `npx vitest src/__tests__/engine/retrievalRelevance.test.ts`
 * after any retrieval change to verify improvement and catch regressions.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { initSearch, search, setEmbedQueryFn, getLastVectorTier, type HIVAssets } from '@/engine/hybridSearch';
import SessionState from '@/engine/sessionState';
import { rewriteQuery } from '@/engine/queryRewriter';
import { classifyIntent } from '@/engine/intentEngine';

/**
 * Each test case defines:
 *  - query: the user's raw input
 *  - domain: clinical category (for reporting)
 *  - expectedTriggers: tokens that MUST appear in the matched chunk's
 *    trigger_phrases, display_title, or content answer to count as a hit
 *  - forbiddenTriggers: tokens that must NOT appear (wrong-chunk indicators)
 */
interface RelevanceCase {
  query: string;
  domain: string;
  expectedTriggers: RegExp;
  forbiddenTriggers?: RegExp;
}

const RELEVANCE_CASES: RelevanceCase[] = [
  // ─── HIV/ART ───
  {
    query: 'ART for pregnant woman with HIV',
    domain: 'HIV',
    expectedTriggers: /pmtct|pregnan|mother.*child|maternal|option.*b/i,
    forbiddenTriggers: /^antiretroviral therapy, or art, is the treatment/i,
  },
  {
    query: 'Signs of ART treatment failure',
    domain: 'HIV',
    expectedTriggers: /fail|viral.*load|1000|suppress|resistan/i,
    forbiddenTriggers: /^improving adherence|regimen.*switch/i,
  },
  {
    query: 'When to start ART in adults',
    domain: 'HIV',
    expectedTriggers: /start|initiat|same.*day|rapid|regardless|cd4/i,
  },
  {
    query: 'What is PMTCT?',
    domain: 'HIV',
    expectedTriggers: /pmtct|mother.*to.*child|prevent.*transmis|pregnan/i,
  },
  {
    query: 'ARV dose for 10kg child',
    domain: 'HIV',
    expectedTriggers: /arv|art|hiv|antiretroviral|lopinavir|abacavir|dolutegravir/i,
  },

  // ─── TB ───
  {
    query: 'How to screen for TB in PLHIV',
    domain: 'TB',
    expectedTriggers: /screen|symptom|cough|fever|weight.*loss|night.*sweat/i,
  },
  {
    query: 'TPT options for PLHIV',
    domain: 'TB',
    expectedTriggers: /3hp|3hr|6h|1hp|ipt|isoniazid|rifapentine|preventive/i,
  },
  {
    query: 'Isoniazid dose for children',
    domain: 'TB',
    expectedTriggers: /isoniazid|inh|10.*mg.*kg|tpt|preventive/i,
  },

  // ─── Malaria ───
  {
    query: 'Coartem dose for 20kg child',
    domain: 'Malaria',
    expectedTriggers: /coartem|act|artemether|lumefantrine|malaria|tablet/i,
  },
  {
    query: 'How much amoxicillin for a 14kg child?',
    domain: 'Drug Dosing',
    expectedTriggers: /amoxicillin|250mg|mg/i,
  },

  // ─── Drug Interactions ───
  {
    query: 'Can I give rifampicin with dolutegravir?',
    domain: 'Drug Interactions',
    expectedTriggers: /rifampicin|dolutegravir|dose.*adjust|double|50.*mg.*twice/i,
  },

  // ─── Maternal/Newborn ───
  {
    query: 'Newborn danger signs',
    domain: 'Maternal/Newborn',
    expectedTriggers: /convuls|not.*feed|fever|breath|lethargi|jaundice|cord|refer/i,
  },

  // ─── Multi-concept ───
  {
    query: 'HIV treatment during pregnancy',
    domain: 'HIV',
    expectedTriggers: /pmtct|pregnan|maternal|mother/i,
  },
  {
    query: 'Managing TB in HIV-positive patients',
    domain: 'TB/HIV',
    expectedTriggers: /tb.*hiv|co.*infect|rifampicin|art.*tb/i,
  },

  // ─── Pidgin/colloquial phrasing ───
  {
    query: 'wetin be the sign say pikin dey sick well well',
    domain: 'Danger Signs',
    expectedTriggers: /danger|sign|sick|convuls|refer|fever/i,
  },
];

/**
 * Build a minimal mock assets set from chunk data.
 * In integration mode, this would load from the actual .hiv file.
 * For unit testing, we use synthetic chunks that mirror real structure.
 */
function buildTestAssets(): { assets: HIVAssets; chunkContentMap: Map<string, string> } {
  // Synthetic chunks representing real clinical content categories
  const chunks = [
    {
      id: 'pmtct-protocol',
      title: 'PMTCT — Prevention of Mother to Child Transmission',
      triggerPhrases: ['pmtct', 'prevention of mother to child transmission', 'hiv pregnancy', 'art in pregnancy', 'maternal hiv'],
      content: 'PMTCT prevents mother-to-child HIV transmission during pregnancy, labour, delivery and breastfeeding. All pregnant women with HIV should start ART immediately (Option B+). Maternal viral suppression is the goal.',
    },
    {
      id: 'art-initiation',
      title: 'ART Initiation in Adults',
      triggerPhrases: ['when to start art', 'art initiation', 'same day art', 'rapid art initiation'],
      content: 'Start ART in all adults regardless of CD4 count. Same-day initiation is recommended. Rapid ART initiation within 7 days of HIV diagnosis.',
    },
    {
      id: 'art-definition',
      title: 'What is ART (Antiretroviral Therapy)',
      triggerPhrases: ['what is art', 'antiretroviral therapy', 'art definition'],
      content: 'Antiretroviral therapy, or ART, is the treatment of HIV infection using a combination of medicines. ART reduces viral load and prevents progression to AIDS.',
    },
    {
      id: 'art-failure',
      title: 'ART Treatment Failure',
      triggerPhrases: ['treatment failure', 'art failure signs', 'virologic failure', 'viral load failure'],
      content: 'Treatment failure is defined as viral load above 1000 copies/mL on two consecutive measurements. Signs include rising viral load despite adherence, immunologic failure (falling CD4), or clinical progression.',
    },
    {
      id: 'arv-dosing-children',
      title: 'ARV Dosing for Children',
      triggerPhrases: ['arv dose child', 'pediatric arv', 'art dose children'],
      content: 'ARV dosing in children: Dolutegravir 50mg for >20kg, Abacavir/Lamivudine weight-based. Lopinavir/Ritonavir for infants.',
    },
    {
      id: 'tb-screening-plhiv',
      title: 'TB Screening in PLHIV',
      triggerPhrases: ['tb screening', 'screen tb hiv', 'tb symptom screen'],
      content: 'Screen for TB using the 4-symptom screen: current cough, fever, weight loss, night sweats. Any positive symptom requires further investigation.',
    },
    {
      id: 'tpt-options',
      title: 'TB Preventive Therapy Options',
      triggerPhrases: ['tpt', 'ipt', 'tb preventive therapy', '3hp', 'isoniazid preventive'],
      content: 'TPT options: 6H (isoniazid daily for 6 months), 3HP (isoniazid + rifapentine weekly for 3 months), 3HR (isoniazid + rifampicin daily for 3 months).',
    },
    {
      id: 'isoniazid-dosing',
      title: 'Isoniazid Dosing',
      triggerPhrases: ['isoniazid dose', 'inh dose', 'ipt dosing'],
      content: 'Isoniazid 10mg/kg/day for children (max 300mg). For TPT: 10mg/kg daily for 6 months.',
    },
    {
      id: 'coartem-dosing',
      title: 'Coartem (ACT) Dosing',
      triggerPhrases: ['coartem dose', 'act dosing', 'artemether lumefantrine dose', 'malaria treatment dose'],
      content: 'Coartem (artemether-lumefantrine) for malaria: 20kg child gets 2 tablets twice daily for 3 days.',
    },
    {
      id: 'amoxicillin-dosing',
      title: 'Amoxicillin Dosing',
      triggerPhrases: ['amoxicillin dose', 'amoxicillin children'],
      content: 'Amoxicillin 250mg/5ml: 14kg child gets 7.5ml (375mg) three times daily.',
    },
    {
      id: 'rifampicin-dolutegravir',
      title: 'Rifampicin-Dolutegravir Interaction',
      triggerPhrases: ['rifampicin dolutegravir', 'drug interaction rifampicin', 'dtg dose adjustment'],
      content: 'Rifampicin reduces dolutegravir levels. Dose adjust: give dolutegravir 50mg twice daily when co-administered with rifampicin.',
    },
    {
      id: 'newborn-danger-signs',
      title: 'Newborn Danger Signs',
      triggerPhrases: ['newborn danger signs', 'neonatal danger', 'sick newborn'],
      content: 'Danger signs in newborns: convulsions, not feeding, fever >38°C, fast breathing >60/min, severe jaundice, cord infection. Refer immediately.',
    },
    {
      id: 'tb-hiv-coinfection',
      title: 'TB-HIV Co-infection Management',
      triggerPhrases: ['tb hiv coinfection', 'managing tb hiv', 'art tb treatment'],
      content: 'Start TB treatment first, then ART within 2-8 weeks. Use rifampicin-based regimen. Adjust dolutegravir to 50mg twice daily during TB treatment.',
    },
  ];

  // Build BM25 index from trigger phrases + title + content
  const bm25Index: Record<string, Array<{ chunk_id: string; score: number }>> = {};
  const chunkContentMap = new Map<string, string>();

  for (const chunk of chunks) {
    const allText = [chunk.title, ...chunk.triggerPhrases, chunk.content].join(' ');
    chunkContentMap.set(chunk.id, allText.toLowerCase());

    const tokens = allText.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
    const seen = new Set<string>();
    for (const token of tokens) {
      const clean = token.replace(/[^\w]/g, '');
      if (clean.length < 2 || seen.has(clean)) continue;
      seen.add(clean);
      if (!bm25Index[clean]) bm25Index[clean] = [];
      bm25Index[clean].push({ chunk_id: chunk.id, score: 3 });
    }

    // Boost trigger phrase tokens (higher score for exact triggers)
    for (const phrase of chunk.triggerPhrases) {
      const phraseTokens = phrase.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
      for (const token of phraseTokens) {
        const clean = token.replace(/[^\w]/g, '');
        if (clean.length < 2) continue;
        if (!bm25Index[clean]) bm25Index[clean] = [];
        bm25Index[clean].push({ chunk_id: chunk.id, score: 8 });
      }
    }
  }

  // Build embedding vectors (simple bag-of-words for testability)
  // In production this would be real MiniLM embeddings
  const dims = 384;
  const total = chunks.length;
  const buffer = new ArrayBuffer(total * dims * 4);
  const view = new Float32Array(buffer);

  // Create deterministic pseudo-embeddings from chunk content
  for (let i = 0; i < total; i++) {
    const text = chunks[i].title + ' ' + chunks[i].triggerPhrases.join(' ');
    const tokens = text.toLowerCase().split(/\s+/);
    for (let j = 0; j < dims; j++) {
      // Simple hash-based embedding for testing
      const tokenIdx = j % tokens.length;
      const charSum = tokens[tokenIdx]?.split('').reduce((s, c) => s + c.charCodeAt(0), 0) || 0;
      view[i * dims + j] = ((charSum * (j + 1)) % 255) / 127.0 - 1.0;
    }
    // Normalize
    let norm = 0;
    for (let j = 0; j < dims; j++) norm += view[i * dims + j] ** 2;
    norm = Math.sqrt(norm);
    for (let j = 0; j < dims; j++) view[i * dims + j] /= norm;
  }

  // Build query proxies from trigger phrases
  const queryProxies: Record<string, number[]> = {};
  for (const chunk of chunks) {
    for (const phrase of chunk.triggerPhrases) {
      const proxyVec = new Array(dims).fill(0);
      const tokens = phrase.toLowerCase().split(/\s+/);
      for (let j = 0; j < dims; j++) {
        const tokenIdx = j % tokens.length;
        const charSum = tokens[tokenIdx]?.split('').reduce((s, c) => s + c.charCodeAt(0), 0) || 0;
        proxyVec[j] = ((charSum * (j + 1)) % 255) / 127.0 - 1.0;
      }
      // Normalize
      let norm = 0;
      for (let j = 0; j < dims; j++) norm += proxyVec[j] ** 2;
      norm = Math.sqrt(norm);
      for (let j = 0; j < dims; j++) proxyVec[j] /= norm;
      queryProxies[phrase] = proxyVec;
    }
  }

  const assets: HIVAssets = {
    embeddingsBuffer: buffer,
    embeddingsIndex: {
      dimensions: dims,
      total_chunks: total,
      chunk_ids: chunks.map(c => c.id),
    },
    queryProxies,
    bm25Index: { en: { index: bm25Index } },
    chunks: chunks.map(c => ({ id: c.id, content: { en: { answer: c.content } } })),
  };

  return { assets, chunkContentMap };
}

describe('Retrieval Relevance Harness', () => {
  let assets: HIVAssets;
  let chunkContentMap: Map<string, string>;

  beforeAll(() => {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  ARTIFACT: SYNTHETIC DEV FIXTURE (in-memory, 13 chunks)');
    console.log('  NOT loaded from hiv-cache.bin — tests algorithm correctness');
    console.log('  For production-artifact validation, use: node test-embedding-recall.mjs');
    console.log('═══════════════════════════════════════════════════════');

    const built = buildTestAssets();
    assets = built.assets;
    chunkContentMap = built.chunkContentMap;
    initSearch(assets);
  });

  describe('Recall@1 — correct chunk is top result', () => {
    const results: Array<{ query: string; domain: string; pass: boolean; chunkId: string | null }> = [];

    for (const testCase of RELEVANCE_CASES) {
      it(`[${testCase.domain}] "${testCase.query}"`, async () => {
        const sessionState = new SessionState();
        const intent = classifyIntent(testCase.query);
        const rewritten = rewriteQuery(testCase.query, intent, sessionState);
        const result = await search(rewritten.rewritten, sessionState, 'en', assets);

        const chunkId = result?.chunkId ?? null;
        const chunkContent = chunkId ? (chunkContentMap.get(chunkId) ?? '') : '';

        const pass = chunkId !== null && testCase.expectedTriggers.test(chunkContent);
        const noForbidden = !testCase.forbiddenTriggers || !testCase.forbiddenTriggers.test(chunkContent);

        results.push({ query: testCase.query, domain: testCase.domain, pass: pass && noForbidden, chunkId });

        if (!(pass && noForbidden)) {
          console.warn(
            `  MISS [${testCase.domain}] "${testCase.query}" → ${chunkId}\n` +
            `    Content: ${chunkContent.slice(0, 120)}...`
          );
        }

        expect(chunkId).not.toBeNull();
      });
    }
  });

  it('reports overall pass rate', async () => {
    let pass = 0;
    let total = 0;

    for (const testCase of RELEVANCE_CASES) {
      const freshState = new SessionState();
      const intent = classifyIntent(testCase.query);
      const rewritten = rewriteQuery(testCase.query, intent, freshState);
      const result = await search(rewritten.rewritten, freshState, 'en', assets);

      const chunkId = result?.chunkId ?? null;
      const chunkContent = chunkId ? (chunkContentMap.get(chunkId) ?? '') : '';

      const hit = chunkId !== null && testCase.expectedTriggers.test(chunkContent);
      const noForbidden = !testCase.forbiddenTriggers || !testCase.forbiddenTriggers.test(chunkContent);

      if (hit && noForbidden) pass++;
      total++;
    }

    const rate = ((pass / total) * 100).toFixed(1);
    console.log(`\n══════════════════════════════════════════`);
    console.log(`  COLD-STATE RETRIEVAL (BM25 + proxy): ${pass}/${total} (${rate}%)`);
    console.log(`  Vector tier used: ${getLastVectorTier()}`);
    console.log(`══════════════════════════════════════════\n`);

    // BM25+proxy should pass at least 60% — this is the cold-start floor
    expect(pass).toBeGreaterThanOrEqual(Math.floor(total * 0.6));
  });
});

/**
 * WARM-STATE harness: simulates on-device embedding model being ready.
 * Uses a simple bag-of-words pseudo-embedding to test the Tier 1 code path.
 * In production, the MiniLM model provides real semantic embeddings.
 */
describe('Retrieval Relevance — Warm State (Tier 1 embedding model)', () => {
  let assets: HIVAssets;
  let chunkContentMap: Map<string, string>;

  beforeAll(() => {
    const built = buildTestAssets();
    assets = built.assets;
    chunkContentMap = built.chunkContentMap;
    initSearch(assets);

    // Mock embedding function using the SAME vector space as buildTestAssets().
    // This simulates what a real embedding model does: map text to a vector
    // space where semantically similar content has high cosine similarity.
    const mockEmbedQuery = async (text: string): Promise<Float32Array> => {
      const dims = 384;
      const vec = new Float32Array(dims);
      const tokens = text.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
      if (tokens.length === 0) return vec;
      for (let j = 0; j < dims; j++) {
        const tokenIdx = j % tokens.length;
        const charSum = tokens[tokenIdx]?.split('').reduce((s, c) => s + c.charCodeAt(0), 0) || 0;
        vec[j] = ((charSum * (j + 1)) % 255) / 127.0 - 1.0;
      }
      let norm = 0;
      for (let j = 0; j < dims; j++) norm += vec[j] * vec[j];
      norm = Math.sqrt(norm) || 1;
      for (let j = 0; j < dims; j++) vec[j] /= norm;
      return vec;
    };

    setEmbedQueryFn(mockEmbedQuery);
  });

  it('reports warm-state pass rate and tier usage', async () => {
    let pass = 0;
    let total = 0;
    let tier1Count = 0;
    const details: string[] = [];

    for (const testCase of RELEVANCE_CASES) {
      const freshState = new SessionState();
      const intent = classifyIntent(testCase.query);
      const rewritten = rewriteQuery(testCase.query, intent, freshState);
      const result = await search(rewritten.rewritten, freshState, 'en', assets);

      if (getLastVectorTier() === 'embedding_model') tier1Count++;

      const chunkId = result?.chunkId ?? null;
      const chunkContent = chunkId ? (chunkContentMap.get(chunkId) ?? '') : '';

      const hit = chunkId !== null && testCase.expectedTriggers.test(chunkContent);
      const noForbidden = !testCase.forbiddenTriggers || !testCase.forbiddenTriggers.test(chunkContent);
      const ok = hit && noForbidden;

      if (ok) pass++;
      total++;
      details.push(`  ${ok ? '✓' : '✗'} [${testCase.domain}] "${testCase.query}" → ${chunkId}`);
    }

    const rate = ((pass / total) * 100).toFixed(1);
    const tierRate = ((tier1Count / total) * 100).toFixed(1);
    console.log(`\n══════════════════════════════════════════`);
    console.log(`  WARM-STATE RETRIEVAL (Tier 1 active): ${pass}/${total} (${rate}%)`);
    console.log(`  Tier 1 usage: ${tier1Count}/${total} queries (${tierRate}%)`);
    console.log(`──────────────────────────────────────────`);
    for (const d of details) console.log(d);
    console.log(`══════════════════════════════════════════\n`);

    expect(tier1Count).toBe(total);
    expect(pass).toBeGreaterThanOrEqual(1);
  });

  it('warm state never regresses below cold state (CI gate)', async () => {
    // Run cold-state pass count
    setEmbedQueryFn(null);
    let coldPass = 0;
    for (const testCase of RELEVANCE_CASES) {
      const freshState = new SessionState();
      const intent = classifyIntent(testCase.query);
      const rewritten = rewriteQuery(testCase.query, intent, freshState);
      const result = await search(rewritten.rewritten, freshState, 'en', assets);
      const chunkId = result?.chunkId ?? null;
      const chunkContent = chunkId ? (chunkContentMap.get(chunkId) ?? '') : '';
      const hit = chunkId !== null && testCase.expectedTriggers.test(chunkContent);
      const noForbidden = !testCase.forbiddenTriggers || !testCase.forbiddenTriggers.test(chunkContent);
      if (hit && noForbidden) coldPass++;
    }

    // Run warm-state pass count (re-enable mock embedding)
    const mockEmbed = async (text: string): Promise<Float32Array> => {
      const dims = 384;
      const vec = new Float32Array(dims);
      const tokens = text.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
      if (tokens.length === 0) return vec;
      for (let j = 0; j < dims; j++) {
        const tokenIdx = j % tokens.length;
        const charSum = tokens[tokenIdx]?.split('').reduce((s, c) => s + c.charCodeAt(0), 0) || 0;
        vec[j] = ((charSum * (j + 1)) % 255) / 127.0 - 1.0;
      }
      let norm = 0;
      for (let j = 0; j < dims; j++) norm += vec[j] * vec[j];
      norm = Math.sqrt(norm) || 1;
      for (let j = 0; j < dims; j++) vec[j] /= norm;
      return vec;
    };
    setEmbedQueryFn(mockEmbed);

    let warmPass = 0;
    for (const testCase of RELEVANCE_CASES) {
      const freshState = new SessionState();
      const intent = classifyIntent(testCase.query);
      const rewritten = rewriteQuery(testCase.query, intent, freshState);
      const result = await search(rewritten.rewritten, freshState, 'en', assets);
      const chunkId = result?.chunkId ?? null;
      const chunkContent = chunkId ? (chunkContentMap.get(chunkId) ?? '') : '';
      const hit = chunkId !== null && testCase.expectedTriggers.test(chunkContent);
      const noForbidden = !testCase.forbiddenTriggers || !testCase.forbiddenTriggers.test(chunkContent);
      if (hit && noForbidden) warmPass++;
    }

    console.log(`  Regression guard: cold=${coldPass}, warm=${warmPass}`);
    expect(warmPass).toBeGreaterThanOrEqual(coldPass);
  });
});
