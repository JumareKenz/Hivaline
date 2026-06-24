/**
 * answerAssembler.test.ts — Answer assembler unit tests
 */

import { describe, it, expect } from 'vitest';
import {
  selectAnswerContent,
  computePatientDose,
  buildOpener,
  buildClosing,
  buildFollowUpChips,
  hasAnyPatientSlot,
  getAlternateClosing,
} from '@/engine/answerAssembler';
import SessionState from '@/engine/sessionState';
import type { SlotMemory } from '@/engine/sessionState';

describe('selectAnswerContent', () => {
  it('returns definition for DEFINE intent', () => {
    const chunk = {
      id: 'c1',
      aspects: ['definition'],
      content: { en: { definition: 'Malaria is a disease.', answer: 'Use ACT.' } },
    };
    const state = new SessionState();
    expect(selectAnswerContent(chunk, state, 'DEFINE')).toBe('Malaria is a disease.');
  });

  it('skips definition when already covered and returns next aspect', () => {
    const chunk = {
      id: 'c1',
      aspects: ['definition', 'dosage'],
      content: { en: { definition: 'Malaria is a disease.', dosage: 'Give 2 tablets.' } },
    };
    const state = new SessionState();
    state.markAspectsCovered(['definition']);
    expect(selectAnswerContent(chunk, state, 'DEFINE')).toBe('Give 2 tablets.');
  });

  it('returns coverage for SCOPE intent', () => {
    const chunk = {
      id: 'c1',
      content: { en: { coverage: 'Covers all ages.', answer: 'Use ACT.' } },
    };
    const state = new SessionState();
    expect(selectAnswerContent(chunk, state, 'SCOPE')).toBe('Covers all ages.');
  });

  it('returns dosage_rules for DETAIL intent', () => {
    const chunk = {
      id: 'c1',
      content: { en: { dosage_rules: '2 tablets twice daily', answer: 'Use ACT.' } },
    };
    const state = new SessionState();
    expect(selectAnswerContent(chunk, state, 'DETAIL')).toBe('2 tablets twice daily');
  });

  it('returns procedure for PROCEDURE intent', () => {
    const chunk = {
      id: 'c1',
      content: { en: { procedure: 'Step 1: wash hands.', answer: 'Use ACT.' } },
    };
    const state = new SessionState();
    expect(selectAnswerContent(chunk, state, 'PROCEDURE')).toBe('Step 1: wash hands.');
  });

  it('returns referral for REFERRAL intent', () => {
    const chunk = {
      id: 'c1',
      content: { en: { referral: 'Refer if severe.', answer: 'Use ACT.' } },
    };
    const state = new SessionState();
    expect(selectAnswerContent(chunk, state, 'REFERRAL')).toBe('Refer if severe.');
  });

  it('falls back to answer when no intent-specific content', () => {
    const chunk = {
      id: 'c1',
      content: { en: { answer: 'Use ACT.' } },
    };
    const state = new SessionState();
    expect(selectAnswerContent(chunk, state, 'CLINICAL')).toBe('Use ACT.');
  });

  it('returns null for completely empty chunk', () => {
    const chunk = { id: 'c1', content: { en: {} } };
    const state = new SessionState();
    expect(selectAnswerContent(chunk, state, 'CLINICAL')).toBeNull();
  });

  it('returns definition for HEADING_LOOKUP intent', () => {
    const chunk = {
      id: 'c1',
      aspects: ['definition'],
      content: { en: { definition: 'ANC stands for Antenatal Care.', answer: 'Go to clinic.' } },
    };
    const state = new SessionState();
    expect(selectAnswerContent(chunk, state, 'HEADING_LOOKUP')).toBe('ANC stands for Antenatal Care.');
  });
});

describe('computePatientDose', () => {
  const dosageRules = [
    {
      basis: 'weight',
      brackets: [
        { min_kg: 0, max_kg: 5, dose: '1/4 tablet' },
        { min_kg: 5, max_kg: 15, dose: '1/2 tablet' },
        { min_kg: 15, max_kg: 25, dose: '1 tablet' },
        { min_kg: 25, max_kg: 35, dose: '2 tablets' },
      ],
      age_override: [
        { min_months: 0, max_months: 1, warning: 'Not recommended in first month of life.' },
      ],
    },
  ];

  it('returns weight-specific string when weight is in slots', () => {
    const slots = { patientWeightKg: 15, patientAgeMonths: 12 } as SessionState['slotMemory'];
    expect(computePatientDose(dosageRules, slots)).toBe('For your 15kg patient: 1/2 tablet');
  });

  it('returns generic rule table when weight is missing', () => {
    const slots = { patientWeightKg: null, patientAgeMonths: null } as SessionState['slotMemory'];
    const result = computePatientDose(dosageRules, slots);
    expect(result).toContain('Dosing by weight');
    expect(result).toContain('0-5kg');
  });

  it('returns warning when age falls into age_override range', () => {
    const slots = { patientWeightKg: 3, patientAgeMonths: 0 } as SessionState['slotMemory'];
    expect(computePatientDose(dosageRules, slots)).toBe('Warning: Not recommended in first month of life.');
  });

  it('returns fallback when no dosage rules provided', () => {
    const slots = { patientWeightKg: 10 } as SessionState['slotMemory'];
    expect(computePatientDose(null, slots)).toBe('No dosing information available.');
  });

  it('returns fallback for non-array dosageRules', () => {
    const slots = { patientWeightKg: 10 } as SessionState['slotMemory'];
    expect(computePatientDose('string', slots)).toBe('No dosing information available.');
  });
});

describe('buildOpener', () => {
  it('returns empty string for URGENT intent', () => {
    expect(buildOpener('URGENT', 'malaria', 'dosage', { URGENT: 'Urgent:' })).toBe('');
  });

  it('fills template variables', () => {
    const matrix = { DEFINE: 'On {topic}:' };
    expect(buildOpener('DEFINE', 'malaria', null, matrix)).toBe('On malaria:');
  });

  it('returns empty string when intent not in matrix', () => {
    expect(buildOpener('UNKNOWN', 'malaria', null, {})).toBe('');
  });

  it('returns default HEADING_LOOKUP opener when not in matrix', () => {
    expect(buildOpener('HEADING_LOOKUP', 'malaria', null, {})).toBe("Here's an overview of malaria:");
  });
});

describe('buildClosing', () => {
  it('returns urgent closing for URGENT intent', () => {
    const state = new SessionState();
    expect(buildClosing([], 'URGENT', state)).toBe('Is the patient stable right now?');
  });

  it('returns empty string for GREETING intent', () => {
    const state = new SessionState();
    expect(buildClosing([], 'GREETING', state)).toBe('');
  });

  it('returns AFFIRM-specific closing when no gaps', () => {
    const state = new SessionState();
    expect(buildClosing([], 'AFFIRM', state)).toBe('Happy to help with anything else.');
  });

  it('returns patient closing when no gaps but patient slots are set', () => {
    const state = new SessionState();
    state.slotMemory.chiefComplaint = 'malaria';
    expect(buildClosing([], 'CLINICAL', state)).toBe('Anything else about this patient?');
  });

  it('returns DEFINE variant when no gaps and no patient slots', () => {
    const state = new SessionState();
    state.currentTopic = 'malaria';
    expect(buildClosing([], 'DEFINE', state)).toBe('Should I explain what malaria involves?');
  });

  it('returns SCOPE variant when no gaps and no patient slots', () => {
    const state = new SessionState();
    expect(buildClosing([], 'SCOPE', state)).toBe('Want the specific protocols or dosages?');
  });

  it('returns PROCEDURE variant when no gaps and no patient slots', () => {
    const state = new SessionState();
    expect(buildClosing([], 'PROCEDURE', state)).toBe('Should I go through any of these steps in detail?');
  });

  it('returns REFERRAL variant when no gaps and no patient slots', () => {
    const state = new SessionState();
    expect(buildClosing([], 'REFERRAL', state)).toBe('Need the danger signs that trigger referral?');
  });

  it('returns generic fallback when no gaps, no patient slots, unknown intent', () => {
    const state = new SessionState();
    expect(buildClosing([], 'CLINICAL', state)).toBe('Want to know more about this?');
  });

  it('returns dosage closing when dosage is pending', () => {
    const state = new SessionState();
    expect(buildClosing(['dosage'], 'CLINICAL', state)).toBe('Should I give you the specific dose?');
  });

  it('returns referral closing when referral is pending', () => {
    const state = new SessionState();
    expect(buildClosing(['referral'], 'CLINICAL', state)).toBe('Do you need to know when to refer?');
  });

  it('returns danger_signs closing', () => {
    const state = new SessionState();
    expect(buildClosing(['danger_signs'], 'CLINICAL', state)).toBe('Want the danger signs to watch for?');
  });

  /* ─── Bug 4: no patient language on pure knowledge queries (5 fixtures) ─── */

  describe('no patient language when all slots are null', () => {
    it('DEFINE intent with all null slots → no "patient"', () => {
      const state = new SessionState();
      state.currentTopic = 'anc';
      const closing = buildClosing([], 'DEFINE', state);
      expect(closing.toLowerCase()).not.toContain('patient');
    });

    it('SCOPE intent with all null slots → no "patient"', () => {
      const state = new SessionState();
      const closing = buildClosing([], 'SCOPE', state);
      expect(closing.toLowerCase()).not.toContain('patient');
    });

    it('HEADING_LOOKUP intent with all null slots → no "patient"', () => {
      const state = new SessionState();
      const closing = buildClosing([], 'HEADING_LOOKUP', state);
      expect(closing.toLowerCase()).not.toContain('patient');
    });

    it('CLINICAL intent with all null slots → no "patient"', () => {
      const state = new SessionState();
      const closing = buildClosing([], 'CLINICAL', state);
      expect(closing.toLowerCase()).not.toContain('patient');
    });

    it('REFERRAL intent with all null slots → no "patient"', () => {
      const state = new SessionState();
      const closing = buildClosing([], 'REFERRAL', state);
      expect(closing.toLowerCase()).not.toContain('patient');
    });
  });

  /* ─── Bug 4: patient language when chiefComplaint is set (3 fixtures) ─── */

  describe('patient language when chiefComplaint is set', () => {
    it('returns patient closing with chiefComplaint=malaria', () => {
      const state = new SessionState();
      state.slotMemory.chiefComplaint = 'malaria';
      const closing = buildClosing([], 'CLINICAL', state);
      expect(closing.toLowerCase()).toContain('patient');
    });

    it('returns patient closing with chiefComplaint=fever', () => {
      const state = new SessionState();
      state.slotMemory.chiefComplaint = 'fever';
      const closing = buildClosing([], 'CLINICAL', state);
      expect(closing.toLowerCase()).toContain('patient');
    });

    it('returns patient closing with chiefComplaint=pneumonia', () => {
      const state = new SessionState();
      state.slotMemory.chiefComplaint = 'pneumonia';
      const closing = buildClosing([], 'DETAIL', state);
      expect(closing.toLowerCase()).toContain('patient');
    });
  });

  /* ─── Bug 4: anti-repetition (4 fixtures) ─── */

  describe('anti-repetition', () => {
    it('never repeats the same closing line twice in a row (patient context)', () => {
      const state = new SessionState();
      state.slotMemory.chiefComplaint = 'malaria';

      const first = buildClosing([], 'CLINICAL', state);
      expect(first).toBe('Anything else about this patient?');

      const second = buildClosing([], 'CLINICAL', state);
      expect(second).not.toBe('Anything else about this patient?');
    });

    it('never repeats for knowledge query closing', () => {
      const state = new SessionState();

      const first = buildClosing([], 'CLINICAL', state);
      expect(first).toBe('Want to know more about this?');

      const second = buildClosing([], 'CLINICAL', state);
      expect(second).not.toBe('Want to know more about this?');
    });

    it('never repeats for gap-based closing', () => {
      const state = new SessionState();

      const first = buildClosing(['dosage'], 'CLINICAL', state);
      expect(first).toBe('Should I give you the specific dose?');

      const second = buildClosing(['dosage'], 'CLINICAL', state);
      expect(second).not.toBe('Should I give you the specific dose?');
    });

    it('never repeats for AFFIRM closing', () => {
      const state = new SessionState();

      const first = buildClosing([], 'AFFIRM', state);
      expect(first).toBe('Happy to help with anything else.');

      const second = buildClosing([], 'AFFIRM', state);
      expect(second).not.toBe('Happy to help with anything else.');
    });
  });
});

/* ─── hasAnyPatientSlot ─── */

describe('hasAnyPatientSlot', () => {
  it('returns false for fully empty SlotMemory', () => {
    const slots: SlotMemory = {
      patientAge: null,
      patientAgeMonths: null,
      patientWeight: null,
      patientWeightKg: null,
      chiefComplaint: null,
      currentDrug: null,
      gender: null,
    };
    expect(hasAnyPatientSlot(slots)).toBe(false);
  });

  it('returns true if patientAge is set', () => {
    const slots: SlotMemory = {
      patientAge: '2 year',
      patientAgeMonths: 24,
      patientWeight: null,
      patientWeightKg: null,
      chiefComplaint: null,
      currentDrug: null,
      gender: null,
    };
    expect(hasAnyPatientSlot(slots)).toBe(true);
  });

  it('returns true if patientWeight is set', () => {
    const slots: SlotMemory = {
      patientAge: null,
      patientAgeMonths: null,
      patientWeight: '15 kg',
      patientWeightKg: 15,
      chiefComplaint: null,
      currentDrug: null,
      gender: null,
    };
    expect(hasAnyPatientSlot(slots)).toBe(true);
  });

  it('returns true if chiefComplaint is set', () => {
    const slots: SlotMemory = {
      patientAge: null,
      patientAgeMonths: null,
      patientWeight: null,
      patientWeightKg: null,
      chiefComplaint: 'malaria',
      currentDrug: null,
      gender: null,
    };
    expect(hasAnyPatientSlot(slots)).toBe(true);
  });

  it('returns true if currentDrug is set', () => {
    const slots: SlotMemory = {
      patientAge: null,
      patientAgeMonths: null,
      patientWeight: null,
      patientWeightKg: null,
      chiefComplaint: null,
      currentDrug: 'ACT',
      gender: null,
    };
    expect(hasAnyPatientSlot(slots)).toBe(true);
  });
});

describe('buildFollowUpChips', () => {
  it('generates chips from pending gaps as natural language', () => {
    const state = new SessionState();
    const chips = buildFollowUpChips(['dosage', 'referral'], {}, 'c1', new Map(), 3);
    expect(chips).toContain("What's the dose?");
    expect(chips).toContain('When to refer?');
  });

  it('maps all 8 aspect keys to human phrases', () => {
    const aspects = ['dosage', 'referral', 'danger_signs', 'procedure', 'side_effects', 'contraindications', 'coverage', 'definition'];
    const state = new SessionState();
    const chips = buildFollowUpChips(aspects, {}, 'c1', new Map(), 8);
    expect(chips).toContain("What's the dose?");
    expect(chips).toContain('When to refer?');
    expect(chips).toContain('What are the danger signs?');
    expect(chips).toContain('How to do it step by step?');
    expect(chips).toContain('Any side effects?');
    expect(chips).toContain('Who should not receive this?');
    expect(chips).toContain('What does this cover?');
    expect(chips).toContain('What exactly is this?');
  });

  it('uses gap graph labels when available', () => {
    const gapGraph = {
      c1: [{ to: 'c2', score: 0.9, label: 'Side effects' }],
    };
    const state = new SessionState();
    const chips = buildFollowUpChips(['dosage'], gapGraph, 'c1', new Map(), 3);
    expect(chips).toContain("What's the dose?");
    expect(chips).toContain('Side effects?');
  });

  it('uses target chunk primary_question when gap graph has no label', () => {
    const gapGraph = {
      c1: [{ to: 'c2', score: 0.9 }],
    };
    const chunkMap = new Map([
      ['c2', { id: 'c2', content: { en: { primary_question: 'What are the side effects of ACT' } } }],
    ]);
    const state = new SessionState();
    const chips = buildFollowUpChips(['dosage'], gapGraph, 'c1', chunkMap, 3);
    expect(chips).toContain("What's the dose?");
    expect(chips).toContain('What are the side effects of ACT?');
  });

  it('truncates long primary_question to 40 chars with question mark', () => {
    const gapGraph = {
      c1: [{ to: 'c2', score: 0.9 }],
    };
    const longQ = 'What are the very long side effects of artemisinin combination therapy';
    const chunkMap = new Map([
      ['c2', { id: 'c2', content: { en: { primary_question: longQ } } }],
    ]);
    const state = new SessionState();
    const chips = buildFollowUpChips(['dosage'], gapGraph, 'c1', chunkMap, 3);
    const chip = chips.find((c) => c.startsWith('What are the very'));
    expect(chip).toBeDefined();
    expect(chip!.length).toBeLessThanOrEqual(43); // 37 + "...?"
    expect(chip!.endsWith('?')).toBe(true);
  });

  it('always returns at least 2 chips (pads with fallbacks)', () => {
    const state = new SessionState();
    const chips = buildFollowUpChips([], {}, 'c1', new Map(), 3);
    expect(chips.length).toBeGreaterThanOrEqual(2);
    expect(chips).toContain('Tell me more');
    expect(chips).toContain('When to refer?');
  });

  it('returns at least 2 chips even with only one pending gap', () => {
    const state = new SessionState();
    const chips = buildFollowUpChips(['dosage'], {}, 'c1', new Map(), 3);
    expect(chips.length).toBeGreaterThanOrEqual(2);
  });

  it('respects topK limit', () => {
    const state = new SessionState();
    const chips = buildFollowUpChips(
      ['dosage', 'referral', 'danger_signs', 'procedure'],
      {},
      'c1',
      new Map(),
      2
    );
    expect(chips.length).toBeLessThanOrEqual(2);
  });
});
