/**
 * measure-confidence-gate-margin.mjs — Confidence gate margin threshold validation
 *
 * PURPOSE: Measure the false-positive/false-negative tradeoff when relaxing the
 * vector margin requirement from 10% to 5% (or intermediate values).
 *
 * CRITICAL FOR CLINICAL PRODUCT: Must track not just aggregate false-positive rate,
 * but WHICH specific queries get wrong answers through the gate, especially for
 * high-stakes URGENT/DOSAGE queries.
 *
 * Usage: node measure-confidence-gate-margin.mjs [margin-percent] [hiv-bundle-path]
 * Example: node measure-confidence-gate-margin.mjs 5 hiv-cache.bin
 */

import { initSearch, search } from './src/engine/hybridSearch.js';
import SessionState from './src/engine/sessionState.js';
import { readFileSync } from 'fs';
import { unzipSync, strFromU8 } from 'fflate';

// Parse arguments
const MARGIN_PERCENT = parseFloat(process.argv[2] || '5');
const MARGIN_DECIMAL = MARGIN_PERCENT / 100;
const HIV_PATH = process.argv[3] || './hiv-cache.bin';

console.log('═══════════════════════════════════════════════════════');
console.log('  CONFIDENCE GATE MARGIN VALIDATION');
console.log('─────────────────────────────────────────────────────');
console.log(`  Testing margin: ${MARGIN_PERCENT}% (${MARGIN_DECIMAL})`);
console.log(`  Bundle: ${HIV_PATH}`);
console.log('═══════════════════════════════════════════════════════\n');

// ═══════════════════════════════════════════════════════════════════════════
// TEST CASES (same 39-query set from baseline)
// ═══════════════════════════════════════════════════════════════════════════

const TEST_CASES = [
  // ENGLISH — HIV/ART
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

  // ENGLISH — TB
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

  // ENGLISH — Malaria + Drugs
  { q: 'Coartem dose for 20kg child', lang: 'en', intent: 'DOSAGE',
    expect: /coartem|act|artemether|lumefantrine|malaria|20.*kg|tablet/i },
  { q: 'How much amoxicillin for a 14kg child?', lang: 'en', intent: 'DOSAGE',
    expect: /amoxicillin|14.*kg|250.*mg|mg.*kg|dose/i },
  { q: 'Can I give rifampicin with dolutegravir?', lang: 'en', intent: 'DETAIL',
    expect: /rifampicin|dolutegravir|dose.*adjust|double|50.*mg.*twice|interact/i },
  { q: 'Malaria treatment in pregnancy', lang: 'en', intent: 'URGENT',
    expect: /malaria|pregnan|act|quinine|artemisinin/i },

  // ENGLISH — Maternal/Newborn
  { q: 'Newborn danger signs', lang: 'en', intent: 'URGENT',
    expect: /convuls|not.*feed|fever|breath|lethargi|jaundice|cord|refer/i },
  { q: 'Postpartum hemorrhage management', lang: 'en', intent: 'URGENT',
    expect: /postpartum|hemorrhage|pph|bleed|oxytocin|misoprostol/i },
  { q: 'Signs of preeclampsia', lang: 'en', intent: 'URGENT',
    expect: /preeclampsia|eclampsia|blood.*pressure|protein.*urine|headache|visual/i },

  // ENGLISH — Multi-concept
  { q: 'ART regimen for pregnant woman with TB', lang: 'en', intent: 'URGENT',
    expect: /pregnan|tb|pmtct|rifampicin|dolutegravir|twice.*daily/i },
  { q: 'Child 8kg with HIV and malnutrition dosing', lang: 'en', intent: 'DOSAGE',
    expect: /8.*kg|child|arv|nutrition|weight.*based/i },

  // PIDGIN
  { q: 'wetin be the sign say pikin dey sick well well', lang: 'pid', intent: 'URGENT',
    expect: /danger|sign|sick|convuls|refer|fever|child/i },
  { q: 'how person fit take treat malaria', lang: 'pid', intent: 'DETAIL',
    expect: /malaria|treat|coartem|act|dose/i },

  // HAUSA
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

  // YORUBA
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

  // IGBO
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

  // EDGE CASES
  { q: 'What is the weather today', lang: 'en', intent: 'UNKNOWN',
    expect: null, shouldReject: true,
    note: 'Out-of-domain (should reject)' },
  { q: 'How much does ARV cost', lang: 'en', intent: 'UNKNOWN',
    expect: null, shouldReject: true,
    note: 'Policy question (should reject)' },
];

// ═══════════════════════════════════════════════════════════════════════════
// LOAD BUNDLE & INITIALIZE SEARCH
// ═══════════════════════════════════════════════════════════════════════════

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
console.log(`Bundle version: ${manifest.version || 'UNKNOWN'}`);
console.log(`Chunks: ${manifest.chunk_count || 'UNKNOWN'}\n`);

const chunksRaw = strFromU8(getFile('content/chunks.jsonl'));
const chunks = chunksRaw.split('\n').filter(l => l.trim()).map(l => {
  try { return JSON.parse(l); } catch { return null; }
}).filter(Boolean);

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

// Parse embeddings
const embRaw = getFile('index/embeddings.bin');
const embView = new DataView(embRaw.buffer, embRaw.byteOffset, embRaw.byteLength);
const chunkCount = embView.getUint32(0, true);
const dims = embView.getUint32(4, true);
const embOffset = 8;
const embFloats = new Float32Array(embRaw.buffer, embRaw.byteOffset + embOffset, chunkCount * dims);

const indexRaw = getFile('index/embeddings_index.json');
let chunkIds = [];
if (indexRaw) {
  const indexData = JSON.parse(strFromU8(indexRaw));
  const indexMap = indexData.index;
  chunkIds = Object.keys(indexMap).sort((a, b) => Number(a) - Number(b)).map(k => indexMap[k]);
}

const lexRaw = getFile('index/lexical.json');
const bm25Index = lexRaw ? JSON.parse(strFromU8(lexRaw)) : {};

const proxyRaw = getFile('index/query_proxies.json');
let queryProxies = {};
if (proxyRaw) {
  const parsed = JSON.parse(strFromU8(proxyRaw));
  const entries = parsed?.en ?? [];
  if (Array.isArray(entries)) {
    for (const e of entries) {
      if (e.pattern && Array.isArray(e.vector)) queryProxies[e.pattern] = e.vector;
    }
  }
}

// Initialize search engine
const assets = {
  embeddingsBuffer: embFloats.buffer,
  embeddingsIndex: {
    dimensions: dims,
    total_chunks: chunkCount,
    chunk_ids: chunkIds,
  },
  queryProxies,
  bm25Index: { en: bm25Index.en },
  chunks: chunks,
};

initSearch(assets);

console.log('Search engine initialized\n');
console.log('Running 39-query measurement...\n');

// ═══════════════════════════════════════════════════════════════════════════
// RUN MEASUREMENT
// ═══════════════════════════════════════════════════════════════════════════

const results = [];

for (const testCase of TEST_CASES) {
  const { q, lang, intent, expect, shouldReject, note } = testCase;

  const sessionState = new SessionState();
  const result = await search(q, sessionState, lang, assets);

  const topId = result?.chunkId ?? null;
  const topContent = topId ? (chunkMap.get(topId) ?? '') : '';
  const topChunk = chunks.find(c => c.id === topId);
  const topTitle = topChunk?.display_title || topId || 'NULL';

  // Check if result is correct
  const correct = expect ? expect.test(topContent) : false;

  // Gate passed if result is not null
  const gatePassed = result !== null;

  // Determine gate correctness
  let gateCorrect = false;
  let errorType = null;

  if (shouldReject) {
    // Out-of-domain query — should reject
    gateCorrect = !gatePassed;
    if (gatePassed) errorType = 'FALSE_POSITIVE';
  } else {
    // Has expected answer
    if (gatePassed && correct) {
      gateCorrect = true;
    } else if (!gatePassed) {
      errorType = 'FALSE_NEGATIVE';
    } else if (gatePassed && !correct) {
      errorType = 'FALSE_POSITIVE';
    }
  }

  results.push({
    query: q,
    lang,
    intent,
    note,
    topChunkId: topId,
    topTitle,
    correct,
    gatePassed,
    gateCorrect,
    errorType,
    shouldReject: shouldReject || false,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPUTE METRICS
// ═══════════════════════════════════════════════════════════════════════════

const total = results.length;
const recall1 = results.filter(r => r.correct).length;
const gatePassed = results.filter(r => r.gatePassed).length;
const gateCorrect = results.filter(r => r.gateCorrect).length;

// False negatives: gate rejected but answer exists (not shouldReject cases)
const shouldPassCases = results.filter(r => !r.shouldReject);
const falseNegatives = shouldPassCases.filter(r => r.errorType === 'FALSE_NEGATIVE');
const fnRate = shouldPassCases.length > 0 ? (falseNegatives.length / shouldPassCases.length * 100) : 0;

// False positives: gate passed but wrong answer (or should have rejected)
const falsePositives = results.filter(r => r.errorType === 'FALSE_POSITIVE');
const shouldRejectCases = results.filter(r => r.shouldReject);
const fpRate = total > 0 ? (falsePositives.length / total * 100) : 0;

// ═══════════════════════════════════════════════════════════════════════════
// REPORT RESULTS
// ═══════════════════════════════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════════════════');
console.log(`  RESULTS — ${MARGIN_PERCENT}% Margin Threshold`);
console.log('───────────────────────────────────────────────────────────────');
console.log(`  Total queries: ${total}`);
console.log(`  Recall@1: ${recall1}/${total} (${(recall1/total*100).toFixed(1)}%)`);
console.log(`  Gate pass rate: ${gatePassed}/${total} (${(gatePassed/total*100).toFixed(1)}%)`);
console.log(`  Gate accuracy: ${gateCorrect}/${total} (${(gateCorrect/total*100).toFixed(1)}%)`);
console.log(`  False negative rate: ${fnRate.toFixed(1)}% (${falseNegatives.length}/${shouldPassCases.length})`);
console.log(`  False positive rate: ${fpRate.toFixed(1)}% (${falsePositives.length}/${total})`);
console.log('═══════════════════════════════════════════════════════════════\n');

// FALSE POSITIVES — CRITICAL FOR CLINICAL SAFETY
if (falsePositives.length > 0) {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  ⚠️  FALSE POSITIVES (Gate passed with WRONG answer)');
  console.log('───────────────────────────────────────────────────────────────');
  for (const fp of falsePositives) {
    console.log(`\n  ❌ [${fp.lang}/${fp.intent}] "${fp.query}"`);
    console.log(`     → Retrieved (WRONG): ${fp.topTitle}`);
    if (fp.note) console.log(`     Expected: ${fp.note}`);
    if (fp.intent === 'URGENT' || fp.intent === 'DOSAGE') {
      console.log(`     ⚠️  HIGH-STAKES FAILURE: ${fp.intent} query got wrong answer`);
    }
  }
  console.log('═══════════════════════════════════════════════════════════════\n');
} else {
  console.log('✅ NO FALSE POSITIVES\n');
}

// FALSE NEGATIVES
if (falseNegatives.length > 0) {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  FALSE NEGATIVES (Gate rejected correct answer)');
  console.log('───────────────────────────────────────────────────────────────');
  for (const fn of falseNegatives.slice(0, 10)) {  // Show first 10
    console.log(`  ⊘ [${fn.lang}/${fn.intent}] "${fn.query}"`);
  }
  if (falseNegatives.length > 10) {
    console.log(`  ... and ${falseNegatives.length - 10} more`);
  }
  console.log('═══════════════════════════════════════════════════════════════\n');
}

// Language breakdown
console.log('═══════════════════════════════════════════════════════════════');
console.log('  LANGUAGE BREAKDOWN');
console.log('───────────────────────────────────────────────────────────────');
for (const lang of ['en', 'ha', 'yo', 'ig', 'pid']) {
  const subset = results.filter(r => r.lang === lang);
  if (subset.length === 0) continue;
  const langRecall = subset.filter(r => r.correct).length;
  const langName = { en: 'English', ha: 'Hausa', yo: 'Yoruba', ig: 'Igbo', pid: 'Pidgin' }[lang];
  console.log(`  ${langName}: ${langRecall}/${subset.length} (${(langRecall/subset.length*100).toFixed(1)}%)`);
}
console.log('═══════════════════════════════════════════════════════════════\n');

// Intent breakdown
console.log('═══════════════════════════════════════════════════════════════');
console.log('  INTENT TYPE BREAKDOWN');
console.log('───────────────────────────────────────────────────────────────');
for (const intent of ['URGENT', 'DEFINE', 'DETAIL', 'PROCEDURE', 'DOSAGE', 'UNKNOWN']) {
  const subset = results.filter(r => r.intent === intent);
  if (subset.length === 0) continue;
  const intentRecall = subset.filter(r => r.correct).length;
  console.log(`  ${intent}: ${intentRecall}/${subset.length} (${(intentRecall/subset.length*100).toFixed(1)}%)`);
}
console.log('═══════════════════════════════════════════════════════════════\n');

console.log('Measurement complete.');
