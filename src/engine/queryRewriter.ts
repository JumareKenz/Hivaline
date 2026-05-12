/**
 * queryRewriter.ts — Four-stage query rewriter
 *
 * 1. Pronoun resolution
 * 2. Gap injection
 * 3. Slot injection
 * 4. Topic continuity
 */

import type SessionState from './sessionState';

const PRONOUNS = new Set(['it', 'this', 'that', 'they', 'them', 'their', 'its', 'those']);

const CLINICAL_KEYWORDS = [
  'fever', 'malaria', 'diarrhea', 'vomiting', 'convulsion',
  'rash', 'cough', 'bleeding', 'jaundice', 'anaemia',
  'pneumonia', 'dehydration', 'malnutrition',
  'delivery', 'labour', 'pregnancy', 'anc',
  'pph', 'postpartum', 'hemorrhage', 'haemorrhage',
  'pre-eclampsia', 'preeclampsia', 'hypertension', 'eclampsia',
  'sepsis', 'obstructed labour', 'prolonged labour',
  'retained placenta', 'perineal tear', 'episiotomy',
  'newborn', 'neonatal', 'asphyxia', 'resuscitation',
  'immunization', 'vaccination', 'family planning', 'contraception',
  'sti', 'hiv', 'tb', 'nutrition', 'anemia',
  'blood pressure', 'sugar', 'diabetes',
  'injury', 'burn', 'fracture', 'wound', 'infection',
];

export interface RewrittenQuery {
  original: string;
  rewritten: string;
  detectedTopic: string | null;
  isTopicShift: boolean;
}

/**
 * Rewrite query with pronoun resolution, gap injection, slot injection, and topic continuity.
 * @param query — raw user query
 * @param intent — classified intent
 * @param sessionState — current session state
 * @returns RewrittenQuery object
 */
export function rewriteQuery(query: string, intent: string, sessionState: SessionState): RewrittenQuery {
  const original = query;
  let rewritten = query;

  // Stage 1: Pronoun resolution
  if (sessionState.currentTopic) {
    const pronounPattern = new RegExp('\\b(' + Array.from(PRONOUNS).join('|') + ')\\b', 'gi');
    rewritten = rewritten.replace(pronounPattern, sessionState.currentTopic);
  }

  // Stage 2: Gap injection
  const isAffirmOrFollowUp = intent === 'AFFIRM' || intent === 'FOLLOW_UP' || intent === 'CLINICAL';
  if (isAffirmOrFollowUp && sessionState.pendingGaps.length > 0) {
    rewritten += ' ' + sessionState.pendingGaps[0];
  }

  // Stage 3: Slot injection
  const slots = sessionState.slotMemory;
  if (slots.chiefComplaint) {
    rewritten += ' ' + slots.chiefComplaint;
  }
  if (slots.patientAgeMonths !== null) {
    rewritten += slots.patientAgeMonths < 24 ? ' infant neonate' : ' child';
  }

  // Stage 4: Topic continuity
  const clinicalKeywordCount = countClinicalKeywords(rewritten);
  if (clinicalKeywordCount < 2 && sessionState.currentTopic) {
    rewritten = sessionState.currentTopic + ' ' + rewritten;
  }

  // Detect topic shift
  const detectedTopic = extractTopic(rewritten) || sessionState.currentTopic;
  const isTopicShift = sessionState.detectTopicShift(detectedTopic);

  return {
    original,
    rewritten: deduplicateTerms(rewritten),
    detectedTopic,
    isTopicShift,
  };
}

function countClinicalKeywords(text: string): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (const kw of CLINICAL_KEYWORDS) {
    if (lower.includes(kw)) count++;
  }
  return count;
}

function extractTopic(text: string): string | null {
  const lower = text.toLowerCase();
  for (const kw of CLINICAL_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

function deduplicateTerms(query: string): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const part of query.split(/\s+/)) {
    const normalized = part.toLowerCase().replace(/[^\w]/g, '');
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    parts.push(part);
  }
  return parts.join(' ');
}
