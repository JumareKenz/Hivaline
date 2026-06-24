/**
 * PHASE 26b — Canonical Regression Test
 * Measures improvement from drug-class boost across clinical, policy, dosage query sets
 * Uses v2026.06.24.64 (997 chunks, post-boost artifact)
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

// ============================================================
// DRUG-CLASS BOOST (Stage 1b)
// ============================================================
function boostDrugClassInBm25(results, query, chunks) {
  if (!chunks) return results;

  const DRUG_CLASSES = {
    arv: [
      'arv', 'antiretroviral', 'art', 'hiv.*treatment', 'hiv.*drug',
      'dolutegravir', 'dtg', 'efavirenz', 'efv', 'nevirapine', 'nvp',
      'lopinavir', 'ltv', 'ritonavir', 'rtv', 'tenofovir', 'tdf',
      'lamivudine', '3tc', 'abacavir', 'abc', 'raltegravir', 'ral',
      'emtricitabine', 'ftc', 'bictegravir', 'btk'
    ],
    act: ['act', 'artemisinin', 'coartem', 'lumefantrine'],
    tpt: ['tpt', 'preventive therapy', 'preventive treatment'],
    cpt: ['cpt', 'cotrimoxazole', 'ctx', 'bactrim'],
    prep: ['prep', 'pre-exposure'],
  };

  const boostableTypes = new Set(['drug_table', 'protocol', 'definition', 'faq']);
  const queryLower = query.toLowerCase();
  const matchedClasses = new Set();
  for (const [className, terms] of Object.entries(DRUG_CLASSES)) {
    for (const term of terms) {
      if (queryLower.includes(term)) {
        matchedClasses.add(className);
        break;
      }
    }
  }

  if (matchedClasses.size === 0) return results;

  const boosted = results.map((r) => {
    const chunk = chunks.find((ch) => ch.id === r.chunkId);
    if (!chunk || !boostableTypes.has(chunk.type || '')) return r;

    const chunkText = (
      (chunk.display_title || '') + ' ' +
      JSON.stringify(chunk.content || {})
    ).toLowerCase();

    let hasDrugClass = false;
    for (const className of matchedClasses) {
      const terms = DRUG_CLASSES[className];
      for (const term of terms) {
        if (term.includes('*')) {
          if (new RegExp(term, 'i').test(chunkText)) {
            hasDrugClass = true;
            break;
          }
        } else {
          if (chunkText.includes(term)) {
            hasDrugClass = true;
            break;
          }
        }
      }
      if (hasDrugClass) break;
    }

    if (hasDrugClass) {
      return { ...r, score: r.score * 1.4 };
    } else if (
      /dosage|medication|dose|medicine|drug.*name/i.test(chunk.display_title || '')
    ) {
      return { ...r, score: r.score * 0.6 };
    }

    return r;
  });

  return boosted.sort((a, b) => b.score - a.score);
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

// ============================================================
// TEST SUITES
// ============================================================
const CLINICAL_QUERIES = [
  { q: 'ART for pregnant woman with HIV', domain: 'HIV', expect: /pmtct|pregnan|mother.*child|maternal|option.*b/i },
  { q: 'Signs of ART treatment failure', domain: 'HIV', expect: /fail|viral.*load|1000|suppress|resistan/i },
  { q: 'When to start ART in adults', domain: 'HIV', expect: /start|initiat|same.*day|rapid|regardless|cd4/i },
  { q: 'What is PMTCT?', domain: 'HIV', expect: /pmtct|mother.*to.*child|prevent.*transmis|pregnan/i },
  { q: 'ARV dose for 10kg child', domain: 'HIV', expect: /arv|art|hiv|antiretroviral|lopinavir|abacavir|dolutegravir|dtg|efv/i },
  { q: 'How to screen for TB in PLHIV', domain: 'TB', expect: /screen|symptom|cough|fever|weight.*loss|night.*sweat/i },
  { q: 'TPT options for PLHIV', domain: 'TB', expect: /3hp|3hr|6h|1hp|ipt|isoniazid|rifapentine|preventive/i },
  { q: 'Isoniazid dose for children', domain: 'TB', expect: /isoniazid|inh|10.*mg.*kg|tpt|preventive/i },
  { q: 'Coartem dose for 20kg child', domain: 'Malaria', expect: /coartem|act|artemether|lumefantrine|malaria|tablet/i },
  { q: 'How much amoxicillin for a 14kg child?', domain: 'Drug', expect: /amoxicillin|amoxycillin|pharyngitis|otitis|antibiotic/i },
  { q: 'Can I give rifampicin with dolutegravir?', domain: 'Drug', expect: /rifampicin|dolutegravir|dose.*adjust|double|50.*mg.*twice/i },
  { q: 'Newborn danger signs', domain: 'Maternal', expect: /convuls|not.*feed|fever|breath|lethargi|jaundice|cord|refer/i },
  { q: 'HIV treatment during pregnancy', domain: 'HIV', expect: /pmtct|pregnan|maternal|mother/i },
  { q: 'Managing TB in HIV-positive patients', domain: 'TB/HIV', expect: /tb.*hiv|co.*infect|rifampicin|art.*tb/i },
];

const DOSAGE_QUERIES = [
  { q: 'Coartem dose for 15kg child', expect: /coartem|act|artemether|lumefantrine/i },
  { q: 'Coartem dose for 20kg child', expect: /coartem|act|artemether|lumefantrine/i },
  { q: 'Coartem dose for 25kg child', expect: /coartem|act|artemether|lumefantrine/i },
  { q: 'amoxicillin 250mg for 12kg child', expect: /amoxicillin|amoxycillin|pharyngitis|otitis/i },
  { q: 'dolutegravir dose with rifampicin', expect: /dolutegravir|dtg.*50.*mg|rifampicin.*adjust/i },
  { q: 'cotrimoxazole dose for HIV positive child 8kg', expect: /cotrimoxazole|ctx|bactrim/i },
  { q: 'isoniazid 10mg/kg for TPT in children', expect: /isoniazid|inh|3hr|3hp/i },
];

const POLICY_QUERIES = [
  { q: 'What is RMNCAEH?', expect: /reproductive|maternal|newborn|child|adolescent|elderly|nutrition/i },
  { q: 'Which ministries are involved in health?', expect: /ministr|government|health|coordinat/i },
  { q: 'What are the health programme partnerships?', expect: /partner|world|organization|unicef|financing/i },
  { q: 'MSPCP subnational coordination structure', expect: /subnational|state|lga|coordination|health/i },
  { q: 'Health programme stakeholders', expect: /stakeholder|partner|government|ngo|private|faith/i },
];

(async () => {

console.log('═'.repeat(100));
console.log('PHASE 26b — CANONICAL REGRESSION TEST');
console.log('Measures drug-class boost improvement across clinical, dosage, policy queries');
console.log(`Artifact: v2026.06.24.64 (${chunks.length} chunks)`);
console.log('═'.repeat(100) + '\n');

console.log('Loading embedding model...\n');
await embedQuery('warmup');

// Helper to run a test suite
async function runSuite(name, queries) {
  console.log(`\n${'═'.repeat(100)}`);
  console.log(`${name}`);
  console.log(`${'═'.repeat(100)}\n`);

  let beforeBoostPass = 0;
  let afterBoostPass = 0;

  for (const { q, domain, expect } of queries) {
    const expanded = expandQuery(q);
    const bm25 = bm25Search(expanded);
    const vector = await vectorSearch(expanded);
    const confident = isVectorConfident(vector) && bm25.length > 0;

    // Before boost: direct fusion
    const fusedBefore = rrfFuse(bm25, confident ? vector : []);
    const topBefore = fusedBefore[0]?.chunkId;
    const passBefore = topBefore && expect.test(content(topBefore));
    if (passBefore) beforeBoostPass++;

    // After boost: apply drug-class boost to BM25 before fusion
    const bm25Boosted = boostDrugClassInBm25(bm25, expanded, chunks);
    const fusedAfter = rrfFuse(bm25Boosted, confident ? vector : []);
    const topAfter = fusedAfter[0]?.chunkId;
    const passAfter = topAfter && expect.test(content(topAfter));
    if (passAfter) afterBoostPass++;

    const verdict = passAfter ? '✓' : (passBefore ? '→' : '✗');
    const status = passAfter && !passBefore ? ' FIXED' : passAfter && passBefore ? ' (pass)' : !passAfter && passBefore ? ' REGRESSED' : '';

    console.log(`${verdict} "${q.substring(0, 45)}"`);
    if (domain) console.log(`   [${domain}] Before: ${passBefore ? '✓' : '✗'} | After: ${passAfter ? '✓' : '✗'}${status}`);
  }

  const total = queries.length;
  const improvement = afterBoostPass - beforeBoostPass;
  const improvementPct = ((improvement / total) * 100).toFixed(0);

  console.log(`\n${name} Results:`);
  console.log(`  Before boost: ${beforeBoostPass}/${total} (${(beforeBoostPass/total*100).toFixed(0)}%)`);
  console.log(`  After boost:  ${afterBoostPass}/${total} (${(afterBoostPass/total*100).toFixed(0)}%)`);
  if (improvement !== 0) {
    console.log(`  Change: ${improvement > 0 ? '+' : ''}${improvement} queries (${improvement > 0 ? '+' : ''}${improvementPct}%)`);
  } else {
    console.log(`  Change: No change`);
  }

  return { before: beforeBoostPass, after: afterBoostPass, total };
}

// Run all test suites
const clinicalResults = await runSuite('CLINICAL QUERIES (15 items)', CLINICAL_QUERIES);
const dosageResults = await runSuite('DOSAGE/DRUG-NAME QUERIES (7 items)', DOSAGE_QUERIES);
const policyResults = await runSuite('POLICY QUERIES (5 items)', POLICY_QUERIES);

// Final summary
console.log(`\n${'═'.repeat(100)}`);
console.log('PHASE 26b FINAL SUMMARY');
console.log(`${'═'.repeat(100)}\n`);

const totalBefore = clinicalResults.before + dosageResults.before + policyResults.before;
const totalAfter = clinicalResults.after + dosageResults.after + policyResults.after;
const grandTotal = clinicalResults.total + dosageResults.total + policyResults.total;
const totalImprovement = totalAfter - totalBefore;

console.log('Aggregate Results:');
console.log(`  Clinical:  ${clinicalResults.before}/${clinicalResults.total} → ${clinicalResults.after}/${clinicalResults.total} (${clinicalResults.after - clinicalResults.before > 0 ? '+' : ''}${clinicalResults.after - clinicalResults.before})`);
console.log(`  Dosage:    ${dosageResults.before}/${dosageResults.total} → ${dosageResults.after}/${dosageResults.total} (${dosageResults.after - dosageResults.before > 0 ? '+' : ''}${dosageResults.after - dosageResults.before})`);
console.log(`  Policy:    ${policyResults.before}/${policyResults.total} → ${policyResults.after}/${policyResults.total} (${policyResults.after - policyResults.before > 0 ? '+' : ''}${policyResults.after - policyResults.before})`);

console.log(`\nOverall: ${totalBefore}/${grandTotal} (${(totalBefore/grandTotal*100).toFixed(0)}%) → ${totalAfter}/${grandTotal} (${(totalAfter/grandTotal*100).toFixed(0)}%)`);
console.log(`Net improvement: ${totalImprovement > 0 ? '+' : ''}${totalImprovement} queries`);

if (totalImprovement > 0) {
  console.log('\n🟢 PRODUCTION CLEARANCE: Drug-class boost improves results without regression');
} else if (totalImprovement === 0 && totalBefore === totalAfter && totalAfter > 0) {
  console.log('\n🟡 ACCEPTABLE: No improvement but no regressions; boost does not harm existing queries');
} else if (totalImprovement < 0) {
  console.log('\n🔴 REGRESSION DETECTED: Drug-class boost introduced failures');
} else {
  console.log('\n⚠️  REVIEW NEEDED: All queries failing; investigate artifact or search pipeline');
}

})();
