/**
 * rawTextSynthesizer.ts — Flatten HIVChunk.content.en into a plain string.
 *
 * The compiler will eventually emit a `raw_text` field directly in chunks.jsonl.
 * Until then, this function synthesizes it from the nested content structure at
 * import time. The Kotlin NativeRetriever uses the same priority order.
 *
 * Priority order (first non-empty string wins as the lead sentence):
 *   answer → description → procedure → definition → instruction
 * All other string fields are appended, then dosage/numeric facts.
 *
 * The result is what gets stored in ObjectBox and passed to LFM2.5 as evidence.
 */

const LEAD_FIELDS = ['answer', 'description', 'procedure', 'definition', 'instruction'] as const;

const SECONDARY_FIELDS = [
  'indication', 'contraindication', 'side_effects', 'monitoring',
  'referral_criteria', 'danger_signs', 'prevention', 'notes',
] as const;

export function synthesizeRawText(contentEn: Record<string, unknown>): string {
  if (!contentEn || typeof contentEn !== 'object') return '';

  const parts: string[] = [];

  // Lead field — the primary clinical answer
  for (const field of LEAD_FIELDS) {
    const val = contentEn[field];
    if (typeof val === 'string' && val.trim()) {
      parts.push(val.trim());
      break;
    }
  }

  // Secondary fields
  for (const field of SECONDARY_FIELDS) {
    const val = contentEn[field];
    if (typeof val === 'string' && val.trim()) {
      parts.push(val.trim());
    }
  }

  // Dosage rules — emit as readable text
  const dosageRules = contentEn['dosage_rules'];
  if (dosageRules && typeof dosageRules === 'object') {
    const dosageText = flattenDosageRules(dosageRules as Record<string, unknown>);
    if (dosageText) parts.push(dosageText);
  }

  // Any remaining string fields not already captured
  const captured = new Set<string>([
    ...LEAD_FIELDS, ...SECONDARY_FIELDS, 'dosage_rules',
    // These are structural, not clinical text:
    'trigger_phrases', 'question_variants', 'display_title',
    'checksum', 'id', 'type', 'source',
  ]);
  for (const [key, val] of Object.entries(contentEn)) {
    if (!captured.has(key) && typeof val === 'string' && val.trim()) {
      parts.push(val.trim());
    }
  }

  return parts.join('\n\n');
}

function flattenDosageRules(rules: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, val] of Object.entries(rules)) {
    if (typeof val === 'string') {
      lines.push(`${key}: ${val}`);
    } else if (typeof val === 'object' && val !== null) {
      const nested = Object.entries(val as Record<string, unknown>)
        .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      if (nested) lines.push(`${key}: ${nested}`);
    }
  }
  return lines.join('\n');
}
