// Quick inspection of new .hiv file
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

const buffer = await readFile('./hiv-cache.bin');
const files = unzipSync(new Uint8Array(buffer));

// Parse manifest
const manifest = JSON.parse(strFromU8(files['manifest.json']));
console.log('=== HIVManifest ===');
console.log('Version:', manifest.version);
console.log('Chunks:', manifest.total_chunks);
console.log('Coverage:', manifest.coverage_score);

// Parse chunks
const chunksRaw = strFromU8(files['content/chunks.jsonl']);
const chunks = chunksRaw.trim().split('\n').map(line => JSON.parse(line));

console.log('\n=== Searching for ART failure content ===');
const failureChunks = chunks.filter(c => {
  const title = (c.display_title || '').toLowerCase();
  const content = JSON.stringify(c.content).toLowerCase();
  return title.includes('failure') || content.includes('treatment failure') || content.includes('virologic failure');
});

console.log(`Found ${failureChunks.length} chunks related to failure`);
failureChunks.slice(0, 5).forEach(c => {
  console.log(`\n  ${c.id}: ${c.display_title}`);
  const triggers = c.trigger_phrases?.en || [];
  if (triggers.length) console.log(`  Triggers: ${triggers.slice(0, 3).join(', ')}`);
});

console.log('\n=== Searching for PMTCT/pregnancy content ===');
const pmtctChunks = chunks.filter(c => {
  const title = (c.display_title || '').toLowerCase();
  const content = JSON.stringify(c.content).toLowerCase();
  return title.includes('pmtct') || title.includes('pregnan') || content.includes('pregnant') || content.includes('mother to child');
});

console.log(`Found ${pmtctChunks.length} chunks related to PMTCT/pregnancy`);
pmtctChunks.slice(0, 5).forEach(c => {
  console.log(`\n  ${c.id}: ${c.display_title}`);
  const triggers = c.trigger_phrases?.en || [];
  if (triggers.length) console.log(`  Triggers: ${triggers.slice(0, 3).join(', ')}`);
});

console.log('\n=== Variant Embeddings ===');
const variantIndex = JSON.parse(strFromU8(files['index/variant_embeddings_index.json']));
console.log(`Total variants: ${variantIndex.length}`);

const failureVariants = variantIndex.filter(v => v.text.toLowerCase().includes('failure'));
console.log(`\nFailure variants: ${failureVariants.length}`);
failureVariants.slice(0, 5).forEach(v => {
  console.log(`  "${v.text}" -> ${v.chunk_id}`);
});

const pmtctVariants = variantIndex.filter(v => v.text.toLowerCase().includes('pmtct') || v.text.toLowerCase().includes('pregnant'));
console.log(`\nPMTCT/Pregnant variants: ${pmtctVariants.length}`);
pmtctVariants.slice(0, 5).forEach(v => {
  console.log(`  "${v.text}" -> ${v.chunk_id}`);
});
