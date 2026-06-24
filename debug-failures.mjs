import { readFile } from 'node:fs/promises';
import * as fflate from 'fflate';

const hivBytes = await readFile('./hiv-cache.bin');
const files = fflate.unzipSync(new Uint8Array(hivBytes));
const variantIndex = JSON.parse(new TextDecoder().decode(files['index/variant_embeddings_index.json']));

const failingQueries = [
  "How to screen for TB in PLHIV",
  "Signs of ART treatment failure",
  "How long is IPT?"
];

function tokenize(text) {
  return text.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
}

for (const query of failingQueries) {
  console.log('\n===================');
  console.log('Query:', query);
  console.log('Tokens:', tokenize(query).join(', '));

  const queryTokens = new Set(tokenize(query));

  // Find matching variants
  const matches = [];
  for (let i = 0; i < variantIndex.length; i++) {
    const v = variantIndex[i];
    const vTokens = new Set(tokenize(v.text));
    const inter = Array.from(queryTokens).filter(t => vTokens.has(t)).length;
    const union = new Set([...queryTokens, ...vTokens]).size;
    const score = union > 0 ? inter / union : 0;

    if (score > 0.25) {
      matches.push({ score, text: v.text, chunk_id: v.chunk_id });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  console.log('\nTop 5 matches:');
  matches.slice(0, 5).forEach(m => {
    console.log(`  ${m.score.toFixed(2)} - ${m.text.substring(0, 80)}`);
  });
}
