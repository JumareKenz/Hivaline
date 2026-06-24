/**
 * Integration test: verify drug-class boost works in the search pipeline
 */
import { readFileSync } from 'fs';
import { unzipSync, strFromU8 } from 'fflate';

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

const lexRaw = getFile('index/lexical.json');
const bm25Index = lexRaw ? JSON.parse(strFromU8(lexRaw)) : {};
const idx = bm25Index?.en?.index || {};

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

console.log('INTEGRATION TEST: Drug-class boost in search pipeline\n');
console.log('═'.repeat(80) + '\n');

const query = 'ARV dose for 10kg child';
console.log(`Query: "${query}"\n`);

// Stage 1: BM25
const bm25 = bm25Search(query);
console.log(`Stage 1 (BM25): ${bm25.length} results`);
console.log(`  Top-1: ${chunks.find(c => c.id === bm25[0].chunkId)?.display_title} (${bm25[0].score.toFixed(2)})`);

// Stage 1b: Drug-class boost
const bm25Boosted = boostDrugClassInBm25(bm25, query, chunks);
console.log(`\nStage 1b (Drug-class boost): re-ranked`);
console.log(`  Top-1: ${chunks.find(c => c.id === bm25Boosted[0].chunkId)?.display_title} (${bm25Boosted[0].score.toFixed(2)})`);

// Check ranks
const topChunk = chunks.find(c => c.id === bm25Boosted[0].chunkId);
console.log(`\nResult: "${topChunk?.display_title}"`);
console.log(`Type: ${topChunk?.type}`);
const answer = (topChunk?.content?.en?.answer || '').substring(0, 200);
console.log(`Answer: "${answer}..."\n`);

// Verdict
const hasArv = /arv|antiretroviral|art|dolutegravir|dtg|efv|efavirenz|lpv|abc|3tc|ral/i.test(answer);
const hasChildDose = /pediatric|child|kg|dose|mg|daily/i.test(answer);

console.log('Verdict:');
console.log(`  Contains ARV/drug info: ${hasArv ? '✓' : '✗'}`);
console.log(`  Contains pediatric dosing: ${hasChildDose ? '✓' : '✗'}`);

if (hasArv && hasChildDose) {
  console.log('\n✓ PASS — Drug-class boost successfully retrieved ARV-specific dosing info');
} else {
  console.log('\n✗ FAIL — Retrieved chunk does not match ARV dosing requirements');
}
