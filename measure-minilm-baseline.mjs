/**
 * measure-minilm-baseline.mjs — Comprehensive MiniLM retrieval quality baseline
 *
 * PURPOSE: Establish empirical measurement of current production retrieval quality
 * BEFORE any embedding model replacement work. Every number here becomes the
 * baseline any future candidate must beat.
 *
 * Measures:
 * - Recall@1, @5, @10 across full query set
 * - Language-specific performance (English / Hausa / Yoruba / Igbo)
 * - Intent-type breakdown (URGENT / DEFINE / DETAIL / PROCEDURE / DOSAGE)
 * - Confidence gate calibration (false positive / false negative rates)
 * - Ranking quality (MRR)
 *
 * Usage: node measure-minilm-baseline.mjs [path-to-hiv-cache.bin]
 */

import { pipeline, env } from '@xenova/transformers';
import { readFileSync } from 'fs';
import { unzipSync, strFromU8 } from 'fflate';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = './public/models/';

const HIV_PATH = process.argv[2] || './hiv-cache.bin';

// Confidence gate thresholds (production settings)
const CONFIDENCE = {
  VECTOR_FLOOR: 0.3,
  VECTOR_MARGIN: 0.10,  // 10% separation required
  BM25_FLOOR: 1.5,
  DENSE_ONLY_FLOOR: 0.4,
};

// ═══════════════════════════════════════════════════════════════════════════
// QUERY TEST SET
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Each test case defines:
 * - q: raw query text
 * - lang: language code (en / ha / yo / ig / pid)
 * - intent: clinical intent type
 * - expect: regex that MUST match the correct chunk's content
 * - expectChunkId: (optional) specific chunk ID if known
 * - shouldReject: (optional) true if confidence gate should reject this query
 */
const TEST_CASES = [
  // ─────────────────────────────────────────────────────────────────────────
  // ENGLISH — HIV/ART (URGENT + DEFINE + DETAIL intents)
  // ─────────────────────────────────────────────────────────────────────────
  { q: 'ART for pregnant woman with HIV', lang: 'en', intent: 'URGENT',
    expect: /pmtct|pregnan|mother.*child|maternal|option.*b/i },

  { q: 'Signs of ART treatment failure', lang: 'en', intent: 'URGENT',
    expect: /fail|viral.*load|1000|suppress|resistan/i },

  { q: 'When to start ART in adults', lang: 'en', intent: 'PROCEDURE',
    expect: /start|initiat|same.*day|rapid|regardless|cd4/i },

  { q: 'What is PMTCT?', lang: 'en', intent: 'DEFINE',
    expect: /pmtct|mother.*to.*child|prevent.*transmis|pregnan/i },

  { q: 'ARV dose for 10kg child', lang: 'en', intent: 'DOSAGE',
    expect: /arv|art|hiv|antiretroviral|lopinavir|abacavir|dolutegravir|10.*kg|weight.*based/i },

  { q: 'HIV treatment during pregnancy', lang: 'en', intent: 'URGENT',
    expect: /pmtct|pregnan|maternal|mother/i },

  { q: 'What does viral suppression mean', lang: 'en', intent: 'DEFINE',
    expect: /viral.*load|suppress|undetectable|1000|50.*copies/i },

  { q: 'Can I switch ART regimen', lang: 'en', intent: 'PROCEDURE',
    expect: /switch|regimen|change.*art|fail|side.*effect|intoleran/i },

  { q: 'Dolutegravir side effects', lang: 'en', intent: 'DETAIL',
    expect: /dolutegravir|dtg|side.*effect|adverse|weight.*gain|insomnia/i },

  // ─────────────────────────────────────────────────────────────────────────
  // ENGLISH — TB (URGENT + PROCEDURE)
  // ─────────────────────────────────────────────────────────────────────────
  { q: 'How to screen for TB in PLHIV', lang: 'en', intent: 'PROCEDURE',
    expect: /screen|symptom|cough|fever|weight.*loss|night.*sweat/i },

  { q: 'TPT options for PLHIV', lang: 'en', intent: 'DETAIL',
    expect: /3hp|3hr|6h|1hp|ipt|isoniazid|rifapentine|preventive/i },

  { q: 'Isoniazid dose for children', lang: 'en', intent: 'DOSAGE',
    expect: /isoniazid|inh|10.*mg.*kg|tpt|preventive/i },

  { q: 'Managing TB in HIV-positive patients', lang: 'en', intent: 'URGENT',
    expect: /tb.*hiv|co.*infect|rifampicin|art.*tb/i },

  { q: 'When to start TPT', lang: 'en', intent: 'PROCEDURE',
    expect: /tpt|preventive.*therap|screen.*negative|rule.*out|start/i },

  // ─────────────────────────────────────────────────────────────────────────
  // ENGLISH — Malaria + Drugs (DOSAGE + DETAIL)
  // ─────────────────────────────────────────────────────────────────────────
  { q: 'Coartem dose for 20kg child', lang: 'en', intent: 'DOSAGE',
    expect: /coartem|act|artemether|lumefantrine|malaria|20.*kg|tablet/i },

  { q: 'How much amoxicillin for a 14kg child?', lang: 'en', intent: 'DOSAGE',
    expect: /amoxicillin|14.*kg|250.*mg|mg.*kg|dose/i },

  { q: 'Can I give rifampicin with dolutegravir?', lang: 'en', intent: 'DETAIL',
    expect: /rifampicin|dolutegravir|dose.*adjust|double|50.*mg.*twice|interact/i },

  { q: 'Malaria treatment in pregnancy', lang: 'en', intent: 'URGENT',
    expect: /malaria|pregnan|act|quinine|artemisinin/i },

  // ─────────────────────────────────────────────────────────────────────────
  // ENGLISH — Maternal/Newborn (URGENT)
  // ─────────────────────────────────────────────────────────────────────────
  { q: 'Newborn danger signs', lang: 'en', intent: 'URGENT',
    expect: /convuls|not.*feed|fever|breath|lethargi|jaundice|cord|refer/i },

  { q: 'Postpartum hemorrhage management', lang: 'en', intent: 'URGENT',
    expect: /postpartum|hemorrhage|pph|bleed|oxytocin|misoprostol/i },

  { q: 'Signs of preeclampsia', lang: 'en', intent: 'URGENT',
    expect: /preeclampsia|eclampsia|blood.*pressure|protein.*urine|headache|visual/i },

  // ─────────────────────────────────────────────────────────────────────────
  // ENGLISH — Multi-concept / Complex Queries
  // ─────────────────────────────────────────────────────────────────────────
  { q: 'ART regimen for pregnant woman with TB', lang: 'en', intent: 'URGENT',
    expect: /pregnan|tb|pmtct|rifampicin|dolutegravir|twice.*daily/i },

  { q: 'Child 8kg with HIV and malnutrition dosing', lang: 'en', intent: 'DOSAGE',
    expect: /8.*kg|child|arv|nutrition|weight.*based/i },

  // ─────────────────────────────────────────────────────────────────────────
  // PIDGIN / COLLOQUIAL (West African English variant)
  // ─────────────────────────────────────────────────────────────────────────
  { q: 'wetin be the sign say pikin dey sick well well', lang: 'pid', intent: 'URGENT',
    expect: /danger|sign|sick|convuls|refer|fever|child/i },

  { q: 'how person fit take treat malaria', lang: 'pid', intent: 'DETAIL',
    expect: /malaria|treat|coartem|act|dose/i },

  // ─────────────────────────────────────────────────────────────────────────
  // HAUSA
  // ─────────────────────────────────────────────────────────────────────────
  { q: 'Yaya ake fara maganin HIV', lang: 'ha', intent: 'PROCEDURE',
    expect: /hiv|art|start|initiat|treatment|antiretroviral/i,
    note: 'How to start HIV treatment' },

  { q: 'Alamun ciwon zazzabin cizon sauro', lang: 'ha', intent: 'URGENT',
    expect: /malaria|symptom|fever|sign/i,
    note: 'Signs of malaria' },

  { q: 'Adadin maganin HIV na yara', lang: 'ha', intent: 'DOSAGE',
    expect: /hiv|arv|child|dose|pediatric/i,
    note: 'HIV medicine dosage for children' },

  { q: 'Alamomin cututtukan jiki mai hatsari ga jariri', lang: 'ha', intent: 'URGENT',
    expect: /danger|sign|newborn|infant|refer/i,
    note: 'Danger signs in newborns' },

  // ─────────────────────────────────────────────────────────────────────────
  // YORUBA
  // ─────────────────────────────────────────────────────────────────────────
  { q: 'Bawo ni a ṣe le bẹrẹ itọju HIV', lang: 'yo', intent: 'PROCEDURE',
    expect: /hiv|art|start|initiat|treatment|antiretroviral/i,
    note: 'How to start HIV treatment' },

  { q: 'Ami aisan iba', lang: 'yo', intent: 'URGENT',
    expect: /malaria|symptom|fever|sign/i,
    note: 'Signs of malaria' },

  { q: 'Iwọn oogun HIV fun ọmọde', lang: 'yo', intent: 'DOSAGE',
    expect: /hiv|arv|child|dose|pediatric/i,
    note: 'HIV medicine dosage for children' },

  { q: 'Ami ewu fun ọmọ tuntun', lang: 'yo', intent: 'URGENT',
    expect: /danger|sign|newborn|infant|refer/i,
    note: 'Danger signs in newborns' },

  // ─────────────────────────────────────────────────────────────────────────
  // IGBO
  // ─────────────────────────────────────────────────────────────────────────
  { q: 'Kedu ka esi amalite ọgwụgwọ HIV', lang: 'ig', intent: 'PROCEDURE',
    expect: /hiv|art|start|initiat|treatment|antiretroviral/i,
    note: 'How to start HIV treatment' },

  { q: 'Ihe ngosi nke ọrịa ịba', lang: 'ig', intent: 'URGENT',
    expect: /malaria|symptom|fever|sign/i,
    note: 'Signs of malaria' },

  { q: 'Usoro ọgwụ HIV maka ụmụaka', lang: 'ig', intent: 'DOSAGE',
    expect: /hiv|arv|child|dose|pediatric/i,
    note: 'HIV medicine dosage for children' },

  { q: 'Ihe ngosi nke ihe ize ndụ maka ọhụrụ amụrụ', lang: 'ig', intent: 'URGENT',
    expect: /danger|sign|newborn|infant|refer/i,
    note: 'Danger signs in newborns' },

  // ─────────────────────────────────────────────────────────────────────────
  // EDGE CASES / EXPECTED REJECTIONS
  // ─────────────────────────────────────────────────────────────────────────
  { q: 'What is the weather today', lang: 'en', intent: 'UNKNOWN',
    expect: null, shouldReject: true,
    note: 'Out-of-domain query (should be rejected by confidence gate)' },

  { q: 'How much does ARV cost', lang: 'en', intent: 'UNKNOWN',
    expect: null, shouldReject: true,
    note: 'Policy question (should be rejected — no price info in corpus)' },
];

// ═══════════════════════════════════════════════════════════════════════════
// LOAD .HIV BUNDLE
// ═══════════════════════════════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════════');
console.log('  MiniLM BASELINE RETRIEVAL MEASUREMENT');
console.log('─────────────────────────────────────────────────────');
console.log(`  Bundle: ${HIV_PATH}`);

const hivBytes = readFileSync(HIV_PATH);
const files = unzipSync(new Uint8Array(hivBytes));

function getFile(path) {
  const clean = path.replace(/^\/+/, '');
  for (const key of Object.keys(files)) {
    if (key.replace(/^\/+/, '') === clean && files[key].length > 0) return files[key];
  }
  return null;
}

// Parse manifest
const manifestRaw = getFile('manifest.json');
const manifest = manifestRaw ? JSON.parse(strFromU8(manifestRaw)) : {};
console.log(`  Version: ${manifest.version || 'UNKNOWN'}`);
console.log(`  Chunks: ${manifest.chunk_count || 'UNKNOWN'}`);
console.log(`  Created: ${manifest.created_at || 'UNKNOWN'}`);
console.log(`  Capabilities: ${JSON.stringify(manifest.retrievalCapabilities || {})}`);
console.log('═══════════════════════════════════════════════════════\n');

// Parse chunks
const chunksRaw = strFromU8(getFile('content/chunks.jsonl'));
const chunks = chunksRaw.split('\n').filter(l => l.trim()).map(l => {
  try { return JSON.parse(l); } catch { return null; }
}).filter(Boolean);
console.log(`Loaded ${chunks.length} chunks\n`);

// Parse embeddings
const embRaw = getFile('index/embeddings.bin');
const embView = new DataView(embRaw.buffer, embRaw.byteOffset, embRaw.byteLength);
const chunkCount = embView.getUint32(0, true);
const dims = embView.getUint32(4, true);
const embOffset = 8;
const embFloats = new Float32Array(embRaw.buffer, embRaw.byteOffset + embOffset, chunkCount * dims);
console.log(`Embeddings: ${chunkCount} chunks × ${dims} dims`);

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
console.log(`BM25 index: ${lexRaw ? 'present' : 'ABSENT'}`);

// Build chunk content map
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

// ═══════════════════════════════════════════════════════════════════════════
// LOAD MINILM MODEL
// ═══════════════════════════════════════════════════════════════════════════

console.log('\nLoading MiniLM embedding model...');
const t0 = performance.now();
const embedder = await pipeline('feature-extraction', 'embed', { quantized: true });
const loadMs = Math.round(performance.now() - t0);
console.log(`Model loaded in ${loadMs}ms\n`);

async function embedQuery(text) {
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return output.data;
}

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function cosine(a, b) {
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    nA += a[i] * a[i];
    nB += b[i] * b[i];
  }
  return dot / (Math.sqrt(nA) * Math.sqrt(nB) + 1e-10);
}

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
  // Rare-term anchor boost
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
  return Object.entries(scores)
    .sort(([,a],[,b]) => b - a)
    .map(([id, score]) => ({ chunkId: id, score }));
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
  if (!hasBm25) return true;  // Dense-only mode
  if (results[0].score < CONFIDENCE.VECTOR_FLOOR) return false;
  if (results.length >= 2) {
    const margin = (results[0].score - results[1].score) / results[1].score;
    if (margin < CONFIDENCE.VECTOR_MARGIN) return false;
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
  return Array.from(scores.entries())
    .map(([id, score]) => ({ chunkId: id, score }))
    .sort((a, b) => b.score - a.score);
}

// Synonym expansion (from queryRewriter.ts)
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

// ═══════════════════════════════════════════════════════════════════════════
// RUN COMPREHENSIVE MEASUREMENT
// ═══════════════════════════════════════════════════════════════════════════

console.log('Running comprehensive baseline measurement...\n');

const results = [];

for (const testCase of TEST_CASES) {
  const { q, lang, intent, expect, shouldReject, note } = testCase;

  const expanded = expandQuery(q);
  const bm25 = bm25Search(expanded);
  const vector = await vectorSearch(expanded, 10);  // Get top 10 for Recall@K

  const hasBm25 = bm25.length > 0 && bm25[0].score >= CONFIDENCE.BM25_FLOOR;
  const vectorConfident = isVectorConfident(vector, hasBm25);
  const fused = rrfFuse(bm25, vectorConfident ? vector : []);

  const top10 = fused.slice(0, 10);
  const topId = top10[0]?.chunkId ?? null;
  const topContent = topId ? (chunkMap.get(topId) ?? '') : '';

  // Check recall at different K values
  const matchPositions = [];
  if (expect) {
    for (let i = 0; i < top10.length; i++) {
      const content = chunkMap.get(top10[i].chunkId) ?? '';
      if (expect.test(content)) {
        matchPositions.push(i + 1);  // 1-indexed position
      }
    }
  }

  const recall1 = matchPositions.includes(1);
  const recall5 = matchPositions.some(p => p <= 5);
  const recall10 = matchPositions.length > 0;
  const mrr = matchPositions.length > 0 ? (1 / matchPositions[0]) : 0;

  // Confidence gate analysis
  const gatePassed = vectorConfident && topId !== null;
  const gateCorrect = shouldReject ? !gatePassed : gatePassed;

  results.push({
    query: q,
    lang,
    intent,
    note,
    recall1,
    recall5,
    recall10,
    mrr,
    topChunkId: topId,
    topVectorScore: vector[0]?.score ?? 0,
    topBm25Score: bm25[0]?.score ?? 0,
    vectorConfident,
    gatePassed,
    gateCorrect,
    shouldReject: shouldReject || false,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// AGGREGATE AND REPORT RESULTS
// ═══════════════════════════════════════════════════════════════════════════

function computeMetrics(subset) {
  const total = subset.length;
  if (total === 0) return null;

  const recall1 = subset.filter(r => r.recall1).length;
  const recall5 = subset.filter(r => r.recall5).length;
  const recall10 = subset.filter(r => r.recall10).length;
  const avgMRR = subset.reduce((sum, r) => sum + r.mrr, 0) / total;

  const gatePassed = subset.filter(r => r.gatePassed).length;
  const gateCorrect = subset.filter(r => r.gateCorrect).length;

  // False positives: gate passed but should have rejected
  const shouldRejectCases = subset.filter(r => r.shouldReject);
  const falsePositives = shouldRejectCases.filter(r => r.gatePassed).length;
  const fpRate = shouldRejectCases.length > 0 ? (falsePositives / shouldRejectCases.length) : 0;

  // False negatives: gate rejected but should have passed (and correct answer exists)
  const shouldPassCases = subset.filter(r => !r.shouldReject && r.recall10);
  const falseNegatives = shouldPassCases.filter(r => !r.gatePassed).length;
  const fnRate = shouldPassCases.length > 0 ? (falseNegatives / shouldPassCases.length) : 0;

  return {
    total,
    recall1: { count: recall1, pct: (recall1 / total * 100).toFixed(1) },
    recall5: { count: recall5, pct: (recall5 / total * 100).toFixed(1) },
    recall10: { count: recall10, pct: (recall10 / total * 100).toFixed(1) },
    mrr: avgMRR.toFixed(3),
    gatePassed: { count: gatePassed, pct: (gatePassed / total * 100).toFixed(1) },
    gateCorrect: { count: gateCorrect, pct: (gateCorrect / total * 100).toFixed(1) },
    fpRate: (fpRate * 100).toFixed(1),
    fnRate: (fnRate * 100).toFixed(1),
  };
}

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  OVERALL RESULTS');
console.log('───────────────────────────────────────────────────────────────');
const overall = computeMetrics(results);
console.log(`  Total queries: ${overall.total}`);
console.log(`  Recall@1:  ${overall.recall1.count}/${overall.total} (${overall.recall1.pct}%)`);
console.log(`  Recall@5:  ${overall.recall5.count}/${overall.total} (${overall.recall5.pct}%)`);
console.log(`  Recall@10: ${overall.recall10.count}/${overall.total} (${overall.recall10.pct}%)`);
console.log(`  MRR (Mean Reciprocal Rank): ${overall.mrr}`);
console.log(`  Confidence gate accuracy: ${overall.gateCorrect.count}/${overall.total} (${overall.gateCorrect.pct}%)`);
console.log(`  False positive rate: ${overall.fpRate}% (passed but should reject)`);
console.log(`  False negative rate: ${overall.fnRate}% (rejected but had answer)`);
console.log('═══════════════════════════════════════════════════════════════\n');

// Language breakdown
console.log('═══════════════════════════════════════════════════════════════');
console.log('  BREAKDOWN BY LANGUAGE');
console.log('───────────────────────────────────────────────────────────────');
for (const lang of ['en', 'ha', 'yo', 'ig', 'pid']) {
  const subset = results.filter(r => r.lang === lang);
  if (subset.length === 0) continue;

  const metrics = computeMetrics(subset);
  const langName = { en: 'English', ha: 'Hausa', yo: 'Yoruba', ig: 'Igbo', pid: 'Pidgin' }[lang];
  console.log(`\n  ${langName} (${metrics.total} queries):`);
  console.log(`    Recall@1:  ${metrics.recall1.count}/${metrics.total} (${metrics.recall1.pct}%)`);
  console.log(`    Recall@5:  ${metrics.recall5.count}/${metrics.total} (${metrics.recall5.pct}%)`);
  console.log(`    Recall@10: ${metrics.recall10.count}/${metrics.total} (${metrics.recall10.pct}%)`);
  console.log(`    MRR: ${metrics.mrr}`);
}
console.log('═══════════════════════════════════════════════════════════════\n');

// Intent breakdown
console.log('═══════════════════════════════════════════════════════════════');
console.log('  BREAKDOWN BY INTENT TYPE');
console.log('───────────────────────────────────────────────────────────────');
for (const intent of ['URGENT', 'DEFINE', 'DETAIL', 'PROCEDURE', 'DOSAGE', 'UNKNOWN']) {
  const subset = results.filter(r => r.intent === intent);
  if (subset.length === 0) continue;

  const metrics = computeMetrics(subset);
  console.log(`\n  ${intent} (${metrics.total} queries):`);
  console.log(`    Recall@1:  ${metrics.recall1.count}/${metrics.total} (${metrics.recall1.pct}%)`);
  console.log(`    Recall@10: ${metrics.recall10.count}/${metrics.total} (${metrics.recall10.pct}%)`);
  console.log(`    MRR: ${metrics.mrr}`);
}
console.log('═══════════════════════════════════════════════════════════════\n');

// Detailed failures
console.log('═══════════════════════════════════════════════════════════════');
console.log('  FAILURES (Recall@1 = 0)');
console.log('───────────────────────────────────────────────────────────────');
const failures = results.filter(r => !r.recall1 && !r.shouldReject);
if (failures.length === 0) {
  console.log('  ✓ No failures!');
} else {
  for (const f of failures) {
    const chunk = chunks.find(c => c.id === f.topChunkId);
    const title = chunk?.display_title || f.topChunkId || 'NULL';
    console.log(`\n  ✗ [${f.lang}/${f.intent}] "${f.query}"`);
    console.log(`    → ${title}`);
    console.log(`    Vector: ${f.topVectorScore.toFixed(3)}, BM25: ${f.topBm25Score.toFixed(1)}, Confident: ${f.vectorConfident}`);
    if (f.note) console.log(`    Note: ${f.note}`);
  }
}
console.log('═══════════════════════════════════════════════════════════════\n');

// Confidence gate errors
console.log('═══════════════════════════════════════════════════════════════');
console.log('  CONFIDENCE GATE ERRORS');
console.log('───────────────────────────────────────────────────────────────');
const gateErrors = results.filter(r => !r.gateCorrect);
if (gateErrors.length === 0) {
  console.log('  ✓ No gate errors!');
} else {
  for (const e of gateErrors) {
    const errorType = e.shouldReject ? 'FALSE POSITIVE' : 'FALSE NEGATIVE';
    console.log(`\n  ⚠ ${errorType}: "${e.query}" [${e.lang}]`);
    console.log(`    Expected: ${e.shouldReject ? 'REJECT' : 'PASS'}, Got: ${e.gatePassed ? 'PASS' : 'REJECT'}`);
    console.log(`    Vector: ${e.topVectorScore.toFixed(3)}, Confident: ${e.vectorConfident}`);
  }
}
console.log('═══════════════════════════════════════════════════════════════\n');

// FINAL VERDICT
console.log('═══════════════════════════════════════════════════════════════');
console.log('  BASELINE ESTABLISHED');
console.log('───────────────────────────────────────────────────────────────');
console.log(`  Model: paraphrase-multilingual-MiniLM-L12-v2 (${dims}-dim, quantized)`);
console.log(`  Bundle: ${manifest.version || 'unknown'} (${chunks.length} chunks)`);
console.log(`  Model load time: ${loadMs}ms`);
console.log(`\n  ** Any future embedding model must beat these numbers **`);
console.log(`  ** to justify replacement cost/complexity **`);
console.log('═══════════════════════════════════════════════════════════════');
