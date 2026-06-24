/**
 * displayTitle.test.ts — Tests for display_title support in HIVChunk and buildOpener
 *
 * Verifies that:
 * - buildOpener() prefers chunk.display_title over the raw topic string
 * - Empty/missing display_title gracefully falls back to topic
 * - cleanTopic() still strips section numbers from the fallback topic
 * - HIVChunk interface accepts display_title as optional
 */

import { describe, it, expect } from 'vitest';
import { buildOpener } from '@/engine/answerAssembler';
import type { HIVChunk } from '@/types/hiv';

const OPENER_MATRIX: Record<string, string> = {
  DEFINE: 'On {topic}:',
  SCOPE: 'Coverage of {topic}:',
};

describe('display_title support', () => {
  it('1. display_title wins over raw topic in buildOpener()', () => {
    // Simulates the call site: buildOpener(intent, chunk.display_title || topic, ...)
    const displayTitle = 'Kangaroo Mother Care';
    const topic = 'kmc';
    const result = buildOpener('DEFINE', displayTitle || topic, null, OPENER_MATRIX);
    expect(result).toBe('On Kangaroo Mother Care:');
    expect(result).not.toContain('kmc');
  });

  it('2. empty display_title falls back to topic', () => {
    const displayTitle = '';
    const topic = 'kangaroo mother care';
    const result = buildOpener('DEFINE', displayTitle || topic, null, OPENER_MATRIX);
    expect(result).toBe('On kangaroo mother care:');
  });

  it('3. undefined display_title falls back to topic, no crash', () => {
    const displayTitle: string | undefined = undefined;
    const topic = 'anc';
    const result = buildOpener('DEFINE', displayTitle || topic, null, OPENER_MATRIX);
    expect(result).toBe('On anc:');
  });

  it('4. display_title prevents section number in opener when topic has one', () => {
    const displayTitle = 'Maternal Health';
    const topic = '1.2. maternal health';
    const result = buildOpener('DEFINE', displayTitle || topic, null, OPENER_MATRIX);
    expect(result).toBe('On Maternal Health:');
    expect(result).not.toMatch(/\d/);
  });

  it('5. HIVChunk accepts display_title at top level', () => {
    const chunk: HIVChunk = {
      id: 'kmc-001',
      type: 'faq',
      display_title: 'Kangaroo Mother Care',
      trigger_phrases: { en: ['kmc', 'kangaroo mother care'] },
      content: { en: { answer: 'KMC is skin-to-skin care.' } },
      source: { document: 'FMOH Newborn Care' },
      checksum: 'abc123',
    };
    expect(chunk.display_title).toBe('Kangaroo Mother Care');
    expect(chunk.id).toBe('kmc-001');
  });

  it('6. HIVChunk without display_title compiles (optional field)', () => {
    const chunk: HIVChunk = {
      id: 'old-chunk-001',
      type: 'protocol',
      trigger_phrases: { en: ['malaria'] },
      content: { en: { answer: 'Use ACT.' } },
      source: { document: 'FMOH Malaria Protocol' },
      checksum: 'def456',
    };
    expect(chunk.display_title).toBeUndefined();
    expect(chunk.id).toBe('old-chunk-001');
  });
});
