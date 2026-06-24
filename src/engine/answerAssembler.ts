/**
 * answerAssembler.ts — Progressive disclosure answer assembly
 *
 * - Slot-aware dose computation
 * - Opener selection from matrix
 * - Gap-aware closing line with patient-context gating
 * - Follow-up chip generation
 */

import type SessionState from './sessionState';
import type { SlotMemory } from './sessionState';
import { cleanTopic } from './driftDetector';

export interface DoseRule {
  basis: string;
  brackets: Array<{ min_kg?: number; max_kg?: number; dose: string }>;
  age_override?: Array<{ min_months?: number; max_months?: number; warning: string }>;
}

export interface ChunkContent {
  answer?: string;
  definition?: string;
  coverage?: string;
  dosage_rules?: DoseRule[] | string;
  procedure?: string;
  referral?: string;
  fallback_response?: string;
  primary_question?: string;
  companion_note?: string;
  [key: string]: unknown;
}

export interface Chunk {
  id: string;
  aspects?: string[];
  content?: Record<string, ChunkContent | unknown>;
}

/**
 * Patterns that indicate a compiler error message was written as chunk content.
 * These must never be rendered to health workers as clinical answers.
 */
const COMPILER_ERROR_PATTERNS = [
  'does not contain any meaningful information',
  'no meaningful information to process',
  'provided text does not contain',
];

/**
 * Check if a text string is a compiler error message.
 * Treats it as null-equivalent so the runtime falls through to the next field.
 */
export function isCompilerError(text: string | null | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return COMPILER_ERROR_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Check whether any patient-specific slot is populated in slot memory.
 * Used to gate patient-context closing lines ("Anything else about this patient?").
 */
export function hasAnyPatientSlot(slotMemory: SlotMemory): boolean {
  return (
    slotMemory.patientAge !== null ||
    slotMemory.patientWeight !== null ||
    slotMemory.chiefComplaint !== null ||
    slotMemory.currentDrug !== null
  );
}

/**
 * Strip document boilerplate phrases from answer text.
 */
function stripBoilerplate(text: string): string {
  const boilerplatePatterns = [
    /In Nigeria[,\s]+/gi,
    /A comprehensive plan of action[,\s]+/gi,
    /significantly contribute to[,\s]+/gi,
    /It is important to note that[,\s]+/gi,
    /It should be noted that[,\s]+/gi,
    /Research has shown that[,\s]+/gi,
    /Studies indicate that[,\s]+/gi,
  ];
  let cleaned = text;
  for (const pattern of boilerplatePatterns) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleaned;
}

/**
 * Rewrite dosing parentheticals for conversational delivery.
 * "(10 IU, IV/IM)" → "— give 10 IU IV or IM"
 */
function rewriteDosingParenthetical(text: string): string {
  let rewritten = text;
  // Rewrite parenthetical dosing
  rewritten = rewritten.replace(
    /\((\d+(?:\.\d+)?\s*(?:mg|g|kg|ml|IU|mcg|units?))[,\s]+([^)]+)\)/gi,
    '— give $1 $2'
  );
  // Handle "IV/IM" style slashes
  rewritten = rewritten.replace(/\bgive\s+([^—]+?)\s+(IV|IM|PO|SC)\/([IVMOSC]+)\b/gi, 'give $1 $2 or $3');
  return rewritten;
}

/**
 * Truncate long answers: first 2 sentences + bullet points.
 */
function truncateLongAnswer(text: string): string {
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
  if (wordCount <= 120) return text;

  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const spokenPart = sentences.slice(0, 2).join(' ').trim();
  const remaining = sentences.slice(2).join(' ').trim();

  if (!remaining) return spokenPart;

  // Extract short bullet points
  const bullets: string[] = [];
  const remainingSentences = remaining.match(/[^.!?]+[.!?]+/g) || [remaining];

  for (const sentence of remainingSentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    const words = trimmed.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) continue;
    const bulletText = words.slice(0, 12).join(' ');
    bullets.push(bulletText.replace(/[.!?]+$/, ''));
    if (bullets.length >= 4) break;
  }

  if (bullets.length > 0) {
    return `${spokenPart}\n\nKey points:\n${bullets.map(b => `• ${b}`).join('\n')}`;
  }
  return spokenPart;
}

/**
 * Select answer content based on progressive disclosure rules.
 * Does not repeat aspects already covered this session.
 * Skips fields that contain compiler error messages.
 */
export function selectAnswerContent(chunk: Chunk, sessionState: SessionState, intent: string): string | null {
  const langContent = (chunk.content?.en || chunk.content || {}) as ChunkContent;
  const aspects = chunk.aspects || [];

  /** Return field value only if it exists and is not a compiler error */
  const safeField = (val: unknown): string | null => {
    if (!val) return null;
    const s = String(val);
    if (isCompilerError(s)) return null;
    let formatted = stripBoilerplate(s);
    formatted = rewriteDosingParenthetical(formatted);
    formatted = truncateLongAnswer(formatted);
    return formatted;
  };

  // Only deflect to fallback if this EXACT chunk was already served
  // AND all its aspects are covered. A new chunk with covered aspect
  // categories still has new content worth showing.
  const chunkAlreadyServed = sessionState.coveredChunks.has(chunk.id);
  const allAspectsCovered = aspects.length > 0 &&
    aspects.every(a => sessionState.coveredAspects.has(a));

  if (chunkAlreadyServed && allAspectsCovered) {
    const fallback = safeField(langContent.fallback_response);
    if (fallback) return fallback;
  }

  if (intent === 'DEFINE' || intent === 'HEADING_LOOKUP') {
    if (!sessionState.coveredAspects.has('definition')) {
      const def = safeField(langContent.definition);
      if (def) return def;
    }
    const nextAspect = aspects.find((a) => a !== 'definition' && !sessionState.coveredAspects.has(a));
    if (nextAspect) {
      const val = safeField(langContent[nextAspect]);
      if (val) return val;
    }
  }

  if (intent === 'SCOPE') {
    const val = safeField(langContent.coverage);
    if (val) return val;
  }

  if (intent === 'DETAIL') {
    const val = safeField(langContent.dosage_rules);
    if (val) return val;
  }

  if (intent === 'PROCEDURE') {
    const val = safeField(langContent.procedure);
    if (val) return val;
  }

  if (intent === 'REFERRAL') {
    const val = safeField(langContent.referral);
    if (val) return val;
  }

  // Default priority — skip compiler error strings
  const answer = safeField(langContent.answer);
  if (answer) return answer;
  const definition = safeField(langContent.definition);
  if (definition) return definition;
  const fallback = safeField(langContent.fallback_response);
  if (fallback) return fallback;
  const primary = safeField(langContent.primary_question);
  if (primary) return primary;

  return null;
}

/**
 * Compute patient-specific dose from dosage_rules and slot memory.
 * Returns a weight-specific string when slots are populated,
 * or the generic rule table when they are not.
 */
export function computePatientDose(dosageRules: DoseRule[] | unknown, slotMemory: SessionState['slotMemory']): string {
  if (!Array.isArray(dosageRules)) {
    return 'No dosing information available.';
  }

  const weight = slotMemory.patientWeightKg;
  const ageMonths = slotMemory.patientAgeMonths;

  for (const rule of dosageRules) {
    if (rule.basis === 'weight' && rule.brackets) {
      // Check age override first
      if (rule.age_override && ageMonths !== null) {
        for (const override of rule.age_override) {
          const min = override.min_months ?? 0;
          const max = override.max_months ?? Infinity;
          if (ageMonths >= min && ageMonths <= max) {
            return `Warning: ${override.warning || 'Age-based caution applies'}`;
          }
        }
      }

      if (weight !== null) {
        for (const bracket of rule.brackets) {
          const min = bracket.min_kg ?? 0;
          const max = bracket.max_kg ?? Infinity;
          if (weight >= min && weight <= max) {
            return `For your ${weight}kg patient: ${bracket.dose}`;
          }
        }
      }

      // No weight match or no weight in slots: return generic table
      const lines = rule.brackets.map((b: { min_kg?: number; max_kg?: number; dose: string }) => `${b.min_kg ?? 0}-${b.max_kg ?? '∞'}kg: ${b.dose}`).join('\n');
      return `Dosing by weight:\n${lines}`;
    }
  }

  return 'No matching dose rule found.';
}

/**
 * Build opener from opener_matrix loaded from manifest.json.
 * URGENT intent returns empty string.
 */
export function buildOpener(intent: string, topic: string | null, aspect: string | null, openerMatrix: Record<string, string> | undefined): string {
  if (intent === 'URGENT') return '';
  let template = openerMatrix?.[intent] ?? '';
  if (!template && intent === 'HEADING_LOOKUP') {
    template = "Here's an overview of {topic}:";
  }
  if (!template) return '';
  const cleanedTopic = cleanTopic(topic || '');
  const cleanedAspect = cleanTopic(aspect || '');
  return template
    .replace('{topic}', cleanedTopic)
    .replace('{aspect}', cleanedAspect);
}

/**
 * Get an alternate closing line for the given intent when anti-repetition fires.
 * At least 2 variants per intent class to prevent getting stuck.
 */
export function getAlternateClosing(intent: string, pendingGaps: string[]): string {
  const patientAlternates = [
    'What else can I help you with for this patient?',
    'Need anything else for this case?',
  ];
  const knowledgeAlternates: Record<string, string[]> = {
    DEFINE: ['Would you like more detail on this?', 'Anything else you want to know?'],
    SCOPE: ['Need the step-by-step details?', 'Want more specifics?'],
    PROCEDURE: ['Need clarification on any step?', 'Want more detail on any part?'],
    REFERRAL: ['Anything else about when to refer?', 'Need more on the referral criteria?'],
  };
  const genericAlternates = [
    'What else can I help you with?',
    'Is there something specific you would like to know?',
    'Need more details?',
    'What would you like to explore next?',
  ];
  const gapAlternates = [
    'Need more details?',
    'Want to explore another aspect?',
  ];

  if (pendingGaps.length > 0) {
    return gapAlternates[Math.floor(Math.random() * gapAlternates.length)];
  }

  const intentAlts = knowledgeAlternates[intent];
  if (intentAlts) {
    return intentAlts[Math.floor(Math.random() * intentAlts.length)];
  }

  // Patient or generic
  const pool = [...patientAlternates, ...genericAlternates];
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Build context-sensitive closing line based on pending gaps, intent, and session state.
 * Never repeats the same closing line two turns in a row.
 * Gates "patient" language behind hasAnyPatientSlot().
 */
export function buildClosing(pendingGaps: string[], intent: string, sessionState: SessionState): string {
  if (intent === 'GREETING') return '';
  if (intent === 'URGENT') return 'Is the patient stable right now?';

  let closing = '';

  if (intent === 'AFFIRM' && pendingGaps.length === 0) {
    closing = 'Happy to help with anything else.';
  } else if (pendingGaps.length === 0) {
    // No gaps — check if patient slots are set using the extracted function
    if (hasAnyPatientSlot(sessionState.slotMemory)) {
      closing = 'Anything else about this patient?';
    } else {
      // Pure knowledge query — intent-specific variants
      const topic = sessionState.currentTopic || 'this';
      const variants: Record<string, string> = {
        DEFINE: `Should I explain what ${topic} involves?`,
        SCOPE: 'Want the specific protocols or dosages?',
        PROCEDURE: 'Should I go through any of these steps in detail?',
        REFERRAL: 'Need the danger signs that trigger referral?',
      };
      closing = variants[intent] ?? 'Want to know more about this?';
    }
  } else {
    const gap = pendingGaps[0];
    const closings: Record<string, string> = {
      dosage: 'Should I give you the specific dose?',
      referral: 'Do you need to know when to refer?',
      danger_signs: 'Want the danger signs to watch for?',
      procedure: 'Shall I walk you through the steps?',
    };
    closing = closings[gap] ?? 'Anything else on this?';
  }

  // Anti-repetition: if same as last turn, rotate to an alternate
  if (closing && sessionState.lastClosing === closing) {
    closing = getAlternateClosing(intent, pendingGaps);
    // Safety: if alternate also matches (unlikely), use a hardcoded fallback
    if (closing === sessionState.lastClosing) {
      closing = 'What else can I help you with?';
    }
  }

  sessionState.lastClosing = closing;
  return closing;
}

/**
 * Build follow-up chips from pending gaps and gap graph edges.
 * Always emits at least 2 chips.
 */
export function buildFollowUpChips(
  pendingGaps: string[],
  gapGraph: Record<string, Array<{ to: string; score: number; label?: string }>> | undefined,
  chunkId: string,
  chunkMap: Map<string, Chunk>,
  topK = 3
): string[] {
  const chips: string[] = [];

  // From pending gaps — natural language phrases
  for (const gap of pendingGaps.slice(0, topK)) {
    chips.push(gapToChipLabel(gap));
  }

  // From gap graph — use target chunk primary_question
  const graphEdges = (gapGraph?.[chunkId] ?? [])
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, topK);

  for (const edge of graphEdges) {
    if (edge.label) {
      chips.push(truncateToQuestion(edge.label));
      continue;
    }
    const targetChunk = chunkMap.get(edge.to);
    const targetContent = targetChunk?.content?.en as ChunkContent | undefined;
    if (targetContent?.primary_question) {
      chips.push(truncateToQuestion(String(targetContent.primary_question)));
    }
  }

  // Pad to minimum 2 chips with safe fallbacks
  const fallbacks = ['Tell me more', 'When to refer?'];
  while (chips.length < 2) {
    const fb = fallbacks[chips.length % fallbacks.length];
    if (!chips.includes(fb)) {
      chips.push(fb);
    } else {
      break;
    }
  }

  return chips.slice(0, topK);
}

function truncateToQuestion(text: string): string {
  let t = text.trim();
  if (t.length > 40) {
    t = t.slice(0, 37).trim() + '...';
  }
  if (!t.endsWith('?')) {
    t += '?';
  }
  return t;
}

function gapToChipLabel(gap: string): string {
  const ASPECT_TO_CHIP: Record<string, string> = {
    // Clinical
    dosage: "What's the dose?",
    referral: 'When to refer?',
    danger_signs: 'What are the danger signs?',
    procedure: 'How to do it step by step?',
    side_effects: 'Any side effects?',
    contraindications: 'Who should not receive this?',
    coverage: 'What does this cover?',
    definition: 'What exactly is this?',
    when_to_refer: 'When should I refer?',
    prognosis: 'What is the outlook?',
    // Administrative / policy documents
    eligibility: 'Who is eligible?',
    accreditation: 'What are the accreditation steps?',
    registration: 'How do I register?',
    equipment: 'What equipment is needed?',
    requirements: 'What are the requirements?',
    compliance: 'What are the compliance rules?',
    penalties: 'What are the penalties?',
    exclusions: 'What is excluded?',
    membership: 'How does membership work?',
    administration: 'How is it administered?',
    personnel: 'What staff are needed?',
    facility: 'What facility requirements exist?',
    benefits: 'What are the benefits?',
    obligations: 'What are the obligations?',
    regulations: 'What regulations apply?',
    guidelines: 'What are the guidelines?',
    roles: 'What are the roles?',
    responsibilities: 'What are the responsibilities?',
    remuneration: 'How does remuneration work?',
    licencing: 'What are the licensing requirements?',
    records: 'What records are required?',
    management: 'How is it managed?',
    fund_management: 'How are funds managed?',
    payment_mechanisms: 'How does payment work?',
  };

  // Fallback for any aspect not in the map
  return ASPECT_TO_CHIP[gap] ?? `What about ${gap.replace(/_/g, ' ')}?`;
}
