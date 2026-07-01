/**
 * Extract chunks from real .hiv file for testing.
 * Run: node scripts/extractChunks.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { unzipSync, strFromU8 } from 'fflate';

const hivPath = 'C:/Users/INEWTON/Desktop/Hayok/hiva-0d800868.hiv';
const buf = readFileSync(hivPath);
const files = unzipSync(new Uint8Array(buf));

// Parse chunks
let chunks = [];
const chunksFile = files['content/chunks.jsonl'];
if (chunksFile) {
  const text = strFromU8(chunksFile);
  chunks = text.trim().split('\n').map(line => JSON.parse(line));
}

// Summary
console.log(`Total chunks: ${chunks.length}`);
console.log(`Types: ${[...new Set(chunks.map(c => c.type))].join(', ')}`);
console.log(`\nFirst 5 chunks:`);
for (const c of chunks.slice(0, 5)) {
  console.log(`  ${c.id} [${c.type}] — ${c.display_title || c.trigger_phrases?.en?.[0] || '(no title)'}`);
}

// Write full chunk data for test use
const output = {
  total: chunks.length,
  types: [...new Set(chunks.map(c => c.type))],
  chunks: chunks.map(c => ({
    id: c.id,
    type: c.type,
    display_title: c.display_title,
    trigger_phrases: c.trigger_phrases,
    aspects: c.aspects,
    content_keys: c.content?.en ? Object.keys(c.content.en) : [],
    answer_preview: typeof c.content?.en?.answer === 'string' ? c.content.en.answer.slice(0, 120) : null,
    source: c.source,
  })),
};

writeFileSync('scripts/chunks_summary.json', JSON.stringify(output, null, 2));
console.log('\nFull summary written to scripts/chunks_summary.json');
