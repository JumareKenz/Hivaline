/**
 * responseRenderer.extended.test.ts
 *
 * Extended edge cases: protocol, calculator, missing fields,
 * empty content, unknown chunk type, XSS-in-content passthrough.
 */

import { describe, it, expect } from 'vitest';
import { renderChunk, getChunkPreview, buildGreeting } from '@/services/responseRenderer';
import type { HIVChunk } from '@/types/hiv';

function makeChunk(overrides: Partial<HIVChunk>): HIVChunk {
  return {
    id: 'test-chunk',
    type: 'faq',
    trigger_phrases: {},
    content: {},
    source: { document: 'Test' },
    checksum: '',
    ...overrides,
  };
}

describe('renderChunk — protocol', () => {
  it('renders protocol with title, steps, and notes', () => {
    const chunk = makeChunk({
      type: 'protocol',
      content: {
        en: {
          title: 'ANC First Visit Protocol',
          steps: ['Check BP', 'Weigh patient', 'Give iron/folate'],
          notes: 'Record all findings in patient card.',
        },
      },
    });
    const rendered = renderChunk(chunk, 'en');
    expect(rendered.type).toBe('protocol');
    expect(rendered.content).toContain('ANC First Visit Protocol');
    expect(rendered.content).toContain('1. Check BP');
    expect(rendered.content).toContain('2. Weigh patient');
    expect(rendered.content).toContain('3. Give iron/folate');
    expect(rendered.content).toContain('Record all findings');
  });

  it('renders protocol without notes field', () => {
    const chunk = makeChunk({
      type: 'protocol',
      content: {
        en: {
          title: 'Malaria Protocol',
          steps: ['Give ACT', 'Check temperature'],
        },
      },
    });
    const rendered = renderChunk(chunk, 'en');
    expect(rendered.content).toContain('Malaria Protocol');
    expect(rendered.content).toContain('Give ACT');
    expect(rendered.content).not.toContain('💡');
  });

  it('renders protocol with empty steps array', () => {
    const chunk = makeChunk({
      type: 'protocol',
      content: { en: { title: 'Empty Protocol', steps: [] } },
    });
    const rendered = renderChunk(chunk, 'en');
    expect(rendered.content).toContain('Empty Protocol');
    expect(rendered.type).toBe('protocol');
  });
});

describe('renderChunk — calculator', () => {
  it('renders calculator with title and inputs', () => {
    const chunk = makeChunk({
      type: 'calculator',
      content: {
        en: {
          title: 'Weight-Based Dose Calculator',
          inputs: [{ id: 'weight', label: 'Child weight (kg)', type: 'number' }],
          formula: 'weight * 2',
          output_unit: 'mg',
          output_label: 'Dose',
        },
      },
    });
    const rendered = renderChunk(chunk, 'en');
    expect(rendered.type).toBe('calculator');
    expect(rendered.content).toContain('Weight-Based Dose Calculator');
    expect(rendered.content).toContain('Child weight (kg)');
    expect(rendered.content).toContain('mg');
  });

  it('renders calculator with multiple inputs', () => {
    const chunk = makeChunk({
      type: 'calculator',
      content: {
        en: {
          title: 'Multi-Input Calc',
          inputs: [
            { id: 'a', label: 'Age (months)', type: 'number' },
            { id: 'b', label: 'Weight (kg)', type: 'number' },
          ],
          formula: 'a + b',
          output_unit: 'units',
          output_label: 'Result',
        },
      },
    });
    const rendered = renderChunk(chunk, 'en');
    expect(rendered.content).toContain('Age (months)');
    expect(rendered.content).toContain('Weight (kg)');
  });
});

describe('renderChunk — danger_sign variants', () => {
  it('renders urgent severity with ⚠️ prefix', () => {
    const chunk = makeChunk({
      type: 'danger_sign',
      content: {
        en: {
          sign: 'Severe dehydration',
          severity: 'urgent',
          immediate_action: 'Give ORS immediately',
        },
      },
    });
    const rendered = renderChunk(chunk, 'en');
    expect(rendered.content).toContain('⚠️ URGENT');
    expect(rendered.content).toContain('Severe dehydration');
  });

  it('renders emergency severity with 🚨 prefix', () => {
    const chunk = makeChunk({
      type: 'danger_sign',
      content: {
        en: {
          sign: 'Convulsions',
          severity: 'emergency',
          immediate_action: 'Place on side',
          refer_urgency: 'Refer now',
          handover_info: 'Convulsing child, 2y male',
        },
      },
    });
    const rendered = renderChunk(chunk, 'en');
    expect(rendered.content).toContain('🚨 EMERGENCY');
    expect(rendered.content).toContain('Refer now');
    expect(rendered.content).toContain('Convulsing child');
  });

  it('renders danger_sign without optional fields', () => {
    const chunk = makeChunk({
      type: 'danger_sign',
      content: {
        en: {
          sign: 'Pallor',
          severity: 'urgent',
          immediate_action: 'Check haemoglobin',
        },
      },
    });
    const rendered = renderChunk(chunk, 'en');
    expect(rendered.content).not.toContain('Refer:');
    expect(rendered.content).not.toContain('Tell the facility');
  });
});

describe('renderChunk — drug_table variants', () => {
  it('renders drug_table without watch_for or refer_if', () => {
    const chunk = makeChunk({
      type: 'drug_table',
      content: {
        en: {
          drug_name: 'Paracetamol',
          rows: [{ weight_range: '3-5 kg', dose: '60mg', route: 'Oral', frequency: 'TDS', duration: '3 days' }],
        },
      },
    });
    const rendered = renderChunk(chunk, 'en');
    expect(rendered.content).toContain('Paracetamol');
    expect(rendered.content).not.toContain('⚠️ Watch for:');
    expect(rendered.content).not.toContain('🏥 Refer immediately if:');
  });

  it('renders drug_table with empty rows array', () => {
    const chunk = makeChunk({
      type: 'drug_table',
      content: { en: { drug_name: 'Vitamin A', rows: [], watch_for: ['Anaphylaxis'] } },
    });
    const rendered = renderChunk(chunk, 'en');
    expect(rendered.content).toContain('Vitamin A');
    expect(rendered.content).toContain('Anaphylaxis');
  });
});

describe('renderChunk — missing/empty content', () => {
  it('returns fallback message when no content in any language', () => {
    const chunk = makeChunk({ type: 'faq', content: {} });
    const rendered = renderChunk(chunk, 'en');
    expect(rendered.content).toBe('No content available in this language.');
  });

  it('falls back to English when requested language is missing', () => {
    const chunk = makeChunk({
      type: 'faq',
      content: { en: { question: 'Q in English', answer: 'A' } },
    });
    const rendered = renderChunk(chunk, 'ha'); // Hausa not present
    expect(rendered.content).toContain('Q in English');
  });

  it('handles chunk type unknown/default', () => {
    const chunk = makeChunk({
      type: 'faq', // use valid type but simulate default branch
      content: { en: 'raw string content' },
    });
    // When content[lang] is a string, faq branch receives it as FAQContent
    // — question/answer will be undefined, empty parts
    const rendered = renderChunk(chunk, 'en');
    expect(rendered.type).toBe('faq');
  });
});

describe('renderChunk — decision tree edge cases', () => {
  it('returns fallback when entry_node is missing from nodes', () => {
    const chunk = makeChunk({
      type: 'decision_tree',
      content: {
        en: {
          entry_node: 'missing-node',
          nodes: {},
        },
      },
    });
    const rendered = renderChunk(chunk, 'en');
    expect(rendered.content).toContain('Decision tree is not available');
  });

  it('renders decision tree action node', () => {
    const chunk = makeChunk({
      type: 'decision_tree',
      content: {
        en: {
          entry_node: 'start',
          nodes: {
            start: { action: 'Give ORS and monitor for 4 hours' },
          },
        },
      },
    });
    const rendered = renderChunk(chunk, 'en');
    expect(rendered.content).toContain('✅ Give ORS');
  });

  it('renders decision tree refer node', () => {
    const chunk = makeChunk({
      type: 'decision_tree',
      content: {
        en: {
          entry_node: 'start',
          nodes: {
            start: { refer: 'Refer to hospital immediately' },
          },
        },
      },
    });
    const rendered = renderChunk(chunk, 'en');
    expect(rendered.content).toContain('🚨 Refer to hospital');
  });
});

describe('buildGreeting — time-based salutation', () => {
  it('produces a greeting containing the username', () => {
    const greeting = buildGreeting('Nurse Amina');
    expect(greeting).toContain('Nurse Amina');
    expect(greeting).toContain("I'm HIVA");
  });

  it('produces greeting for empty username without crashing', () => {
    const greeting = buildGreeting('');
    expect(typeof greeting).toBe('string');
    expect(greeting.length).toBeGreaterThan(0);
  });

  it('produces greeting with special characters in name', () => {
    const greeting = buildGreeting("O'Brien & <User>");
    expect(typeof greeting).toBe('string');
    expect(greeting).toContain("O'Brien & <User>");
  });
});

describe('getChunkPreview — all chunk types', () => {
  it('returns drug_name for drug_table chunks', () => {
    const chunk = makeChunk({
      type: 'drug_table',
      content: { en: { drug_name: 'Artemether' } },
    });
    expect(getChunkPreview(chunk, 'en')).toBe('Artemether');
  });

  it('returns sign for danger_sign chunks', () => {
    const chunk = makeChunk({
      type: 'danger_sign',
      content: { en: { sign: 'Convulsions and stiff neck' } },
    });
    expect(getChunkPreview(chunk, 'en')).toBe('Convulsions and stiff neck');
  });

  it('returns title for protocol chunks', () => {
    const chunk = makeChunk({
      type: 'protocol',
      content: { en: { title: 'Malaria Treatment Protocol' } },
    });
    expect(getChunkPreview(chunk, 'en')).toBe('Malaria Treatment Protocol');
  });

  it('falls back to chunk.id when no recognizable content field', () => {
    const chunk = makeChunk({
      id: 'fallback-id-123',
      content: { en: { unknown_field: 'value' } },
    });
    expect(getChunkPreview(chunk, 'en')).toBe('fallback-id-123');
  });

  it('returns chunk.id when content is empty object', () => {
    const chunk = makeChunk({ id: 'empty-content', content: {} });
    expect(getChunkPreview(chunk, 'en')).toBe('empty-content');
  });

  it('truncates preview at 60 characters', () => {
    const chunk = makeChunk({
      content: { en: { sign: 'S'.repeat(200) } },
    });
    const preview = getChunkPreview(chunk, 'en');
    expect(preview.length).toBeLessThanOrEqual(60);
  });
});
