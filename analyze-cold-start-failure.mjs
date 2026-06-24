/**
 * Investigate Coartem 20kg cold-start failure
 * Why does proxy-only retrieval fail for this query?
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

function tokenize(text) {
  return text.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
}

function setIntersection(a, b) {
  const result = [];
  for (const item of a) {
    if (b.has(item)) result.push(item);
  }
  return result;
}

function title(id) { return chunks.find(c => c.id === id)?.display_title || id; }

console.log('COLD-START FAILURE ANALYSIS — Coartem 20kg');
console.log('═'.repeat(70) + '\n');

const query = 'Coartem dose for 20kg child';
const queryTokens = new Set(tokenize(query));

console.log(`Query: "${query}"`);
console.log(`Tokens: [${[...queryTokens].join(', ')}]\n`);

console.log('Top 10 proxy matches by Jaccard similarity:');
console.log('─'.repeat(70));

const matches = [];
for (const [proxyText, proxyVector] of Object.entries(queryProxies)) {
  const proxyTokens = new Set(tokenize(proxyText));
  const inter = setIntersection(queryTokens, proxyTokens).length;
  const union = new Set([...queryTokens, ...proxyTokens]).size;
  const jaccard = union > 0 ? inter / union : 0;
  matches.push({ proxyText, jaccard, inter, union });
}

matches.sort((a, b) => b.jaccard - a.jaccard);

for (let i = 0; i < Math.min(10, matches.length); i++) {
  const { proxyText, jaccard, inter, union } = matches[i];
  console.log(`${i+1}. "${proxyText}" | Jaccard=${jaccard.toFixed(3)} (${inter}/${union})`);
}

const bestMatch = matches[0];
console.log(`\nBest proxy: "${bestMatch.proxyText}" (Jaccard=${bestMatch.jaccard.toFixed(3)})`);

if (bestMatch.jaccard < 0.25) {
  console.log(`\n⚠️  Jaccard=${bestMatch.jaccard.toFixed(3)} < 0.25 safety gate`);
  console.log('   Proxy is essentially random — coldstart returns no result for this query');
} else {
  console.log(`\n✓ Jaccard=${bestMatch.jaccard.toFixed(3)} >= 0.25`);
  console.log('   Proxy SHOULD work, but may still rank wrong chunk');
}

// Find Coartem chunk
const coartemChunk = chunks.find(c => (c.display_title || '').toLowerCase().includes('coartem'));
if (coartemChunk) {
  console.log(`\nCoartem chunk ID: ${coartemChunk.id}`);
  console.log(`Title: "${coartemChunk.display_title}"`);
}

console.log('\n' + '═'.repeat(70));
console.log('DECISION MATRIX:');
console.log('─'.repeat(70));
if (bestMatch.jaccard < 0.25) {
  console.log('Option A: Accept cold-start gap for Coartem');
  console.log('  Reason: Jaccard < 0.25 is safety gate (prevents random clinical content)');
  console.log('  Impact: ~1 query in 15 (~7%) fails cold-start, but safety preserved');
  console.log('\nOption B: Lower Jaccard threshold from 0.25 to 0.15');
  console.log('  Risk: May serve wrong answers during warmup if proxy doesn\'t match semantics');
  console.log('\nOption C: Compiler-side: pre-compute proxy for "coartem" specifically');
  console.log('  Cost: Minimal (one proxy entry); gain: Coartem cold-start works');
} else {
  console.log('✓ Proxy match is confident — issue is ranking, not coldstart safety');
}
