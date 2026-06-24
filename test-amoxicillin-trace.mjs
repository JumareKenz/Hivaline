/**
 * test-amoxicillin-trace.mjs — Full retrieval trace for amoxicillin query
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
  const idx = bm25Index?.en?.index || {};
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

// ─── FULL TRACE ───

const query = 'amoxicillin 250mg for 12kg child';
console.log('Query: "' + query + '"\n');

const bm25 = bm25Search(query);
const vector = await vectorSearch(query);
const hasBm25 = bm25.length > 0;
const confident = isVectorConfident(vector, hasBm25);

console.log('BM25 top 5:');
for (const r of bm25.slice(0, 5)) {
  const c = chunks.find(ch => ch.id === r.chunkId);
  console.log('  score=' + r.score.toFixed(2) + ' → ' + (c?.display_title || r.chunkId));
}

console.log('\nVector top 10:');
for (const r of vector.slice(0, 10)) {
  const c = chunks.find(ch => ch.id === r.chunkId);
  console.log('  score=' + r.score.toFixed(3) + ' → ' + (c?.display_title || r.chunkId));
}

console.log('\nConfidence gate: confident=' + confident);
console.log('  vec[0].score=' + vector[0]?.score.toFixed(3));
if (vector.length >= 2) {
  const margin = (vector[0].score - vector[1].score) / vector[1].score;
  console.log('  vec[1].score=' + vector[1]?.score.toFixed(3));
  console.log('  margin=' + (margin * 100).toFixed(1) + '%');
}

const fused = rrfFuse(bm25, confident ? vector : []);
console.log('\nFused top 5 (confident=' + confident + '):');
for (const r of fused.slice(0, 5)) {
  const c = chunks.find(ch => ch.id === r.chunkId);
  console.log('  score=' + r.score.toFixed(5) + ' → ' + (c?.display_title || r.chunkId));
}

const topId = fused[0]?.chunkId;
const topChunk = chunks.find(c => c.id === topId);
console.log('\n═══ FINAL RETRIEVAL ═══');
console.log('Retrieved: ' + topChunk?.display_title);
console.log('Type: ' + topChunk?.type);
console.log('Answer: ' + (topChunk?.content?.en?.answer || '').substring(0, 300));
console.log('Contains "amoxicillin"? ' + ((topChunk?.content?.en?.answer || '').toLowerCase().includes('amoxicillin')));

// ─── Check all 3 amoxicillin chunks ───
console.log('\n═══ AMOXICILLIN CHUNKS IN CORPUS ═══');
const amoxChunks = chunks.filter(c => {
  const all = JSON.stringify(c).toLowerCase();
  return all.includes('amoxicillin');
});
for (const c of amoxChunks) {
  // Where did these rank in vector search?
  const vecRank = vector.findIndex(v => v.chunkId === c.id);
  const bm25Entry = bm25.find(b => b.chunkId === c.id);
  console.log('  "' + c.display_title + '"');
  console.log('    BM25 rank: ' + (bm25Entry ? '#' + (bm25.indexOf(bm25Entry) + 1) + ' (score=' + bm25Entry.score.toFixed(2) + ')' : 'NOT RANKED'));
  console.log('    Vector rank: ' + (vecRank >= 0 ? '#' + (vecRank + 1) + ' (score=' + vector[vecRank].score.toFixed(3) + ')' : 'NOT IN TOP 10'));
}

// ─── TASK 4: Verify other 4 dosage results ───
console.log('\n═══ TASK 4: VERIFY OTHER DOSAGE RESULTS ═══');

const otherDosage = [
  { q: 'Coartem dose for 15kg child', reported: 'Drug Dosage (14–20 kg)', drug: 'coartem' },
  { q: 'dolutegravir dose with rifampicin', reported: 'Dolutegravir Dose Adjustment with Rifampicin', drug: 'dolutegravir' },
  { q: 'cotrimoxazole dose for HIV positive child 8kg', reported: 'Cotrimoxazole Prophylaxis Dose', drug: 'cotrimoxazole' },
  { q: 'isoniazid 10mg/kg for TPT in children', reported: 'TB Preventive Therapy (TPT) Regimens and Dosage', drug: 'isoniazid' },
];

for (const { q, reported, drug } of otherDosage) {
  const bm25R = bm25Search(q);
  const vectorR = await vectorSearch(q);
  const hasBm25R = bm25R.length > 0;
  const confR = isVectorConfident(vectorR, hasBm25R);
  const fusedR = rrfFuse(bm25R, confR ? vectorR : []);
  const topIdR = fusedR[0]?.chunkId;
  const topC = chunks.find(c => c.id === topIdR);
  const answer = (topC?.content?.en?.answer || '').toLowerCase();
  const containsDrug = answer.includes(drug);
  console.log(`\n  "${q}"`);
  console.log(`    → ${topC?.display_title}`);
  console.log(`    Contains "${drug}" in answer? ${containsDrug}`);
  if (!containsDrug) {
    console.log('    ⚠️  Answer preview: ' + answer.substring(0, 150));
  }
}
