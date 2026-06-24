/**
 * Check: Does BM25+Vector fix Query #1?
 * Quick diagnostic for ARV dosage query
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
const idx = bm25Index?.en?.index || {};

function cosine(a, b) {
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; nA += a[i] * a[i]; nB += b[i] * b[i]; }
  return dot / (Math.sqrt(nA) * Math.sqrt(nB) + 1e-10);
}

async function embedQuery(text) {
  const embedder = await pipeline('feature-extraction', 'embed', { quantized: true });
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return output.data;
}

function bm25Search(query) {
  const terms = query.toLowerCase().split(/\s+/).map(t => t.replace(/[^\w]/g, '')).filter(t => t.length >= 2);
  const scores = {};
  for (const term of terms) {
    const postings = idx[term] || [];
    for (const { chunk_id, score } of postings) {
      scores[chunk_id] = (scores[chunk_id] || 0) + score;
    }
  }
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

async function vectorSearch(query) {
  const qEmb = await embedQuery(query);
  const results = [];
  for (let i = 0; i < chunkCount; i++) {
    const chunkVec = embFloats.subarray(i * dims, (i + 1) * dims);
    results.push({ chunkId: chunkIds[i] || String(i), score: cosine(qEmb, chunkVec) });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 10);
}

function isVectorConfident(results) {
  if (results.length === 0) return false;
  if (results[0].score < 0.3) return false;
  if (results.length >= 2) {
    const margin = (results[0].score - results[1].score) / results[1].score;
    if (margin < 0.10) return false;
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
function chunkType(id) { return chunks.find(c => c.id === id)?.type || 'unknown'; }
function content(id) { return chunks.find(c => c.id === id)?.content?.en?.answer || ''; }

(async () => {

const q = 'ARV dose for 10kg child';
console.log('═'.repeat(90));
console.log('PHASE 25 DIAGNOSTIC: BM25 vs BM25+Vector for Query #1');
console.log('═'.repeat(90) + '\n');

console.log('Query: "' + q + '"\n');
console.log('Loading model...\n');
await embedQuery('warmup');

const bm25 = bm25Search(q);
const vector = await vectorSearch(q);
const confident = isVectorConfident(vector);

console.log('BM25 Top 5:');
for (let i = 0; i < 5 && i < bm25.length; i++) {
  const r = bm25[i];
  console.log(`  ${i+1}. [${chunkType(r.chunkId)}] "${title(r.chunkId)}" (score: ${r.score.toFixed(2)})`);
}

console.log('\nVector Top 5 (confidence: ' + (confident ? 'PASS' : 'GATED') + '):');
for (let i = 0; i < 5 && i < vector.length; i++) {
  const r = vector[i];
  console.log(`  ${i+1}. [${chunkType(r.chunkId)}] "${title(r.chunkId)}" (score: ${r.score.toFixed(3)})`);
}

if (vector.length >= 2) {
  const margin = (vector[0].score - vector[1].score) / vector[1].score;
  console.log(`\nVector margin: ${(margin*100).toFixed(1)}% (threshold: 10%)`);
}

const fused = rrfFuse(bm25, confident ? vector : []);
console.log('\nBM25+Vector (RRF Fusion) Top 5:');
for (let i = 0; i < 5 && i < fused.length; i++) {
  const r = fused[i];
  console.log(`  ${i+1}. [${chunkType(r.chunkId)}] "${title(r.chunkId)}" (fused score: ${r.score.toFixed(5)})`);
}

// Check: is there an ARV-specific chunk?
console.log('\n' + '═'.repeat(90));
console.log('ARV-SPECIFIC CHUNK SEARCH');
console.log('═'.repeat(90) + '\n');

const arvChunks = chunks.filter(c =>
  /arv|antiretroviral|art regimen|art treatment/i.test(c.display_title)
);

console.log(`ARV-specific chunks found: ${arvChunks.length}`);
if (arvChunks.length > 0) {
  console.log('List:');
  for (const c of arvChunks.slice(0, 5)) {
    console.log(`  - [${c.type}] "${c.display_title}"`);
  }

  const bm25Top20Ids = bm25.slice(0, 20).map(r => r.chunkId);
  const arvInTop20 = arvChunks.filter(c => bm25Top20Ids.includes(c.id));
  console.log(`\nARV chunks in BM25 top-20: ${arvInTop20.length}`);
  if (arvInTop20.length === 0) {
    console.log('⚠️  ARV-specific chunks exist but NOT in BM25 top-20');
  }
}

// Check: BM25 index diagnostics
console.log('\n' + '═'.repeat(90));
console.log('BM25 INDEX DIAGNOSTICS');
console.log('═'.repeat(90) + '\n');

const arvPostings = idx['arv'] || [];
const antiretroviralsPostings = idx['antiretroviral'] || [];

console.log(`"arv" term: ${arvPostings.length} postings`);
if (arvPostings.length > 0 && arvPostings.length <= 5) {
  console.log('  ✓ Rare term (should trigger anchor boost)');
  console.log('  Chunks:');
  for (const p of arvPostings.slice(0, 3)) {
    console.log(`    - "${title(p.chunk_id)}"`);
  }
}

console.log(`\n"antiretroviral" term: ${antiretroviralsPostings.length} postings`);

// Final verdict
console.log('\n' + '═'.repeat(90));
console.log('FINAL VERDICT');
console.log('═'.repeat(90) + '\n');

const expectPattern = /arv|art|hiv|antiretroviral|lopinavir|abacavir|dolutegravir|efavirenz/i;
const bm25Pass = expectPattern.test(content(bm25[0].chunkId));
const vectorPass = expectPattern.test(content(vector[0].chunkId));
const fusedPass = expectPattern.test(content(fused[0].chunkId));

console.log(`BM25 only: ${bm25Pass ? 'PASS' : 'FAIL'} (${title(bm25[0].chunkId)})`);
console.log(`Vector only (${confident ? 'confident' : 'gated'}): ${vectorPass ? 'PASS' : 'FAIL'} (${title(vector[0].chunkId)})`);
console.log(`Fused result: ${fusedPass ? '✓ PASS' : '✗ FAIL'} (${title(fused[0].chunkId)})`);

if (fusedPass && !bm25Pass && confident) {
  console.log('\n✓ VECTOR RESCUES THE QUERY');
} else if (fusedPass && !bm25Pass && !confident) {
  console.log('\n⚠️  Vector WOULD help but is GATED (margin < 10%)');
} else if (!fusedPass) {
  console.log('\n✗ NEITHER BM25 NOR VECTOR WORKS');
}

})();
