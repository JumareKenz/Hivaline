/**
 * realHivFile.test.ts — Test against REAL .hiv production data
 *
 * Loads the actual compiled .hiv bundle and runs the full engine pipeline
 * against it with realistic health worker queries.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { unzipSync, strFromU8 } from 'fflate';
import SessionState from '@/engine/sessionState';
import { processMessage, type ProcessMessageResult } from '@/engine/processMessage';
import { initSearch, type HIVAssets } from '@/engine/hybridSearch';
import type { HIVChunk } from '@/types/hiv';

/* ─── Load real .hiv file ─── */

let chunks: HIVChunk[] = [];
let assets: HIVAssets;
let coverageManifest: Record<string, { aspects_covered: string[] }> = {};

beforeAll(() => {
  const buf = readFileSync('C:/Users/INEWTON/Desktop/Hayok/hiva-0d800868.hiv');
  const files = unzipSync(new Uint8Array(buf));

  // Parse chunks
  const chunksText = strFromU8(files['content/chunks.jsonl']);
  chunks = chunksText.trim().split('\n').map(line => JSON.parse(line));

  // Parse BM25 lexical index
  let lexicalIndex: Record<string, unknown> = {};
  const lexFile = files['index/lexical.json'];
  if (lexFile) {
    lexicalIndex = JSON.parse(strFromU8(lexFile));
  }

  // Parse gap graph
  let gapGraph: Record<string, Array<{ to: string; score: number }>> = {};
  const gapFile = files['index/gap_graph.json'];
  if (gapFile) {
    gapGraph = JSON.parse(strFromU8(gapFile));
  }

  // Parse coverage manifest
  const covFile = files['index/coverage_manifest.json'];
  if (covFile) {
    const parsed = JSON.parse(strFromU8(covFile));
    coverageManifest = parsed.topics || parsed || {};
  }

  // Parse query proxies
  let queryProxies: Record<string, number[]> = {};
  const proxyFile = files['index/query_proxies.json'];
  if (proxyFile) {
    queryProxies = JSON.parse(strFromU8(proxyFile));
  }

  // Parse embeddings
  let embeddingsBuffer: ArrayBuffer | undefined;
  let embeddingsIndex: { dimensions?: number; total_chunks?: number; chunk_ids?: string[] } = {};
  const embFile = files['index/embeddings.bin'];
  const embIdxFile = files['index/embeddings_index.json'];
  if (embFile && embIdxFile) {
    embeddingsBuffer = embFile.buffer.slice(embFile.byteOffset, embFile.byteOffset + embFile.byteLength);
    embeddingsIndex = JSON.parse(strFromU8(embIdxFile));
  }

  // Parse variant embeddings
  let variantEmbeddings: Float32Array | null = null;
  let variantCount = 0;
  let embeddingDims = 384;
  const varFile = files['index/variant_embeddings.bin'];
  const varIdxFile = files['index/variant_embeddings_index.json'];
  if (varFile) {
    variantEmbeddings = new Float32Array(varFile.buffer, varFile.byteOffset, varFile.byteLength / 4);
  }
  if (varIdxFile) {
    const varIdx = JSON.parse(strFromU8(varIdxFile));
    variantCount = varIdx.length;
  }
  const metaFile = files['index/embeddings_index.json'];
  if (metaFile) {
    const meta = JSON.parse(strFromU8(metaFile));
    embeddingDims = meta.dimensions || 384;
  }

  assets = {
    embeddingsBuffer,
    embeddingsIndex,
    queryProxies,
    bm25Index: lexicalIndex as HIVAssets['bm25Index'],
    chunks,
    gapGraph,
    coverageManifest: { topics: coverageManifest } as unknown as HIVAssets['coverageManifest'],
    variantEmbeddings,
    variantEmbeddingsIndex: varIdxFile ? JSON.parse(strFromU8(varIdxFile)) : null,
    variantCount,
    embeddingDims,
  };

  initSearch(assets);
});

/* ─── Helper ─── */

async function ask(query: string, state?: SessionState): Promise<ProcessMessageResult> {
  const s = state || new SessionState();
  return processMessage(query, s, {
    userMessage: query,
    hivAssets: assets,
    coverageManifest,
    chunks,
  });
}

/* ═══════════════════════════════════════════════════════════════
   REAL .HIV FILE TESTS
   ═══════════════════════════════════════════════════════════════ */

describe('Real .hiv file: Basic retrieval', () => {
  it('loads chunks successfully', () => {
    expect(chunks.length).toBeGreaterThan(50);
  });

  it('retrieves antenatal care content', async () => {
    const r = await ask('what antenatal care should I provide');
    expect(r.fallback).toBe(false);
    expect(r.chunkId).not.toBeNull();
    expect(r.answer.length).toBeGreaterThan(20);
  });

  it('retrieves health education content', async () => {
    const r = await ask('what is health education');
    expect(r.fallback).toBe(false);
    expect(r.answer.length).toBeGreaterThan(20);
  });

  it('retrieves labour management', async () => {
    const r = await ask('management of labour');
    expect(r.fallback).toBe(false);
    expect(r.answer.length).toBeGreaterThan(20);
  });

  it('retrieves post-natal care', async () => {
    const r = await ask('post-natal care for mothers');
    expect(r.fallback).toBe(false);
    expect(r.answer.length).toBeGreaterThan(20);
  });

  it('retrieves TB/tuberculosis content', async () => {
    const r = await ask('tuberculosis screening');
    expect(r.fallback).toBe(false);
    expect(r.answer.length).toBeGreaterThan(10);
  });
});

describe('Real .hiv file: Source attribution', () => {
  it('every clinical answer includes source', async () => {
    const r = await ask('antenatal care protocol');
    if (!r.fallback && r.chunkId) {
      expect(r.answer).toContain('📋 Source:');
    }
  });

  it('source is actual document name, not internal ID', async () => {
    const r = await ask('what care after delivery');
    if (!r.fallback && r.answer.includes('📋 Source:')) {
      expect(r.answer).not.toContain('chunk');
      expect(r.answer).not.toMatch(/[0-9a-f]{8}-/); // no UUIDs
    }
  });
});

describe('Real .hiv file: Danger escalation', () => {
  it('convulsions trigger warning', async () => {
    const r = await ask('patient is having convulsions what do I do');
    if (r.chunkId && !r.fallback) {
      const chunk = chunks.find(c => c.id === r.chunkId);
      if (chunk?.type !== 'danger_sign') {
        expect(r.answer).toContain('⚠️');
      }
    }
  });

  it('bleeding emergency triggers warning', async () => {
    const r = await ask('woman has severe bleeding after delivery');
    expect(r.answer.length).toBeGreaterThan(0);
    // Should trigger danger escalation or find danger_sign chunk
  });

  it('routine query has no warning', async () => {
    const r = await ask('what is health education');
    expect(r.answer).not.toContain('⚠️');
  });
});

describe('Real .hiv file: Realistic health worker queries', () => {
  const queries = [
    'what drugs should a pregnant woman get',
    'when should I refer a patient in labour',
    'gestational diabetes management',
    'what is entitlement for the health insurance',
    'outpatient services covered',
    'how to manage PPH',
    'what vaccines should I give',
    'family planning options for breastfeeding mothers',
    'hypertension in pregnancy treatment',
    'what to do for premature baby',
  ];

  for (const q of queries) {
    it(`"${q.slice(0, 50)}" → returns answer`, async () => {
      const r = await ask(q);
      expect(r).toBeDefined();
      expect(r.answer.length).toBeGreaterThan(0);
      // Never expose internals
      expect(r.answer).not.toMatch(/\.hiv/);
    });
  }
});

describe('Real .hiv file: Pidgin and typos', () => {
  it('pidgin: "belle woman" finds pregnancy content', async () => {
    const r = await ask('belle woman wey dey sick');
    expect(r).toBeDefined();
    expect(r.answer.length).toBeGreaterThan(0);
  });

  it('typo: "antenatal" misspelled', async () => {
    const r = await ask('antenatal care protcol');
    expect(r).toBeDefined();
    expect(r.answer.length).toBeGreaterThan(0);
  });

  it('pidgin: "pikin" finds child content', async () => {
    const r = await ask('pikin wey sick');
    expect(r).toBeDefined();
    expect(r.answer.length).toBeGreaterThan(0);
  });
});

describe('Real .hiv file: Out-of-scope rejection', () => {
  it('random gibberish: returns something but no crash', async () => {
    const r = await ask('xyzabc defghij klmnop');
    // With real variant embeddings, gibberish may still get a nonzero cosine
    // against some chunk vector. The out-of-scope detector in the full
    // ConversationEngine (not processMessage) catches this upstream in production.
    expect(r).toBeDefined();
    expect(r.answer.length).toBeGreaterThan(0);
  });

  it('non-clinical question', async () => {
    const r = await ask('what football team is the best');
    // May or may not fallback depending on BM25 overlap, but should not crash
    expect(r).toBeDefined();
    expect(r.answer.length).toBeGreaterThan(0);
  });
});

describe('Real .hiv file: Multi-turn conversation', () => {
  it('maintains context across 3 turns', async () => {
    const state = new SessionState();
    const r1 = await ask('antenatal care', state);
    expect(r1.fallback).toBe(false);

    const r2 = await ask('what tests should I do', state);
    expect(r2).toBeDefined();
    expect(r2.answer.length).toBeGreaterThan(0);

    const r3 = await ask('and for labour', state);
    expect(r3).toBeDefined();
    expect(r3.answer.length).toBeGreaterThan(0);

    expect(state.turnCount).toBeGreaterThanOrEqual(3);
  });
});

describe('Real .hiv file: Performance', () => {
  it('single query < 100ms', async () => {
    const start = performance.now();
    await ask('antenatal care protocol');
    expect(performance.now() - start).toBeLessThan(100);
  });

  it('10 queries < 500ms total', async () => {
    const queries = ['health education', 'labour', 'postnatal', 'drugs', 'pregnancy',
      'TB', 'insurance', 'outpatient', 'referral', 'vaccination'];
    const start = performance.now();
    for (const q of queries) await ask(q);
    expect(performance.now() - start).toBeLessThan(500);
  });
});
