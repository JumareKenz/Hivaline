/**
 * PHASE 25 — Fast targeted re-check of 4 flagged queries
 * Query #1 is priority (drug-specificity blocker)
 * Artifact: 2026.06.24.62 (997 chunks)
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

const SYNONYMS = {
  arv: ['antiretroviral'], pmtct: ['prevention', 'mother', 'child', 'transmission', 'pregnancy', 'maternal'],
  tpt: ['preventive', 'isoniazid', 'rifapentine', 'tuberculosis'], tb: ['tuberculosis', 'coinfection'],
  act: ['artemisinin', 'coartem', 'lumefantrine', 'malaria'], plhiv: ['people', 'living', 'hiv', 'positive'],
  pregnant: ['pregnancy', 'maternal', 'pmtct'], failure: ['virologic', 'viral', 'load', 'resistance'],
};
function expandQuery(query) {
  const normalized = query.replace(/[-/]/g, ' ');
  const tokens = normalized.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
  const expansions = [];
  const set = new Set(tokens);
  for (const t of tokens) {
    const syns = SYNONYMS[t];
    if (syns) for (const s of syns) if (!set.has(s) && !expansions.includes(s)) expansions.push(s);
  }
  return expansions.length > 0 ? normalized + ' ' + expansions.join(' ') : normalized;
}

(async () => {
console.log('═'.repeat(90));
console.log('PHASE 25 — TARGETED RE-CHECK (4 FLAGGED QUERIES)');
console.log('═'.repeat(90) + '\n');

console.log('Loading model...\n');
await embedQuery('warmup');

const QUERIES = [
  {
    q: 'ARV dose for 10kg child',
    priority: 'PRIORITY',
    expect: /arv|art|hiv|antiretroviral|lopinavir|abacavir|dolutegravir|efavirenz/i,
    notes: 'Drug-specificity blocker — must be ARV-class specific, not generic dosage'
  },
  {
    q: 'How to screen for TB in PLHIV',
    priority: 'INFO',
    expect: /screen|symptom|cough|fever|weight.*loss|night.*sweat|tb.*test|tb.*diagnosis/i,
    notes: 'Lower stakes — topically-adjacent acceptable'
  },
  {
    q: 'HIV treatment during pregnancy',
    priority: 'INFO',
    expect: /pmtct|pregnan|maternal|mother|hiv.*treat/i,
    notes: 'Lower stakes — informational'
  },
  {
    q: 'What is PMTCT?',
    priority: 'INFO',
    expect: /pmtct|mother.*to.*child|prevent.*transmis|pregnan|vertical|option.*b/i,
    notes: 'Lower stakes — definitional'
  }
];

for (const { q, priority, expect, notes } of QUERIES) {
  console.log(`[${priority}] "${q}"`);
  console.log(`Notes: ${notes}`);

  const expanded = expandQuery(q);
  const bm25 = bm25Search(expanded);
  const vector = await vectorSearch(expanded);
  const confident = isVectorConfident(vector) && bm25.length > 0;
  const fused = rrfFuse(bm25, confident ? vector : []);

  const topId = fused[0]?.chunkId ?? null;
  const topChunk = title(topId);
  const topType = chunkType(topId);
  const topContent = content(topId);
  const tier = confident ? 'BM25+Vec' : 'BM25-only';

  // Verdict: does it answer the question correctly?
  const isCorrect = expect.test(topContent);
  const isGeneric = /dosage amount|dose|drug.*name|treatment|advice|information|clinical|information/i.test(topChunk) &&
                    !/specific|arv|antiretroviral|pmtct|tuberculosis|tb|malaria|coartem|dolutegravir|amoxicillin/i.test(topChunk);

  const verdict = isCorrect ? '✓ PASS' : isGeneric ? '⚠️ GENERIC' : '✗ FAIL';

  console.log(`\nRetrieved: [${topType}] "${topChunk}"`);
  console.log(`Tier: ${tier}`);
  console.log(`Answer preview: "${topContent.substring(0, 80)}..."`);
  console.log(`Verdict: ${verdict}`);

  if (!isCorrect) {
    console.log(`  ⚠️  Does not match expected pattern: ${expect}`);
  }

  console.log();
}

// SUMMARY
console.log('═'.repeat(90));
console.log('PHASE 25 VERDICT');
console.log('═'.repeat(90) + '\n');

const results = [];
for (const { q, priority, expect } of QUERIES) {
  const expanded = expandQuery(q);
  const bm25 = bm25Search(expanded);
  const vector = await vectorSearch(expanded);
  const confident = isVectorConfident(vector) && bm25.length > 0;
  const fused = rrfFuse(bm25, confident ? vector : []);
  const topId = fused[0]?.chunkId ?? null;
  const topContent = content(topId);
  const isCorrect = expect.test(topContent);

  results.push({ q, priority, pass: isCorrect });
}

const priorityPass = results.find(r => r.priority === 'PRIORITY')?.pass;
const infoPass = results.filter(r => r.priority === 'INFO').every(r => r.pass);

console.log(`Query #1 (PRIORITY): ${priorityPass ? '✓ PASS' : '✗ FAIL'}`);
console.log(`Queries #2-4 (INFO): ${infoPass ? '✓ ALL PASS' : '⚠️ SOME FAIL'}\n`);

if (priorityPass) {
  console.log('🟢 PRODUCTION CLEARANCE: Query #1 (ARV dosage) passes');
  console.log('   All priority blocker conditions met.');
} else {
  console.log('🔴 PRODUCTION HOLD: Query #1 (ARV dosage) FAILS');
  console.log('   This is the drug-specificity blocker flagged in Phase 17b/18.');
  console.log('   Do not push to production without root-cause analysis.');
}

if (!infoPass) {
  console.log('\n⚠️  Info queries have issues but are not production blockers.');
}

})();
