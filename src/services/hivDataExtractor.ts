/**
 * hivDataExtractor — extract artifacts/drugs/trees from .hiv chunks
 */

import type { HIVFile } from '@/types/hiv';

export interface ArtifactData {
  id: string;
  title: string;
  publisher: string;
  year: number;
  icon: string;
  colorTint: string;
  topics: string[];
  verified: boolean;
  description?: string;
}

export interface DrugTableData {
  id: string;
  name: string;
  route: string;
  form: string;
  unitDose: string;
  frequency: string;
  duration: string;
  weightRanges: { minKg: number; maxKg: number; dose: string; notes?: string }[];
  warning?: string;
  source: string;
}

export interface DecisionTreeData {
  id: string;
  name: string;
  entryNode: string;
  nodes: Record<string, {
    id: string;
    type: 'branch' | 'action' | 'refer';
    question?: string;
    hint?: string;
    options?: { id: string; label: string; next: string; icon?: 'check' | 'x' }[];
    title?: string;
    instruction?: string;
    linkedDrug?: string;
    urgency?: 'immediate' | 'urgent' | 'routine';
    holdingCare?: string;
    handover?: string;
  }>;
}

export function extractArtifacts(file: HIVFile | null): ArtifactData[] {
  if (!file) return [];

  // Prefer manifest document_sources (new format) over chunk-based extraction
  if (file.manifest.document_sources && file.manifest.document_sources.length > 0) {
    return file.manifest.document_sources.map((doc) => ({
      id: doc.id,
      title: doc.name,
      publisher: doc.publisher,
      year: doc.year,
      icon: '📋',
      colorTint: 'accent',
      topics: [],
      verified: true,
      description: doc.url,
    }));
  }

  // Legacy: extract from protocol/faq chunks
  const artifactChunks = file.chunks.filter(
    (c) => c.type === 'protocol' || c.type === 'faq'
  );

  return artifactChunks.map((chunk) => {
    const content = chunk.content as Record<string, unknown>;
    return {
      id: chunk.id,
      title: String(content.title ?? chunk.id),
      publisher: String(content.publisher ?? 'FMOH'),
      year: Number(content.year ?? new Date().getFullYear()),
      icon: String(content.icon ?? '📋'),
      colorTint: String(content.colorTint ?? 'accent'),
      topics: (content.topics as string[] ?? []).length > 0
        ? (content.topics as string[])
        : Object.keys(content).slice(0, 5),
      verified: true,
      description: content.description ? String(content.description) : undefined,
    };
  });
}

export function extractDrugTables(file: HIVFile | null): DrugTableData[] {
  if (!file) return [];

  const drugChunks = file.chunks.filter((c) => c.type === 'drug_table');

  return drugChunks.map((chunk) => {
    const content = chunk.content as Record<string, unknown>;
    const ranges = content.weightRanges as Array<{
      minKg: number;
      maxKg: number;
      dose: string;
      notes?: string;
    }> | undefined;

    return {
      id: chunk.id,
      name: String(content.name ?? chunk.id),
      route: String(content.route ?? 'oral'),
      form: String(content.form ?? 'tablet'),
      unitDose: String(content.unitDose ?? ''),
      frequency: String(content.frequency ?? 'once daily'),
      duration: String(content.duration ?? '5 days'),
      weightRanges: ranges ?? [],
      warning: content.warning ? String(content.warning) : undefined,
      source: chunk.source.document,
    };
  });
}

export function extractDecisionTrees(file: HIVFile | null): DecisionTreeData[] {
  if (!file) return [];

  const treeChunks = file.chunks.filter((c) => c.type === 'decision_tree');

  return treeChunks.map((chunk) => {
    const content = chunk.content as Record<string, unknown>;
    const nodes = content.nodes as Record<string, unknown> | undefined;

    const parsedNodes: Record<string, DecisionTreeData['nodes'][string]> = {};
    if (nodes) {
      for (const [key, node] of Object.entries(nodes)) {
        const n = node as Record<string, unknown>;
        parsedNodes[key] = {
          id: String(key),
          type: String(n.type ?? 'branch') as 'branch' | 'action' | 'refer',
          question: n.question ? String(n.question) : undefined,
          hint: n.hint ? String(n.hint) : undefined,
          options: n.options
            ? (n.options as Array<{ id: string; label: string; next: string; icon?: string }>).map((o) => ({
                id: String(o.id),
                label: String(o.label),
                next: String(o.next),
                icon: o.icon as 'check' | 'x' | undefined,
              }))
            : undefined,
          title: n.title ? String(n.title) : undefined,
          instruction: n.instruction ? String(n.instruction) : undefined,
          linkedDrug: n.linkedDrug ? String(n.linkedDrug) : undefined,
          urgency: n.urgency ? String(n.urgency) as 'immediate' | 'urgent' | 'routine' : undefined,
          holdingCare: n.holdingCare ? String(n.holdingCare) : undefined,
          handover: n.handover ? String(n.handover) : undefined,
        };
      }
    }

    return {
      id: chunk.id,
      name: String(content.name ?? chunk.id),
      entryNode: String(content.entryNode ?? Object.keys(parsedNodes)[0] ?? ''),
      nodes: parsedNodes,
    };
  });
}

export function getArtifactById(file: HIVFile | null, id: string): ArtifactData | undefined {
  const artifacts = extractArtifacts(file);
  return artifacts.find((a) => a.id === id);
}

export function getDrugById(file: HIVFile | null, id: string): DrugTableData | undefined {
  const drugs = extractDrugTables(file);
  return drugs.find((d) => d.id === id);
}

export function getTreeById(file: HIVFile | null, id: string): DecisionTreeData | undefined {
  const trees = extractDecisionTrees(file);
  return trees.find((t) => t.id === id);
}

export function getDoseForWeight(drug: DrugTableData | undefined, weightKg: number): string {
  if (!drug || !drug.weightRanges.length) return 'N/A';
  const range = drug.weightRanges.find(
    (r) => weightKg >= r.minKg && weightKg <= r.maxKg
  );
  return range?.dose ?? 'N/A';
}