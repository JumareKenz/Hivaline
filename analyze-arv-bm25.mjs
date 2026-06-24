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

const results = bm25Search('ARV dose for 10kg child');
console.log('BM25 Top 20 results for "ARV dose for 10kg child":\n');
for (let i = 0; i < 20 && i < results.length; i++) {
  const c = chunks.find(ch => ch.id === results[i].chunkId);
  const ans = (c?.content?.en?.answer || '').substring(0, 80);
  console.log(`${i+1}. [${c?.type}] "${c?.display_title}" (score: ${results[i].score.toFixed(2)})`);
  console.log(`   "${ans}..."`);
  
  // Check if contains ARV info
  const hasArv = /arv|antiretroviral|art|pediatric.*dose|lopinavir|abacavir|dolutegravir/i.test(
    (c?.content?.en?.answer || '')
  );
  console.log(`   Contains ARV info: ${hasArv ? '✓' : '✗'}\n`);
}
