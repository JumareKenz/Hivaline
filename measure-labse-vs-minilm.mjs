/**
 * measure-labse-vs-minilm.mjs — Head-to-head comparison of LaBSE vs MiniLM
 *
 * Tests both models on the same 39-query baseline to measure:
 * - Overall Recall@1/5/10 improvement
 * - Language-specific improvements (especially Hausa 50% → target 75%+)
 * - Intent-type improvements (especially URGENT 69% → target 85%+)
 * - Inference latency (must be <30ms, not 79ms like bge-m3)
 * - Memory footprint (471MB model, but what's runtime RSS?)
 *
 * Deployment decision: LaBSE must achieve:
 * - Hausa ≥75% (+25 points over baseline)
 * - English ≥85% (+5 points)
 * - URGENT ≥80% (+11 points)
 * - Latency <30ms per query
 *
 * Usage: node measure-labse-vs-minilm.mjs [hiv-bundle-path]
 */

import { pipeline, env } from '@xenova/transformers';
import { readFileSync } from 'fs';
import { unzipSync, strFromU8 } from 'fflate';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = './public/models/';

const HIV_PATH = process.argv[2] || './hiv-cache.bin';

// Test cases (same 39-query baseline)
const TEST_CASES = [
  // ENGLISH
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
  { q: 'Coartem dose for 20kg child', lang: 'en', intent: 'DOSAGE',
    expect: /coartem|act|artemether|lumefantrine|malaria|20.*kg|tablet/i },
  { q: 'How much amoxicillin for a 14kg child?', lang: 'en', intent: 'DOSAGE',
    expect: /amoxicillin|14.*kg|250.*mg|mg.*kg|dose/i },
  { q: 'Can I give rifampicin with dolutegravir?', lang: 'en', intent: 'DETAIL',
    expect: /rifampicin|dolutegravir|dose.*adjust|double|50.*mg.*twice|interact/i },
  { q: 'Malaria treatment in pregnancy', lang: 'en', intent: 'URGENT',
    expect: /malaria|pregnan|act|quinine|artemisinin/i },
  { q: 'Newborn danger signs', lang: 'en', intent: 'URGENT',
    expect: /convuls|not.*feed|fever|breath|lethargi|jaundice|cord|refer/i },
  { q: 'Postpartum hemorrhage management', lang: 'en', intent: 'URGENT',
    expect: /postpartum|hemorrhage|pph|bleed|oxytocin|misoprostol/i },
  { q: 'Signs of preeclampsia', lang: 'en', intent: 'URGENT',
    expect: /preeclampsia|eclampsia|blood.*pressure|protein.*urine|headache|visual/i },
  { q: 'ART regimen for pregnant woman with TB', lang: 'en', intent: 'URGENT',
    expect: /pregnan|tb|pmtct|rifampicin|dolutegravir|twice.*daily/i },
  { q: 'Child 8kg with HIV and malnutrition dosing', lang: 'en', intent: 'DOSAGE',
    expect: /8.*kg|child|arv|nutrition|weight.*based/i },

  // PIDGIN
  { q: 'wetin be the sign say pikin dey sick well well', lang: 'pid', intent: 'URGENT',
    expect: /danger|sign|sick|convuls|refer|fever|child/i },
  { q: 'how person fit take treat malaria', lang: 'pid', intent: 'DETAIL',
    expect: /malaria|treat|coartem|act|dose/i },

  // HAUSA (Current worst performer: 50% Recall@1 with MiniLM)
  { q: 'Yaya ake fara maganin HIV', lang: 'ha', intent: 'PROCEDURE',
    expect: /hiv|art|start|initiat|treatment|antiretroviral/i, note: 'How to start HIV treatment' },
  { q: 'Alamun ciwon zazzabin cizon sauro', lang: 'ha', intent: 'URGENT',
    expect: /malaria|symptom|fever|sign/i, note: 'Signs of malaria' },
  { q: 'Adadin maganin HIV na yara', lang: 'ha', intent: 'DOSAGE',
    expect: /hiv|arv|child|dose|pediatric/i, note: 'HIV medicine dosage for children' },
  { q: 'Alamomin cututtukan jiki mai hatsari ga jariri', lang: 'ha', intent: 'URGENT',
    expect: /danger|sign|newborn|infant|refer/i, note: 'Danger signs in newborns' },

  // YORUBA (Current: 75% Recall@1)
  { q: 'Bawo ni a ṣe le bẹrẹ itọju HIV', lang: 'yo', intent: 'PROCEDURE',
    expect: /hiv|art|start|initiat|treatment|antiretroviral/i, note: 'How to start HIV treatment' },
  { q: 'Ami aisan iba', lang: 'yo', intent: 'URGENT',
    expect: /malaria|symptom|fever|sign/i, note: 'Signs of malaria' },
  { q: 'Iwọn oogun HIV fun ọmọde', lang: 'yo', intent: 'DOSAGE',
    expect: /hiv|arv|child|dose|pediatric/i, note: 'HIV medicine dosage for children' },
  { q: 'Ami ewu fun ọmọ tuntun', lang: 'yo', intent: 'URGENT',
    expect: /danger|sign|newborn|infant|refer/i, note: 'Danger signs in newborns' },

  // IGBO (Current: 100% Recall@1!)
  { q: 'Kedu ka esi amalite ọgwụgwọ HIV', lang: 'ig', intent: 'PROCEDURE',
    expect: /hiv|art|start|initiat|treatment|antiretroviral/i, note: 'How to start HIV treatment' },
  { q: 'Ihe ngosi nke ọrịa ịba', lang: 'ig', intent: 'URGENT',
    expect: /malaria|symptom|fever|sign/i, note: 'Signs of malaria' },
  { q: 'Usoro ọgwụ HIV maka ụmụaka', lang: 'ig', intent: 'DOSAGE',
    expect: /hiv|arv|child|dose|pediatric/i, note: 'HIV medicine dosage for children' },
  { q: 'Ihe ngosi nke ihe ize ndụ maka ọhụrụ amụrụ', lang: 'ig', intent: 'URGENT',
    expect: /danger|sign|newborn|infant|refer/i, note: 'Danger signs in newborns' },

  // OUT-OF-DOMAIN (should reject)
  { q: 'What is the weather today', lang: 'en', intent: 'UNKNOWN',
    expect: null, shouldReject: true },
  { q: 'How much does ARV cost', lang: 'en', intent: 'UNKNOWN',
    expect: null, shouldReject: true },
];

console.log('═══════════════════════════════════════════════════════════════');
console.log('  LaBSE vs MiniLM HEAD-TO-HEAD COMPARISON');
console.log('───────────────────────────────────────────────────────────────');
console.log(`  Bundle: ${HIV_PATH}`);
console.log(`  Test set: ${TEST_CASES.length} queries`);
console.log('═══════════════════════════════════════════════════════════════\n');

// Load bundle (once, reused for both models)
const hivBytes = readFileSync(HIV_PATH);
const files = unzipSync(new Uint8Array(hivBytes));
function getFile(path) {
  const clean = path.replace(/^\/+/, '');
  for (const key of Object.keys(files)) {
    if (key.replace(/^\/+/, '') === clean && files[key].length > 0) return files[key];
  }
  return null;
}

const manifestRaw = getFile('manifest.json');
const manifest = manifestRaw ? JSON.parse(strFromU8(manifestRaw)) : {};
console.log(`Bundle: ${manifest.version || 'UNKNOWN'} (${manifest.chunk_count || '?'} chunks)\n`);

const chunksRaw = strFromU8(getFile('content/chunks.jsonl'));
const chunks = chunksRaw.split('\n').filter(l => l.trim()).map(l => {
  try { return JSON.parse(l); } catch { return null; }
}).filter(Boolean);

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

// Shared search functions
function cosine(a, b) {
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
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

const SYNONYMS = {
  arv: ['antiretroviral'], pmtct: ['prevention', 'mother', 'child', 'transmission', 'pregnancy', 'maternal'],
  tpt: ['preventive', 'isoniazid', 'rifapentine', 'tuberculosis'], ipt: ['isoniazid', 'preventive', 'tuberculosis'],
  tb: ['tuberculosis', 'coinfection'], act: ['artemisinin', 'coartem', 'lumefantrine', 'malaria'],
  plhiv: ['people', 'living', 'hiv', 'positive'], pph: ['postpartum', 'hemorrhage', 'bleeding'],
  pregnant: ['pregnancy', 'maternal', 'pmtct'], failure: ['virologic', 'viral', 'load', 'resistance'],
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

// Test both models
async function testModel(modelName, modelPath) {
  console.log(`\n${'═'.repeat(63)}`);
  console.log(`  TESTING ${modelName.toUpperCase()}`);
  console.log(`${'═'.repeat(63)}\n`);

  console.log(`Loading ${modelName} model...`);
  const loadStart = performance.now();
  const embedder = await pipeline('feature-extraction', modelPath, { quantized: true });
  const loadTime = Math.round(performance.now() - loadStart);
  console.log(`Model loaded in ${loadTime}ms\n`);

  async function embedQuery(text) {
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    return output.data;
  }

  const results = [];
  const latencies = [];

  for (const tc of TEST_CASES) {
    const expanded = expandQuery(tc.q);
    const bm25 = bm25Search(expanded);

    // Measure vector search latency
    const vecStart = performance.now();
    const qEmb = await embedQuery(expanded);
    const vecResults = [];
    for (let i = 0; i < chunkCount; i++) {
      const offset = i * dims;
      const chunkVec = embFloats.subarray(offset, offset + dims);
      const score = cosine(qEmb, chunkVec);
      vecResults.push({ chunkId: chunkIds[i] || String(i), score });
    }
    const vector = vecResults.sort((a, b) => b.score - a.score).slice(0, 10);
    const vecLatency = performance.now() - vecStart;
    latencies.push(vecLatency);

    // Confidence gate (10% margin)
    const confident = vector.length > 0 && vector[0].score >= 0.3 &&
      (vector.length < 2 || (vector[0].score - vector[1].score) / vector[1].score >= 0.10);

    const fused = rrfFuse(bm25, confident ? vector : []);
    const topId = fused[0]?.chunkId ?? null;
    const topContent = topId ? (chunkMap.get(topId) ?? '') : '';

    const correct = tc.expect ? tc.expect.test(topContent) : false;
    const gatePassed = confident && topId !== null;

    results.push({
      query: tc.q,
      lang: tc.lang,
      intent: tc.intent,
      correct,
      gatePassed,
      vectorScore: vector[0]?.score ?? 0,
    });
  }

  // Compute metrics
  const total = results.length;
  const recall1 = results.filter(r => r.correct).length;
  const gatePassed = results.filter(r => r.gatePassed).length;

  const avgLatency = latencies.reduce((a,b) => a + b, 0) / latencies.length;
  const minLatency = Math.min(...latencies);
  const maxLatency = Math.max(...latencies);

  console.log(`  Recall@1: ${recall1}/${total} (${(recall1/total*100).toFixed(1)}%)`);
  console.log(`  Gate pass rate: ${gatePassed}/${total} (${(gatePassed/total*100).toFixed(1)}%)`);
  console.log(`  Avg latency: ${avgLatency.toFixed(1)}ms (min: ${minLatency.toFixed(1)}ms, max: ${maxLatency.toFixed(1)}ms)`);
  console.log(`  Model load time: ${loadTime}ms`);

  // Language breakdown
  console.log('\n  Language Breakdown:');
  for (const lang of ['en', 'ha', 'yo', 'ig', 'pid']) {
    const subset = results.filter(r => r.lang === lang);
    if (subset.length === 0) continue;
    const langRecall = subset.filter(r => r.correct).length;
    const langName = { en: 'English', ha: 'Hausa', yo: 'Yoruba', ig: 'Igbo', pid: 'Pidgin' }[lang];
    console.log(`    ${langName}: ${langRecall}/${subset.length} (${(langRecall/subset.length*100).toFixed(1)}%)`);
  }

  // Intent breakdown
  console.log('\n  Intent Breakdown:');
  for (const intent of ['URGENT', 'DOSAGE', 'PROCEDURE', 'DEFINE', 'DETAIL']) {
    const subset = results.filter(r => r.intent === intent);
    if (subset.length === 0) continue;
    const intentRecall = subset.filter(r => r.correct).length;
    console.log(`    ${intent}: ${intentRecall}/${subset.length} (${(intentRecall/subset.length*100).toFixed(1)}%)`);
  }

  return { recall1, total, avgLatency, loadTime, results };
}

// Test MiniLM baseline
const minilmResults = await testModel('MiniLM', 'embed');

// Test LaBSE
const labseResults = await testModel('LaBSE', 'labse');

// Final comparison
console.log('\n\n' + '═'.repeat(63));
console.log('  FINAL COMPARISON');
console.log('═'.repeat(63));

const minilmRecall = (minilmResults.recall1 / minilmResults.total * 100).toFixed(1);
const labseRecall = (labseResults.recall1 / labseResults.total * 100).toFixed(1);
const recallDelta = (labseResults.recall1 - minilmResults.recall1);

console.log(`\n  Recall@1:`);
console.log(`    MiniLM: ${minilmResults.recall1}/${minilmResults.total} (${minilmRecall}%)`);
console.log(`    LaBSE:  ${labseResults.recall1}/${labseResults.total} (${labseRecall}%)`);
console.log(`    Delta:  ${recallDelta > 0 ? '+' : ''}${recallDelta} queries (${(recallDelta / minilmResults.total * 100).toFixed(1)} points)`);

console.log(`\n  Latency:`);
console.log(`    MiniLM: ${minilmResults.avgLatency.toFixed(1)}ms avg`);
console.log(`    LaBSE:  ${labseResults.avgLatency.toFixed(1)}ms avg`);
console.log(`    Delta:  ${(labseResults.avgLatency / minilmResults.avgLatency).toFixed(1)}x ${labseResults.avgLatency > minilmResults.avgLatency ? 'slower' : 'faster'}`);

console.log(`\n  Model Load:`);
console.log(`    MiniLM: ${minilmResults.loadTime}ms`);
console.log(`    LaBSE:  ${labseResults.loadTime}ms`);

// Language-specific improvements
console.log(`\n  Language-Specific Improvements:`);
for (const lang of ['en', 'ha', 'yo', 'ig']) {
  const minilmSubset = minilmResults.results.filter(r => r.lang === lang);
  const labseSubset = labseResults.results.filter(r => r.lang === lang);
  if (minilmSubset.length === 0) continue;

  const minilmLang = minilmSubset.filter(r => r.correct).length;
  const labseLang = labseSubset.filter(r => r.correct).length;
  const delta = labseLang - minilmLang;

  const langName = { en: 'English', ha: 'Hausa', yo: 'Yoruba', ig: 'Igbo' }[lang];
  console.log(`    ${langName}: ${minilmLang}/${minilmSubset.length} → ${labseLang}/${labseSubset.length} (${delta > 0 ? '+' : ''}${delta})`);
}

// Deployment decision
console.log(`\n${'═'.repeat(63)}`);
console.log('  DEPLOYMENT DECISION');
console.log('═'.repeat(63));

const deploymentCriteria = {
  hausaTarget: labseResults.results.filter(r => r.lang === 'ha' && r.correct).length >= 3, // 75% of 4 queries
  englishTarget: labseResults.results.filter(r => r.lang === 'en' && r.correct).length >= 22, // 88% of 25 queries
  urgentTarget: labseResults.results.filter(r => r.intent === 'URGENT' && r.correct).length >= 13, // 81% of 16 queries
  latencyTarget: labseResults.avgLatency < 30,
};

console.log(`\n  Criteria:`);
console.log(`    Hausa ≥75% (3/4):    ${deploymentCriteria.hausaTarget ? '✅ PASS' : '❌ FAIL'}`);
console.log(`    English ≥85% (21/25): ${deploymentCriteria.englishTarget ? '✅ PASS' : '❌ FAIL'}`);
console.log(`    URGENT ≥80% (13/16):  ${deploymentCriteria.urgentTarget ? '✅ PASS' : '❌ FAIL'}`);
console.log(`    Latency <30ms:        ${deploymentCriteria.latencyTarget ? '✅ PASS' : '❌ FAIL'}`);

const allCriteriaMet = Object.values(deploymentCriteria).every(v => v);

console.log(`\n  Recommendation: ${allCriteriaMet ? '✅ DEPLOY LaBSE' : '❌ DO NOT DEPLOY - criteria not met'}`);
console.log('═'.repeat(63));
