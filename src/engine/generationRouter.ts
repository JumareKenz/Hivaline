/**
 * generationRouter.ts — Decision logic for when to invoke Edge Brain generation
 *
 * Edge Brain generation should ONLY fire when template assembly genuinely
 * can't produce a complete answer from structured evidence alone. If retrieved
 * evidence already fully answers the query via:
 *   - Decision-tree/calculator rule output (deterministic, non-generative)
 *   - Structured dosage rules with complete coverage
 *   - Complete answer/definition/procedure fields
 * ...then generation is skipped.
 *
 * This routing decision is explicit and testable, not implicit.
 */

import type { HIVChunk } from '@/types/hiv';
import type { SlotMemory } from '@/engine/sessionState';

export interface GenerationDecision {
  /** True if Edge Brain generation should be invoked. */
  shouldGenerate: boolean;
  /** Reason for the decision (for logging/debugging). */
  reason: string;
  /** The evidence string to pass to the generator (if shouldGenerate=true). */
  evidence: string | null;
}

/**
 * Determine whether Edge Brain generation should be invoked for this query.
 *
 * Returns shouldGenerate=false (skip generation) when:
 *   1. Structured answer exists and is complete (not a compiler error)
 *   2. Dosage rules exist and slot memory provides complete patient context
 *   3. The chunk has a complete procedure/referral/definition field
 *
 * Returns shouldGenerate=true (invoke generation) when:
 *   1. Answer field exists but is fragmented/incomplete
 *   2. Multiple aspects exist but none is a complete standalone answer
 *   3. Chunk has no structured answer at all
 */
export function shouldInvokeGeneration(
  chunk: HIVChunk,
  intent: string,
  slotMemory: SlotMemory,
  answerText: string | null
): GenerationDecision {
  const langContent = chunk.content?.en as Record<string, unknown> | undefined;
  if (!langContent) {
    return {
      shouldGenerate: false,
      reason: 'No English content in chunk',
      evidence: null,
    };
  }

  // Decision-tree/calculator output (e.g., rule-based dosage computation)
  // is deterministic and complete — skip generation
  if (langContent.dosage_rules && slotMemory.patientWeightKg !== null) {
    return {
      shouldGenerate: false,
      reason: 'Dosage rules with complete slot memory — deterministic output',
      evidence: null,
    };
  }

  // Complete structured answer exists (not a compiler error)
  if (answerText && answerText.length > 50 && !isCompilerError(answerText)) {
    // Check if the answer is fragmented (multiple bullet points with no connective text)
    const bulletCount = (answerText.match(/^[•\-*]\s/gm) || []).length;
    const sentenceCount = (answerText.match(/[.!?]\s/g) || []).length;

    if (bulletCount > 3 && sentenceCount < 2) {
      // Fragmented list — generation could improve coherence
      return {
        shouldGenerate: true,
        reason: 'Answer is fragmented bullet list — generation can improve coherence',
        evidence: buildEvidenceString(chunk, intent),
      };
    }

    return {
      shouldGenerate: false,
      reason: 'Complete structured answer exists',
      evidence: null,
    };
  }

  // Procedure/referral/definition fields are usually complete and self-contained
  const completeFields = ['procedure', 'referral', 'definition'];
  for (const field of completeFields) {
    const val = langContent[field];
    if (val && typeof val === 'string' && val.length > 50 && !isCompilerError(val)) {
      return {
        shouldGenerate: false,
        reason: `Complete ${field} field exists`,
        evidence: null,
      };
    }
  }

  // No complete answer — invoke generation
  return {
    shouldGenerate: true,
    reason: 'No complete structured answer — generation needed',
    evidence: buildEvidenceString(chunk, intent),
  };
}

/**
 * Build the evidence string to pass to the Edge Brain generator.
 * Includes all relevant fields from the chunk based on intent.
 */
function buildEvidenceString(chunk: HIVChunk, intent: string): string {
  const langContent = chunk.content?.en as Record<string, unknown> | undefined;
  if (!langContent) return '';

  const parts: string[] = [];

  // Title/topic
  if (chunk.display_title) {
    parts.push(`Topic: ${chunk.display_title}`);
  }

  // Intent-specific fields first
  const intentFieldMap: Record<string, string[]> = {
    DEFINE: ['definition', 'answer'],
    SCOPE: ['coverage', 'answer'],
    DETAIL: ['dosage_rules', 'answer', 'procedure'],
    PROCEDURE: ['procedure', 'answer'],
    REFERRAL: ['referral', 'danger_signs', 'answer'],
  };

  const priorityFields = intentFieldMap[intent] || ['answer', 'definition'];

  for (const field of priorityFields) {
    const val = langContent[field];
    if (val && typeof val === 'string' && !isCompilerError(val)) {
      parts.push(`${capitalize(field)}:\n${val}`);
    } else if (field === 'dosage_rules' && Array.isArray(val)) {
      // Serialize dosage rules as text
      parts.push(`Dosage:\n${serializeDosageRules(val)}`);
    }
  }

  // Additional context from aspects
  const aspects = chunk.aspects || [];
  for (const aspect of aspects) {
    if (priorityFields.includes(aspect)) continue; // Already included
    const val = langContent[aspect];
    if (val && typeof val === 'string' && !isCompilerError(val)) {
      parts.push(`${capitalize(aspect)}:\n${val}`);
    }
  }

  // Source attribution
  if (chunk.source?.document) {
    parts.push(`Source: ${chunk.source.document}`);
  }

  return parts.join('\n\n');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

function isCompilerError(text: string): boolean {
  const patterns = [
    'does not contain any meaningful information',
    'no meaningful information to process',
    'provided text does not contain',
  ];
  const lower = text.toLowerCase();
  return patterns.some((p) => lower.includes(p));
}

function serializeDosageRules(rules: unknown): string {
  if (!Array.isArray(rules)) return '';
  const lines: string[] = [];
  for (const rule of rules) {
    if (typeof rule === 'object' && rule && 'basis' in rule && 'brackets' in rule) {
      const r = rule as { basis: string; brackets: Array<{ min_kg?: number; max_kg?: number; dose: string }> };
      lines.push(`By ${r.basis}:`);
      for (const bracket of r.brackets) {
        const range = `${bracket.min_kg ?? 0}-${bracket.max_kg ?? '∞'}kg`;
        lines.push(`  ${range}: ${bracket.dose}`);
      }
    }
  }
  return lines.join('\n');
}
