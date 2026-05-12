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
} from '@/engine/answerAssembler';
import SessionState from '@/engine/sessionState';

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
});

describe('buildClosing', () => {
  it('returns urgent closing for URGENT intent', () => {
    expect(buildClosing([], 'URGENT', 1)).toBe('Is the patient stable right now?');
  });

  it('returns generic closing when no pending gaps', () => {
    expect(buildClosing([], 'CLINICAL', 1)).toBe('Anything else about this patient?');
  });

  it('returns dosage closing when dosage is pending', () => {
    expect(buildClosing(['dosage'], 'CLINICAL', 1)).toBe('Should I give you the specific dose?');
  });

  it('returns referral closing when referral is pending', () => {
    expect(buildClosing(['referral'], 'CLINICAL', 1)).toBe('Do you need to know when to refer?');
  });

  it('returns danger_signs closing', () => {
    expect(buildClosing(['danger_signs'], 'CLINICAL', 1)).toBe('Want the danger signs to watch for?');
  });
});

describe('buildFollowUpChips', () => {
  it('generates chips from pending gaps', () => {
    const chips = buildFollowUpChips(['dosage', 'referral'], {}, 'c1', 3);
    expect(chips).toContain('Get dosage');
    expect(chips).toContain('When to refer');
  });

  it('includes gap graph labels when available', () => {
    const gapGraph = {
      c1: [{ to: 'c2', score: 0.9, label: 'Side effects' }],
    };
    const chips = buildFollowUpChips(['dosage'], gapGraph, 'c1', 3);
    expect(chips).toContain('Get dosage');
    expect(chips).toContain('Side effects');
  });

  it('respects topK limit', () => {
    const chips = buildFollowUpChips(['dosage', 'referral', 'danger_signs', 'procedure'], {}, 'c1', 2);
    expect(chips).toHaveLength(2);
  });
});
