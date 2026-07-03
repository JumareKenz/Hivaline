/**
 * measure-margin-tradeoff.mjs — Measure false-positive/false-negative tradeoff for margin changes
 *
 * Tests multiple margin values (5%, 7%, 10%) to find optimal balance.
 * Standalone script with inline search logic (no TypeScript imports).
 *
 * Usage: node measure-margin-tradeoff.mjs [hiv-bundle-path]
 */

import { pipeline, env } from '@xenova/transformers';
import { readFileSync } from 'fs';
import { unzipSync, strFromU8 } from 'fflate';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = './public/models/';

const HIV_PATH = process.argv[2] || './hiv-cache.bin';

// Test cases (same 39-query set)
const TEST_CASES = [
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
  { q: 'wetin be the sign say pikin dey sick well well', lang: 'pid', intent: 'URGENT',
    expect: /danger|sign|sick|convuls|refer|fever|child/i },
  { q: 'how person fit take treat malaria', lang: 'pid', intent: 'DETAIL',
    expect: /malaria|treat|coartem|act|dose/i },
  { q: 'Yaya ake fara maganin HIV', lang: 'ha', intent: 'PROCEDURE',
    expect: /hiv|art|start|initiat|treatment|antiretroviral/i, note: 'How to start HIV treatment' },
  { q: 'Alamun ciwon zazzabin cizon sauro', lang: 'ha', intent: 'URGENT',
    expect: /malaria|symptom|fever|sign/i, note: 'Signs of malaria' },
  { q: 'Adadin maganin HIV na yara', lang: 'ha', intent: 'DOSAGE',
    expect: /hiv|arv|child|dose|pediatric/i, note: 'HIV medicine dosage for children' },
  { q: 'Alamomin cututtukan jiki mai hatsari ga jariri', lang: 'ha', intent: 'URGENT',
    expect: /danger|sign|newborn|infant|refer/i, note: 'Danger signs in newborns' },
  { q: 'Bawo ni a ṣe le bẹrẹ itọju HIV', lang: 'yo', intent: 'PROCEDURE',
    expect: /hiv|art|start|initiat|treatment|antiretroviral/i, note: 'How to start HIV treatment' },
  { q: 'Ami aisan iba', lang: 'yo', intent: 'URGENT',
    expect: /malaria|symptom|fever|sign/i, note: 'Signs of malaria' },
  { q: 'Iwọn oogun HIV fun ọmọde', lang: 'yo', intent: 'DOSAGE',
    expect: /hiv|arv|child|dose|pediatric/i, note: 'HIV medicine dosage for children' },
  { q: 'Ami ewu fun ọmọ tuntun', lang: 'yo', intent: 'URGENT',
    expect: /danger|sign|newborn|infant|refer/i, note: 'Danger signs in newborns' },
  { q: 'Kedu ka esi amalite ọgwụgwọ HIV', lang: 'ig', intent: 'PROCEDURE',
    expect: /hiv|art|start|initiat|treatment|antiretroviral/i, note: 'How to start HIV treatment' },
  { q: 'Ihe ngosi nke ọrịa ịba', lang: 'ig', intent: 'URGENT',
    expect: /malaria|symptom|fever|sign/i, note: 'Signs of malaria' },
  { q: 'Usoro ọgwụ HIV maka ụmụaka', lang: 'ig', intent: 'DOSAGE',
    expect: /hiv|arv|child|dose|pediatric/i, note: 'HIV medicine dosage for children' },
  { q: 'Ihe ngosi nke ihe ize ndụ maka ọhụrụ amụrụ', lang: 'ig', intent: 'URGENT',
    expect: /danger|sign|newborn|infant|refer/i, note: 'Danger signs in newborns' },
  { q: 'What is the weather today', lang: 'en', intent: 'UNKNOWN',
    expect: null, shouldReject: true, note: 'Out-of-domain' },
  { q: 'How much does ARV cost', lang: 'en', intent: 'UNKNOWN',
    expect: null, shouldReject: true, note: 'Policy question' },
];

console.log('═══════════════════════════════════════════════════════════════');
console.log('  CONFIDENCE GATE MARGIN TRADEOFF MEASUREMENT');
console.log('───────────────────────────────────────────────────────────────');
console.log(`  Bundle: ${HIV_PATH}`);
console.log(`  Test set: ${TEST_CASES.length} queries`);
console.log('═══════════════════════════════════════════════════════════════\n');

// Load bundle
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

console.log('Loading MiniLM model...');
const embedder = await pipeline('feature-extraction', 'embed', { quantized: true });
console.log('Model loaded\n');

async function embedQuery(text) {
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return output.data;
}

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

async function vectorSearch(query) {
  const qEmb = await embedQuery(query);
  const results = [];
  for (let i = 0; i < chunkCount; i++) {
    const offset = i * dims;
    const chunkVec = embFloats.subarray(offset, offset + dims);
    const score = cosine(qEmb, chunkVec);
    results.push({ chunkId: chunkIds[i] || String(i), score });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 10);
}

function isVectorConfident(results, marginThreshold) {
  if (results.length === 0) return false;
  if (results[0].score < 0.3) return false;
  if (results.length >= 2) {
    const margin = (results[0].score - results[1].score) / results[1].score;
    if (margin < marginThreshold) return false;
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

const SYNONYMS = {
  arv: ['antiretroviral'], pmtct: ['prevention', 'mother', 'child', 'transmission', 'pregnancy', 'maternal'],
  tpt: ['preventive', 'isoniazid', 'rifapentine', 'tuberculosis'], ipt: ['isoniazid', 'preventive', 'tuberculosis'],
  tb: ['tuberculosis', 'coinfection'], act: ['artemisinin', 'coartem', 'lumefantrine', 'malaria'],
  kmc: ['kangaroo', 'mother', 'care', 'skin'], plhiv: ['people', 'living', 'hiv', 'positive'],
  pph: ['postpartum', 'hemorrhage', 'bleeding'], anc: ['antenatal', 'pregnancy'],
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

// Test multiple margin thresholds
const MARGINS = [0.10, 0.07, 0.05];

for (const marginThreshold of MARGINS) {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  TESTING ${(marginThreshold * 100).toFixed(0)}% MARGIN`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const results = [];

  for (const tc of TEST_CASES) {
    const expanded = expandQuery(tc.q);
    const bm25 = bm25Search(expanded);
    const vector = await vectorSearch(expanded);
    const hasBm25 = bm25.length > 0 && bm25[0].score >= 1.5;
    const confident = isVectorConfident(vector, marginThreshold);
    const fused = rrfFuse(bm25, confident ? vector : []);

    const topId = fused[0]?.chunkId ?? null;
    const topContent = topId ? (chunkMap.get(topId) ?? '') : '';
    const topChunk = chunks.find(c => c.id === topId);
    const topTitle = topChunk?.display_title || topId || 'NULL';

    const correct = tc.expect ? tc.expect.test(topContent) : false;
    const gatePassed = confident && topId !== null;

    let errorType = null;
    if (tc.shouldReject) {
      if (gatePassed) errorType = 'FALSE_POSITIVE';
    } else {
      if (!gatePassed) errorType = 'FALSE_NEGATIVE';
      else if (!correct) errorType = 'FALSE_POSITIVE';
    }

    results.push({
      query: tc.q,
      lang: tc.lang,
      intent: tc.intent,
      note: tc.note,
      topChunkId: topId,
      topTitle,
      correct,
      gatePassed,
      errorType,
      shouldReject: tc.shouldReject || false,
      vectorScore: vector[0]?.score ?? 0,
      vectorMargin: vector.length >= 2 ? ((vector[0].score - vector[1].score) / vector[1].score) : 999,
    });
  }

  // Compute metrics
  const total = results.length;
  const recall1 = results.filter(r => r.correct).length;
  const gatePassed = results.filter(r => r.gatePassed).length;

  const shouldPassCases = results.filter(r => !r.shouldReject);
  const falseNegatives = shouldPassCases.filter(r => r.errorType === 'FALSE_NEGATIVE');
  const fnRate = (falseNegatives.length / shouldPassCases.length * 100);

  const falsePositives = results.filter(r => r.errorType === 'FALSE_POSITIVE');
  const fpRate = (falsePositives.length / total * 100);

  console.log(`  Recall@1: ${recall1}/${total} (${(recall1/total*100).toFixed(1)}%)`);
  console.log(`  Gate pass rate: ${gatePassed}/${total} (${(gatePassed/total*100).toFixed(1)}%)`);
  console.log(`  False negative rate: ${fnRate.toFixed(1)}% (${falseNegatives.length}/${shouldPassCases.length})`);
  console.log(`  False positive rate: ${fpRate.toFixed(1)}% (${falsePositives.length}/${total})`);

  if (falsePositives.length > 0) {
    console.log('\n  ⚠️  FALSE POSITIVES:');
    for (const fp of falsePositives) {
      console.log(`    ❌ [${fp.lang}/${fp.intent}] "${fp.query}"`);
      console.log(`       → WRONG: ${fp.topTitle}`);
      console.log(`       Vector: ${fp.vectorScore.toFixed(3)}, Margin: ${(fp.vectorMargin*100).toFixed(1)}%`);
      if (fp.intent === 'URGENT' || fp.intent === 'DOSAGE') {
        console.log(`       ⚠️⚠️  HIGH-STAKES ${fp.intent} FAILURE ⚠️⚠️`);
      }
    }
  } else {
    console.log('\n  ✅ NO FALSE POSITIVES');
  }
}

console.log('\n\n═══════════════════════════════════════════════════════════════');
console.log('  MEASUREMENT COMPLETE');
console.log('═══════════════════════════════════════════════════════════════');
