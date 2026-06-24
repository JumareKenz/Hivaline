/**
 * test-embedding-recall.mjs — Real MiniLM embedding model recall test
 *
 * Runs the 15-query retrieval harness with the ACTUAL on-device embedding model
 * (paraphrase-multilingual-MiniLM-L12-v2) loaded via @xenova/transformers in Node.
 *
 * This is the definitive measurement of warm-state Recall@1 with the real model,
 * not a mock or hash substitute.
 *
 * Usage: node test-embedding-recall.mjs
 */

import { pipeline, env } from '@xenova/transformers';
import { readFileSync } from 'fs';
import { unzipSync, strFromU8 } from 'fflate';

// Point at local model files
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = './public/models/';

// ─── Load .hiv file and extract embeddings + BM25 index ───

const HIV_PATH = process.argv[2] || './hiv-cache.bin';
console.log('═══════════════════════════════════════════════════════');
console.log('  ARTIFACT IDENTITY');
console.log('─────────────────────────────────────────────────────');
console.log(`  File: ${HIV_PATH}`);

const hivBytes = readFileSync(HIV_PATH);
const files = unzipSync(new Uint8Array(hivBytes));

function getFile(path) {
  const clean = path.replace(/^\/+/, '');
  for (const key of Object.keys(files)) {
    if (key.replace(/^\/+/, '') === clean && files[key].length > 0) return files[key];
  }
  return null;
}

// Parse and display manifest identity
const manifestRaw = getFile('manifest.json');
const manifest = manifestRaw ? JSON.parse(strFromU8(manifestRaw)) : {};
console.log(`  Version: ${manifest.version || 'UNKNOWN'}`);
console.log(`  Chunk count: ${manifest.chunk_count || 'UNKNOWN'}`);
console.log(`  Created: ${manifest.created_at || 'UNKNOWN'}`);
console.log(`  Capabilities: ${JSON.stringify(manifest.retrievalCapabilities || 'NOT DECLARED')}`);
console.log('═══════════════════════════════════════════════════════\n');

// Parse chunks
const chunksRaw = strFromU8(getFile('content/chunks.jsonl'));
const chunks = chunksRaw.split('\n').filter(l => l.trim()).map(l => {
  try { return JSON.parse(l); } catch { return null; }
}).filter(Boolean);
console.log(`Loaded ${chunks.length} chunks`);

// Parse embeddings
const embRaw = getFile('index/embeddings.bin');
const embView = new DataView(embRaw.buffer, embRaw.byteOffset, embRaw.byteLength);
const chunkCount = embView.getUint32(0, true);
const dims = embView.getUint32(4, true);
console.log(`Embeddings: ${chunkCount} chunks × ${dims} dims`);

const embOffset = 8;
const embFloats = new Float32Array(embRaw.buffer, embRaw.byteOffset + embOffset, chunkCount * dims);

// Parse embeddings_index.json for chunk ID mapping
const indexRaw = getFile('index/embeddings_index.json');
let chunkIds = [];
if (indexRaw) {
  const indexData = JSON.parse(strFromU8(indexRaw));
  const indexMap = indexData.index;
  chunkIds = Object.keys(indexMap).sort((a, b) => Number(a) - Number(b)).map(k => indexMap[k]);
}

// Parse BM25 index
const lexRaw = getFile('index/lexical.json');
const bm25Index = lexRaw ? JSON.parse(strFromU8(lexRaw)) : {};
console.log('BM25 index:', lexRaw ? 'present' : 'ABSENT (no lexical.json)');

// Parse query proxies (Tier 3 fallback)
const proxyRaw = getFile('index/query_proxies.json');
let queryProxies = {};
if (proxyRaw) {
  const parsed = JSON.parse(strFromU8(proxyRaw));
  // Format: { "en": [ { pattern, vector }, ... ] }
  const entries = parsed?.en ?? [];
  if (Array.isArray(entries)) {
    for (const e of entries) {
      if (e.pattern && Array.isArray(e.vector)) queryProxies[e.pattern] = e.vector;
    }
  }
}
const proxyCount = Object.keys(queryProxies).length;
console.log(`Query proxies: ${proxyCount} entries (${proxyRaw ? Math.round(proxyRaw.length/1024) + 'KB' : 'ABSENT'})`);

// Build chunk content map for result verification
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

// ─── Load real embedding model ───

console.log('Loading MiniLM embedding model (may take 10-30s on first run)...');
const t0 = performance.now();
const embedder = await pipeline('feature-extraction', 'embed', { quantized: true });
const loadMs = Math.round(performance.now() - t0);
console.log(`Model loaded in ${loadMs}ms`);

async function embedQuery(text) {
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return output.data;
}

// ─── Cosine similarity ───

function cosine(a, b) {
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    nA += a[i] * a[i];
    nB += b[i] * b[i];
  }
  return dot / (Math.sqrt(nA) * Math.sqrt(nB) + 1e-10);
}

// ─── Search functions ───

function bm25Search(query) {
  const idx = bm25Index?.en?.index || {};
  const terms = query.toLowerCase().split(/\s+/).map(t => t.replace(/[^\w]/g, '')).filter(t => t.length >= 2);
  const scores = {};
  for (const term of terms) {
    const postings = idx[term] || [];
    for (const { chunk_id, score } of postings) {
      scores[chunk_id] = (scores[chunk_id] || 0) + score;
    }
  }
  // Rare-term anchor: boost matching chunks, demote non-matching
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
  return Object.entries(scores).sort(([,a],[,b]) => b - a).map(([id, score]) => ({ chunkId: id, score }));
}

function proxyVectorSearch(query, topK = 10) {
  if (Object.keys(queryProxies).length === 0) return [];
  const queryTokens = new Set(query.toLowerCase().split(/\s+/).filter(t => t.length >= 2));
  let bestProxy = null;
  let bestJaccard = -1;
  for (const [proxyText, proxyVector] of Object.entries(queryProxies)) {
    const proxyTokens = new Set(proxyText.toLowerCase().split(/\s+/).filter(t => t.length >= 2));
    const inter = [...queryTokens].filter(t => proxyTokens.has(t)).length;
    const union = new Set([...queryTokens, ...proxyTokens]).size;
    const jaccard = union > 0 ? inter / union : 0;
    if (jaccard > bestJaccard) { bestJaccard = jaccard; bestProxy = proxyVector; }
  }
  if (!bestProxy) return [];
  const results = [];
  for (let i = 0; i < chunkCount; i++) {
    const offset = i * dims;
    const chunkVec = embFloats.subarray(offset, offset + dims);
    const score = cosine(bestProxy, chunkVec);
    results.push({ chunkId: chunkIds[i] || String(i), score });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, topK);
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
  // If BM25 has no results, always trust vector (it's all we have)
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
  for (const [id, { bm25, vector }] of ranks) {
    scores.set(id, 1 / (k + bm25) + 1 / (k + vector));
  }
  return Array.from(scores.entries()).map(([id, score]) => ({ chunkId: id, score })).sort((a, b) => b.score - a.score);
}

// ─── Synonym expansion (same as queryRewriter.ts) ───

const SYNONYMS = {
  arv: ['antiretroviral'],
  pmtct: ['prevention', 'mother', 'child', 'transmission', 'pregnancy', 'maternal'],
  tpt: ['preventive', 'isoniazid', 'rifapentine', 'tuberculosis'],
  ipt: ['isoniazid', 'preventive', 'tuberculosis'],
  tb: ['tuberculosis', 'coinfection'],
  act: ['artemisinin', 'coartem', 'lumefantrine', 'malaria'],
  kmc: ['kangaroo', 'mother', 'care', 'skin'],
  plhiv: ['people', 'living', 'hiv', 'positive'],
  pph: ['postpartum', 'hemorrhage', 'bleeding'],
  anc: ['antenatal', 'pregnancy'],
  pregnant: ['pregnancy', 'maternal', 'pmtct'],
  failure: ['virologic', 'viral', 'load', 'resistance'],
};

function expandQuery(query) {
  const normalized = query.replace(/[-/]/g, ' ');
  const tokens = normalized.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
  const parts = [];
  for (const t of tokens) {
    const sub = t.split(/[-/]/).filter(p => p.length >= 2);
    parts.push(...(sub.length > 1 ? sub : [t.replace(/[^\w]/g, '')]));
  }
  const expansions = [];
  const set = new Set(parts);
  for (const token of parts) {
    const syns = SYNONYMS[token];
    if (syns) for (const s of syns) if (!set.has(s) && !expansions.includes(s)) expansions.push(s);
  }
  return expansions.length > 0 ? normalized + ' ' + expansions.join(' ') : normalized;
}

// ─── Domain coverage check ───

const FULL_CORPUS_DOMAINS = ['HIV', 'TB', 'Malaria', 'Drug', 'Maternal'];
const chunkTitles = chunks.map(c => (c.display_title || '').toLowerCase());
const hasFullCorpus = FULL_CORPUS_DOMAINS.every(d => {
  const domainLower = d.toLowerCase();
  return chunkTitles.some(t => t.includes(domainLower)) ||
    chunks.some(c => {
      const answer = (c.content?.en?.answer || '').toLowerCase();
      return answer.includes(domainLower);
    });
});

if (!hasFullCorpus) {
  console.log('⚠️  PARTIAL BUILD DETECTED — artifact does not cover all 5 clinical domains');
  console.log('   Full 15-query harness results are NOT valid for this build.');
  console.log('   Running scoped smoke test only.\n');
}

// ─── RMNCAEH-scoped smoke test (for partial/scoped builds) ───

const RMNCAEH_CASES = [
  { q: 'What is RMNCAEH+N?', domain: 'RMNCAEH', expect: /reproductive|maternal|newborn|child|adolescent|elderly|nutrition/i },
  { q: 'Which ministries are involved in health?', domain: 'RMNCAEH', expect: /ministr|agriculture|federal|government/i },
  { q: 'What is the Family Health Department?', domain: 'RMNCAEH', expect: /family health|coordinat|reproductive|maternal/i },
  { q: 'When did the Baby Friendly Initiative start?', domain: 'RMNCAEH', expect: /baby friendly|bfi|2021|breastfeed/i },
  { q: 'Who are the programme partners?', domain: 'RMNCAEH', expect: /partner|global financing|world bank|unicef/i },
];

// ─── Full 15-query clinical harness ───

const CASES = [
  { q: 'ART for pregnant woman with HIV', domain: 'HIV', expect: /pmtct|pregnan|mother.*child|maternal|option.*b/i },
  { q: 'Signs of ART treatment failure', domain: 'HIV', expect: /fail|viral.*load|1000|suppress|resistan/i },
  { q: 'When to start ART in adults', domain: 'HIV', expect: /start|initiat|same.*day|rapid|regardless|cd4/i },
  { q: 'What is PMTCT?', domain: 'HIV', expect: /pmtct|mother.*to.*child|prevent.*transmis|pregnan/i },
  { q: 'ARV dose for 10kg child', domain: 'HIV', expect: /arv|art|hiv|antiretroviral|lopinavir|abacavir|dolutegravir/i },
  { q: 'How to screen for TB in PLHIV', domain: 'TB', expect: /screen|symptom|cough|fever|weight.*loss|night.*sweat/i },
  { q: 'TPT options for PLHIV', domain: 'TB', expect: /3hp|3hr|6h|1hp|ipt|isoniazid|rifapentine|preventive/i },
  { q: 'Isoniazid dose for children', domain: 'TB', expect: /isoniazid|inh|10.*mg.*kg|tpt|preventive/i },
  { q: 'Coartem dose for 20kg child', domain: 'Malaria', expect: /coartem|act|artemether|lumefantrine|malaria|tablet/i },
  { q: 'How much amoxicillin for a 14kg child?', domain: 'Drug', expect: /amoxicillin|amoxycillin|pharyngitis|otitis|antibiotic/i },
  { q: 'Can I give rifampicin with dolutegravir?', domain: 'Drug', expect: /rifampicin|dolutegravir|dose.*adjust|double|50.*mg.*twice/i },
  { q: 'Newborn danger signs', domain: 'Maternal', expect: /convuls|not.*feed|fever|breath|lethargi|jaundice|cord|refer/i },
  { q: 'HIV treatment during pregnancy', domain: 'HIV', expect: /pmtct|pregnan|maternal|mother/i },
  { q: 'Managing TB in HIV-positive patients', domain: 'TB/HIV', expect: /tb.*hiv|co.*infect|rifampicin|art.*tb/i },
  { q: 'wetin be the sign say pikin dey sick well well', domain: 'Pidgin', expect: /danger|sign|sick|convuls|refer|fever/i },
];

// ─── RMNCAEH SMOKE TEST (always runs) ───

console.log('Running RMNCAEH scoped smoke test...\n');
let smokePass = 0;
const smokeDetails = [];

for (const { q, domain, expect: regex } of RMNCAEH_CASES) {
  const expanded = expandQuery(q);
  const bm25 = bm25Search(expanded);
  const proxy = proxyVectorSearch(expanded);
  const fused = rrfFuse(bm25, proxy);
  const topId = fused[0]?.chunkId ?? null;
  const content = topId ? (chunkMap.get(topId) ?? '') : '';
  const hit = topId !== null && regex.test(content);
  if (hit) smokePass++;
  const chunk = chunks.find(c => c.id === topId);
  const title = chunk?.display_title || topId || 'NULL';
  smokeDetails.push(`  ${hit ? '✓' : '✗'} "${q}" → ${title}`);
}

console.log('══════════════════════════════════════════════════');
console.log(`  RMNCAEH SMOKE TEST (BM25+proxy): ${smokePass}/${RMNCAEH_CASES.length}`);
console.log('──────────────────────────────────────────────────');
for (const d of smokeDetails) console.log(d);
console.log('══════════════════════════════════════════════════\n');

if (!hasFullCorpus) {
  console.log('Skipping full 15-query clinical harness (partial build).\n');
  process.exit(0);
}

// ─── COLD-START TEST (proxy only, no embedding model) ───

console.log(`Running 15-query COLD-START harness (Tier 3 proxy only)...\n`);
let coldPass = 0;
const coldDetails = [];

for (const { q, domain, expect: regex } of CASES) {
  const expanded = expandQuery(q);
  const bm25 = bm25Search(expanded);
  const proxy = proxyVectorSearch(expanded);
  const hasBm25 = bm25.length > 0;
  const fused = rrfFuse(bm25, (!hasBm25 || isVectorConfident(proxy, hasBm25)) ? proxy : []);

  const topId = fused[0]?.chunkId ?? null;
  const content = topId ? (chunkMap.get(topId) ?? '') : '';
  const hit = topId !== null && regex.test(content);

  if (hit) coldPass++;
  const icon = hit ? '✓' : (topId ? '✗' : '⊘');
  const chunk = chunks.find(c => c.id === topId);
  const title = chunk?.display_title || topId || 'NULL (no result)';
  coldDetails.push(`  ${icon} [${domain}] "${q}" → ${title}`);
}

console.log('══════════════════════════════════════════════════');
console.log(`  COLD-START (Proxy, no model): ${coldPass}/${CASES.length} (${((coldPass/CASES.length)*100).toFixed(1)}%)`);
console.log('──────────────────────────────────────────────────');
for (const d of coldDetails) console.log(d);
console.log('══════════════════════════════════════════════════\n');

// ─── WARM-STATE TEST (real embedding model) ───

console.log(`Running 15-query harness with REAL MiniLM model...\n`);
let pass = 0;
const details = [];

for (const { q, domain, expect: regex } of CASES) {
  const expanded = expandQuery(q);
  const bm25 = bm25Search(expanded);
  const vector = await vectorSearch(expanded);
  const confident = isVectorConfident(vector, bm25.length > 0);
  const fused = rrfFuse(bm25, confident ? vector : []);

  const topId = fused[0]?.chunkId ?? null;
  const content = topId ? (chunkMap.get(topId) ?? '') : '';
  const hit = topId !== null && regex.test(content);

  if (hit) pass++;
  const icon = hit ? '✓' : '✗';
  const chunk = chunks.find(c => c.id === topId);
  const title = chunk?.display_title || topId || 'null';
  const conf = confident ? `vec=${vector[0]?.score.toFixed(3)}` : 'vec=GATED';
  details.push(`  ${icon} [${domain}] "${q}"\n    → ${title} (${conf}, bm25_top=${bm25[0]?.score ?? 0})`);
}

console.log('══════════════════════════════════════════════════');
console.log(`  REAL-MODEL WARM-STATE RECALL@1: ${pass}/${CASES.length} (${((pass/CASES.length)*100).toFixed(1)}%)`);
console.log(`  Model: paraphrase-multilingual-MiniLM-L12-v2 (quantized)`);
console.log(`  Model load time: ${loadMs}ms`);
console.log('──────────────────────────────────────────────────');
for (const d of details) console.log(d);
console.log('══════════════════════════════════════════════════');
