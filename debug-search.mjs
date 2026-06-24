import { readFile } from 'node:fs/promises';
import * as fflate from 'fflate';

const hivBytes = await readFile('./hiv-cache.bin');
const files = fflate.unzipSync(new Uint8Array(hivBytes));

// Parse variant index
const variantIndex = JSON.parse(new TextDecoder().decode(files['index/variant_embeddings_index.json']));

const query = "ARV dose for 10kg child";
const queryTokens = new Set(query.toLowerCase().split(/\s+/).filter(t => t.length >= 2));

console.log('Query:', query);
console.log('Tokens:', Array.from(queryTokens));

// Find matching variants
const matches = [];
for (let i = 0; i < variantIndex.length; i++) {
  const v = variantIndex[i];
  const vText = v.text.toLowerCase();
  const vTokens = new Set(vText.split(/\s+/).filter(t => t.length >= 2));

  const inter = Array.from(queryTokens).filter(t => vTokens.has(t)).length;
  const union = new Set([...queryTokens, ...vTokens]).size;
  const score = union > 0 ? inter / union : 0;

  if (score > 0.2 || vText.includes('arv') || vText.includes('dose')) {
    matches.push({ score, text: v.text, chunk_id: v.chunk_id, field_type: v.field_type });
  }
}

matches.sort((a, b) => b.score - a.score);
console.log('\nTop 10 matches:');
matches.slice(0, 10).forEach(m => {
  console.log(`  ${m.score.toFixed(2)} [${m.field_type}] ${m.text.substring(0, 80)}`);
});
