/**
 * test-drug-fix-verify.mjs — Verify Phase 17b fixes resolve drug-name mismatches
 * Tests the FIXED logic (10% margin + rare-term anchor boost) against 2026.06.22.58.
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
console.log(`Artifact: ${manifest.version} (${manifest.chunk_count} chunks)\n`);

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

// ═══ FIXED BM25 with rare-term anchor boost + non-anchor demotion ═══
function bm25SearchFixed(query) {
  const terms = query.toLowerCase().split(/\s+/).map(t => t.replace(/[^\w]/g, '')).filter(t => t.length >= 2);
  const scores = {};
  for (const term of terms) {
    const postings = idx[term] || [];
    for (const { chunk_id, score } of postings) { scores[chunk_id] = (scores[chunk_id] || 0) + score; }
  }

  // Rare-term anchor: boost matching chunks, demote non-matching
  const anchorTerms = [];
  const anchorChunks = new Set();
  for (const term of terms) {
    if (term.length < 4 || !/^[a-z]+$/i.test(term)) continue;
    const postings = idx[term] || [];
    if (postings.length > 0 && postings.length <= 5) {
      anchorTerms.push(term);
      for (const { chunk_id } of postings) anchorChunks.add(chunk_id);
    }
  }
  if (anchorTerms.length > 0 && anchorChunks.size > 0) {
    for (const [chunkId, score] of Object.entries(scores)) {
      if (anchorChunks.has(chunkId)) {
        scores[chunkId] = score * 1.3;
      } else {
        scores[chunkId] = score * 0.7;
      }
    }
  }

  return Object.entries(scores).sort(([, a], [, b]) => b - a).map(([id, score]) => ({ chunkId: id, score }));
}

// OLD BM25 (no boost)
function bm25SearchOld(query) {
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

// FIXED confidence gate (10% margin)
function isVectorConfidentFixed(results, hasBm25) {
  if (results.length === 0) return false;
  if (!hasBm25) return true;
  if (results[0].score < 0.3) return false;
  if (results.length >= 2) {
    const margin = (results[0].score - results[1].score) / results[1].score;
    if (margin < 0.10) return false;  // was 0.05
  }
  return true;
}

// OLD confidence gate (5% margin)
function isVectorConfidentOld(results, hasBm25) {
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
function answerText(id) { return chunks.find(c => c.id === id)?.content?.en?.answer || ''; }

// ═══ TEST ALL 5 DOSAGE QUERIES — BEFORE vs AFTER ═══

const DOSAGE_QUERIES = [
  { q: 'amoxicillin 250mg for 12kg child', drug: 'amoxicillin', altNames: [] },
  { q: 'Coartem dose for 15kg child', drug: 'coartem', altNames: ['artemether', 'lumefantrine'] },
  { q: 'dolutegravir dose with rifampicin', drug: 'dolutegravir', altNames: ['dtg'] },
  { q: 'cotrimoxazole dose for HIV positive child 8kg', drug: 'cotrimoxazole', altNames: ['ctx', 'bactrim'] },
  { q: 'isoniazid 10mg/kg for TPT in children', drug: 'isoniazid', altNames: ['inh'] },
];

console.log('══════════════════════════════════════════════════════════════════════');
console.log('  DOSAGE QUERIES — OLD (5% gate, no anchor boost) vs FIXED (10% gate + anchor boost)');
console.log('══════════════════════════════════════════════════════════════════════\n');

let oldPass = 0, newPass = 0;

for (const { q, drug, altNames } of DOSAGE_QUERIES) {
  const vector = await vectorSearch(q);

  // OLD behavior
  const bm25Old = bm25SearchOld(q);
  const confOld = isVectorConfidentOld(vector, bm25Old.length > 0);
  const fusedOld = rrfFuse(bm25Old, confOld ? vector : []);
  const oldResult = fusedOld[0]?.chunkId;
  const oldTitle = title(oldResult);
  const oldAnswer = answerText(oldResult).toLowerCase();
  const allDrugs = [drug, ...altNames];
  const oldCorrect = allDrugs.some(d => oldAnswer.includes(d) || oldTitle.toLowerCase().includes(d));

  // FIXED behavior
  const bm25New = bm25SearchFixed(q);
  const confNew = isVectorConfidentFixed(vector, bm25New.length > 0);
  const fusedNew = rrfFuse(bm25New, confNew ? vector : []);
  const newResult = fusedNew[0]?.chunkId;
  const newTitle = title(newResult);
  const newAnswer = answerText(newResult).toLowerCase();
  const newCorrect = allDrugs.some(d => newAnswer.includes(d) || newTitle.toLowerCase().includes(d));

  if (oldCorrect) oldPass++;
  if (newCorrect) newPass++;

  const changed = oldResult !== newResult;
  const icon = newCorrect ? '✓' : '✗';
  const changeIcon = changed ? (newCorrect && !oldCorrect ? ' ← FIXED' : newCorrect === oldCorrect ? ' (changed, still correct)' : ' ← REGRESSION') : '';

  console.log(`  ${icon} "${q}"`);
  console.log(`    OLD: "${oldTitle}" [${confOld ? 'vec+bm25' : 'bm25-only'}] drug_match=${oldCorrect}`);
  console.log(`    NEW: "${newTitle}" [${confNew ? 'vec+bm25' : 'bm25-only'}] drug_match=${newCorrect}${changeIcon}`);
  console.log('');
}

console.log('──────────────────────────────────────────────────────────────────────');
console.log(`  OLD: ${oldPass}/5    FIXED: ${newPass}/5`);
console.log('══════════════════════════════════════════════════════════════════════\n');

// ═══ REGRESSION CHECK: Run full 15-query harness with fixed logic ═══

console.log('══════════════════════════════════════════════════════════════════════');
console.log('  REGRESSION CHECK — Full 15-query harness with FIXED logic');
console.log('──────────────────────────────────────────────────────────────────────');

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

const CASES = [
  { q: 'ART for pregnant woman with HIV', expect: /pmtct|pregnan|mother.*child|maternal|option.*b/i },
  { q: 'Signs of ART treatment failure', expect: /fail|viral.*load|1000|suppress|resistan/i },
  { q: 'When to start ART in adults', expect: /start|initiat|same.*day|rapid|regardless|cd4/i },
  { q: 'What is PMTCT?', expect: /pmtct|mother.*to.*child|prevent.*transmis|pregnan/i },
  { q: 'ARV dose for 10kg child', expect: /arv|art|hiv|antiretroviral|lopinavir|abacavir|dolutegravir/i },
  { q: 'How to screen for TB in PLHIV', expect: /screen|symptom|cough|fever|weight.*loss|night.*sweat/i },
  { q: 'TPT options for PLHIV', expect: /3hp|3hr|6h|1hp|ipt|isoniazid|rifapentine|preventive/i },
  { q: 'Isoniazid dose for children', expect: /isoniazid|inh|10.*mg.*kg|tpt|preventive/i },
  { q: 'Coartem dose for 20kg child', expect: /coartem|act|artemether|lumefantrine|malaria|tablet/i },
  { q: 'How much amoxicillin for a 14kg child?', expect: /amoxicillin|pharyngitis|otitis|antibiotic|throat/i },
  { q: 'Can I give rifampicin with dolutegravir?', expect: /rifampicin|dolutegravir|dose.*adjust|double|50.*mg.*twice/i },
  { q: 'Newborn danger signs', expect: /convuls|not.*feed|fever|breath|lethargi|jaundice|cord|refer/i },
  { q: 'HIV treatment during pregnancy', expect: /pmtct|pregnan|maternal|mother/i },
  { q: 'Managing TB in HIV-positive patients', expect: /tb.*hiv|co.*infect|rifampicin|art.*tb|burden|plhiv/i },
  { q: 'wetin be the sign say pikin dey sick well well', expect: /danger|sign|sick|convuls|refer|fever/i },
];

let pass = 0;
for (const { q, expect: regex } of CASES) {
  const expanded = expandQuery(q);
  const bm25 = bm25SearchFixed(expanded);
  const vec = await vectorSearch(expanded);
  const confident = isVectorConfidentFixed(vec, bm25.length > 0);
  const fused = rrfFuse(bm25, confident ? vec : []);
  const topId = fused[0]?.chunkId ?? null;
  const content = topId ? (chunkMap.get(topId) ?? '') : '';
  const hit = topId !== null && regex.test(content);
  if (hit) pass++;
  else {
    console.log(`  ✗ "${q}" → ${title(topId)} [${confident ? 'vec+bm25' : 'bm25-only'}]`);
  }
}
console.log(`\n  RESULT: ${pass}/15`);
if (pass === 15) console.log('  ✓ No regressions — all 15 still pass with fixed logic');
console.log('══════════════════════════════════════════════════════════════════════');
