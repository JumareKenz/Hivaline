/**
 * Test edge cases where non-drug anchors trigger boost
 * Verify they don't distort ranking incorrectly
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

const lexRaw = getFile('index/lexical.json');
const bm25Index = lexRaw ? JSON.parse(strFromU8(lexRaw)) : {};
const idx = bm25Index?.en?.index || {};

const chunksRaw = strFromU8(getFile('content/chunks.jsonl'));
const chunks = chunksRaw.split('\n').filter(l => l.trim()).map(l => {
  try { return JSON.parse(l); } catch { return null; }
}).filter(Boolean);

function title(id) { return chunks.find(c => c.id === id)?.display_title || id; }

function bm25SearchNoBoost(query) {
  const terms = query.toLowerCase().split(/\s+/).map(t => t.replace(/[^\w]/g, '')).filter(t => t.length >= 2);
  const scores = {};
  for (const term of terms) {
    const postings = idx[term] || [];
    for (const { chunk_id, score } of postings) {
      scores[chunk_id] = (scores[chunk_id] || 0) + score;
    }
  }
  return Object.entries(scores).sort(([, a], [, b]) => b - a).map(([id, score]) => ({ chunkId: id, score }));
}

function bm25SearchWithBoost(query) {
  const terms = query.toLowerCase().split(/\s+/).map(t => t.replace(/[^\w]/g, '')).filter(t => t.length >= 2);
  const scores = {};
  for (const term of terms) {
    const postings = idx[term] || [];
    for (const { chunk_id, score } of postings) {
      scores[chunk_id] = (scores[chunk_id] || 0) + score;
    }
  }
  
  // Anchor boost
  const anchorChunks = new Set();
  for (const term of terms) {
    if (term.length < 4 || !/^[a-z]+$/i.test(term)) continue;
    const postings = idx[term] || [];
    if (postings.length > 0 && postings.length <= 5) {
      for (const { chunk_id } of postings) anchorChunks.add(chunk_id);
    }
  }
  
  if (anchorChunks.size > 0) {
    for (const [chunkId, score] of Object.entries(scores)) {
      scores[chunkId] = anchorChunks.has(chunkId) ? score * 1.3 : score * 0.7;
    }
  }
  
  return Object.entries(scores).sort(([, a], [, b]) => b - a).map(([id, score]) => ({ chunkId: id, score }));
}

console.log('ANCHOR EDGE-CASE VERIFICATION\n');
console.log('═'.repeat(60));

// Test 1: Postpartum hemorrhage (postpartum = rare anchor)
console.log('\n1. "Postpartum hemorrhage management"');
console.log('   (anchor: "postpartum" has 5 postings)');
console.log('─'.repeat(60));

const q1 = 'postpartum hemorrhage management';
const noBoost1 = bm25SearchNoBoost(q1).slice(0, 3);
const withBoost1 = bm25SearchWithBoost(q1).slice(0, 3);

console.log('   Without boost:');
for (const r of noBoost1) console.log(`     ${r.score.toFixed(2)} → ${title(r.chunkId)}`);
console.log('   With boost:');
for (const r of withBoost1) console.log(`     ${r.score.toFixed(2)} → ${title(r.chunkId)}`);

const changed1 = noBoost1[0].chunkId !== withBoost1[0].chunkId;
console.log(`   ${changed1 ? '⚠️ RANK CHANGED' : '✓ Same rank'}`);

// Test 2: Immune reconstitution (immune, reconstitution = rare anchors)
console.log('\n2. "Immune reconstitution inflammatory syndrome"');
console.log('   (anchors: "immune"=5, "reconstitution"=3, "inflammatory"=many)');
console.log('─'.repeat(60));

const q2 = 'immune reconstitution inflammatory syndrome';
const noBoost2 = bm25SearchNoBoost(q2).slice(0, 3);
const withBoost2 = bm25SearchWithBoost(q2).slice(0, 3);

console.log('   Without boost:');
for (const r of noBoost2) console.log(`     ${r.score.toFixed(2)} → ${title(r.chunkId)}`);
console.log('   With boost:');
for (const r of withBoost2) console.log(`     ${r.score.toFixed(2)} → ${title(r.chunkId)}`);

const changed2 = noBoost2[0].chunkId !== withBoost2[0].chunkId;
console.log(`   ${changed2 ? '⚠️ RANK CHANGED' : '✓ Same rank'}`);

// Test 3: Birth weight (birth = rare anchor)
console.log('\n3. "Birth weight categories neonatal"');
console.log('   (anchor: "birth"=4 postings)');
console.log('─'.repeat(60));

const q3 = 'birth weight categories neonatal';
const noBoost3 = bm25SearchNoBoost(q3).slice(0, 3);
const withBoost3 = bm25SearchWithBoost(q3).slice(0, 3);

console.log('   Without boost:');
for (const r of noBoost3) console.log(`     ${r.score.toFixed(2)} → ${title(r.chunkId)}`);
console.log('   With boost:');
for (const r of withBoost3) console.log(`     ${r.score.toFixed(2)} → ${title(r.chunkId)}`);

const changed3 = noBoost3[0].chunkId !== withBoost3[0].chunkId;
console.log(`   ${changed3 ? '⚠️ RANK CHANGED' : '✓ Same rank'}`);

console.log('\n' + '═'.repeat(60));
console.log('CONCLUSION:');
const changedCount = [changed1, changed2, changed3].filter(Boolean).length;
if (changedCount === 0) {
  console.log('✓ Anchor boost does NOT distort non-drug queries');
  console.log('  Edge-case anchors rank results correctly (no spurious reordering)');
} else {
  console.log(`⚠️  ${changedCount}/3 edge-case queries had rank changes`);
  console.log('   Investigate whether these are harmful or clinical improvements');
}
