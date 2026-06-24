/**
 * Trace: what does retrieval actually return for RMNCAEH queries?
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

function title(id) { return chunks.find(c => c.id === id)?.display_title || id; }

console.log('═'.repeat(70));
console.log('RMNCAEH QUERY RETRIEVAL TRACE');
console.log('═'.repeat(70) + '\n');

const queries = [
  { q: 'What is RMNCAEH+N?', expect: /reproductive|maternal|newborn|child|adolescent|elderly|nutrition/i },
  { q: 'Which ministries are involved in health?', expect: /ministr|agriculture|federal|government/i },
  { q: 'What is the Family Health Department?', expect: /family health|coordinat|reproductive|maternal/i },
];

for (const { q, expect } of queries) {
  console.log(`"${q}"`);
  const bm25 = bm25Search(q);
  console.log(`  BM25 top 3:`);
  for (const r of bm25.slice(0, 3)) {
    const t = title(r.chunkId);
    console.log(`    ${r.score.toFixed(1)} → "${t}"`);
  }
  
  const retrieved = title(bm25[0]?.chunkId);
  const matches = expect.test(chunks.find(c => c.id === bm25[0]?.chunkId)?.content?.en?.answer || '');
  console.log(`  Match: ${matches ? '✓' : '✗'}`);
  console.log();
}
