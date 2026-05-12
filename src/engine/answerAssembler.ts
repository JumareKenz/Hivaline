/**
 * answerAssembler.ts — Progressive disclosure answer assembly
 *
 * - Slot-aware dose computation
 * - Opener selection from matrix
 * - Gap-aware closing line
 * - Follow-up chip generation
 */

import type SessionState from './sessionState';

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
  [key: string]: unknown;
}

export interface Chunk {
  id: string;
  aspects?: string[];
  content?: Record<string, ChunkContent | unknown>;
}

/**
 * Select answer content based on progressive disclosure rules.
 * Does not repeat aspects already covered this session.
 */
export function selectAnswerContent(chunk: Chunk, sessionState: SessionState, intent: string): string | null {
  const langContent = (chunk.content?.en || chunk.content || {}) as ChunkContent;
  const aspects = chunk.aspects || [];

  if (intent === 'DEFINE') {
    if (!sessionState.coveredAspects.has('definition') && langContent.definition) {
      return String(langContent.definition);
    }
    const nextAspect = aspects.find((a) => a !== 'definition' && !sessionState.coveredAspects.has(a));
    if (nextAspect && langContent[nextAspect]) {
      return String(langContent[nextAspect]);
    }
  }

  if (intent === 'SCOPE' && langContent.coverage) {
    return String(langContent.coverage);
  }

  if (intent === 'DETAIL' && langContent.dosage_rules) {
    return String(langContent.dosage_rules);
  }

  if (intent === 'PROCEDURE' && langContent.procedure) {
    return String(langContent.procedure);
  }

  if (intent === 'REFERRAL' && langContent.referral) {
    return String(langContent.referral);
  }

  // Default priority
  if (langContent.answer) return String(langContent.answer);
  if (langContent.definition) return String(langContent.definition);
  if (langContent.fallback_response) return String(langContent.fallback_response);
  if (langContent.primary_question) return String(langContent.primary_question);

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
  const template = openerMatrix?.[intent] ?? '';
  if (!template) return '';
  return template
    .replace('{topic}', topic || '')
    .replace('{aspect}', aspect || '');
}

/**
 * Build context-sensitive closing line based on pending gaps and intent.
 */
export function buildClosing(pendingGaps: string[], intent: string, _turnCount: number): string {
  if (intent === 'URGENT') return 'Is the patient stable right now?';
  if (pendingGaps.length === 0) return 'Anything else about this patient?';

  const gap = pendingGaps[0];
  const closings: Record<string, string> = {
    dosage: 'Should I give you the specific dose?',
    referral: 'Do you need to know when to refer?',
    danger_signs: 'Want the danger signs to watch for?',
    procedure: 'Shall I walk you through the steps?',
  };

  return closings[gap] ?? 'Anything else on this?';
}

/**
 * Build follow-up chips from pending gaps and gap graph edges.
 */
export function buildFollowUpChips(
  pendingGaps: string[],
  gapGraph: Record<string, Array<{ to: string; score: number; label?: string }>> | undefined,
  chunkId: string,
  topK = 3
): string[] {
  const fromGaps = pendingGaps.slice(0, 2).map(gapToChipLabel);
  const fromGraph = (gapGraph?.[chunkId] ?? [])
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 1)
    .map((e) => e.label || null)
    .filter((label): label is string => Boolean(label));

  return [...fromGaps, ...fromGraph].slice(0, topK);
}

function gapToChipLabel(gap: string): string {
  const labels: Record<string, string> = {
    dosage: 'Get dosage',
    referral: 'When to refer',
    danger_signs: 'Danger signs',
    procedure: 'Step-by-step',
    side_effects: 'Side effects',
    contraindications: 'Contraindications',
    coverage: 'What it covers',
    prognosis: 'Prognosis',
  };
  return labels[gap] || gap.replace(/_/g, ' ');
}
