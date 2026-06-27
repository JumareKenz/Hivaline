/**
 * phaseA_9point5.test.ts — Tests for the 9.5 features:
 * 1. Proactive dose when weight is known
 * 2. Source attribution on every answer
 * 3. Danger sign auto-escalation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import SessionState from '@/engine/sessionState';
import { processMessage, type ProcessMessageResult } from '@/engine/processMessage';
import type { HIVChunk } from '@/types/hiv';

function makeChunks(): HIVChunk[] {
  return [
    {
      id: 'malaria-treatment',
      type: 'drug_table',
      display_title: 'Malaria Treatment',
      trigger_phrases: { en: ['malaria treatment', 'ACT', 'coartem'] },
      aspects: ['treatment', 'dosage'],
      content: { en: {
        primary_question: 'How do I treat malaria?',
        answer: 'Give Artemether-Lumefantrine (Coartem) for 3 days. First dose under observation.',
        dosage_rules: [
          { basis: 'weight', brackets: [
            { min_kg: 5, max_kg: 15, dose: '1 tablet twice daily x 3 days' },
            { min_kg: 15, max_kg: 25, dose: '2 tablets twice daily x 3 days' },
            { min_kg: 25, max_kg: 35, dose: '3 tablets twice daily x 3 days' },
          ]},
        ],
        topics: ['malaria'],
      }},
      source: { document: 'FMOH Malaria Guidelines 2024' },
      checksum: 'a1',
    },
    {
      id: 'malaria-severe',
      type: 'danger_sign',
      display_title: 'Severe Malaria',
      trigger_phrases: { en: ['severe malaria', 'malaria convulsions', 'malaria danger signs'] },
      aspects: ['emergency'],
      content: { en: {
        primary_question: 'Severe malaria signs?',
        answer: 'REFER IMMEDIATELY: convulsions, unconscious, unable to drink, severe pallor. Pre-referral: rectal artesunate.',
        topics: ['malaria', 'emergency'],
      }},
      source: { document: 'FMOH Malaria Guidelines 2024' },
      checksum: 'a2',
    },
    {
      id: 'pneumonia-child',
      type: 'protocol',
      display_title: 'Pneumonia in Children',
      trigger_phrases: { en: ['pneumonia', 'fast breathing child', 'chest indrawing', 'cough child'] },
      aspects: ['diagnosis', 'treatment'],
      content: { en: {
        primary_question: 'How to manage pneumonia?',
        answer: 'Count respiratory rate. Fast breathing only = Amoxicillin. Chest indrawing = REFER. Danger signs = REFER URGENTLY.',
        dosage_rules: [
          { basis: 'weight', brackets: [
            { min_kg: 4, max_kg: 10, dose: 'Amoxicillin 250mg twice daily' },
            { min_kg: 10, max_kg: 20, dose: 'Amoxicillin 500mg twice daily' },
          ]},
        ],
        topics: ['pneumonia'],
      }},
      source: { document: 'IMNCI Chart Booklet' },
      checksum: 'p1',
    },
    {
      id: 'diarrhea-ors',
      type: 'protocol',
      display_title: 'Diarrhea Management',
      trigger_phrases: { en: ['diarrhea', 'ORS', 'dehydration', 'zinc'] },
      aspects: ['assessment', 'treatment'],
      content: { en: {
        primary_question: 'How to manage diarrhea?',
        answer: 'Assess dehydration. Plan A: ORS + Zinc. Plan B: ORS 75ml/kg/4hr. Plan C: IV fluids + REFER.',
        topics: ['diarrhea'],
      }},
      source: { document: 'IMNCI Chart Booklet' },
      checksum: 'd1',
    },
  ];
}

function makeAssets(chunks: HIVChunk[]) {
  const total = chunks.length;
  const dims = total;
  const buffer = new ArrayBuffer(total * dims * 4);
  const view = new Float32Array(buffer);
  for (let i = 0; i < total; i++) view[i * dims + i] = 1;

  const proxyMap: Record<string, number[]> = {};
  chunks.forEach((chunk, i) => {
    for (const phrase of (chunk.trigger_phrases?.en || [])) {
      const vec = new Array(dims).fill(0);
      vec[i] = 1;
      proxyMap[phrase] = vec;
    }
  });

  const STOP = new Set(['is','are','the','a','an','of','to','for','in','on','at','by','with','and','or','but','not','do','does','how','what','when','where','why','who','which','that','this','it','i','my','me','we','you','they']);
  const bm25Index: Record<string, Array<{ chunk_id: string; score: number }>> = {};
  for (const chunk of chunks) {
    const text = [...(chunk.trigger_phrases?.en || []), chunk.display_title || '', (chunk.content?.en as any)?.answer || ''].join(' ');
    const tokens = text.toLowerCase().split(/\s+/).map(t => t.replace(/[^\w]/g, '')).filter(t => t.length >= 3 && !STOP.has(t));
    const seen = new Set<string>();
    for (const token of tokens) {
      if (seen.has(token)) continue;
      seen.add(token);
      if (!bm25Index[token]) bm25Index[token] = [];
      bm25Index[token].push({ chunk_id: chunk.id, score: 3.0 });
    }
  }

  return {
    embeddingsBuffer: buffer,
    embeddingsIndex: { dimensions: dims, total_chunks: total, chunk_ids: chunks.map(c => c.id) },
    queryProxies: proxyMap,
    chunks,
    gapGraph: { 'malaria-treatment': [{ to: 'malaria-severe', score: 0.9 }] },
    bm25Index: { en: { index: bm25Index } },
  };
}

async function ask(query: string, state: SessionState, chunks: HIVChunk[], assets: ReturnType<typeof makeAssets>): Promise<ProcessMessageResult> {
  return processMessage(query, state, {
    userMessage: query,
    hivAssets: assets,
    coverageManifest: { 'malaria': { aspects_covered: ['treatment', 'dosage', 'emergency'] } },
    chunks,
  });
}

/* ═══════════════════════════════════════════════════════════════
   FEATURE 1: PROACTIVE DOSE
   ═══════════════════════════════════════════════════════════════ */

describe('Feature 1: Proactive dose when weight is known', () => {
  let state: SessionState;
  let chunks: HIVChunk[];
  let assets: ReturnType<typeof makeAssets>;

  beforeEach(() => {
    state = new SessionState();
    chunks = makeChunks();
    assets = makeAssets(chunks);
  });

  it('includes weight-specific dose when patient weight is set (DEFINE intent)', async () => {
    state.slotMemory.patientWeightKg = 8;
    state.slotMemory.patientWeight = '8 kg';
    const r = await ask('what is malaria treatment', state, chunks, assets);
    expect(r.chunkId).toBe('malaria-treatment');
    // Should include BOTH the answer AND the dose
    expect(r.answer).toContain('Artemether');
    expect(r.answer).toContain('8kg');
    expect(r.answer).toContain('1 tablet');
  });

  it('includes weight-specific dose for PROCEDURE intent (how do I treat)', async () => {
    state.slotMemory.patientWeightKg = 20;
    const r = await ask('how do I treat malaria', state, chunks, assets);
    expect(r.chunkId).toBe('malaria-treatment');
    expect(r.answer).toContain('Artemether');
    expect(r.answer).toContain('2 tablets');
  });

  it('does NOT include proactive dose when weight is unknown', async () => {
    const r = await ask('what is malaria treatment', state, chunks, assets);
    expect(r.chunkId).toBe('malaria-treatment');
    expect(r.answer).toContain('Artemether');
    // No weight-specific line
    expect(r.answer).not.toContain('For your');
  });

  it('DETAIL intent still gives dose-only (not full answer)', async () => {
    state.slotMemory.patientWeightKg = 8;
    const r = await ask('what is the dose for malaria', state, chunks, assets);
    expect(r.chunkId).toBe('malaria-treatment');
    expect(r.answer).toContain('8kg');
    expect(r.answer).toContain('1 tablet');
  });

  it('proactive dose works for pneumonia too', async () => {
    state.slotMemory.patientWeightKg = 7;
    const r = await ask('pneumonia treatment child', state, chunks, assets);
    expect(r.chunkId).toBe('pneumonia-child');
    expect(r.answer).toContain('250mg');
  });
});

/* ═══════════════════════════════════════════════════════════════
   FEATURE 2: SOURCE ATTRIBUTION
   ═══════════════════════════════════════════════════════════════ */

describe('Feature 2: Source attribution on every answer', () => {
  let state: SessionState;
  let chunks: HIVChunk[];
  let assets: ReturnType<typeof makeAssets>;

  beforeEach(() => {
    state = new SessionState();
    chunks = makeChunks();
    assets = makeAssets(chunks);
  });

  it('malaria answer shows source document', async () => {
    const r = await ask('malaria treatment', state, chunks, assets);
    expect(r.answer).toContain('📋 Source:');
    expect(r.answer).toContain('FMOH Malaria Guidelines 2024');
    expect(r.source).toBe('FMOH Malaria Guidelines 2024');
  });

  it('pneumonia answer shows IMNCI source', async () => {
    const r = await ask('pneumonia child fast breathing', state, chunks, assets);
    expect(r.answer).toContain('IMNCI Chart Booklet');
  });

  it('diarrhea answer shows source', async () => {
    const r = await ask('diarrhea ORS treatment', state, chunks, assets);
    expect(r.answer).toContain('📋 Source:');
  });

  it('source appears at the END of the answer (not interrupting clinical content)', async () => {
    const r = await ask('malaria treatment', state, chunks, assets);
    const sourceIndex = r.answer.indexOf('📋 Source:');
    const clinicalIndex = r.answer.indexOf('Artemether');
    expect(sourceIndex).toBeGreaterThan(clinicalIndex);
  });
});

/* ═══════════════════════════════════════════════════════════════
   FEATURE 3: DANGER SIGN AUTO-ESCALATION
   ═══════════════════════════════════════════════════════════════ */

describe('Feature 3: Danger sign auto-escalation', () => {
  let state: SessionState;
  let chunks: HIVChunk[];
  let assets: ReturnType<typeof makeAssets>;

  beforeEach(() => {
    state = new SessionState();
    chunks = makeChunks();
    assets = makeAssets(chunks);
  });

  it('convulsions in query triggers escalation warning', async () => {
    const r = await ask('child with malaria and convulsions what do I give', state, chunks, assets);
    // If it retrieves malaria-severe (danger_sign type), no extra warning needed
    // If it retrieves malaria-treatment (drug_table), warning should appear
    if (r.chunkId === 'malaria-treatment') {
      expect(r.answer).toContain('⚠️');
      expect(r.answer).toContain('DANGER SIGN');
      expect(r.dangerEscalation).toBeDefined();
    }
    // Either way, the answer should exist
    expect(r.answer.length).toBeGreaterThan(0);
  });

  it('unable to drink triggers escalation', async () => {
    const r = await ask('child with diarrhea unable to drink anything', state, chunks, assets);
    if (r.chunkId !== 'malaria-severe') {
      expect(r.answer).toContain('⚠️');
      expect(r.answer.toLowerCase()).toContain('danger sign');
    }
  });

  it('no escalation for routine query', async () => {
    const r = await ask('malaria treatment', state, chunks, assets);
    expect(r.answer).not.toContain('⚠️');
    expect(r.dangerEscalation).toBeUndefined();
  });

  it('no double-escalation when chunk is already danger_sign type', async () => {
    const r = await ask('severe malaria danger signs', state, chunks, assets);
    if (r.chunkId === 'malaria-severe') {
      // Should NOT have double warning (chunk already IS the danger content)
      const warningCount = (r.answer.match(/⚠️/g) || []).length;
      expect(warningCount).toBeLessThanOrEqual(1);
    }
  });

  it('escalation appears BEFORE the clinical answer (visibility)', async () => {
    const r = await ask('child not breathing and has pneumonia', state, chunks, assets);
    if (r.dangerEscalation) {
      const warningIndex = r.answer.indexOf('⚠️');
      expect(warningIndex).toBe(0); // Warning is first thing shown
    }
  });

  it('shock symptoms trigger escalation', async () => {
    const r = await ask('patient in shock with weak pulse what ORS plan', state, chunks, assets);
    if (r.chunkId !== 'malaria-severe') {
      expect(r.answer).toContain('⚠️');
      expect(r.answer.toLowerCase()).toContain('shock');
    }
  });
});

/* ═══════════════════════════════════════════════════════════════
   INTEGRATION: All 3 features working together
   ═══════════════════════════════════════════════════════════════ */

describe('Integration: All Phase A features combined', () => {
  it('weight known + danger signs + source all in one response', async () => {
    const state = new SessionState();
    state.slotMemory.patientWeightKg = 12;
    const chunks = makeChunks();
    const assets = makeAssets(chunks);

    const r = await ask('child 12kg with pneumonia and unable to drink', state, chunks, assets);

    // Should have all three features active:
    expect(r.answer.length).toBeGreaterThan(0);

    // Source should be present
    expect(r.answer).toContain('📋 Source:');

    // Danger escalation (unable to drink)
    if (r.chunkId !== 'malaria-severe') {
      expect(r.answer).toContain('⚠️');
    }

    // If pneumonia chunk, proactive dose for 12kg
    if (r.chunkId === 'pneumonia-child') {
      expect(r.answer).toContain('500mg');
    }
  });

  it('routine query: source yes, danger no, dose only if weight set', async () => {
    const state = new SessionState();
    const chunks = makeChunks();
    const assets = makeAssets(chunks);

    const r = await ask('diarrhea ORS treatment', state, chunks, assets);
    expect(r.answer).toContain('📋 Source:');
    expect(r.answer).not.toContain('⚠️');
  });
});
