/**
 * test-coartem-trace.mjs — Trace Coartem 15kg retrieval path
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
const chunksRaw = strFromU8(getFile('content/chunks.jsonl'));
const chunks = chunksRaw.split('\n').filter(l => l.trim()).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

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
    const chunkVec = embFloats.subarray(i * dims, (i + 1) * dims);
    results.push({ chunkId: chunkIds[i] || String(i), score: cosine(qEmb, chunkVec) });
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
function title(id) { return chunks.find(c => c.id === id)?.display_title || id; }

// ═══ Coartem 15kg ═══
console.log('═══ COARTEM 15kg TRACE ═══\n');
const q1 = 'Coartem dose for 15kg child';
const bm25_1 = bm25Search(q1);
const vec_1 = await vectorSearch(q1);
const hasBm25_1 = bm25_1.length > 0;
const conf_1 = isVectorConfident(vec_1, hasBm25_1);

console.log('BM25 top 5:');
for (const r of bm25_1.slice(0, 5)) console.log(`  ${r.score.toFixed(2)} → ${title(r.chunkId)}`);
console.log('\nVector top 5:');
for (const r of vec_1.slice(0, 5)) console.log(`  ${r.score.toFixed(3)} → ${title(r.chunkId)}`);
console.log(`\nConfident: ${conf_1} (vec[0]=${vec_1[0].score.toFixed(3)}, vec[1]=${vec_1[1].score.toFixed(3)}, margin=${((vec_1[0].score - vec_1[1].score)/vec_1[1].score*100).toFixed(1)}%)`);

const fused_1 = rrfFuse(bm25_1, conf_1 ? vec_1 : []);
console.log(`\nFused top 5 (confident=${conf_1}):`);
for (const r of fused_1.slice(0, 5)) console.log(`  ${r.score.toFixed(5)} → ${title(r.chunkId)}`);
console.log(`\nFINAL: ${title(fused_1[0].chunkId)}`);

// Where is Coartem Pediatric Dosing?
const coartemId = chunks.find(c => (c.display_title || '').includes('Coartem Pediatric'))?.id;
if (coartemId) {
  const fusedRank = fused_1.findIndex(r => r.chunkId === coartemId);
  console.log(`Coartem Pediatric Dosing: fused rank #${fusedRank + 1}`);
}

// ═══ Amoxicillin with gate tightened ═══
console.log('\n\n═══ AMOXICILLIN — WHAT IF GATE WAS TIGHTER? ═══\n');
const q2 = 'amoxicillin 250mg for 12kg child';
const bm25_2 = bm25Search(q2);
const vec_2 = await vectorSearch(q2);

// If confidence gate blocked vector:
const fused_gated = rrfFuse(bm25_2, []);
console.log('If vector GATED (BM25 only):');
for (const r of fused_gated.slice(0, 5)) console.log(`  ${r.score.toFixed(5)} → ${title(r.chunkId)}`);
console.log(`→ Would retrieve: ${title(fused_gated[0].chunkId)}`);
const amoxInResult = chunks.find(c => c.id === fused_gated[0].chunkId)?.content?.en?.answer?.toLowerCase().includes('amoxicillin');
console.log(`→ Contains "amoxicillin": ${amoxInResult}`);

// If confident (current behavior):
const fused_conf = rrfFuse(bm25_2, vec_2);
console.log('\nIf vector CONFIDENT (current behavior):');
for (const r of fused_conf.slice(0, 5)) console.log(`  ${r.score.toFixed(5)} → ${title(r.chunkId)}`);
console.log(`→ Would retrieve: ${title(fused_conf[0].chunkId)}`);

// ═══ The root problem: margin=5.0% is EXACTLY on the boundary ═══
console.log('\n\n═══ CONFIDENCE GATE ANALYSIS ═══');
console.log(`Amoxicillin query vec margin: ${((vec_2[0].score - vec_2[1].score)/vec_2[1].score*100).toFixed(2)}%`);
console.log(`Current threshold: 5%`);
console.log(`At 5%: gate PASSES → vector poisons BM25 result`);
console.log(`At 6%: gate would BLOCK → BM25-only → correct result`);
