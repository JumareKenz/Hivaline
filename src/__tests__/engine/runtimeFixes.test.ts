/**
 * runtimeFixes.test.ts — Tests for all 5 runtime bug fixes
 *
 * FIX 1: Social trigger context gate (BUG-1)
 * FIX 2: Gap graph boost assignment (BUG-2)
 * FIX 3: Section number stripping (BUG-3)
 * FIX 4: companion_note rendering (BUG-5)
 * FIX 5: Compiler error guard (BUG-4)
 */

import { describe, it, expect } from 'vitest';
import { ConversationEngine } from '@/services/conversationEngine';
import { composeResponse } from '@/services/responseComposer';
import { cleanTopic, extractPrimaryTopic } from '@/engine/driftDetector';
import { buildOpener, selectAnswerContent, isCompilerError } from '@/engine/answerAssembler';
import { initSearch, search } from '@/engine/hybridSearch';
import SessionState from '@/engine/sessionState';
import type { HIVFile, HIVChunk } from '@/types/hiv';

/* ─── Helpers ─── */

function makeMockHIVFile(chunks: HIVChunk[]): HIVFile {
  return {
    manifest: {
      version: '2026.05.13.1',
      sha256: 'test',
      size_kb: 96,
      languages: ['en'],
      chunk_count: chunks.length,
      created_at: '2026-05-13',
      search_config: {
        bm25_weight: 1,
        vector_weight: 0,
        fusion: 'RRF',
        rrf_k: 60,
        type_boost: {} as Record<string, number>,
      },
    },
    chunks,
    embeddings: [],
    embeddingMeta: [],
    lexicalIndex: { en: { index: {} } },
    sources: { sources: [] },
    rules: {},
    i18n: {},
  };
}

function makeMockChunk(overrides: Partial<HIVChunk> = {}): HIVChunk {
  return {
    id: 'test-chunk-1',
    type: 'protocol',
    trigger_phrases: {},
    content: {
      en: {
        primary_question: 'How is malaria treated?',
        answer: 'Malaria is treated with ACT.',
        answer_direct: 'Give ACT.',
        answer_urgent: 'Give ACT NOW.',
        answer_formal: 'Administer artemisinin-based combination therapy.',
        answer_reassuring: 'Malaria is treatable with ACT.',
        question_variants: [
          'how is malaria treated',
          'malaria medicine',
          'treatment for malaria',
        ],
        follow_up_questions: ['What is the dose?', 'When to refer?'],
        conversational_openers: [
          'Here\'s what to know about {chief_complaint}:',
          'Let me guide you:',
          'Following up on {chief_complaint}:',
        ],
        fallback_response: 'For malaria, use ACT per FMOH guidelines.',
      },
    },
    source: { document: 'FMOH Malaria Protocol' },
    checksum: 'test',
    ...overrides,
  };
}

/* ═══════════════════════════════════════
   FIX 1 — Social trigger context gate
   ═══════════════════════════════════════ */

describe('FIX 1: social trigger context gate', () => {
  it('1. "yes" with active currentTopic routes to search, not SOCIAL_RESPONSES', async () => {
    const chunk = makeMockChunk();
    const engine = new ConversationEngine(makeMockHIVFile([chunk]));
    // First query sets a clinical topic via slot extraction
    await engine.respond('my patient has malaria');
    // "yes" should NOT get a social response
    const response = await engine.respond('yes');
    expect(response.type).not.toBe('greeting');
    // Should not be one of the SOCIAL_RESPONSES (exact matches)
    const socialResponses = [
      "You're welcome! Let me know if anything else comes up.",
      "Glad to help. Stay confident — you've got this.",
      "Anytime. Your patients are lucky to have you.",
      "Happy to help. Reach out whenever you need guidance.",
    ];
    expect(socialResponses).not.toContain(response.message);
  });

  it('2. "yes please" with active currentTopic reaches search pipeline', async () => {
    const chunk = makeMockChunk();
    const engine = new ConversationEngine(makeMockHIVFile([chunk]));
    await engine.respond('my patient has malaria');
    const response = await engine.respond('yes please');
    expect(response.type).not.toBe('greeting');
  });

  it('3. "yes" with no currentTopic (turn 1) still returns social/greeting', async () => {
    const chunk = makeMockChunk();
    const engine = new ConversationEngine(makeMockHIVFile([chunk]));
    // First message is "yes" — no clinical context yet
    const response = await engine.respond('yes');
    // Should be intercepted as social or greeting (short, no clinical keywords)
    expect(response.type).toBe('greeting');
  });

  it('4. "thanks" always returns SOCIAL_RESPONSES regardless of currentTopic', async () => {
    const chunk = makeMockChunk();
    const engine = new ConversationEngine(makeMockHIVFile([chunk]));
    await engine.respond('my patient has malaria');
    const response = await engine.respond('thanks');
    expect(response.type).toBe('greeting');
  });

  it('5. "thank you so much" with startsWith("thank") is always social', async () => {
    const chunk = makeMockChunk();
    const engine = new ConversationEngine(makeMockHIVFile([chunk]));
    await engine.respond('my patient has malaria');
    const response = await engine.respond('thank you so much');
    expect(response.type).toBe('greeting');
  });

  it('6. "ok" with active topic routes to search (not social)', async () => {
    const chunk = makeMockChunk();
    const engine = new ConversationEngine(makeMockHIVFile([chunk]));
    await engine.respond('my patient has malaria');
    const response = await engine.respond('ok');
    // "ok" was removed from SOCIAL_TRIGGERS, so it should NOT be greeting
    expect(response.type).not.toBe('greeting');
  });

  it('7. "sure" with active topic routes to search (not social)', async () => {
    const chunk = makeMockChunk();
    const engine = new ConversationEngine(makeMockHIVFile([chunk]));
    await engine.respond('my patient has malaria');
    const response = await engine.respond('sure');
    // "sure" was removed from SOCIAL_TRIGGERS
    expect(response.type).not.toBe('greeting');
  });
});

/* ═══════════════════════════════════════
   FIX 2 — Gap graph boost applied
   ═══════════════════════════════════════ */

describe('FIX 2: gap graph boost is applied', () => {
  it('8. chunk reachable via gap graph gets score boost', () => {
    const sessionState = new SessionState();
    // Simulate serving chunk-A on first turn
    sessionState.addTurn('first query', 'chunk-a', [], 'DEFINE');

    const gapGraph: Record<string, Array<{ to: string; score: number }>> = {
      'chunk-a': [{ to: 'chunk-b', score: 0.8 }],
    };

    const bm25Index = {
      en: {
        index: {
          malaria: [
            { chunk_id: 'chunk-b', score: 1.0 },
            { chunk_id: 'chunk-c', score: 1.0 },
          ],
        },
      },
    };

    const assets = {
      bm25Index,
      gapGraph,
      chunks: [{ id: 'chunk-a' }, { id: 'chunk-b' }, { id: 'chunk-c' }],
    };

    initSearch(assets);
    const result = search('malaria', sessionState, 'en', assets);

    // chunk-b should win because it gets gap graph boost from chunk-a
    expect(result).not.toBeNull();
    expect(result!.chunkId).toBe('chunk-b');
  });
});

/* ═══════════════════════════════════════
   FIX 3 — Section number stripping
   ═══════════════════════════════════════ */

describe('FIX 3: cleanTopic strips section numbers', () => {
  it('9. strips "1.1. federal ministry of health"', () => {
    expect(cleanTopic('1.1. federal ministry of health')).toBe('federal ministry of health');
  });

  it('10. strips "2" (pure digit)', () => {
    expect(cleanTopic('2')).toBe('');
  });

  it('11. "state ministry of health" unchanged', () => {
    expect(cleanTopic('state ministry of health')).toBe('state ministry of health');
  });

  it('12. strips "1.2.3. something"', () => {
    expect(cleanTopic('1.2.3. something')).toBe('something');
  });

  it('13. buildOpener output does not contain leading digits', () => {
    const matrix = { DEFINE: 'On {topic}:' };
    const result = buildOpener('DEFINE', '1.1. federal ministry of health (fmoh)', null, matrix);
    expect(result).toBe('On federal ministry of health (fmoh):');
    expect(result).not.toMatch(/^\s*On\s+\d/);
  });

  it('extractPrimaryTopic cleans section numbers from chunk topics', () => {
    const ss = new SessionState();
    const result = extractPrimaryTopic(
      'what is this?',
      ['1.1. federal ministry of health'],
      ss,
      {},
      0.8
    );
    expect(result).toBe('federal ministry of health');
    expect(result).not.toMatch(/^\d/);
  });
});

/* ═══════════════════════════════════════
   FIX 4 — companion_note rendering
   ═══════════════════════════════════════ */

describe('FIX 4: companion_note rendering', () => {
  it('14. companion_note present in chunk is appended with em dash prefix', async () => {
    const chunk = makeMockChunk({
      content: {
        en: {
          answer: 'ACT is the treatment.',
          definition: 'Malaria is a parasitic disease.',
          companion_note: 'Always check RDT before prescribing.',
          question_variants: ['malaria treatment'],
          primary_question: 'How is malaria treated?',
          fallback_response: 'Use ACT.',
          conversational_openers: ['Let me guide you:'],
        },
      },
    });
    const engine = new ConversationEngine(makeMockHIVFile([chunk]));
    const response = await engine.respond('what is malaria');
    // companion_note should appear with em dash prefix
    expect(response.message).toContain('\u2014 Always check RDT before prescribing.');
  });

  it('15. companion_note empty string is not appended', async () => {
    const chunk = makeMockChunk({
      content: {
        en: {
          answer: 'ACT is the treatment.',
          definition: 'Malaria is a parasitic disease.',
          companion_note: '',
          question_variants: ['malaria treatment'],
          primary_question: 'How is malaria treated?',
          fallback_response: 'Use ACT.',
          conversational_openers: ['Let me guide you:'],
        },
      },
    });
    const engine = new ConversationEngine(makeMockHIVFile([chunk]));
    const response = await engine.respond('what is malaria');
    expect(response.message).not.toContain('\u2014 ');
  });

  it('16. companion_note absent (undefined) does not crash', async () => {
    const chunk = makeMockChunk();
    const engine = new ConversationEngine(makeMockHIVFile([chunk]));
    const response = await engine.respond('what is malaria');
    // Should not crash and should not contain em dash prefix from companion_note
    expect(response.message).toBeDefined();
    expect(response.message.length).toBeGreaterThan(0);
  });

  it('17. companion_note rendered via legacy responseComposer path', () => {
    const chunk = makeMockChunk({
      content: {
        en: {
          answer: 'ACT is the treatment.',
          companion_note: 'Double-check weight before dosing.',
          conversational_openers: ['Let me guide you:'],
          question_variants: ['malaria treatment'],
          primary_question: 'How is malaria treated?',
          fallback_response: 'Use ACT.',
        },
      },
    });
    const state = {
      turns: [],
      slots: {
        patientAge: null,
        patientWeight: null,
        symptomDuration: null,
        chiefComplaint: null,
      },
      lastChunkId: null,
      turnCount: 1,
      lastOpener: null,
      lastChiefComplaint: null,
    };
    const result = composeResponse(chunk, state, 'clinical');
    expect(result).toContain('\u2014 Double-check weight before dosing.');
  });
});

/* ═══════════════════════════════════════
   FIX 5 — Compiler error guard
   ═══════════════════════════════════════ */

describe('FIX 5: compiler error guard', () => {
  it('18. isCompilerError detects known error strings', () => {
    expect(isCompilerError(
      'Unfortunately, the provided text does not contain any meaningful information to process.'
    )).toBe(true);
    expect(isCompilerError(
      'No meaningful information to process was found.'
    )).toBe(true);
    expect(isCompilerError(
      'The provided text does not contain relevant data.'
    )).toBe(true);
  });

  it('19. isCompilerError returns false for valid clinical content', () => {
    expect(isCompilerError('Give 500mg paracetamol')).toBe(false);
    expect(isCompilerError('Malaria is treated with ACT.')).toBe(false);
    expect(isCompilerError('')).toBe(false);
    expect(isCompilerError(null)).toBe(false);
    expect(isCompilerError(undefined)).toBe(false);
  });

  it('20. chunk with compiler error in answer field falls through to next field', () => {
    const ss = new SessionState();
    const chunk = {
      id: 'error-chunk',
      aspects: ['definition'],
      content: {
        en: {
          answer: 'Unfortunately, the provided text does not contain any meaningful information to process.',
          definition: 'Unfortunately, the provided text does not contain any meaningful information to process.',
          fallback_response: 'SMOH coordinates health at state level.',
        },
      },
    };
    const result = selectAnswerContent(chunk, ss, 'DEFINE');
    // Should skip the compiler error strings and find fallback_response
    expect(result).toBe('SMOH coordinates health at state level.');
    expect(result).not.toContain('does not contain');
  });

  it('chunk with compiler error in all fields returns null', () => {
    const ss = new SessionState();
    const chunk = {
      id: 'all-error-chunk',
      aspects: [],
      content: {
        en: {
          answer: 'Unfortunately, the provided text does not contain any meaningful information to process.',
          definition: 'The provided text does not contain any meaningful information.',
        },
      },
    };
    const result = selectAnswerContent(chunk, ss, 'DEFINE');
    expect(result).toBeNull();
  });
});
