/**
 * edgeBrainService.test.ts — Tests for Edge Brain grounding check
 *
 * Note: These tests only cover the grounding check logic. Model loading and
 * generation tests require a real model file and native plugin, so they are
 * tested manually on device.
 */

import { describe, it, expect } from 'vitest';
import { checkGrounding } from '@/services/edgeBrainService';

describe('checkGrounding', () => {
  it('passes when output is INSUFFICIENT_EVIDENCE', () => {
    const result = checkGrounding('INSUFFICIENT_EVIDENCE', 'any evidence');
    expect(result.grounded).toBe(true);
    expect(result.score).toBe(1.0);
    expect(result.unmatchedTerms).toEqual([]);
  });

  it('passes when all key terms are present in evidence', () => {
    const evidence = `
      Amoxicillin is used for bacterial infections.
      Dosage: 500mg three times daily for 7 days.
      Age range: 6 months to 5 years.
    `;

    const generated = 'Amoxicillin 500mg three times daily for 7 days.';

    const result = checkGrounding(generated, evidence);
    expect(result.grounded).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.7);
  });

  it('fails when generated text contains fabricated drug name', () => {
    const evidence = `
      Amoxicillin is used for bacterial infections.
      Dosage: 500mg three times daily for 7 days.
    `;

    const generated = 'Give Fabricazole 250mg twice daily and Amoxicillin 500mg for infections.';

    const result = checkGrounding(generated, evidence);
    expect(result.grounded).toBe(false);
    expect(result.unmatchedTerms).toContain('Fabricazole');
  });

  it('fails when generated dosage is not in evidence', () => {
    const evidence = `
      Paracetamol dosage: 10-15mg/kg every 6 hours.
      Maximum: 60mg/kg per day.
    `;

    const generated = 'Give Paracetamol 250mg every 4 hours for children 10-15kg.';

    const result = checkGrounding(generated, evidence);
    // 250mg is not in the evidence, 4 hours is not in the evidence
    expect(result.score).toBeLessThan(0.7);
  });

  it('passes when dosage and duration match evidence', () => {
    const evidence = `
      Azithromycin for respiratory infections.
      Dosage: 10mg/kg once daily for 3 days.
      Weight range: 15-25kg.
    `;

    const generated = 'Give Azithromycin 10mg/kg once daily for 3 days. Suitable for children 15-25kg.';

    const result = checkGrounding(generated, evidence);
    expect(result.grounded).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.7);
  });

  it('extracts numeric dosages correctly', () => {
    const evidence = 'Vitamin K: 1mg IM at birth.';
    const generated = 'Vitamin K 1mg IM at birth.';

    const result = checkGrounding(generated, evidence);
    expect(result.grounded).toBe(true);
  });

  it('extracts weight ranges correctly', () => {
    const evidence = 'For children 10-20kg: give half dose.';
    const generated = 'Children weighing 10-20kg should receive half the adult dose.';

    const result = checkGrounding(generated, evidence);
    expect(result.grounded).toBe(true);
  });

  it('extracts duration patterns correctly', () => {
    const evidence = 'Continue treatment for 10 days even if symptoms improve.';
    const generated = 'Treatment must continue for 10 days.';

    const result = checkGrounding(generated, evidence);
    expect(result.grounded).toBe(true);
  });

  it('fails when generated text has no extractable key terms', () => {
    const evidence = 'Some medical information here.';
    const generated = 'yes';

    const result = checkGrounding(generated, evidence);
    expect(result.grounded).toBe(false);
    expect(result.score).toBe(0);
  });

  it('calculates score correctly at boundary (70% threshold)', () => {
    const evidence = `
      Drug A, Drug B, Drug C are used.
      Dosages: 100mg, 200mg, 300mg.
    `;

    // 3 terms match (Drug A, 100mg, 200mg), 1 does not (Drug D) → 75% score → grounded
    const generated1 = 'Drug A 100mg and 200mg, or Drug D.';
    const result1 = checkGrounding(generated1, evidence);
    expect(result1.grounded).toBe(true);
    expect(result1.score).toBeGreaterThanOrEqual(0.7);

    // 2 terms match, 2 do not → 50% score → not grounded
    const generated2 = 'Drug A 100mg, Drug D 400mg.';
    const result2 = checkGrounding(generated2, evidence);
    expect(result2.grounded).toBe(false);
    expect(result2.score).toBeLessThan(0.7);
  });
});
