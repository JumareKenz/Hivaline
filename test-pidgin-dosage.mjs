/**
 * test-pidgin-dosage.mjs — Pidgin and dosage spot-check with tier breakdown
 */
import { pipeline, env } from '@xenova/transformers';
import { readFileSync } from 'fs';
import { unzipSync, strFromU8 } from 'fflate';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = './public/models/';

const HIV_PATH = process.argv[2] || './hiv-cache.bin';
const hivBytes = readFileSync(HIV_PATH);
const files = unzipSync(new Uint8Array(hivBytes));

function getFile(path) {
  const clean = path.replace(/^\/+/, '');
  for (const key of Object.keys(files)) {
    if (key.replace(/^\/+/, '') === clean && files[key].length > 0) return files[key];
  }
  return null;
}

// Parse chunks
const chunksRaw = strFromU8(getFile('content/chunks.jsonl'));
const chunks = chunksRaw.split('\n').filter(l => l.trim()).map(l => {
  try { return JSON.parse(l); } catch { return null; }
}).filter(Boolean);

// Parse embeddings
const embRaw = getFile('index/embeddings.bin');
const embView = new DataView(embRaw.buffer, embRaw.byteOffset, embRaw.byteLength);
const chunkCount = embView.getUint32(0, true);
const dims = embView.getUint32(4, true);
const embFloats = new Float32Array(embRaw.buffer, embRaw.byteOffset + 8, chunkCount * dims);

// Chunk ID mapping
const indexRaw = getFile('index/embeddings_index.json');
let chunkIds = [];
if (indexRaw) {
  const indexData = JSON.parse(strFromU8(indexRaw));
  chunkIds = Object.keys(indexData.index).sort((a, b) => Number(a) - Number(b)).map(k => indexData.index[k]);
}

// BM25
const lexRaw = getFile('index/lexical.json');
const bm25Index = lexRaw ? JSON.parse(strFromU8(lexRaw)) : {};

// Chunk content map
const chunkMap = new Map();
for (const chunk of chunks) {
  const en = chunk.content?.en;
  let text = (chunk.display_title || '') + ' ';
  if (chunk.trigger_phrases?.en) text += chunk.trigger_phrases.en.join(' ') + ' ';
  if (en?.answer) text += en.answer + ' ';
  if (en?.definition) text += en.definition + ' ';
  if (en?.primary_question) text += en.primary_question + ' ';
  if (en?.question_variants) text += en.question_variants.join(' ');
  chunkMap.set(chunk.id, text.toLowerCase());
}

// Load model
console.log('Loading MiniLM model...');
const embedder = await pipeline('feature-extraction', 'embed', { quantized: true });
console.log('Model ready.\n');

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
  // Rare-term anchor boost + non-anchor demotion
  const anchorChunks = new Set();
  let hasAnchors = false;
  for (const term of terms) {
    if (term.length < 4 || !/^[a-z]+$/i.test(term)) continue;
    const postings = idx[term] || [];
    if (postings.length > 0 && postings.length <= 5) {
      hasAnchors = true;
      for (const { chunk_id } of postings) anchorChunks.add(chunk_id);
    }
  }
  if (hasAnchors && anchorChunks.size > 0) {
    for (const [chunkId, score] of Object.entries(scores)) {
      scores[chunkId] = anchorChunks.has(chunkId) ? score * 1.3 : score * 0.7;
    }
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

// ──── PIDGIN QUERIES ────
const PIDGIN = [
  { q: 'wetin be the sign say pikin dey sick well well', expect: /danger|sign|sick|newborn|convuls|refer/i },
  { q: 'how I go give pikin malaria medicine', expect: /malaria|coartem|act|artemether|dose|child/i },
  { q: 'my patient belle don come, e get HIV', expect: /pregnan|pmtct|mother|antenatal|hiv.*positive/i },
  { q: 'wetin go happen if person stop take ARV', expect: /fail|adherence|resistan|interrupt|viral|treatment/i },
  { q: 'how person go know say e get TB', expect: /tb|screen|cough|symptom|tuberculosis/i },
];

// ──── DOSAGE QUERIES ────
const DOSAGE = [
  { q: 'Coartem dose for 15kg child', expect: /coartem|artemether|lumefantrine/i },
  { q: 'amoxicillin 250mg for 12kg child', expect: /amoxicillin|amoxycillin|pharyngitis|otitis/i },
  { q: 'dolutegravir dose with rifampicin', expect: /dolutegravir|dtg.*50.*mg|rifampicin.*adjust/i },
  { q: 'cotrimoxazole dose for HIV positive child 8kg', expect: /cotrimoxazole|ctx|bactrim/i },
  { q: 'isoniazid 10mg/kg for TPT in children', expect: /isoniazid|inh|3hr|3hp/i },
];

async function testSet(name, cases) {
  console.log('══════════════════════════════════════════════════');
  console.log('  ' + name);
  console.log('──────────────────────────────────────────────────');
  let pass = 0;
  for (const { q, expect: regex } of cases) {
    const expanded = expandQuery(q);
    const bm25 = bm25Search(expanded);
    const vector = await vectorSearch(expanded);
    const hasBm25 = bm25.length > 0;
    const confident = isVectorConfident(vector, hasBm25);
    const fused = rrfFuse(bm25, confident ? vector : []);
    const topId = fused[0]?.chunkId ?? null;
    const content = topId ? (chunkMap.get(topId) ?? '') : '';
    const hit = topId !== null && regex.test(content);
    if (hit) pass++;
    const chunk = chunks.find(c => c.id === topId);
    const title = chunk?.display_title || topId || 'NULL';
    const tier = confident ? 'BM25+Vec' : 'BM25-only';
    const vecScore = vector[0]?.score?.toFixed(3) || 'N/A';
    const bm25Score = bm25[0]?.score?.toFixed(1) || '0';
    console.log(`  ${hit ? '✓' : '✗'} "${q}"`);
    console.log(`    → ${title}`);
    console.log(`    tier=${tier} vec=${vecScore}${confident ? '' : ' (GATED)'} bm25=${bm25Score}`);
  }
  console.log(`\n  RESULT: ${pass}/${cases.length}`);
  console.log('══════════════════════════════════════════════════\n');
}

await testSet('PIDGIN QUERIES (warm state)', PIDGIN);
await testSet('DOSAGE/DRUG QUERIES (warm state)', DOSAGE);

// ──── TONE GAP CHECK ────
console.log('══════════════════════════════════════════════════');
console.log('  TONE GAP DEGRADATION CHECK');
console.log('──────────────────────────────────────────────────');
// Find chunks with no tone variants and check if answer assembly would break
let gapChunks = chunks.filter(c => {
  const en = c.content?.en;
  return en && !en.answer_urgent && !en.answer_reassuring && !en.answer_formal;
});
console.log(`  Chunks with base-only answer (no tones): ${gapChunks.length}/${chunks.length}`);
const sample = gapChunks.slice(0, 3);
for (const c of sample) {
  const en = c.content?.en;
  const hasBase = !!(en?.answer || en?.definition);
  const fields = Object.keys(en || {}).filter(k => k.startsWith('answer'));
  console.log(`  - "${c.display_title}" | has base: ${hasBase} | answer fields: [${fields.join(', ')}]`);
}
console.log('══════════════════════════════════════════════════');
