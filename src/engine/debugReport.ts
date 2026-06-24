import type { HIVAssets } from './hybridSearch';

export function generateHivReport(hivAssets: HIVAssets): string {
  const chunks = hivAssets.chunks ?? [];
  const total = chunks.length;

  // Aspect coverage
  const aspectCounts: Record<string, number> = {};
  const chunksWithManyAspects: string[] = [];
  let chunksWithOnlyDefinition = 0;
  let chunksWithZeroAspects = 0;

  for (const chunk of chunks) {
    const aspects = chunk.aspects ?? [];
    if (aspects.length === 0) chunksWithZeroAspects++;
    if (aspects.length === 1 && aspects[0] === 'definition') {
      chunksWithOnlyDefinition++;
    }
    if (aspects.length > 2) {
      chunksWithManyAspects.push(
        `${chunk.display_title || chunk.id}: [${aspects.join(', ')}]`
      );
    }
    for (const a of aspects) {
      aspectCounts[a] = (aspectCounts[a] ?? 0) + 1;
    }
  }

  // Gap graph coverage
  const gapGraph = hivAssets.gapGraph ?? {};
  const chunksWithEdges = Object.keys(gapGraph).length;
  const totalEdges = Object.values(gapGraph)
    .reduce((sum, edges) => sum + edges.length, 0);

  // Pending gaps simulation — what would gap detection produce
  // for a fresh session with no covered aspects?
  const ASPECT_PRIORITY = [
    'dosage', 'referral', 'danger_signs', 'procedure',
    'side_effects', 'contraindications', 'coverage', 'prognosis',
    'when_to_refer'
  ];
  let chunksWithUsableGaps = 0;
  for (const chunk of chunks) {
    const aspects = chunk.aspects ?? [];
    const gaps = ASPECT_PRIORITY.filter(a => aspects.includes(a));
    if (gaps.length > 0) chunksWithUsableGaps++;
  }

  // Coverage manifest summary
  const manifest = hivAssets.coverageManifest;
  const topicCount = manifest?.topics
    ? Object.keys(manifest.topics).length : 0;

  // Build report
  const lines = [
    '=== HIVA .hiv Quality Report ===',
    `Total chunks: ${total}`,
    '',
    '--- Aspect Coverage ---',
    `Chunks with zero aspects: ${chunksWithZeroAspects}`,
    `Chunks with only ["definition"]: ${chunksWithOnlyDefinition}`,
    `Chunks with 3+ aspects: ${chunksWithManyAspects.length}`,
    `Chunks with usable gap aspects (non-definition): ${chunksWithUsableGaps}`,
    '',
    'Aspect frequency across all chunks:',
    ...Object.entries(aspectCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `  ${k}: ${v}`),
    '',
    '--- Gap Graph ---',
    `Chunks with gap graph edges: ${chunksWithEdges} of ${total}`,
    `Total edges: ${totalEdges}`,
    `Average edges per chunk: ${(totalEdges / total).toFixed(1)}`,
    '',
    '--- Coverage Manifest ---',
    `Topics in manifest: ${topicCount}`,
    '',
    '--- Chunks with Rich Aspects (3+) ---',
    ...chunksWithManyAspects.slice(0, 10),
    chunksWithManyAspects.length > 10
      ? `...and ${chunksWithManyAspects.length - 10} more` : '',
  ];

  return lines.filter(l => l !== undefined).join('\n');
}
