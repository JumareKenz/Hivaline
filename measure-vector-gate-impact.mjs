/**
 * Measure vector participation before/after gate threshold change
 * Identify query classes where 5-8% margins existed and vector was valuable
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

function analyzeMargin(vector) {
  if (vector.length < 2 || vector[1].score === 0) return null;
  return (vector[0].score - vector[1].score) / vector[1].score;
}

// Extended test set — 25 diverse queries to find 5-8% margin cases
const QUERIES = [
  'ART for pregnant woman with HIV',
  'Signs of ART treatment failure',
  'When to start ART in adults',
  'What is PMTCT?',
  'ARV dose for 10kg child',
  'How to screen for TB in PLHIV',
  'TPT options for PLHIV',
  'Isoniazid dose for children',
  'Coartem dose for 20kg child',
  'How much amoxicillin for a 14kg child?',
  'Can I give rifampicin with dolutegravir?',
  'Newborn danger signs',
  'HIV treatment during pregnancy',
  'Managing TB in HIV-positive patients',
  'Cotrimoxazole prophylaxis dosing',
  'Opportunistic infection screening',
  'CD4 count interpretation',
  'Viral load monitoring',
  'Immune reconstitution inflammatory syndrome',
  'Postpartum hemorrhage management',
  'Breastfeeding and HIV transmission',
  'Infant feeding options for HIV',
  'Adherence counseling strategies',
  'Drug interactions with ART',
  'Nutritional support in advanced disease',
];

console.log('═'.repeat(80));
console.log('VECTOR GATE IMPACT ANALYSIS — 5-8% Margin Discovery');
console.log('═'.repeat(80) + '\n');

console.log('Loading model...');
const t0 = Date.now();
const embedder = await pipeline('feature-extraction', 'embed', { quantized: true });
const loadMs = Date.now() - t0;
console.log(`Model loaded in ${loadMs}ms\n`);

let at5pct = 0, at5to10pct = 0, at10pct = 0, total = 0;
const marginsIn5to8 = [];

for (const query of QUERIES) {
  const bm25 = bm25Search(query);
  const vector = await vectorSearch(query);
  
  if (bm25.length === 0) continue;
  
  const margin = analyzeMargin(vector);
  if (margin !== null) {
    total++;
    const pct = margin * 100;
    
    if (pct < 0.05) at5pct++;
    else if (pct < 0.10) { at5to10pct++; marginsIn5to8.push({ query, margin: pct }); }
    else at10pct++;
  }
}

console.log('Vector margin distribution (all ${total} queries with BM25 fallback):');
console.log(`  < 5%:       ${at5pct} queries (would PASS at 5%, FAIL at 10%) → vector gated out in both`);
console.log(`  5–10%:      ${at5to10pct} queries (PASS at 5%, FAIL at 10%) → vector excluded by new gate`);
console.log(`  > 10%:      ${at10pct} queries (FAIL at 5%, PASS at 10%) → vector included in both`);

console.log(`\nQueries in 5–10% margin (affected by gate change):`);
if (marginsIn5to8.length === 0) {
  console.log('  None found in test set — 10% threshold is conservative');
} else {
  for (const { query, margin } of marginsIn5to8.slice(0, 5)) {
    console.log(`  "${query}" (margin=${margin.toFixed(1)}%)`);
  }
}

console.log('\n' + '═'.repeat(80));
console.log('CONCLUSION:');
if (at5to10pct === 0) {
  console.log('✓ No 5–10% margin queries in extended test set');
  console.log('  10% gate is CONSERVATIVE and does not lose value on tested domains');
  console.log('  Possible hidden loss only in untested query classes (e.g., rare conditions)');
} else {
  console.log(`⚠️  ${at5to10pct} query(ies) in 5–10% range affected by gate change`);
  console.log('  Impact: Vector excluded when it had valid but weak discriminative signal');
  console.log('  Recommendation: Verify these don\'t belong in high-impact query classes');
}
console.log('═'.repeat(80));
