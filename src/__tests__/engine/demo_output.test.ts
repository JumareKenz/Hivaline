/**
 * demo_output.test.ts — Shows actual output with all Phase A features
 * Prints real answers to demonstrate the quality improvement.
 */

import { describe, it, expect } from 'vitest';
import SessionState from '@/engine/sessionState';
import { processMessage } from '@/engine/processMessage';
import type { HIVChunk } from '@/types/hiv';

function makeChunks(): HIVChunk[] {
  return [
    {
      id: 'malaria-treatment',
      type: 'drug_table',
      display_title: 'Uncomplicated Malaria Treatment',
      trigger_phrases: { en: ['malaria treatment', 'ACT', 'coartem'] },
      aspects: ['treatment', 'dosage'],
      content: { en: {
        answer: 'Give Artemether-Lumefantrine (Coartem) for 3 days. First dose under observation. Second dose 8 hours later, then twice daily for 2 more days. Always give with food or milk.',
        dosage_rules: [
          { basis: 'weight', brackets: [
            { min_kg: 5, max_kg: 15, dose: '1 tablet (20/120mg) twice daily for 3 days' },
            { min_kg: 15, max_kg: 25, dose: '2 tablets twice daily for 3 days' },
            { min_kg: 25, max_kg: 35, dose: '3 tablets twice daily for 3 days' },
          ]},
        ],
        topics: ['malaria'],
      }},
      source: { document: 'FMOH Malaria Guidelines 2024' },
      checksum: 'x1',
    },
    {
      id: 'pneumonia-child',
      type: 'protocol',
      display_title: 'Childhood Pneumonia',
      trigger_phrases: { en: ['pneumonia', 'fast breathing', 'cough child', 'chest indrawing'] },
      aspects: ['diagnosis', 'treatment'],
      content: { en: {
        answer: 'Count respiratory rate for 1 full minute. PNEUMONIA (fast breathing only): Give Amoxicillin 40mg/kg/dose twice daily for 5 days. SEVERE PNEUMONIA (chest indrawing): First dose Amoxicillin + REFER. VERY SEVERE (cyanosis, unable to drink, convulsions): REFER URGENTLY.',
        dosage_rules: [
          { basis: 'weight', brackets: [
            { min_kg: 4, max_kg: 10, dose: 'Amoxicillin 250mg twice daily for 5 days' },
            { min_kg: 10, max_kg: 20, dose: 'Amoxicillin 500mg twice daily for 5 days' },
          ]},
        ],
        topics: ['pneumonia'],
      }},
      source: { document: 'IMNCI Chart Booklet 2024' },
      checksum: 'x2',
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
    for (const p of (chunk.trigger_phrases?.en || [])) { const v = new Array(dims).fill(0); v[i] = 1; proxyMap[p] = v; }
  });
  const bm25Index: Record<string, Array<{ chunk_id: string; score: number }>> = {};
  for (const chunk of chunks) {
    const text = [...(chunk.trigger_phrases?.en || []), (chunk.content?.en as any)?.answer || ''].join(' ');
    const tokens = text.toLowerCase().split(/\s+/).map(t => t.replace(/[^\w]/g, '')).filter(t => t.length >= 3);
    const seen = new Set<string>();
    for (const t of tokens) { if (!seen.has(t)) { seen.add(t); if (!bm25Index[t]) bm25Index[t] = []; bm25Index[t].push({ chunk_id: chunk.id, score: 3 }); } }
  }
  return { embeddingsBuffer: buffer, embeddingsIndex: { dimensions: dims, total_chunks: total, chunk_ids: chunks.map(c => c.id) }, queryProxies: proxyMap, chunks, gapGraph: {}, bm25Index: { en: { index: bm25Index } } };
}

describe('DEMO: What answers look like now', () => {
  it('Scenario 1: "my patient is 8kg with malaria, how do I treat?"', async () => {
    const state = new SessionState();
    state.slotMemory.patientWeightKg = 8;
    const chunks = makeChunks();
    const r = await processMessage('my patient is 8kg with malaria how do I treat', state, {
      userMessage: 'my patient is 8kg with malaria how do I treat',
      hivAssets: makeAssets(chunks), coverageManifest: {}, chunks,
    });

    console.log('\n━━━ SCENARIO 1: 8kg child with malaria ━━━');
    console.log(r.answer);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    expect(r.answer).toContain('Artemether');
    expect(r.answer).toContain('8kg');
    expect(r.answer).toContain('1 tablet');
    expect(r.answer).toContain('📋 Source:');
  });

  it('Scenario 2: "child with pneumonia and convulsions unable to drink"', async () => {
    const state = new SessionState();
    state.slotMemory.patientWeightKg = 7;
    const chunks = makeChunks();
    const r = await processMessage('child with pneumonia and convulsions unable to drink', state, {
      userMessage: 'child with pneumonia and convulsions unable to drink',
      hivAssets: makeAssets(chunks), coverageManifest: {}, chunks,
    });

    console.log('\n━━━ SCENARIO 2: child + pneumonia + convulsions + unable to drink ━━━');
    console.log(r.answer);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    expect(r.answer).toContain('⚠️');
    expect(r.answer).toContain('📋 Source:');
  });

  it('Scenario 3: routine query — "malaria treatment" (no weight, no danger)', async () => {
    const state = new SessionState();
    const chunks = makeChunks();
    const r = await processMessage('malaria treatment', state, {
      userMessage: 'malaria treatment',
      hivAssets: makeAssets(chunks), coverageManifest: {}, chunks,
    });

    console.log('\n━━━ SCENARIO 3: Routine malaria query (no weight, no danger) ━━━');
    console.log(r.answer);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    expect(r.answer).toContain('Artemether');
    expect(r.answer).toContain('📋 Source:');
    expect(r.answer).not.toContain('⚠️');
    expect(r.answer).not.toContain('For your');
  });
});
