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

const DRUG_CLASSES = {
  arv: [
    'arv', 'antiretroviral', 'art', 'hiv.*treatment', 'hiv.*drug',
    'dolutegravir', 'dtg', 'efavirenz', 'efv', 'nevirapine', 'nvp',
    'lopinavir', 'ltv', 'ritonavir', 'rtv', 'tenofovir', 'tdf',
    'lamivudine', '3tc', 'abacavir', 'abc', 'raltegravir', 'ral',
    'emtricitabine', 'ftc', 'bictegravir', 'btk'
  ],
};

const query = 'ARV dose for 10kg child';
const bm25 = bm25Search(query);

console.log('Before boost - Top 10:\n');
for (let i = 0; i < 10 && i < bm25.length; i++) {
  const chunk = chunks.find(c => c.id === bm25[i].chunkId);
  console.log(`${i+1}. "${chunk?.display_title}" (${bm25[i].score.toFixed(2)})`);
}

// Now apply boost
const boosted = bm25.map((r) => {
  const chunk = chunks.find((ch) => ch.id === r.chunkId);
  if (!chunk) return r;
  
  const chunkText = (
    (chunk.display_title || '') + ' ' +
    JSON.stringify(chunk.content || {})
  ).toLowerCase();
  
  // Check if chunk mentions any matched drug class term
  let hasDrugClass = false;
  for (const term of DRUG_CLASSES.arv) {
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
  
  const isGeneric = /dosage|medication|dose|medicine|drug.*name/i.test(chunk?.display_title || '');
  
  if (hasDrugClass) {
    return { ...r, score: r.score * 1.4 };
  } else if (isGeneric) {
    return { ...r, score: r.score * 0.6 };
  }
  
  return r;
}).sort((a, b) => b.score - a.score);

console.log('\nAfter boost - Top 10:\n');
for (let i = 0; i < 10 && i < boosted.length; i++) {
  const chunk = chunks.find(c => c.id === boosted[i].chunkId);
  console.log(`${i+1}. "${chunk?.display_title}" (${boosted[i].score.toFixed(2)})`);
}
