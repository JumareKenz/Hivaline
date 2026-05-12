/**
 * processMessage.integration.test.ts — Integration tests for the full intelligence pipeline
 *
 * Covers the exact failing conversation from the spec:
 * 1. "what is the National Guideline for Basic Newborn Care?" → definition chunk
 * 2. "what does it cover?" → DIFFERENT chunk covering scope/coverage aspect
 * 3. "yes, what's the specific dose?" → dosage chunk, not the definition chunk again
 */

import { describe, it, expect, beforeEach } from 'vitest';
import SessionState from '@/engine/sessionState';
import { processMessage } from '@/engine/processMessage';
import type { HIVChunk } from '@/types/hiv';

function makeChunks(): HIVChunk[] {
  return [
    {
      id: 'newborn-definition',
      type: 'protocol',
      trigger_phrases: { en: ['newborn care', 'basic newborn care'] },
      aspects: ['definition'],
      content: {
        en: {
          primary_question: 'What is the National Guideline for Basic Newborn Care?',
          answer: 'The National Guideline for Basic Newborn Care outlines essential practices.',
          definition: 'The National Guideline for Basic Newborn Care outlines essential practices for keeping newborns healthy.',
          coverage: 'It covers thermal care, breastfeeding, immunization, and danger signs.',
          dosage_rules: [
            {
              basis: 'weight',
              brackets: [
                { min_kg: 0, max_kg: 2, dose: '1 tablet' },
                { min_kg: 2, max_kg: 4, dose: '2 tablets' },
              ],
            },
          ],
        },
      },
      source: { document: 'FMOH Newborn Care' },
      checksum: 'a',
    },
    {
      id: 'newborn-coverage',
      type: 'protocol',
      trigger_phrases: { en: ['newborn coverage', 'what does newborn care cover'] },
      aspects: ['coverage'],
      content: {
        en: {
          primary_question: 'What does the newborn care guideline cover?',
          coverage: 'It covers thermal care, breastfeeding support, immunization schedules, and identification of danger signs.',
        },
      },
      source: { document: 'FMOH Newborn Care' },
      checksum: 'b',
    },
    {
      id: 'newborn-dosage',
      type: 'protocol',
      trigger_phrases: { en: ['newborn dose', 'newborn dosage'] },
      aspects: ['dosage'],
      content: {
        en: {
          primary_question: 'What is the specific dose for newborn care?',
          dosage_rules: [
            {
              basis: 'weight',
              brackets: [
                { min_kg: 0, max_kg: 2, dose: '1 tablet twice daily' },
                { min_kg: 2, max_kg: 4, dose: '2 tablets twice daily' },
              ],
            },
          ],
        },
      },
      source: { document: 'FMOH Newborn Care' },
      checksum: 'c',
    },
  ];
}

function makeAssets(chunks: HIVChunk[]) {
  return {
    bm25Index: {
      en: {
        index: {
          newborn: [
            { chunk_id: 'newborn-definition', score: 3.0 },
            { chunk_id: 'newborn-coverage', score: 2.5 },
            { chunk_id: 'newborn-dosage', score: 2.0 },
          ],
          care: [
            { chunk_id: 'newborn-definition', score: 2.0 },
            { chunk_id: 'newborn-coverage', score: 1.5 },
          ],
          cover: [
            { chunk_id: 'newborn-coverage', score: 4.0 },
            { chunk_id: 'newborn-definition', score: 1.0 },
          ],
          dose: [
            { chunk_id: 'newborn-dosage', score: 4.0 },
            { chunk_id: 'newborn-definition', score: 0.5 },
          ],
          specific: [
            { chunk_id: 'newborn-dosage', score: 3.0 },
          ],
        },
      },
    },
    chunks,
    gapGraph: {
      'newborn-definition': [
        { to: 'newborn-coverage', score: 0.8 },
        { to: 'newborn-dosage', score: 0.7 },
      ],
      'newborn-coverage': [
        { to: 'newborn-dosage', score: 0.9 },
      ],
    },
  };
}

function makeCoverageManifest() {
  return {
    'newborn care': {
      aspects_covered: ['definition', 'coverage', 'dosage'],
    },
  };
}

describe('integration: three-query conversation flow', () => {
  let sessionState: SessionState;
  let chunks: HIVChunk[];
  let assets: ReturnType<typeof makeAssets>;
  let coverageManifest: ReturnType<typeof makeCoverageManifest>;

  beforeEach(() => {
    sessionState = new SessionState();
    chunks = makeChunks();
    assets = makeAssets(chunks);
    coverageManifest = makeCoverageManifest();
  });

  it('turn 1: returns definition chunk for "what is the National Guideline for Basic Newborn Care?"', () => {
    const result = processMessage(
      'what is the National Guideline for Basic Newborn Care?',
      sessionState,
      {
        userMessage: 'what is the National Guideline for Basic Newborn Care?',
        hivAssets: assets,
        coverageManifest,
        chunks,
      }
    );

    expect(result.chunkId).toBe('newborn-definition');
    expect(result.intent).toBe('DEFINE');
    expect(result.answer).toContain('National Guideline');
    expect(result.fallback).toBe(false);
  });

  it('turn 2: returns DIFFERENT chunk covering scope/coverage aspect', () => {
    // First turn
    processMessage(
      'what is the National Guideline for Basic Newborn Care?',
      sessionState,
      { userMessage: 'what is the National Guideline for Basic Newborn Care?', hivAssets: assets, coverageManifest, chunks }
    );

    // Second turn
    const result = processMessage(
      'what does it cover?',
      sessionState,
      { userMessage: 'what does it cover?', hivAssets: assets, coverageManifest, chunks }
    );

    expect(result.chunkId).toBe('newborn-coverage');
    expect(result.chunkId).not.toBe('newborn-definition');
    expect(result.intent).toBe('SCOPE');
    expect(result.answer).toContain('thermal care');
  });

  it('turn 3: returns dosage chunk, not the definition chunk again', () => {
    // First turn
    processMessage(
      'what is the National Guideline for Basic Newborn Care?',
      sessionState,
      { userMessage: 'what is the National Guideline for Basic Newborn Care?', hivAssets: assets, coverageManifest, chunks }
    );

    // Second turn
    processMessage(
      'what does it cover?',
      sessionState,
      { userMessage: 'what does it cover?', hivAssets: assets, coverageManifest, chunks }
    );

    // Third turn
    const result = processMessage(
      "yes, what's the specific dose?",
      sessionState,
      { userMessage: "yes, what's the specific dose?", hivAssets: assets, coverageManifest, chunks }
    );

    expect(result.chunkId).toBe('newborn-dosage');
    expect(result.chunkId).not.toBe('newborn-definition');
    expect(result.intent).toBe('DETAIL');
    expect(result.answer).toContain('tablet');
  });

  it('sessionState.coveredChunks grows with each turn', () => {
    expect(sessionState.coveredChunks.size).toBe(0);

    processMessage(
      'what is the National Guideline for Basic Newborn Care?',
      sessionState,
      { userMessage: 'q1', hivAssets: assets, coverageManifest, chunks }
    );
    expect(sessionState.coveredChunks.size).toBe(1);

    processMessage('what does it cover?', sessionState, { userMessage: 'q2', hivAssets: assets, coverageManifest, chunks });
    expect(sessionState.coveredChunks.size).toBe(2);

    processMessage("yes, what's the dose?", sessionState, { userMessage: 'q3', hivAssets: assets, coverageManifest, chunks });
    expect(sessionState.coveredChunks.size).toBe(3);
  });

  it('pendingGaps correctly predicts follow-up needs', () => {
    processMessage(
      'what is the National Guideline for Basic Newborn Care?',
      sessionState,
      { userMessage: 'q1', hivAssets: assets, coverageManifest, chunks }
    );
    // After turn 1, definition is covered. Remaining gaps: dosage, coverage (ordered by priority)
    expect(sessionState.pendingGaps).toContain('dosage');

    processMessage('what does it cover?', sessionState, { userMessage: 'q2', hivAssets: assets, coverageManifest, chunks });
    // After turn 2, detectGaps runs before markAspectsCovered, so coverage is still predicted as needed
    expect(sessionState.pendingGaps).toEqual(['dosage', 'coverage']);
  });

  it('patient dose computation returns weight-specific string when patientWeightKg is set', () => {
    sessionState.slotMemory.patientWeightKg = 3;
    sessionState.slotMemory.patientWeight = '3 kg';

    const result = processMessage(
      "what's the dose?",
      sessionState,
      { userMessage: 'q1', hivAssets: assets, coverageManifest, chunks }
    );

    expect(result.answer).toContain('3kg');
    expect(result.answer).toContain('tablets');
  });

  it('fallback handler never mentions file names or internal IDs', () => {
    const result = processMessage(
      'random unknown topic xyz123',
      sessionState,
      { userMessage: 'random unknown topic xyz123', hivAssets: assets, coverageManifest, chunks }
    );

    expect(result.fallback).toBe(true);
    expect(result.answer).not.toMatch(/\.hiv/i);
    expect(result.answer).not.toMatch(/chunk/i);
    expect(result.answer).not.toMatch(/artifact/i);
  });
});
