/**
 * phase29Fixes.test.ts — Regression tests for all Phase 29 audit fixes
 *
 * Covers:
 * - H1: DEFINE/DETAIL composite resolution
 * - M4: Expanded verb detection
 * - M5: Correction detection
 * - M3: Clinical presence check
 * - L1: Fuzzy typo correction
 * - L2: Pidgin/local language normalization
 */

import { describe, it, expect } from 'vitest';
import { classifyIntent, isAmbiguousInput, detectCorrection } from '@/engine/intentEngine';
import { normalizeQuery, hasClinicalPresence } from '@/engine/fuzzyNormalizer';
import { rewriteQuery } from '@/engine/queryRewriter';
import SessionState from '@/engine/sessionState';

/* ═══════════════════════════════════════════════════════════════
   H1 FIX: DEFINE vs DETAIL Composite Resolution
   ═══════════════════════════════════════════════════════════════ */

describe('H1 Fix: DETAIL wins over DEFINE for dose queries', () => {
  it('"what is the dose" → DETAIL', () => {
    expect(classifyIntent('what is the dose')).toBe('DETAIL');
  });

  it('"what is the dosage for a child" → DETAIL', () => {
    expect(classifyIntent('what is the dosage for a child')).toBe('DETAIL');
  });

  it('"what is the correct amount" → DETAIL', () => {
    expect(classifyIntent('what is the correct amount')).toBe('DETAIL');
  });

  it('"how much should I give" → DETAIL', () => {
    expect(classifyIntent('how much should I give')).toBe('DETAIL');
  });

  it('"what is malaria" → still DEFINE (no dose terms)', () => {
    expect(classifyIntent('what is malaria')).toBe('DEFINE');
  });

  it('"what are the symptoms" → still DEFINE', () => {
    expect(classifyIntent('what are the symptoms')).toBe('DEFINE');
  });

  it('URGENT always wins even with dose words', () => {
    expect(classifyIntent('convulsions what is the dose')).toBe('URGENT');
  });

  it('REFERRAL wins over PROCEDURE', () => {
    expect(classifyIntent('when should I refer this patient')).toBe('REFERRAL');
  });
});

/* ═══════════════════════════════════════════════════════════════
   M4 FIX: Expanded Verb Detection
   ═══════════════════════════════════════════════════════════════ */

describe('M4 Fix: Expanded verb detection in isAmbiguousInput', () => {
  it('"I meant TB" is NOT ambiguous (has verb "meant")', () => {
    expect(isAmbiguousInput('I meant TB')).toBe(false);
  });

  it('"I was thinking pneumonia" is NOT ambiguous', () => {
    expect(isAmbiguousInput('I was thinking pneumonia')).toBe(false);
  });

  it('"need malaria dose" is NOT ambiguous', () => {
    expect(isAmbiguousInput('need malaria dose')).toBe(false);
  });

  it('"got it" is NOT ambiguous (has verb "got")', () => {
    expect(isAmbiguousInput('got it')).toBe(false);
  });

  it('"malaria" alone IS still ambiguous (1 token, no verb)', () => {
    expect(isAmbiguousInput('malaria')).toBe(true);
  });

  it('"TB HIV coinfection" IS ambiguous (no verb, ≤5 tokens)', () => {
    expect(isAmbiguousInput('TB HIV coinfection')).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════
   M5 FIX: Correction Detection
   ═══════════════════════════════════════════════════════════════ */

describe('M5 Fix: Negation + correction detection', () => {
  it('"no I meant TB" → detects correction "tb"', () => {
    const correction = detectCorrection('no I meant TB');
    expect(correction).toBe('tb');
  });

  it('"actually pneumonia" → detects correction "pneumonia"', () => {
    const correction = detectCorrection('actually pneumonia');
    expect(correction).toBe('pneumonia');
  });

  it('"not malaria" → detects correction "malaria" (simple negation)', () => {
    const correction = detectCorrection('not malaria');
    expect(correction).toBe('malaria');
  });

  it('"sorry I meant diarrhea" → detects correction', () => {
    const correction = detectCorrection('sorry I meant diarrhea');
    expect(correction).toBe('diarrhea');
  });

  it('"malaria treatment" → NOT a correction', () => {
    expect(detectCorrection('malaria treatment')).toBeNull();
  });

  it('"what is the dose" → NOT a correction', () => {
    expect(detectCorrection('what is the dose')).toBeNull();
  });

  it('"hello" → NOT a correction', () => {
    expect(detectCorrection('hello')).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════
   M3 FIX: Clinical Presence Check
   ═══════════════════════════════════════════════════════════════ */

describe('M3 Fix: Clinical presence detection', () => {
  it('clinical queries have presence', () => {
    expect(hasClinicalPresence('malaria treatment')).toBe(true);
    expect(hasClinicalPresence('child with fever')).toBe(true);
    expect(hasClinicalPresence('what is the dose')).toBe(true);
    expect(hasClinicalPresence('HIV positive pregnant woman')).toBe(true);
    expect(hasClinicalPresence('TB screening')).toBe(true);
  });

  it('non-clinical queries lack presence', () => {
    expect(hasClinicalPresence('how to cook jollof rice')).toBe(false);
    expect(hasClinicalPresence('who won the world cup')).toBe(false);
    expect(hasClinicalPresence('best programming language')).toBe(false);
    expect(hasClinicalPresence('tell me a joke')).toBe(false);
  });

  it('pidgin terms have clinical presence', () => {
    expect(hasClinicalPresence('pikin dey feva')).toBe(true);
    expect(hasClinicalPresence('stooling and purging')).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════
   L1 FIX: Fuzzy Typo Correction
   ═══════════════════════════════════════════════════════════════ */

describe('L1 Fix: Typo correction', () => {
  it('corrects common clinical misspellings', () => {
    expect(normalizeQuery('malarya treetment')).toBe('malaria treatment');
    expect(normalizeQuery('pnemonia')).toBe('pneumonia');
    expect(normalizeQuery('diaroea child')).toContain('diarrhea');
    expect(normalizeQuery('amoxcilin')).toContain('amoxicillin');
    expect(normalizeQuery('imunization skedule')).toContain('immunization');
    expect(normalizeQuery('imunization skedule')).toContain('schedule');
  });

  it('preserves correctly spelled words', () => {
    expect(normalizeQuery('malaria treatment')).toBe('malaria treatment');
    expect(normalizeQuery('pneumonia in child')).toBe('pneumonia in child');
  });

  it('corrects drug name misspellings', () => {
    expect(normalizeQuery('artesunete')).toContain('artesunate');
    expect(normalizeQuery('oxitocin')).toContain('oxytocin');
    expect(normalizeQuery('paracetemol')).toContain('paracetamol');
  });

  it('handles mixed correct and incorrect', () => {
    const result = normalizeQuery('malarya dose for child');
    expect(result).toContain('malaria');
    expect(result).toContain('dose');
    expect(result).toContain('child');
  });
});

/* ═══════════════════════════════════════════════════════════════
   L2 FIX: Pidgin / Local Language Normalization
   ═══════════════════════════════════════════════════════════════ */

describe('L2 Fix: Pidgin and local language support', () => {
  it('expands single pidgin words', () => {
    expect(normalizeQuery('pikin')).toContain('child');
    expect(normalizeQuery('feva')).toContain('fever');
    expect(normalizeQuery('cof')).toContain('cough');
    expect(normalizeQuery('stooling')).toContain('diarrhea');
  });

  it('expands multi-word pidgin phrases', () => {
    expect(normalizeQuery('hot body')).toContain('fever');
    expect(normalizeQuery('weak body')).toContain('fatigue');
    expect(normalizeQuery('yellow eye')).toContain('jaundice');
    expect(normalizeQuery('run belly')).toContain('diarrhea');
  });

  it('handles mixed pidgin and English', () => {
    const result = normalizeQuery('pikin dey feva and cof');
    expect(result).toContain('child');
    expect(result).toContain('fever');
    expect(result).toContain('cough');
  });

  it('expands informal medical terms', () => {
    expect(normalizeQuery('sugar')).toContain('diabetes');
    expect(normalizeQuery('pressure')).toContain('hypertension');
    expect(normalizeQuery('drip')).toContain('IV fluids');
  });
});

/* ═══════════════════════════════════════════════════════════════
   INTEGRATION: Rewriter pipeline with fuzzy + narrative
   ═══════════════════════════════════════════════════════════════ */

describe('Integration: Rewriter with fuzzy normalization', () => {
  it('typo-corrected query reaches BM25 with correct terms', () => {
    const state = new SessionState();
    const r = rewriteQuery('malarya treetment', 'CLINICAL', state);
    expect(r.rewritten).toContain('malaria');
    expect(r.rewritten).toContain('treatment');
  });

  it('pidgin-expanded query reaches BM25 with clinical terms', () => {
    const state = new SessionState();
    const r = rewriteQuery('pikin feva', 'CLINICAL', state);
    expect(r.rewritten).toContain('child');
    expect(r.rewritten).toContain('fever');
  });

  it('narrative with pidgin is both normalized and extracted', () => {
    const state = new SessionState();
    const r = rewriteQuery(
      'the pikin has been having feva since morning and body hot',
      'CLINICAL',
      state
    );
    expect(r.rewritten).toContain('child');
    expect(r.rewritten).toContain('fever');
  });
});
