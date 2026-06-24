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
  // 3 chunks mapped to 3-dim vectors:
  //   newborn-definition → [1, 0, 0]
  //   newborn-coverage   → [0, 1, 0]
  //   newborn-dosage     → [0, 0, 1]
  const dims = 3;
  const total = 3;
  const buffer = new ArrayBuffer(total * dims * 4);
  const view = new Float32Array(buffer);
  view[0] = 1; view[1] = 0; view[2] = 0;
  view[3] = 0; view[4] = 1; view[5] = 0;
  view[6] = 0; view[7] = 0; view[8] = 1;

  return {
    embeddingsBuffer: buffer,
    embeddingsIndex: { dimensions: dims, total_chunks: total, chunk_ids: ['newborn-definition', 'newborn-coverage', 'newborn-dosage'] },
    queryProxies: {
      'newborn care basic guideline what is': [1, 0, 0],
      'cover coverage what does it scope': [0, 1, 0],
      'dose dosage specific': [0, 0, 1],
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

  it('turn 1: returns definition chunk for "what is the National Guideline for Basic Newborn Care?"', async () => {
    const result = await processMessage(
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

  it('turn 2: returns DIFFERENT chunk covering scope/coverage aspect', async () => {
    // First turn
    await processMessage(
      'what is the National Guideline for Basic Newborn Care?',
      sessionState,
      { userMessage: 'what is the National Guideline for Basic Newborn Care?', hivAssets: assets, coverageManifest, chunks }
    );

    // Second turn
    const result = await processMessage(
      'what does it cover?',
      sessionState,
      { userMessage: 'what does it cover?', hivAssets: assets, coverageManifest, chunks }
    );

    expect(result.chunkId).toBe('newborn-coverage');
    expect(result.chunkId).not.toBe('newborn-definition');
    expect(result.intent).toBe('SCOPE');
    expect(result.answer).toContain('thermal care');
  });

  it('turn 3: returns dosage chunk, not the definition chunk again', async () => {
    // First turn
    await processMessage(
      'what is the National Guideline for Basic Newborn Care?',
      sessionState,
      { userMessage: 'what is the National Guideline for Basic Newborn Care?', hivAssets: assets, coverageManifest, chunks }
    );

    // Second turn
    await processMessage(
      'what does it cover?',
      sessionState,
      { userMessage: 'what does it cover?', hivAssets: assets, coverageManifest, chunks }
    );

    // Third turn
    const result = await processMessage(
      "yes, what's the specific dose?",
      sessionState,
      { userMessage: "yes, what's the specific dose?", hivAssets: assets, coverageManifest, chunks }
    );

    expect(result.chunkId).toBe('newborn-dosage');
    expect(result.chunkId).not.toBe('newborn-definition');
    expect(result.intent).toBe('DETAIL');
    expect(result.answer).toContain('tablet');
  });

  it('sessionState.coveredChunks grows with each turn', async () => {
    expect(sessionState.coveredChunks.size).toBe(0);

    await processMessage(
      'what is the National Guideline for Basic Newborn Care?',
      sessionState,
      { userMessage: 'q1', hivAssets: assets, coverageManifest, chunks }
    );
    expect(sessionState.coveredChunks.size).toBe(1);

    await processMessage('what does it cover?', sessionState, { userMessage: 'q2', hivAssets: assets, coverageManifest, chunks });
    expect(sessionState.coveredChunks.size).toBe(2);

    await processMessage("yes, what's the dose?", sessionState, { userMessage: 'q3', hivAssets: assets, coverageManifest, chunks });
    expect(sessionState.coveredChunks.size).toBe(3);
  });

  it('pendingGaps correctly predicts follow-up needs', async () => {
    await processMessage(
      'what is the National Guideline for Basic Newborn Care?',
      sessionState,
      { userMessage: 'q1', hivAssets: assets, coverageManifest, chunks }
    );
    // After turn 1, definition is covered. Remaining gaps: dosage, coverage (ordered by priority)
    expect(sessionState.pendingGaps).toContain('dosage');

    await processMessage('what does it cover?', sessionState, { userMessage: 'q2', hivAssets: assets, coverageManifest, chunks });
    // After turn 2, detectGaps runs before markAspectsCovered, so coverage is still predicted as needed
    expect(sessionState.pendingGaps).toEqual(['dosage', 'coverage']);
  });

  it('patient dose computation returns weight-specific string when patientWeightKg is set', async () => {
    sessionState.slotMemory.patientWeightKg = 3;
    sessionState.slotMemory.patientWeight = '3 kg';

    const result = await processMessage(
      "what's the dose?",
      sessionState,
      { userMessage: 'q1', hivAssets: assets, coverageManifest, chunks }
    );

    expect(result.answer).toContain('3kg');
    expect(result.answer).toContain('tablets');
  });

  it('fallback handler never mentions file names or internal IDs', async () => {
    const result = await processMessage(
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

/* ─── 5-Turn Conversation Verification (Bug 2-4 smoke test) ─── */

describe('5-turn conversation: ANC → Outbreak Preparedness', () => {
  function makeFiveTurnChunks(): HIVChunk[] {
    return [
      {
        id: 'anc-definition',
        type: 'protocol' as const,
        trigger_phrases: { en: ['antenatal care', 'anc', 'what is anc'] },
        aspects: ['definition'],
        content: {
          en: {
            primary_question: 'What is ANC?',
            definition: 'ANC (Antenatal Care) is routine health care provided during pregnancy to ensure maternal and fetal well-being.',
            answer: 'ANC is health care during pregnancy.',
            topics: ['antenatal care'],
          },
        },
        source: { document: 'FMOH ANC' },
        checksum: 'anc1',
      },
      {
        id: 'anc-coverage',
        type: 'protocol' as const,
        trigger_phrases: { en: ['anc coverage', 'what does anc cover', 'antenatal care cover'] },
        aspects: ['coverage'],
        content: {
          en: {
            primary_question: 'What does ANC cover?',
            coverage: 'ANC covers: blood pressure monitoring, urine testing, weight tracking, fetal assessment, tetanus vaccination, iron/folate supplementation, and birth planning.',
            answer: 'ANC covers multiple health checks during pregnancy.',
            topics: ['antenatal care'],
          },
        },
        source: { document: 'FMOH ANC' },
        checksum: 'anc2',
      },
      {
        id: 'anc-schedule',
        type: 'protocol' as const,
        trigger_phrases: { en: ['anc schedule', 'antenatal care schedule', 'specific schedule'] },
        aspects: ['schedule'],
        content: {
          en: {
            primary_question: 'What is the ANC schedule?',
            schedule: 'ANC schedule: First visit before 12 weeks, second at 20 weeks, third at 26 weeks, fourth at 30 weeks, then every 2 weeks until delivery.',
            answer: 'ANC visits start before 12 weeks.',
            topics: ['antenatal care'],
          },
        },
        source: { document: 'FMOH ANC' },
        checksum: 'anc3',
      },
      {
        id: 'outbreak-overview',
        type: 'protocol' as const,
        trigger_phrases: { en: ['outbreak preparedness', 'outbreak response', 'outbreak preparedness and response'] },
        aspects: ['definition'],
        content: {
          en: {
            primary_question: 'What is Outbreak Preparedness and Response?',
            definition: 'Outbreak Preparedness and Response covers early detection, notification, investigation, and containment of disease outbreaks.',
            answer: 'Outbreak preparedness is about detecting and responding to disease outbreaks.',
            topics: ['outbreak preparedness', 'tb', 'newborn care'],
          },
        },
        source: { document: 'FMOH Outbreak' },
        checksum: 'ob1',
      },
      {
        id: 'outbreak-referral',
        type: 'protocol' as const,
        trigger_phrases: { en: ['outbreak referral', 'when to refer outbreak', 'outbreak escalation'] },
        aspects: ['referral'],
        content: {
          en: {
            primary_question: 'When do we refer during an outbreak?',
            referral: 'Refer when: case count exceeds facility capacity, unusual pathogen suspected, mortality rate > 5%, community spread confirmed, or health worker infected.',
            answer: 'Refer when case count exceeds capacity.',
            topics: ['outbreak preparedness'],
          },
        },
        source: { document: 'FMOH Outbreak' },
        checksum: 'ob2',
      },
    ];
  }

  function makeFiveTurnAssets(chunks: HIVChunk[]) {
    // 5 chunks mapped to 5-dim orthogonal vectors
    const dims = 5;
    const total = 5;
    const buffer = new ArrayBuffer(total * dims * 4);
    const view = new Float32Array(buffer);
    for (let i = 0; i < total; i++) view[i * dims + i] = 1;

    return {
      embeddingsBuffer: buffer,
      embeddingsIndex: {
        dimensions: dims,
        total_chunks: total,
        chunk_ids: ['anc-definition', 'anc-coverage', 'anc-schedule', 'outbreak-overview', 'outbreak-referral'],
      },
      queryProxies: {
        'anc antenatal care what is': [1, 0, 0, 0, 0],
        'cover coverage what does it': [0, 1, 0, 0, 0],
        'schedule specific dose when': [0, 0, 1, 0, 0],
        'outbreak preparedness response': [0, 0, 0, 1, 0],
        'refer referral when should': [0, 0, 0, 0, 1],
      },
      chunks,
      gapGraph: {
        'anc-definition': [
          { to: 'anc-coverage', score: 0.8 },
          { to: 'anc-schedule', score: 0.7 },
        ],
        'anc-coverage': [
          { to: 'anc-schedule', score: 0.9 },
        ],
        'outbreak-overview': [
          { to: 'outbreak-referral', score: 0.8 },
        ],
      },
    };
  }

  function makeFiveTurnCoverage() {
    return {
      'antenatal care': {
        aspects_covered: ['definition', 'coverage', 'schedule'],
      },
      'outbreak preparedness': {
        aspects_covered: ['definition', 'referral'],
      },
    };
  }

  let sessionState: SessionState;
  let chunks: HIVChunk[];
  let assets: ReturnType<typeof makeFiveTurnAssets>;
  let coverageManifest: ReturnType<typeof makeFiveTurnCoverage>;

  beforeEach(() => {
    sessionState = new SessionState();
    chunks = makeFiveTurnChunks();
    assets = makeFiveTurnAssets(chunks);
    coverageManifest = makeFiveTurnCoverage();
  });

  it('Turn 1: "what is ANC?" → ANC definition, topic = antenatal care, no patient closing', async () => {
    const result = await processMessage('what is ANC?', sessionState, {
      userMessage: 'what is ANC?',
      hivAssets: assets,
      coverageManifest,
      chunks,
    });

    expect(result.chunkId).toBe('anc-definition');
    expect(result.answer).toContain('Antenatal Care');
    expect(sessionState.currentTopic).toContain('antenatal care');
    expect(result.closing.toLowerCase()).not.toContain('patient');
  });

  it('Turn 2: "what does it cover?" → ANC coverage content, same topic', async () => {
    // Turn 1
    await processMessage('what is ANC?', sessionState, {
      userMessage: 'what is ANC?', hivAssets: assets, coverageManifest, chunks,
    });

    // Turn 2
    const result = await processMessage('what does it cover?', sessionState, {
      userMessage: 'what does it cover?', hivAssets: assets, coverageManifest, chunks,
    });

    expect(result.chunkId).toBe('anc-coverage');
    expect(result.chunkId).not.toBe('anc-definition');
    expect(result.answer).toContain('blood pressure');
    expect(sessionState.currentTopic).toContain('antenatal care');
  });

  it('Turn 3: "what is the specific schedule?" → ANC schedule, not newborn/postnatal', async () => {
    // Turn 1 + 2
    await processMessage('what is ANC?', sessionState, {
      userMessage: 'what is ANC?', hivAssets: assets, coverageManifest, chunks,
    });
    await processMessage('what does it cover?', sessionState, {
      userMessage: 'what does it cover?', hivAssets: assets, coverageManifest, chunks,
    });

    // Turn 3
    const result = await processMessage('what is the specific schedule?', sessionState, {
      userMessage: 'what is the specific schedule?', hivAssets: assets, coverageManifest, chunks,
    });

    expect(result.chunkId).toBe('anc-schedule');
    expect(result.answer).toContain('12 weeks');
    expect(sessionState.currentTopic).toContain('antenatal care');
  });

  it('Turn 4: "what is Outbreak Preparedness and Response" → outbreak content, topic = outbreak preparedness, opener does NOT say "On tb:"', async () => {
    // Turns 1-3
    await processMessage('what is ANC?', sessionState, {
      userMessage: 'what is ANC?', hivAssets: assets, coverageManifest, chunks,
    });
    await processMessage('what does it cover?', sessionState, {
      userMessage: 'what does it cover?', hivAssets: assets, coverageManifest, chunks,
    });
    await processMessage('what is the specific schedule?', sessionState, {
      userMessage: 'what is the specific schedule?', hivAssets: assets, coverageManifest, chunks,
    });

    // Turn 4
    const result = await processMessage('what is Outbreak Preparedness and Response', sessionState, {
      userMessage: 'what is Outbreak Preparedness and Response', hivAssets: assets, coverageManifest, chunks,
    });

    expect(result.chunkId).toBe('outbreak-overview');
    expect(result.answer.toLowerCase()).toContain('outbreak preparedness');
    expect(sessionState.currentTopic).toContain('outbreak preparedness');
    // Opener must NOT say "On tb:"
    expect(result.answer).not.toContain('On tb:');
    expect(result.answer).not.toContain('On tb');
  });

  it('Turn 5: "when do we refer?" → outbreak referral, topic unchanged from turn 4', async () => {
    // Turns 1-4
    await processMessage('what is ANC?', sessionState, {
      userMessage: 'what is ANC?', hivAssets: assets, coverageManifest, chunks,
    });
    await processMessage('what does it cover?', sessionState, {
      userMessage: 'what does it cover?', hivAssets: assets, coverageManifest, chunks,
    });
    await processMessage('what is the specific schedule?', sessionState, {
      userMessage: 'what is the specific schedule?', hivAssets: assets, coverageManifest, chunks,
    });
    await processMessage('what is Outbreak Preparedness and Response', sessionState, {
      userMessage: 'what is Outbreak Preparedness and Response', hivAssets: assets, coverageManifest, chunks,
    });

    const topicBefore = sessionState.currentTopic;
    expect(topicBefore).toContain('outbreak preparedness');

    // Turn 5
    const result = await processMessage('when do we refer?', sessionState, {
      userMessage: 'when do we refer?', hivAssets: assets, coverageManifest, chunks,
    });

    expect(result.chunkId).toBe('outbreak-referral');
    expect(result.answer).toContain('case count');
    // Topic should remain "outbreak preparedness"
    expect(sessionState.currentTopic).toContain('outbreak preparedness');
  });
});
