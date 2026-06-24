/**
 * test-drug-mismatch.mjs — Phase 17b drug-name mismatch investigation
 * Tests against the active hiv-cache.bin artifact.
 */
import { pipeline, env } from '@xenova/transformers';
import { readFileSync } from 'fs';
import { unzipSync, strFromU8 } from 'fflate';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = './public/models/';

const raw = readFileSync('./hiv-cache.bin');
const files = unzipSync(new Uint8Array(raw));
function getFile(path) {
  const clean = path.replace(/^\/+/, '');
  for (const key of Object.keys(files)) {
    if (key.replace(/^\/+/, '') === clean && files[key].length > 0) return files[key];
  }
  return null;
}

const manifest = JSON.parse(strFromU8(getFile('manifest.json')));
console.log('═══════════════════════════════════════════════════════');
console.log('  ARTIFACT: ' + manifest.version + ' (' + manifest.chunk_count + ' chunks)');
console.log('═══════════════════════════════════════════════════════\n');

const chunksRaw = strFromU8(getFile('content/chunks.jsonl'));
const chunks = chunksRaw.split('\n').filter(l => l.trim()).map(l => {
  try { return JSON.parse(l); } catch { return null; }
}).filter(Boolean);

const embRaw = getFile('index/embeddings.bin');
const embView = new DataView(embRaw.buffer, embRaw.byteOffset, embRaw.byteLength);
const chunkCount = embView.getUint32(0, true);
const dims = embView.getUint32(4, true);
const embFloats = new Float32Array(embRaw.buffer, embRaw.byteOffset + 8, chunkCount * dims);

const indexRaw = getFile('index/embeddings_index.json');
let chunkIds = [];
if (indexRaw) {
  const indexData = JSON.parse(strFromU8(indexRaw));
  chunkIds = Object.keys(indexData.index).sort((a, b) => Number(a) - Number(b)).map(k => indexData.index[k]);
}

const lexRaw = getFile('index/lexical.json');
const bm25Index = lexRaw ? JSON.parse(strFromU8(lexRaw)) : {};
const idx = bm25Index?.en?.index || {};

const embedder = await pipeline('feature-extraction', 'embed', { quantized: true });
async function embedQuery(text) {
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return output.data;
}

function cosine(a, b) {
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; nA += a[i] * a[i]; nB += b[i] * b[i]; }
  return dot / (Math.sqrt(nA) * Math.sqrt(nB) + 1e-10);
}

function bm25Search(query) {
  const terms = query.toLowerCase().split(/\s+/).map(t => t.replace(/[^\w]/g, '')).filter(t => t.length >= 2);
  const scores = {};
  for (const term of terms) {
    const postings = idx[term] || [];
    for (const { chunk_id, score } of postings) { scores[chunk_id] = (scores[chunk_id] || 0) + score; }
  }
  return Object.entries(scores).sort(([, a], [, b]) => b - a).map(([id, score]) => ({ chunkId: id, score }));
}

async function vectorSearch(query, topK = 10) {
  const qEmb = await embedQuery(query);
  const results = [];
  for (let i = 0; i < chunkCount; i++) {
    const offset = i * dims;
    const chunkVec = embFloats.subarray(offset, offset + dims);
    const score = cosine(qEmb, chunkVec);
    results.push({ chunkId: chunkIds[i] || String(i), score });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, topK);
}

function isVectorConfident(results, hasBm25) {
  if (results.length === 0) return false;
  if (!hasBm25) return true;
  if (results[0].score < 0.3) return false;
  if (results.length >= 2) {
    const margin = (results[0].score - results[1].score) / results[1].score;
    if (margin < 0.05) return false;
  }
  return true;
}

function rrfFuse(bm25, vector, k = 60) {
  const ranks = new Map();
  bm25.forEach((r, i) => ranks.set(r.chunkId, { bm25: i + 1, vector: Infinity }));
  vector.forEach((r, i) => {
    const existing = ranks.get(r.chunkId);
    if (existing) existing.vector = i + 1;
    else ranks.set(r.chunkId, { bm25: Infinity, vector: i + 1 });
  });
  const scores = new Map();
  for (const [id, { bm25: b, vector: v }] of ranks) {
    scores.set(id, 1 / (k + b) + 1 / (k + v));
  }
  return Array.from(scores.entries()).map(([id, score]) => ({ chunkId: id, score })).sort((a, b) => b.score - a.score);
}

function title(chunkId) {
  const c = chunks.find(ch => ch.id === chunkId);
  return c?.display_title || chunkId;
}

function answer(chunkId) {
  const c = chunks.find(ch => ch.id === chunkId);
  return c?.content?.en?.answer || '';
}

// ═══════════════════════════════════════════════════════
// TASK 1: AMOXICILLIN — What's in the corpus?
// ═══════════════════════════════════════════════════════

console.log('══════════════════════════════════════════════════');
console.log('  TASK 1: AMOXICILLIN CORPUS SEARCH');
console.log('──────────────────────────────────────────────────');

// Search all chunk content for amoxicillin
const amoxChunks = chunks.filter(c => {
  const all = JSON.stringify(c).toLowerCase();
  return all.includes('amoxicillin') || all.includes('amoxycillin');
});
console.log(`Chunks containing "amoxicillin": ${amoxChunks.length}`);
for (const c of amoxChunks) {
  console.log(`  - [${c.type}] "${c.display_title}"`);
  console.log(`    answer: ${(c.content?.en?.answer || '').substring(0, 120)}...`);
}

// Is "amoxicillin" in the BM25 index?
const amoxPostings = idx['amoxicillin'] || [];
console.log(`\n"amoxicillin" in BM25 index: ${amoxPostings.length} postings`);
if (amoxPostings.length > 0) {
  for (const p of amoxPostings.slice(0, 10)) {
    console.log(`  → ${title(p.chunk_id)} (score=${p.score.toFixed(2)})`);
  }
}

// Also check variants
for (const variant of ['amoxycillin', 'amoxil', 'augmentin']) {
  const posts = idx[variant] || [];
  if (posts.length > 0) console.log(`"${variant}" in BM25: ${posts.length} postings`);
}

// ═══════════════════════════════════════════════════════
// TASK 2/3: FULL RETRIEVAL TRACE
// ═══════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════');
console.log('  TASK 2/3: RETRIEVAL TRACE — "amoxicillin 250mg for 12kg child"');
console.log('──────────────────────────────────────────────────');

const query = 'amoxicillin 250mg for 12kg child';
const bm25 = bm25Search(query);
const vector = await vectorSearch(query);
const hasBm25 = bm25.length > 0;
const confident = isVectorConfident(vector, hasBm25);

console.log('\nBM25 top 10:');
for (const r of bm25.slice(0, 10)) {
  const contains = answer(r.chunkId).toLowerCase().includes('amoxicillin');
  console.log(`  ${r.score.toFixed(2)} → ${title(r.chunkId)}${contains ? ' [HAS AMOXICILLIN]' : ''}`);
}

// Show which BM25 terms matched
console.log('\nBM25 term analysis:');
const queryTerms = query.toLowerCase().split(/\s+/).map(t => t.replace(/[^\w]/g, '')).filter(t => t.length >= 2);
for (const t of queryTerms) {
  const posts = idx[t] || [];
  console.log(`  "${t}": ${posts.length} postings${posts.length === 0 ? ' ← NOT INDEXED' : ''}`);
}

console.log('\nVector top 10:');
for (const r of vector.slice(0, 10)) {
  const contains = answer(r.chunkId).toLowerCase().includes('amoxicillin');
  console.log(`  ${r.score.toFixed(3)} → ${title(r.chunkId)}${contains ? ' [HAS AMOXICILLIN]' : ''}`);
}

console.log(`\nConfidence gate: confident=${confident}`);
if (vector.length >= 2) {
  const margin = (vector[0].score - vector[1].score) / vector[1].score;
  console.log(`  vec[0]=${vector[0].score.toFixed(3)}, vec[1]=${vector[1].score.toFixed(3)}, margin=${(margin * 100).toFixed(1)}%`);
}

const fused = rrfFuse(bm25, confident ? vector : []);
console.log(`\nFused result (confident=${confident}):`);
for (const r of fused.slice(0, 5)) {
  const contains = answer(r.chunkId).toLowerCase().includes('amoxicillin');
  console.log(`  ${r.score.toFixed(5)} → ${title(r.chunkId)}${contains ? ' [HAS AMOXICILLIN]' : ''}`);
}

const topChunk = chunks.find(c => c.id === fused[0]?.chunkId);
console.log(`\n  ═══ FINAL ANSWER ═══`);
console.log(`  Retrieved: "${topChunk?.display_title}"`);
console.log(`  Answer: ${answer(fused[0]?.chunkId).substring(0, 200)}`);
console.log(`  Contains "amoxicillin"? ${answer(fused[0]?.chunkId).toLowerCase().includes('amoxicillin')}`);

// Where did actual amoxicillin chunks rank?
if (amoxChunks.length > 0) {
  console.log('\n  Where amoxicillin chunks ranked:');
  for (const c of amoxChunks) {
    const bm25Rank = bm25.findIndex(r => r.chunkId === c.id);
    const vecRank = vector.findIndex(r => r.chunkId === c.id);
    const fusedRank = fused.findIndex(r => r.chunkId === c.id);
    console.log(`    "${c.display_title}"`);
    console.log(`      BM25: ${bm25Rank >= 0 ? '#' + (bm25Rank + 1) + ' (score=' + bm25[bm25Rank].score.toFixed(2) + ')' : 'UNRANKED'}`);
    console.log(`      Vector: ${vecRank >= 0 ? '#' + (vecRank + 1) + ' (score=' + vector[vecRank].score.toFixed(3) + ')' : 'NOT IN TOP 10'}`);
    console.log(`      Fused: ${fusedRank >= 0 ? '#' + (fusedRank + 1) : 'BELOW TOP RESULTS'}`);
  }
}

// ═══════════════════════════════════════════════════════
// TASK 4: VERIFY OTHER 4 DOSAGE RESULTS
// ═══════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════');
console.log('  TASK 4: VERIFY OTHER 4 DOSAGE QUERIES');
console.log('──────────────────────────────────────────────────');

const dosageQueries = [
  { q: 'Coartem dose for 15kg child', drug: 'coartem', altDrug: ['artemether', 'lumefantrine', 'act'] },
  { q: 'dolutegravir dose with rifampicin', drug: 'dolutegravir', altDrug: ['dtg'] },
  { q: 'cotrimoxazole dose for HIV positive child 8kg', drug: 'cotrimoxazole', altDrug: ['ctx', 'bactrim', 'septrin'] },
  { q: 'isoniazid 10mg/kg for TPT in children', drug: 'isoniazid', altDrug: ['inh', 'ipt'] },
];

for (const { q, drug, altDrug } of dosageQueries) {
  const bm25R = bm25Search(q);
  const vectorR = await vectorSearch(q);
  const hasBm25R = bm25R.length > 0;
  const confR = isVectorConfident(vectorR, hasBm25R);
  const fusedR = rrfFuse(bm25R, confR ? vectorR : []);
  const topId = fusedR[0]?.chunkId;
  const topTitle = title(topId);
  const topAnswer = answer(topId).toLowerCase();
  const allDrugNames = [drug, ...altDrug];
  const containsDrug = allDrugNames.some(d => topAnswer.includes(d) || topTitle.toLowerCase().includes(d));
  const tier = confR ? 'BM25+Vec' : 'BM25-only';

  console.log(`\n  "${q}"`);
  console.log(`    → "${topTitle}"`);
  console.log(`    tier: ${tier}`);
  console.log(`    answer contains ${drug}/${altDrug.join('/')}: ${containsDrug}`);
  if (!containsDrug) {
    console.log(`    ⚠️  WRONG DRUG — answer: "${topAnswer.substring(0, 150)}..."`);
    // What would have been correct?
    const correctChunks = chunks.filter(c => {
      const a = (c.content?.en?.answer || '').toLowerCase();
      const t = (c.display_title || '').toLowerCase();
      return allDrugNames.some(d => a.includes(d) || t.includes(d));
    });
    if (correctChunks.length > 0) {
      console.log(`    Correct chunks in corpus (${correctChunks.length}):`);
      for (const cc of correctChunks.slice(0, 3)) {
        const fusedPos = fusedR.findIndex(r => r.chunkId === cc.id);
        console.log(`      "${cc.display_title}" — fused rank: ${fusedPos >= 0 ? '#' + (fusedPos + 1) : 'NOT IN TOP RESULTS'}`);
      }
    } else {
      console.log(`    ⚠️  NO ${drug} CHUNK EXISTS IN CORPUS — content gap`);
    }
  } else {
    console.log(`    ✓ CORRECT — drug name confirmed in retrieved content`);
  }
}

console.log('\n══════════════════════════════════════════════════');
