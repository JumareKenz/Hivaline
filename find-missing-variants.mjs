// Find variants for failing queries
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

const buffer = await readFile('./hiv-cache.bin');
const files = unzipSync(new Uint8Array(buffer));

const variantIndex = JSON.parse(strFromU8(files['index/variant_embeddings_index.json']));
const chunks = strFromU8(files['content/chunks.jsonl']).trim().split('\n').map(line => JSON.parse(line));

console.log('=== Query: "Signs of ART treatment failure" ===');
const failureSignsVariants = variantIndex.filter(v => {
  const text = v.text.toLowerCase();
  return (text.includes('sign') && text.includes('failure')) ||
         (text.includes('symptom') && text.includes('failure'));
});
console.log(`Found ${failureSignsVariants.length} variants`);
failureSignsVariants.slice(0, 10).forEach(v => {
  console.log(`  "${v.text}" -> ${v.chunk_id}`);
});

// Find chunks about signs of failure
const failureChunks = chunks.filter(c => {
  const title = (c.display_title || '').toLowerCase();
  const content = JSON.stringify(c.content || {}).toLowerCase();
  return (title.includes('sign') && title.includes('failure')) ||
         (content.includes('signs of') && content.includes('failure')) ||
         title.includes('treatment failure');
});
console.log(`\nChunks with "signs of failure" content: ${failureChunks.length}`);
failureChunks.slice(0, 5).forEach(c => {
  console.log(`  ${c.id}: ${c.display_title}`);
});

console.log('\n=== Query: "ART for pregnant woman with HIV" ===');
const pregArtVariants = variantIndex.filter(v => {
  const text = v.text.toLowerCase();
  return (text.includes('pregnant') && text.includes('art')) ||
         (text.includes('pregnancy') && text.includes('hiv'));
});
console.log(`Found ${pregArtVariants.length} variants`);
pregArtVariants.slice(0, 10).forEach(v => {
  console.log(`  "${v.text}" -> ${v.chunk_id}`);
});

// Find chunks about ART in pregnancy
const pregArtChunks = chunks.filter(c => {
  const title = (c.display_title || '').toLowerCase();
  const content = JSON.stringify(c.content || {}).toLowerCase();
  return (title.includes('pregnant') || title.includes('pregnancy')) &&
         (title.includes('art') || title.includes('hiv') || title.includes('antiretroviral'));
});
console.log(`\nChunks with pregnancy + ART content: ${pregArtChunks.length}`);
pregArtChunks.slice(0, 5).forEach(c => {
  console.log(`  ${c.id}: ${c.display_title}`);
});
