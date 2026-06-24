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
  HEADING_LOOKUP: null, // handled by isAmbiguousInput pre-check
};

const SENTIMENT_PATTERNS: Record<string, RegExp | null> = {
  panic: /urgent|emergency|dying|help me|please|scared|worried|afraid|crisis/i,
  confused: /don.t understand|not clear|what do you mean|confused|again|repeat/i,
  affirm: /thanks|thank you|good|got it|understood|ok|noted|clear/i,
  calm: null,
};

function tokenize(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
}

/**
 * Detect short/ambiguous inputs that look like topic headings rather than questions.
 * @param query — raw user query
 * @returns true if input is too short and lacks verbs/question words
 */
export function isAmbiguousInput(query: string): boolean {
  const tokens = tokenize(query);
  const hasVerb = /\b(is|are|was|were|do|does|did|what|how|when|where|why|tell|explain|give|show)\b/i.test(query);
  const hasQuestionWord = /^(what|how|when|where|why|who|which|can|should|does)/i.test(query.trim());
  return tokens.length <= 5 && !hasVerb && !hasQuestionWord;
}

/**
 * Classify primary intent from query.
 * @param query — raw user query
 * @returns intent class string (e.g. 'URGENT', 'DEFINE', 'CLINICAL')
 */
export function classifyIntent(query: string): string {
  const lower = query.toLowerCase().trim();

  // First pass: check explicit intent patterns (HEADING_LOOKUP is fallback only)
  for (const [intent, pattern] of Object.entries(INTENT_PATTERNS)) {
    if (intent === 'HEADING_LOOKUP') continue;
    if (pattern && pattern.test(lower)) {
      return intent;
    }
  }

  // Fallback: ambiguous short inputs → HEADING_LOOKUP
  if (isAmbiguousInput(query)) {
    return 'HEADING_LOOKUP';
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

  // Use aspects_covered from manifest — these are aspects that
  // actually exist in THIS document for THIS topic
  const documentAspects = topicData.aspects_covered ?? [];

  // Find which of these the user has NOT yet seen
  const uncovered = documentAspects.filter(
    a => !sessionState.coveredAspects.has(a)
  );

  if (uncovered.length === 0) return [];

  // Prioritize known high-value aspects, then alphabetical
  const PRIORITY = [
    'dosage', 'referral', 'danger_signs', 'procedure',
    'eligibility', 'accreditation', 'registration', 'equipment',
    'coverage', 'contraindications', 'exclusions', 'membership',
    'requirements', 'compliance', 'penalties', 'administration',
  ];

  const prioritized = PRIORITY.filter(a => uncovered.includes(a));
  const remaining = uncovered
    .filter(a => !PRIORITY.includes(a))
    .sort();

  return [...prioritized, ...remaining].slice(0, 3);
}
