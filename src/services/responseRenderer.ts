/**
 * responseRenderer.ts — Conversational response renderer
 *
 * Turns .hiv chunk data into warm, clinically accurate, natural-language
 * responses. NOT robotic data dumps — empathetic, contextual, human.
 */

import type { HIVChunk, RenderedResponse, Language } from '@/types/hiv';

type Lang = Language | string;

export function renderChunk(chunk: HIVChunk, lang: Lang = 'en'): RenderedResponse {
  const c = chunk.content[lang] ?? chunk.content.en;
  if (!c) {
    return {
      type: chunk.type,
      content: 'No content available in this language.',
    };
  }

  switch (chunk.type) {
    case 'faq':
      return renderFaq(chunk, c as FAQContent);
    case 'drug_table':
      return renderDrugTable(chunk, c as DrugTableContent);
    case 'decision_tree':
      return renderDecisionTree(chunk, c as DecisionTreeContent);
    case 'protocol':
      return renderProtocol(chunk, c as ProtocolContent);
    case 'danger_sign':
      return renderDangerSign(chunk, c as DangerSignContent);
    case 'calculator':
      return renderCalculator(chunk, c as CalculatorContent);
    default:
      return {
        type: chunk.type,
        content: String(c),
      };
  }
}

/* ─── FAQ ─── */

interface FAQContent {
  question?: string;
  answer?: string;
  details?: string;
  related_queries?: string[];
}

function renderFaq(chunk: HIVChunk, c: FAQContent): RenderedResponse {
  const parts: string[] = [];

  if (c.question) {
    parts.push(c.question);
  }

  if (c.answer) {
    parts.push('');
    parts.push(c.answer);
  }

  if (c.details) {
    parts.push('');
    parts.push(c.details);
  }

  return {
    type: 'faq',
    content: parts.join('\n'),
    source: chunk.source,
  };
}

/* ─── Drug Table ─── */

interface DrugTableRow {
  weight_range: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
}

interface DrugTableContent {
  drug_name: string;
  rows: DrugTableRow[];
  watch_for?: string[];
  refer_if?: string[];
}

function renderDrugTable(chunk: HIVChunk, c: DrugTableContent): RenderedResponse {
  const parts: string[] = [];

  parts.push(`${c.drug_name} Dosing`);
  parts.push('');

  if (c.rows?.length) {
    c.rows.forEach((row) => {
      parts.push(
        `• ${row.weight_range}: ${row.dose} — ${row.route}, ${row.frequency}, for ${row.duration}`
      );
    });
  }

  if (c.watch_for?.length) {
    parts.push('');
    parts.push('⚠️ Watch for:');
    c.watch_for.forEach((w) => parts.push(`  – ${w}`));
  }

  if (c.refer_if?.length) {
    parts.push('');
    parts.push('🏥 Refer immediately if:');
    c.refer_if.forEach((r) => parts.push(`  – ${r}`));
  }

  return {
    type: 'drug_table',
    content: parts.join('\n'),
    source: chunk.source,
  };
}

/* ─── Decision Tree ─── */

interface DecisionTreeContent {
  entry_node: string;
  nodes: Record<string, DecisionNode>;
}

interface DecisionNode {
  question?: string;
  options?: Array<{ label: string; next: string }>;
  action?: string;
  refer?: string;
}

function renderDecisionTree(chunk: HIVChunk, c: DecisionTreeContent): RenderedResponse {
  const entry = c.nodes[c.entry_node];
  if (!entry) {
    return {
      type: 'decision_tree',
      content: 'Decision tree is not available in this language.',
    };
  }

  const parts: string[] = [];

  if (entry.question) {
    parts.push(entry.question);
    parts.push('');
    parts.push('Tap an option to continue:');
    entry.options?.forEach((opt, i) => {
      parts.push(`${i + 1}. ${opt.label}`);
    });
  } else if (entry.action) {
    parts.push(`✅ ${entry.action}`);
  } else if (entry.refer) {
    parts.push(`🚨 ${entry.refer}`);
  }

  return {
    type: 'decision_tree',
    content: parts.join('\n'),
    source: chunk.source,
  };
}

/* ─── Protocol ─── */

interface ProtocolContent {
  title: string;
  steps: string[];
  notes?: string;
}

function renderProtocol(chunk: HIVChunk, c: ProtocolContent): RenderedResponse {
  const parts: string[] = [];

  parts.push(c.title);
  parts.push('');
  c.steps.forEach((step, i) => {
    parts.push(`${i + 1}. ${step}`);
  });

  if (c.notes) {
    parts.push('');
    parts.push(`💡 ${c.notes}`);
  }

  return {
    type: 'protocol',
    content: parts.join('\n'),
    source: chunk.source,
  };
}

/* ─── Danger Sign ─── */

interface DangerSignContent {
  sign: string;
  severity: 'urgent' | 'emergency';
  immediate_action: string;
  refer_urgency?: string;
  handover_info?: string;
}

function renderDangerSign(chunk: HIVChunk, c: DangerSignContent): RenderedResponse {
  const parts: string[] = [];

  const severityLabel = c.severity === 'emergency' ? '🚨 EMERGENCY' : '⚠️ URGENT';
  parts.push(`${severityLabel}: ${c.sign}`);
  parts.push('');
  parts.push('Immediate action:');
  parts.push(c.immediate_action);

  if (c.refer_urgency) {
    parts.push('');
    parts.push(`Refer: ${c.refer_urgency}`);
  }

  if (c.handover_info) {
    parts.push('');
    parts.push(`Tell the facility: ${c.handover_info}`);
  }

  return {
    type: 'danger_sign',
    content: parts.join('\n'),
    source: chunk.source,
  };
}

/* ─── Calculator ─── */

interface CalculatorContent {
  title: string;
  inputs: Array<{ id: string; label: string; type: string }>;
  formula: string;
  output_unit: string;
  output_label: string;
  bounds_check?: { min: number; max: number };
}

function renderCalculator(chunk: HIVChunk, c: CalculatorContent): RenderedResponse {
  const parts: string[] = [];

  parts.push(`📐 ${c.title}`);
  parts.push('');
  parts.push('Enter the required value:');
  c.inputs.forEach((input) => {
    parts.push(`• ${input.label}`);
  });
  parts.push('');
  parts.push(`Result will show in ${c.output_unit}.`);

  return {
    type: 'calculator',
    content: parts.join('\n'),
    source: chunk.source,
  };
}

/**
 * Get a short preview string for a chunk (for "related" suggestions).
 */
export function getChunkPreview(chunk: HIVChunk, lang: Lang = 'en'): string {
  const c = chunk.content[lang] ?? chunk.content.en;
  if (!c) return chunk.id;

  if (typeof c === 'object' && 'question' in c && c.question) {
    return String(c.question).slice(0, 60);
  }
  if (typeof c === 'object' && 'title' in c && c.title) {
    return String(c.title).slice(0, 60);
  }
  if (typeof c === 'object' && 'sign' in c && c.sign) {
    return String(c.sign).slice(0, 60);
  }
  if (typeof c === 'object' && 'drug_name' in c && c.drug_name) {
    return String(c.drug_name).slice(0, 60);
  }

  return chunk.id;
}

/**
 * Build a warm, conversational greeting from HIVA.
 */
export function buildGreeting(userName: string): string {
  const hour = new Date().getHours();
  let greeting = 'Hello';
  if (hour < 12) greeting = 'Good morning';
  else if (hour < 17) greeting = 'Good afternoon';
  else greeting = 'Good evening';

  return `${greeting}, ${userName}. I'm HIVA — your offline clinical assistant. Ask me anything about malaria, child health, ANC, or emergency care. I'm here to help.`;
}

/**
 * Fallback when no results found.
 */
export function buildNoResultMessage(): string {
  return `I don't have information on that in the current clinical guidelines. The loaded topics cover: Malaria, ANC, Child Health, Essential Medicines, and Emergency Referral. Try rephrasing or check the Knowledge Base.`;
}
