/**
 * intentEngine.ts — Two-stage intent classifier + gap detection
 *
 * Stage 1: Primary intent classification
 * Stage 2: Sentiment probing
 * Gap detection: compute which aspects the user likely still needs
 */

import type SessionState from './sessionState';

export const INTENT_PATTERNS: Record<string, RegExp | null> = {
  URGENT: /convuls|not breath|uncon|severe bleed|collapse|fitting|not waking|emergency/i,
  DEFINE: /\bwhat is\b|\bwhat are\b|tell me about|explain|define|meaning of/i,
  SCOPE: /what does.{0,20}cover|what topics|what does it include|what is included/i,
  DETAIL: /specific|exact|how much|dosage|dose|how many|quantity|amount/i,
  PROCEDURE: /how to|how do i|steps|protocol|process|procedure|method/i,
  REFERRAL: /when to refer|when should|when is it serious|when to send|refer/i,
  AFFIRM: /^yes[.!?]?$|^yeah$|^ok$|^okay$|correct|right|exactly|sure/i,
  NEGATE: /^no[.!?]?$|not that|wrong|different|other|else/i,
  GREETING: /^(hi|hello|good morning|good afternoon|salam|ẹ káàbọ̀|ndewo)[\s!.?]*$/i,
};

const SENTIMENT_PATTERNS: Record<string, RegExp | null> = {
  panic: /urgent|emergency|dying|help me|please|scared|worried|afraid|crisis/i,
  confused: /don.t understand|not clear|what do you mean|confused|again|repeat/i,
  affirm: /thanks|thank you|good|got it|understood|ok|noted|clear/i,
  calm: null,
};

/**
 * Classify primary intent from query.
 * @param query — raw user query
 * @returns intent class string (e.g. 'URGENT', 'DEFINE', 'CLINICAL')
 */
export function classifyIntent(query: string): string {
  const lower = query.toLowerCase().trim();
  for (const [intent, pattern] of Object.entries(INTENT_PATTERNS)) {
    if (pattern && pattern.test(lower)) {
      return intent;
    }
  }
  return 'CLINICAL';
}

/**
 * Probe sentiment from query.
 * @param query — raw user query
 * @returns sentiment label: 'panic' | 'confused' | 'affirm' | 'calm'
 */
export function probeSentiment(query: string): string {
  const lower = query.toLowerCase().trim();
  for (const [sentiment, pattern] of Object.entries(SENTIMENT_PATTERNS)) {
    if (pattern && pattern.test(lower)) {
      return sentiment;
    }
  }
  return 'calm';
}

export interface CoverageManifest {
  topics: Record<string, { aspects_covered: string[] }>;
}

/**
 * Detect which aspects the user is likely to need next.
 * @param topic — current clinical topic string
 * @param coverageManifest — parsed index/coverage_manifest.json from .hiv
 * @param sessionState — current SessionState instance
 * @returns array of up to 3 prioritized aspect strings
 */
export function detectGaps(topic: string, coverageManifest: CoverageManifest, sessionState: SessionState): string[] {
  const topicData = coverageManifest?.topics?.[topic];
  if (!topicData) return [];
  const uncovered = sessionState.getUncoveredAspects(topicData.aspects_covered || []);
  const priority = ['dosage', 'referral', 'danger_signs', 'procedure', 'side_effects', 'contraindications', 'coverage', 'prognosis'];
  return priority.filter((a) => uncovered.includes(a)).slice(0, 3);
}
