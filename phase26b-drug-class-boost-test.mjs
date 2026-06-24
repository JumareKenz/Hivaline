/**
 * PHASE 26b — Drug-class boost verification
 * Test the new boost mechanism across ARV, ACT, TPT, CPT
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

    // Check if chunk mentions any matched drug class term
    let hasDrugClass = false;
    for (const className of matchedClasses) {
      const terms = DRUG_CLASSES[className];
      for (const term of terms) {
        // Handle regex patterns (e.g., 'hiv.*treatment') vs literal strings
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
      // Chunk specifically mentions the drug class — boost it
      return { ...r, score: r.score * 1.4 };
    } else if (
      // Generic dosage chunk without the specific drug class mentioned
      /dosage|medication|dose|medicine|drug.*name/i.test(chunk.display_title || '')
    ) {
      // Demote generic chunks when querying for specific drug classes
      return { ...r, score: r.score * 0.6 };
    }

    return r;
  });

  // Re-sort by score after applying boosts/demotions
  return boosted.sort((a, b) => b.score - a.score);
}

function title(id) { return chunks.find(c => c.id === id)?.display_title || id; }
function chunkType(id) { return chunks.find(c => c.id === id)?.type || 'unknown'; }
function content(id) { return chunks.find(c => c.id === id)?.content?.en?.answer || ''; }

(async () => {

const TESTS = [
  { q: 'ARV dose for 10kg child', expect: /arv|antiretroviral|art|pediatric|dtg|dolutegravir|efv|efavirenz|lpv|lpr|abc|3tc|ral|raltegravir|dose|mg.*daily/i, class: 'ARV' },
  { q: 'ACT dosage for malaria', expect: /act|coartem|artemether|lumefantrine|malaria.*dose/i, class: 'ACT' },
  { q: 'TPT regimen for children', expect: /tpt|preventive.*therapy|isoniazid|3hr|3hp/i, class: 'TPT' },
  { q: 'CPT dose for HIV positive child', expect: /cpt|cotrimoxazole|ctx|bactrim/i, class: 'CPT' },
];

console.log('═'.repeat(90));
console.log('PHASE 26b — DRUG-CLASS BOOST VERIFICATION');
console.log('═'.repeat(90) + '\n');

console.log('Loading model...\n');
await embedQuery('warmup');

for (const { q, expect, class: className } of TESTS) {
  console.log(`[${className}] "${q}"`);

  let bm25 = bm25Search(q);
  const vector = await vectorSearch(q);
  const confident = isVectorConfident(vector);

  // Apply drug-class boost to BM25 BEFORE fusion (Stage 1b)
  const bm25Boosted = boostDrugClassInBm25(bm25, q, chunks);
  const fused = rrfFuse(bm25Boosted, confident ? vector : []);

  const bm25Top = bm25[0];
  const bm25BoostedTop = bm25Boosted[0];
  const fusedTop = fused[0];

  console.log(`  BM25 (raw) top-1: [${chunkType(bm25Top.chunkId)}] "${title(bm25Top.chunkId)}" (score: ${bm25Top.score.toFixed(2)})`);
  console.log(`  BM25 (boosted) top-1: [${chunkType(bm25BoostedTop.chunkId)}] "${title(bm25BoostedTop.chunkId)}" (score: ${bm25BoostedTop.score.toFixed(2)})`);
  console.log(`  Fused top-1: [${chunkType(fusedTop.chunkId)}] "${title(fusedTop.chunkId)}" (score: ${fusedTop.score.toFixed(5)})`);

  const bm25Pass = expect.test(content(bm25Top.chunkId));
  const bm25BoostedPass = expect.test(content(bm25BoostedTop.chunkId));
  const fusedPass = expect.test(content(fusedTop.chunkId));

  console.log(`  BM25 (raw): ${bm25Pass ? '✓' : '✗'} | BM25 (boosted): ${bm25BoostedPass ? '✓' : '✗'} | Fused: ${fusedPass ? '✓' : '✗'}`);

  if (!bm25Pass && bm25BoostedPass) {
    console.log(`  ✓ PRE-FUSION BOOST FIXES BM25`);
  } else if (bm25Pass) {
    console.log(`  ✓ BM25 already passes without boost`);
  } else if (fusedPass) {
    console.log(`  ✓ Fusion fixes the query`);
  } else {
    console.log(`  ✗ All strategies fail this query`);
  }

  console.log();
}

console.log('═'.repeat(90));
console.log('PHASE 26b VERDICT');
console.log('═'.repeat(90));

})();
