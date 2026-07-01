/**
 * generationRouter.test.ts — Tests for generation routing logic
 */

import { describe, it, expect } from 'vitest';
import { shouldInvokeGeneration } from '@/engine/generationRouter';
import type { HIVChunk } from '@/types/hiv';
import SessionState from '@/engine/sessionState';

describe('shouldInvokeGeneration', () => {
  const sessionState = new SessionState();

  it('skips generation when complete structured answer exists', () => {
    const chunk: HIVChunk = {
      id: 'test-1',
      content: {
        en: {
          answer: 'This is a complete answer with multiple sentences. It provides comprehensive information about the topic and does not require generation to improve clarity.',
        },
      },
    } as HIVChunk;

    const decision = shouldInvokeGeneration(chunk, 'DEFINE', sessionState.slotMemory, chunk.content.en.answer as string);

    expect(decision.shouldGenerate).toBe(false);
    expect(decision.reason).toContain('Complete structured answer');
  });

  it('invokes generation when answer is fragmented bullet list', () => {
    const chunk: HIVChunk = {
      id: 'test-2',
      display_title: 'Test Topic',
      content: {
        en: {
          answer: '• Point one here\n• Point two here\n• Point three here\n• Point four here',
        },
      },
    } as HIVChunk;

    const decision = shouldInvokeGeneration(chunk, 'DEFINE', sessionState.slotMemory, chunk.content.en.answer as string);

    expect(decision.shouldGenerate).toBe(true);
    expect(decision.reason).toContain('fragmented bullet list');
    expect(decision.evidence).toBeTruthy();
    expect(decision.evidence).toContain('Test Topic');
  });

  it('skips generation when dosage rules exist with complete slot memory', () => {
    const chunk: HIVChunk = {
      id: 'test-3',
      content: {
        en: {
          dosage_rules: [
            {
              basis: 'weight',
              brackets: [{ min_kg: 10, max_kg: 20, dose: '100mg' }],
            },
          ],
        },
      },
    } as HIVChunk;

    const slotMemoryWithWeight = { ...sessionState.slotMemory, patientWeightKg: 15 };

    const decision = shouldInvokeGeneration(chunk, 'DETAIL', slotMemoryWithWeight, null);

    expect(decision.shouldGenerate).toBe(false);
    expect(decision.reason).toContain('Dosage rules with complete slot memory');
  });

  it('invokes generation when dosage rules exist but slot memory is incomplete', () => {
    const chunk: HIVChunk = {
      id: 'test-4',
      display_title: 'Drug Dosing',
      content: {
        en: {
          dosage_rules: [
            {
              basis: 'weight',
              brackets: [{ min_kg: 10, max_kg: 20, dose: '100mg' }],
            },
          ],
        },
      },
    } as HIVChunk;

    const decision = shouldInvokeGeneration(chunk, 'DETAIL', sessionState.slotMemory, null);

    expect(decision.shouldGenerate).toBe(true);
    expect(decision.reason).toContain('No complete structured answer');
  });

  it('skips generation when complete procedure field exists', () => {
    const chunk: HIVChunk = {
      id: 'test-5',
      content: {
        en: {
          procedure: 'Step 1: Do this. Step 2: Do that. Step 3: Complete the procedure. This is a comprehensive procedure with clear instructions.',
        },
      },
    } as HIVChunk;

    const decision = shouldInvokeGeneration(chunk, 'PROCEDURE', sessionState.slotMemory, null);

    expect(decision.shouldGenerate).toBe(false);
    expect(decision.reason).toContain('Complete procedure field');
  });

  it('skips generation when complete definition field exists', () => {
    const chunk: HIVChunk = {
      id: 'test-6',
      content: {
        en: {
          definition: 'This is a comprehensive definition that explains the concept clearly and does not require generation.',
        },
      },
    } as HIVChunk;

    const decision = shouldInvokeGeneration(chunk, 'DEFINE', sessionState.slotMemory, null);

    expect(decision.shouldGenerate).toBe(false);
    expect(decision.reason).toContain('Complete definition field');
  });

  it('invokes generation when no complete answer exists', () => {
    const chunk: HIVChunk = {
      id: 'test-7',
      display_title: 'Incomplete Topic',
      content: {
        en: {
          answer: 'Short',
        },
      },
    } as HIVChunk;

    const decision = shouldInvokeGeneration(chunk, 'DEFINE', sessionState.slotMemory, 'Short');

    expect(decision.shouldGenerate).toBe(true);
    expect(decision.reason).toContain('No complete structured answer');
  });

  it('builds evidence string with title, answer, and source', () => {
    const chunk: HIVChunk = {
      id: 'test-8',
      display_title: 'Test Drug',
      content: {
        en: {
          answer: 'This is the answer content.',
          definition: 'This is the definition.',
        },
      },
      source: { document: 'Guidelines 2024' },
    } as HIVChunk;

    const decision = shouldInvokeGeneration(chunk, 'DEFINE', sessionState.slotMemory, null);

    expect(decision.shouldGenerate).toBe(true);
    expect(decision.evidence).toContain('Test Drug');
    expect(decision.evidence).toContain('Definition:');
    expect(decision.evidence).toContain('This is the definition');
    expect(decision.evidence).toContain('Source: Guidelines 2024');
  });
});
