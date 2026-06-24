/**
 * Part B.4 — Check decision-tree functionality
 * Verify decision trees exist and can be rendered
 */
import { readFileSync } from 'fs';
import { unzipSync, strFromU8 } from 'fflate';

const raw = readFileSync('./hiv-cache.bin');
const files = unzipSync(new Uint8Array(raw));
function getFile(path) {
  const clean = path.replace(/^\/+/, '');
  for (const key of Object.keys(files)) {
    if (key.replace(/^\/+/, '') === clean && files[key].length > 0) return files[key];
  }
  return null;
}

const manifestRaw = getFile('manifest.json');
const manifest = manifestRaw ? JSON.parse(strFromU8(manifestRaw)) : {};

const treesRaw = getFile('decision_trees/trees.json');
let trees = [];
if (treesRaw) {
  const parsed = JSON.parse(strFromU8(treesRaw));
  trees = parsed.trees || [];
}

console.log('═'.repeat(70));
console.log('PART B.4 — DECISION TREE CHECK');
console.log('═'.repeat(70) + '\n');

console.log(`Manifest declares: ${manifest.decision_tree_count || 'unknown'} decision trees`);
console.log(`Actual trees.json: ${trees.length} trees\n`);

if (trees.length === 0) {
  console.log('✗ NO DECISION TREES FOUND');
  console.log('  Decision-tree rendering cannot be tested.');
} else {
  console.log(`✓ Found ${trees.length} decision trees\n`);
  console.log('Sample trees:');
  for (const tree of trees.slice(0, 3)) {
    console.log(`  - "${tree.title || tree.id}" (${tree.nodes?.length || 0} nodes)`);
  }
}

// Try to find queries that might trigger decision trees
const chunksRaw = getFile('content/chunks.jsonl');
if (chunksRaw) {
  const chunks = strFromU8(chunksRaw).split('\n').filter(l => l.trim()).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
  
  const decisionChunks = chunks.filter(c => c.decision_tree);
  console.log(`\n\nChunks with decision_tree field: ${decisionChunks.length}`);
  if (decisionChunks.length > 0) {
    console.log('Sample:');
    for (const c of decisionChunks.slice(0, 3)) {
      console.log(`  - "${c.display_title}" (tree_id: ${c.decision_tree})`);
    }
  }
}
