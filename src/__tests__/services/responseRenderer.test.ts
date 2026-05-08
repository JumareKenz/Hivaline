/**
 * responseRenderer.test.ts — Conversational response rendering
 */

import { describe, it, expect } from 'vitest';
import { renderChunk, getChunkPreview, buildGreeting, buildNoResultMessage } from '@/services/responseRenderer';
import type { HIVChunk } from '@/types/hiv';

describe('renderChunk', () => {
  it('renders faq chunk', () => {
    const chunk: HIVChunk = {
      id: 'faq-1',
      type: 'faq',
      trigger_phrases: {},
      content: {
        en: {
          question: 'How do I treat malaria?',
          answer: 'Give ACT immediately.',
          details: 'Complete 3-day course.',
        },
      },
      source: { document: 'WHO 2024' },
      checksum: '',
    };
    const rendered = renderChunk(chunk, 'en');
    expect(rendered.type).toBe('faq');
    expect(rendered.content).toContain('How do I treat malaria?');
    expect(rendered.content).toContain('Give ACT immediately.');
    expect(rendered.source?.document).toBe('WHO 2024');
  });

  it('renders drug_table chunk', () => {
    const chunk: HIVChunk = {
      id: 'drug-1',
      type: 'drug_table',
      trigger_phrases: {},
      content: {
        en: {
          drug_name: 'Artemether-Lumefantrine',
          rows: [
            { weight_range: '5-14 kg', dose: '1 tablet', route: 'Oral', frequency: 'Twice daily', duration: '3 days' },
          ],
          watch_for: ['Vomiting within 30 min'],
        },
      },
      source: { document: 'FMOH 2024' },
      checksum: '',
    };
    const rendered = renderChunk(chunk, 'en');
    expect(rendered.type).toBe('drug_table');
    expect(rendered.content).toContain('Artemether-Lumefantrine');
    expect(rendered.content).toContain('5-14 kg');
    expect(rendered.content).toContain('Vomiting within 30 min');
  });

  it('renders danger_sign chunk', () => {
    const chunk: HIVChunk = {
      id: 'danger-1',
      type: 'danger_sign',
      trigger_phrases: {},
      content: {
        en: {
          sign: 'Convulsions',
          severity: 'emergency',
          immediate_action: 'Place child on side, clear airway.',
          refer_urgency: 'Refer immediately to hospital.',
        },
      },
      source: { document: 'IMCI 2024' },
      checksum: '',
    };
    const rendered = renderChunk(chunk, 'en');
    expect(rendered.type).toBe('danger_sign');
    expect(rendered.content).toContain('EMERGENCY');
    expect(rendered.content).toContain('Convulsions');
    expect(rendered.content).toContain('Place child on side');
  });

  it('falls back to English when language missing', () => {
    const chunk: HIVChunk = {
      id: 'faq-1',
      type: 'faq',
      trigger_phrases: {},
      content: {
        en: { question: 'Q', answer: 'A' },
      },
      source: { document: 'X' },
      checksum: '',
    };
    const rendered = renderChunk(chunk, 'ha'); // Hausa not present
    expect(rendered.content).toContain('Q');
  });
});

describe('getChunkPreview', () => {
  it('returns question for faq', () => {
    const chunk: HIVChunk = {
      id: 'c1',
      type: 'faq',
      trigger_phrases: {},
      content: { en: { question: 'How to treat fever?' } },
      source: { document: 'A' },
      checksum: '',
    };
    expect(getChunkPreview(chunk, 'en')).toBe('How to treat fever?');
  });

  it('truncates long previews', () => {
    const chunk: HIVChunk = {
      id: 'c1',
      type: 'faq',
      trigger_phrases: {},
      content: { en: { question: 'a'.repeat(100) } },
      source: { document: 'A' },
      checksum: '',
    };
    expect(getChunkPreview(chunk, 'en')).toHaveLength(60);
  });
});

describe('buildGreeting', () => {
  it('includes user name', () => {
    const greeting = buildGreeting('Kano State CHEW');
    expect(greeting).toContain('Kano State CHEW');
    expect(greeting).toContain("I'm HIVA");
  });
});

describe('buildNoResultMessage', () => {
  it('suggests rephrasing', () => {
    const msg = buildNoResultMessage();
    expect(msg).toContain("don't have information");
    expect(msg).toContain('rephrasing');
    expect(msg).toContain('Knowledge Base');
  });
});
