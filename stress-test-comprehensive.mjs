/**
 * Part B — Comprehensive stress test across both clinical and policy domains
 * Per-query, per-tier breakdown (not aggregates only)
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

const proxyRaw = getFile('index/query_proxies.json');
let queryProxies = {};
if (proxyRaw) {
  const parsed = JSON.parse(strFromU8(proxyRaw));
  const entries = parsed?.en ?? [];
  for (const e of entries) {
    if (e.pattern && Array.isArray(e.vector)) queryProxies[e.pattern] = e.vector;
  }
}

function tokenize(text) {
  return text.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
}

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

function proxyVectorSearch(query) {
  const queryTokens = new Set(tokenize(query));
  let bestProxy = null, bestJaccard = -1;
  for (const [proxyText, proxyVector] of Object.entries(queryProxies)) {
    const proxyTokens = new Set(tokenize(proxyText));
    const inter = [...queryTokens].filter(t => proxyTokens.has(t)).length;
    const union = new Set([...queryTokens, ...proxyTokens]).size;
    const jaccard = union > 0 ? inter / union : 0;
    if (jaccard > bestJaccard) { bestJaccard = jaccard; bestProxy = proxyVector; }
  }
  if (!bestProxy) return [];
  const results = [];
  for (let i = 0; i < chunkCount; i++) {
    const chunkVec = embFloats.subarray(i * dims, (i + 1) * dims);
    results.push({ chunkId: chunkIds[i] || String(i), score: cosine(bestProxy, chunkVec) });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 10);
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

const CLINICAL_QUERIES = [
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
  { q: 'Coartem dose for 15kg child', domain: 'Malaria', expect: /coartem|act|artemether|lumefantrine/i },
  { q: 'Coartem dose for 25kg child', domain: 'Malaria', expect: /coartem|act|artemether|lumefantrine/i },
  { q: 'amoxicillin 250mg for 12kg child', domain: 'Drug', expect: /amoxicillin|amoxycillin|pharyngitis|otitis/i },
  { q: 'dolutegravir dose with rifampicin', domain: 'Drug', expect: /dolutegravir|dtg.*50.*mg|rifampicin.*adjust/i },
  { q: 'cotrimoxazole dose for HIV positive child 8kg', domain: 'Drug', expect: /cotrimoxazole|ctx|bactrim/i },
  { q: 'TB screening in pregnant women with HIV', domain: 'TB/HIV/Maternal', expect: /tb|screen|pregnan|hiv|symptom/i },
];

const POLICY_QUERIES = [
  { q: 'What is RMNCAEH?', domain: 'Policy', expect: /reproductive|maternal|newborn|child|health/i },
  { q: 'Which ministries run the health programme?', domain: 'Policy', expect: /ministr|government|health|coordinat/i },
  { q: 'What are the health programme partnerships?', domain: 'Policy', expect: /partner|world|organization|unicef|financing/i },
];

console.log('═'.repeat(80));
console.log('PART B: COMPREHENSIVE STRESS TEST');
console.log('═'.repeat(80) + '\n');

console.log('Loading model...');
const t0 = Date.now();
await embedQuery('warmup');
const modelLoadMs = Date.now() - t0;
console.log(`Model ready in ${modelLoadMs}ms\n`);

console.log('═'.repeat(80));
console.log('COLD-START (BM25 + Proxy, no embedding model)');
console.log('═'.repeat(80));

async function testColdStart(querySet, setName) {
  let pass = 0;
  const results = [];

  for (const { q, domain, expect } of querySet) {
    const expanded = expandQuery(q);
    const bm25 = bm25Search(expanded);
    const proxy = proxyVectorSearch(expanded);
    const fused = rrfFuse(bm25, proxy);
    const topId = fused[0]?.chunkId ?? null;
    const txt = topId ? content(topId) : '';
    const hit = topId !== null && expect.test(txt);

    if (hit) pass++;

    let tier = 'BM25-only';
    if (bm25.length > 0 && proxy.length > 0 && fused[0]?.chunkId === proxy[0]?.chunkId) tier = 'BM25+Proxy';
    if (!topId) tier = 'NULL';

    results.push({
      q: q.substring(0, 50),
      domain,
      topChunk: title(topId),
      tier,
      verdict: hit ? '✓' : '✗'
    });
  }

  console.log(`\n${setName}: ${pass}/${querySet.length}`);
  console.log('─'.repeat(80));
  for (const r of results) {
    console.log(`${r.verdict} [${r.domain}] "${r.q}" → ${r.topChunk} (${r.tier})`);
  }

  return { pass, total: querySet.length, results };
}

const coldClinical = await testColdStart(CLINICAL_QUERIES, 'CLINICAL COLD-START');
const coldPolicy = await testColdStart(POLICY_QUERIES, 'POLICY COLD-START');

console.log('\n\n' + '═'.repeat(80));
console.log('WARM-STATE (BM25 + Vector, real embedding model)');
console.log('═'.repeat(80));

async function testWarmState(querySet, setName) {
  let pass = 0;
  const results = [];

  for (const { q, domain, expect } of querySet) {
    const expanded = expandQuery(q);
    const bm25 = bm25Search(expanded);
    const vector = await vectorSearch(expanded);
    const confident = isVectorConfident(vector) && bm25.length > 0;
    const fused = rrfFuse(bm25, confident ? vector : []);
    const topId = fused[0]?.chunkId ?? null;
    const txt = topId ? content(topId) : '';
    const hit = topId !== null && expect.test(txt);

    if (hit) pass++;

    let tier = 'BM25-only';
    if (bm25.length > 0 && confident && vector.some(v => v.chunkId === fused[0]?.chunkId)) tier = 'BM25+Vec';
    if (vector.length > 0 && bm25.length === 0) tier = 'Vec-only';
    if (!topId) tier = 'NULL';

    results.push({
      q: q.substring(0, 50),
      domain,
      topChunk: title(topId),
      tier,
      verdict: hit ? '✓' : '✗'
    });
  }

  console.log(`\n${setName}: ${pass}/${querySet.length}`);
  console.log('─'.repeat(80));
  for (const r of results) {
    console.log(`${r.verdict} [${r.domain}] "${r.q}" → ${r.topChunk} (${r.tier})`);
  }

  return { pass, total: querySet.length, results };
}

const warmClinical = await testWarmState(CLINICAL_QUERIES, 'CLINICAL WARM-STATE');
const warmPolicy = await testWarmState(POLICY_QUERIES, 'POLICY WARM-STATE');

console.log('\n\n' + '═'.repeat(80));
console.log('SUMMARY');
console.log('═'.repeat(80));
console.log(`\nCLINICAL DOMAIN (${CLINICAL_QUERIES.length} queries):`);
console.log(`  Cold-start: ${coldClinical.pass}/${coldClinical.total}`);
console.log(`  Warm-state: ${warmClinical.pass}/${warmClinical.total}`);
console.log(`\nPOLICY DOMAIN (${POLICY_QUERIES.length} queries):`);
console.log(`  Cold-start: ${coldPolicy.pass}/${coldPolicy.total}`);
console.log(`  Warm-state: ${warmPolicy.pass}/${warmPolicy.total}`);
