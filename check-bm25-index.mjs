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

const lexRaw = getFile('index/lexical.json');
const bm25Index = lexRaw ? JSON.parse(strFromU8(lexRaw)) : {};
const idx = bm25Index?.en?.index || {};

console.log(`BM25 index terms: ${Object.keys(idx).length}`);
console.log('\nSearching for policy-related terms:');
const searchTerms = ['rmncaeh', 'ministry', 'ministries', 'government', 'health', 'programme', 'partner'];
for (const term of searchTerms) {
  const postings = idx[term] || [];
  console.log(`  "${term}": ${postings.length} postings`);
}
