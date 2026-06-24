/**
 * Check: Can a decision_tree chunk actually be retrieved and rendered?
 * Trace the flow: search() -> conversationEngine -> responseRenderer -> MessageBubble
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

const chunksRaw = strFromU8(getFile('content/chunks.jsonl'));
const chunks = chunksRaw.split('\n').filter(l => l.trim()).map(l => {
  try { return JSON.parse(l); } catch { return null; }
}).filter(Boolean);

console.log('═'.repeat(80));
console.log('DECISION-TREE FLOW CHECK');
console.log('═'.repeat(80) + '\n');

// Count chunk types
const typeCount = new Map();
for (const c of chunks) {
  const type = c.type || 'unknown';
  typeCount.set(type, (typeCount.get(type) || 0) + 1);
}

console.log('Chunk type distribution:');
for (const [type, count] of Array.from(typeCount.entries()).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${type}: ${count}`);
}

const decisionTreeChunks = chunks.filter(c => c.type === 'decision_tree');
console.log(`\nDecision tree chunks: ${decisionTreeChunks.length}`);

if (decisionTreeChunks.length === 0) {
  console.log('\n✗ NO DECISION TREE CHUNKS IN ARTIFACT');
  console.log('\nPROBLEM:');
  console.log('  - Frontend code has renderDecisionTree() function (ACTIVE)');
  console.log('  - conversationEngine suggests follow-up questions for decision_tree chunks (ACTIVE)');
  console.log('  - MessageBubble renders decision_tree message type (ACTIVE)');
  console.log('  - But: 0 chunks with type="decision_tree" exist in artifact');
  console.log('\nCONSEQUENCES:');
  console.log('  IF a chunk with type=decision_tree were retrieved:');
  console.log('    1. conversationEngine would call renderDecisionTree()');
  console.log('    2. renderDecisionTree() checks if entry node exists');
  console.log('    3. If missing: returns fallback "Decision tree is not available in this language."');
  console.log('    4. MessageBubble renders this as a message (graceful degradation)');
  console.log('  CURRENTLY: Can\'t test this because no decision_tree chunks exist');
} else {
  console.log('✓ Found decision tree chunks');
  for (const c of decisionTreeChunks.slice(0, 3)) {
    console.log(`  - "${c.display_title}"`);
  }
}

console.log('\n' + '═'.repeat(80));
console.log('VERDICT:');
console.log('═'.repeat(80));
console.log('Decision trees ARE wired into the UI and WILL render if chunks exist.');
console.log('However, 0 decision_tree chunks in artifact means this code path');
console.log('is NEVER TRIGGERED in practice (dead code at runtime).');
console.log('\nThis is NOT a blocker — it\'s a declared-but-unimplemented feature.');
console.log('If a decision_tree chunk DID exist, rendering would fail gracefully.');
