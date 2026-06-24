/**
 * intentEngine.test.ts — Intent classification, sentiment probing, and gap detection tests
 */

import { describe, it, expect } from 'vitest';
import { classifyIntent, probeSentiment, detectGaps, isAmbiguousInput, INTENT_PATTERNS } from '@/engine/intentEngine';
import SessionState from '@/engine/sessionState';

describe('classifyIntent', () => {
  it('classifies URGENT: "child is convulsing"', () => {
    expect(classifyIntent('child is convulsing')).toBe('URGENT');
  });

  it('classifies URGENT: "not breathing"', () => {
    expect(classifyIntent('not breathing')).toBe('URGENT');
  });

  it('classifies URGENT: "severe bleeding"', () => {
    expect(classifyIntent('severe bleeding')).toBe('URGENT');
  });

  it('classifies DEFINE: "what is malaria"', () => {
    expect(classifyIntent('what is malaria')).toBe('DEFINE');
  });

  it('classifies DEFINE: "explain pneumonia"', () => {
    expect(classifyIntent('explain pneumonia')).toBe('DEFINE');
  });

  it('classifies SCOPE: "what does it cover"', () => {
    expect(classifyIntent('what does it cover')).toBe('SCOPE');
  });

  it('classifies SCOPE: "what topics are included"', () => {
    expect(classifyIntent('what topics are included')).toBe('SCOPE');
  });

  it('classifies DETAIL: "what dosage"', () => {
    expect(classifyIntent('what dosage')).toBe('DETAIL');
  });

  it('classifies DETAIL: "how much paracetamol"', () => {
    expect(classifyIntent('how much paracetamol')).toBe('DETAIL');
  });

  it('classifies PROCEDURE: "how do I treat"', () => {
    expect(classifyIntent('how do I treat')).toBe('PROCEDURE');
  });

  it('classifies PROCEDURE: "steps for resuscitation"', () => {
    expect(classifyIntent('steps for resuscitation')).toBe('PROCEDURE');
  });

  it('classifies REFERRAL: "when to refer"', () => {
    expect(classifyIntent('when to refer')).toBe('REFERRAL');
  });

  it('classifies AFFIRM: "yes"', () => {
    expect(classifyIntent('yes')).toBe('AFFIRM');
  });

  it('classifies AFFIRM: "ok"', () => {
    expect(classifyIntent('ok')).toBe('AFFIRM');
  });

  it('classifies AFFIRM: "sure"', () => {
    expect(classifyIntent('sure')).toBe('AFFIRM');
  });

  it('classifies NEGATE: "no"', () => {
    expect(classifyIntent('no')).toBe('NEGATE');
  });

  it('classifies NEGATE: "wrong"', () => {
    expect(classifyIntent('wrong')).toBe('NEGATE');
  });

  it('classifies GREETING: "hello"', () => {
    expect(classifyIntent('hello')).toBe('GREETING');
  });

  it('classifies GREETING: "good morning"', () => {
    expect(classifyIntent('good morning')).toBe('GREETING');
  });

  it('classifies HEADING_LOOKUP: "malaria treatment"', () => {
    expect(classifyIntent('malaria treatment')).toBe('HEADING_LOOKUP');
  });

  it('classifies HEADING_LOOKUP: "my patient has fever"', () => {
    expect(classifyIntent('my patient has fever')).toBe('HEADING_LOOKUP');
  });

  it('classifies HEADING_LOOKUP: "Outbreak Preparedness and Response"', () => {
    expect(classifyIntent('Outbreak Preparedness and Response')).toBe('HEADING_LOOKUP');
  });

  it('classifies CLINICAL not HEADING_LOOKUP: "whats ANC?"', () => {
    // "whats" has a question-word prefix so isAmbiguousInput is false;
    // but it also does not match the DEFINE regex, so it falls to CLINICAL
    expect(classifyIntent('whats ANC?')).toBe('CLINICAL');
  });
});

describe('isAmbiguousInput', () => {
  it('returns true for short topic-like input without verb', () => {
    expect(isAmbiguousInput('malaria')).toBe(true);
  });

  it('returns true for 5-token input without verb', () => {
    expect(isAmbiguousInput('Outbreak Preparedness and Response')).toBe(true);
  });

  it('returns false for input with question word', () => {
    expect(isAmbiguousInput('what is malaria')).toBe(false);
  });

  it('returns false for input with verb', () => {
    expect(isAmbiguousInput('tell me about malaria')).toBe(false);
  });

  it('returns false for long input', () => {
    expect(isAmbiguousInput('my patient has malaria for three days')).toBe(false);
  });

  it('returns true for single word topic', () => {
    expect(isAmbiguousInput('ANC')).toBe(true);
  });

  it('returns false for input starting with question word', () => {
    expect(isAmbiguousInput('whats ANC?')).toBe(false);
  });

  it('returns true for short phrase without verb', () => {
    expect(isAmbiguousInput('newborn care')).toBe(true);
  });

  it('returns false for input with how', () => {
    expect(isAmbiguousInput('how to treat')).toBe(false);
  });

  it('returns true for 5-token heading without verb', () => {
    expect(isAmbiguousInput('Basic Emergency Obstetric Care')).toBe(true);
  });
});

describe('probeSentiment', () => {
  it('detects panic: "help me emergency"', () => {
    expect(probeSentiment('help me emergency')).toBe('panic');
  });

  it('detects confused: "I don\'t understand"', () => {
    expect(probeSentiment("I don't understand")).toBe('confused');
  });

  it('detects affirm: "thank you"', () => {
    expect(probeSentiment('thank you')).toBe('affirm');
  });

  it('defaults to calm', () => {
    expect(probeSentiment('tell me about malaria')).toBe('calm');
  });
});

describe('detectGaps', () => {
  it('returns prioritized uncovered aspects', () => {
    const sessionState = new SessionState();
    sessionState.currentTopic = 'malaria';
    sessionState.markAspectsCovered(['definition']);

    const coverageManifest = {
      topics: {
        malaria: {
          aspects_covered: ['definition', 'dosage', 'referral', 'danger_signs', 'procedure'],
        },
      },
    };

    const gaps = detectGaps('malaria', coverageManifest, sessionState);
    expect(gaps).toEqual(['dosage', 'referral', 'danger_signs']);
  });

  it('returns empty array when all aspects are covered', () => {
    const sessionState = new SessionState();
    sessionState.currentTopic = 'malaria';
    sessionState.markAspectsCovered(['definition', 'dosage']);

    const coverageManifest = {
      topics: {
        malaria: {
          aspects_covered: ['definition', 'dosage'],
        },
      },
    };

    expect(detectGaps('malaria', coverageManifest, sessionState)).toEqual([]);
  });

  it('returns empty array for unknown topic', () => {
    const sessionState = new SessionState();
    expect(detectGaps('unknown', { topics: {} }, sessionState)).toEqual([]);
  });

  it('limits to 3 gaps', () => {
    const sessionState = new SessionState();
    const coverageManifest = {
      topics: {
        malaria: {
          aspects_covered: ['dosage', 'referral', 'danger_signs', 'procedure', 'side_effects', 'contraindications'],
        },
      },
    };
    const gaps = detectGaps('malaria', coverageManifest, sessionState);
    expect(gaps).toHaveLength(3);
  });
});

describe('INTENT_PATTERNS', () => {
  it('has 10 intent patterns defined', () => {
    expect(Object.keys(INTENT_PATTERNS)).toHaveLength(10);
  });
});
