/**
 * queryRewriter.ts — Five-stage query rewriter
 *
 * 1. Pronoun resolution
 * 2. Gap injection
 * 3. Slot injection
 * 4. Topic continuity
 * 5. Clinical synonym expansion (improves BM25 recall for abbreviations)
 */

import type SessionState from './sessionState';
import { isNarrativeQuery, normalizeForBm25 } from './narrativeNormalizer';
import { normalizeQuery } from './fuzzyNormalizer';

/**
 * Clinical synonym map: abbreviation/short-form → expanded terms.
 * These expansions are appended to the rewritten query to improve BM25 recall
 * when the user's phrasing differs from the indexed document vocabulary.
 */
const CLINICAL_SYNONYMS: Record<string, string[]> = {
  // Abbreviation → expansion. Keep expansions specific to avoid flooding BM25
  // with generic terms that match multiple chunks indiscriminately.
  arv: ['antiretroviral'],
  pmtct: ['prevention', 'mother', 'child', 'transmission', 'pregnancy', 'maternal'],
  tpt: ['preventive', 'isoniazid', 'rifapentine', 'tuberculosis'],
  ipt: ['isoniazid', 'preventive', 'tuberculosis'],
  tb: ['tuberculosis', 'coinfection'],
  act: ['artemisinin', 'coartem', 'lumefantrine', 'malaria'],
  kmc: ['kangaroo', 'mother', 'care', 'skin'],
  plhiv: ['people', 'living', 'hiv', 'positive'],
  pph: ['postpartum', 'hemorrhage', 'bleeding'],
  anc: ['antenatal', 'pregnancy'],
  dtg: ['dolutegravir'],
  inh: ['isoniazid'],
  '3hp': ['isoniazid', 'rifapentine', 'preventive'],
  '3hr': ['isoniazid', 'rifampicin', 'preventive'],
  '6h': ['isoniazid', 'preventive'],
  sti: ['sexually', 'transmitted', 'infection'],
  imnci: ['integrated', 'neonatal', 'childhood', 'illness'],
  ors: ['oral', 'rehydration'],
  pregnant: ['pregnancy', 'maternal', 'pmtct'],
  failure: ['virologic', 'viral', 'load', 'resistance'],
  coinfection: ['co-infection'],
  // "complicated malaria" is CHEW-standard phrasing; indexed content uses "severe malaria"
  complicated: ['severe'],
  mrdt: ['malaria', 'rapid', 'test', 'rdt'],
  // "when to start preventive therapy" → anchor to TPT/isoniazid vocabulary in index
  // NOTE: "prophylaxis" deliberately excluded — it matches wound/surgical prophylaxis chunks
  preventive: ['isoniazid', 'tpt'],
  therapy: ['treatment', 'regimen'],
};

/**
 * Expand clinical abbreviations and synonyms in the query.
 * Appends expansion terms only for tokens that match known abbreviations.
 * Handles hyphenated terms (e.g., "HIV-positive" → check both "hiv" and "positive").
 */
function expandClinicalSynonyms(query: string): string {
  // Split on whitespace, then further split hyphenated tokens
  const rawTokens = query.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
  const tokens: string[] = [];
  for (const t of rawTokens) {
    // Split on hyphens/slashes to handle "HIV-positive", "TB/HIV", etc.
    const parts = t.split(/[-/]/).filter(p => p.length >= 2);
    if (parts.length > 1) {
      tokens.push(...parts);
    } else {
      tokens.push(t.replace(/[^\w]/g, ''));
    }
  }

  const expansions: string[] = [];
  const tokenSet = new Set(tokens);

  for (const token of tokens) {
    const synonyms = CLINICAL_SYNONYMS[token];
    if (synonyms) {
      for (const syn of synonyms) {
        if (!tokenSet.has(syn) && !expansions.includes(syn)) {
          expansions.push(syn);
        }
      }
    }
  }

  if (expansions.length === 0) return query;
  return query + ' ' + expansions.join(' ');
}

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
  bm25Query: string | null;
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

  // Stage 0: Fuzzy normalization — correct typos and expand local language
  let rewritten = normalizeQuery(query);

  // Stage 1: Pronoun resolution — only resolve pronouns to chiefComplaint,
  // NOT to currentTopic. Topic continuity is handled by hybridSearch via
  // sessionState.currentTopic (title match bonus), not by query modification.

  // Stage 2: Gap injection
  const isAffirmOrFollowUp = intent === 'AFFIRM' || intent === 'FOLLOW_UP' || intent === 'CLINICAL' || intent === 'HEADING_LOOKUP';
  if (isAffirmOrFollowUp && sessionState.pendingGaps.length > 0) {
    rewritten += ' ' + sessionState.pendingGaps[0];
  }

  // Stage 2b: HEADING_LOOKUP expansion
  if (intent === 'HEADING_LOOKUP') {
    rewritten += ' what is overview definition';
  }

  // Stage 3: Slot injection
  const slots = sessionState.slotMemory;
  if (slots.chiefComplaint) {
    rewritten += ' ' + slots.chiefComplaint;
  }
  // Age slot: only inject when the current query references a pediatric patient.
  // Guard 1 — query must mention a patient at all.
  // Guard 2 — query must NOT contain clearly adult-only terms (woman, man, mother,
  //            pregnant, labour, delivery, postnatal) without also mentioning a child.
  //            This prevents a newborn slot from the previous turn bleeding into
  //            "HIV positive pregnant woman ART" or "woman delivered heavy bleeding".
  const queryHasPediatricRef = /\b(baby|infant|child|pikin|toddler|neonate|newborn|boy|\d+\s*(year|month|week|day)s?\s*old)\b/i.test(query);
  const queryHasAdultOnlyRef = /\b(woman|man|mother|father|pregnant|labour|labor|delivery|postpartum|postnatal|antenatal)\b/i.test(query) && !queryHasPediatricRef;
  if (slots.patientAgeMonths !== null && queryHasPediatricRef && !queryHasAdultOnlyRef) {
    rewritten += slots.patientAgeMonths < 24 ? ' infant neonate' : ' child';
  }

  // Stage 4: Topic continuity — no longer prepends topic to query string.
  // hybridSearch applies topic continuity bonus via sessionState.currentTopic.

  // Stage 5: Normalize hyphens/slashes to spaces (BM25 tokenizer concatenates them)
  rewritten = rewritten.replace(/[-/]/g, ' ');

  // Stage 6: Clinical synonym expansion — expand abbreviations to improve BM25 recall
  rewritten = expandClinicalSynonyms(rewritten);

  // Stage 7: Narrative normalization for BM25
  // If the original query is narrative-style, produce a focused BM25 query
  // that extracts clinical n-grams. The full rewritten query still goes to
  // vector search where embeddings handle narrative phrasing natively.
  let bm25Query: string | null = null;
  if (isNarrativeQuery(original)) {
    const normalized = normalizeForBm25(original);
    if (normalized !== original) {
      bm25Query = expandClinicalSynonyms(normalized);
    }
  }

  // Detect topic shift
  const detectedTopic = extractTopic(rewritten) || sessionState.currentTopic;
  const isTopicShift = sessionState.detectTopicShift(detectedTopic);

  return {
    original,
    rewritten: deduplicateTerms(rewritten),
    bm25Query: bm25Query ? deduplicateTerms(bm25Query) : null,
    detectedTopic,
    isTopicShift,
  };
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
