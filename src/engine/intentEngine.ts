/**
 * intentEngine.ts — Multi-stage intent classifier + gap detection
 *
 * Stage 1: Composite intent classification with priority resolution
 * Stage 2: Negation/correction detection
 * Stage 3: Sentiment probing
 * Gap detection: compute which aspects the user likely still needs
 */

import type SessionState from './sessionState';

export const INTENT_PATTERNS: Record<string, RegExp | null> = {
  URGENT: /convuls|not breath|uncon|severe bleed|collapse|fitting|not waking|emergency/i,
  DEFINE: /\bwhat is\b|\bwhat are\b|tell me about|explain|define|meaning of/i,
  SCOPE: /what does.{0,20}cover|what topics|what does it include|what is included/i,
  DETAIL: /specific|exact|how much|dosage|dose|how many|quantity|amount|tablet|mg\b|ml\b|administration/i,
  PROCEDURE: /how to|how do i|steps|protocol|process|procedure|method/i,
  REFERRAL: /when to refer|when should|when is it serious|when to send|refer/i,
  AFFIRM: /^yes[.!?]?$|^yeah$|^ok$|^okay$|correct|right|exactly|sure/i,
  NEGATE: /^no[.!?]?$|not that|wrong|different|other|else/i,
  GREETING: /^(hi|hello|good morning|good afternoon|salam|ẹ káàbọ̀|ndewo)[\s!.?]*$/i,
  HEADING_LOOKUP: null, // handled by isAmbiguousInput pre-check
};

/**
 * Dosage-semantic terms that should force DETAIL even when DEFINE also matches.
 * Resolves H1: "what is the dose" → DETAIL, not DEFINE.
 */
const DOSAGE_TERMS = /\b(dose|dosage|how much|how many|tablet|capsule|mg|ml|amount|quantity|administration)\b/i;

/**
 * Negation + correction pattern: user is correcting a prior assumption.
 * "no I meant TB", "not malaria, it's pneumonia", "actually diarrhea"
 */
const CORRECTION_PATTERN = /^(?:no|not|nope|sorry|actually)\s*[,.]?\s*(?:i\s*(?:meant?|mean|was\s*(?:talking|asking|referring))|it'?s\s*(?:not|actually)|(?:not\s+)?(?:\w+)[,.]?\s*(?:i\s*mean|actually|rather))/i;
const SIMPLE_CORRECTION = /^(?:no|not|nope|actually|sorry)\s+(?!that\b)(\w[\w\s]{2,30})$/i;

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
 * M4 fix: expanded verb list to include conversational correction verbs.
 */
export function isAmbiguousInput(query: string): boolean {
  const tokens = tokenize(query);
  const hasVerb = /\b(is|are|was|were|do|does|did|what|how|when|where|why|tell|explain|give|show|meant|said|tried|asked|thinking|want|need|got|referring|talking|mean|know|think)\b/i.test(query);
  const hasQuestionWord = /^(what|how|when|where|why|who|which|can|should|does)/i.test(query.trim());
  return tokens.length <= 5 && !hasVerb && !hasQuestionWord;
}

/**
 * Detect if a query is a correction of a previous topic/assumption.
 * Returns the corrected topic if detected, null otherwise.
 */
export function detectCorrection(query: string): string | null {
  const lower = query.toLowerCase().trim();

  if (CORRECTION_PATTERN.test(lower)) {
    const match = lower.match(/(?:meant?|mean|it'?s|actually|rather)\s+(.+?)[\s.!?]*$/);
    if (match) return match[1].trim();
  }

  const simple = lower.match(SIMPLE_CORRECTION);
  if (simple) return simple[1].trim();

  return null;
}

/**
 * Classify primary intent from query.
 * Uses composite resolution: when multiple patterns match, applies priority rules.
 */
export function classifyIntent(query: string): string {
  const lower = query.toLowerCase().trim();

  // URGENT always wins — safety-critical
  if (INTENT_PATTERNS.URGENT!.test(lower)) return 'URGENT';

  // Composite resolution: DEFINE + DETAIL conflict → DETAIL wins when dose terms present
  const matchesDefine = INTENT_PATTERNS.DEFINE!.test(lower);
  const matchesDetail = INTENT_PATTERNS.DETAIL!.test(lower);
  if (matchesDefine && matchesDetail) {
    if (DOSAGE_TERMS.test(lower)) return 'DETAIL';
  }
  if (matchesDetail) return 'DETAIL';

  // REFERRAL before PROCEDURE (safety: referral questions are clinically important)
  if (INTENT_PATTERNS.REFERRAL!.test(lower)) return 'REFERRAL';
  if (INTENT_PATTERNS.PROCEDURE!.test(lower)) return 'PROCEDURE';

  if (INTENT_PATTERNS.SCOPE!.test(lower)) return 'SCOPE';
  if (matchesDefine) return 'DEFINE';

  if (INTENT_PATTERNS.GREETING!.test(lower)) return 'GREETING';
  if (INTENT_PATTERNS.AFFIRM!.test(lower)) return 'AFFIRM';
  if (INTENT_PATTERNS.NEGATE!.test(lower)) return 'NEGATE';

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
