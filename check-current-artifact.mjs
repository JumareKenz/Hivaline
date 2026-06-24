/**
 * Check: what artifact is currently loaded?
 * Is it the ~1,014-chunk Phase 24 target, or still the 588-chunk Phase 19 artifact?
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

const manifestRaw = getFile('manifest.json');
const manifest = manifestRaw ? JSON.parse(strFromU8(manifestRaw)) : {};

const chunksRaw = strFromU8(getFile('content/chunks.jsonl'));
const chunks = chunksRaw.split('\n').filter(l => l.trim()).map(l => {
  try { return JSON.parse(l); } catch { return null; }
}).filter(Boolean);

console.log('CURRENT ARTIFACT STATE:');
console.log('═'.repeat(60));
console.log(`Version: ${manifest.version}`);
console.log(`Chunk count (manifest): ${manifest.chunk_count}`);
console.log(`Chunk count (actual): ${chunks.length}`);
console.log(`Created: ${manifest.created_at}`);

// Category breakdown
const categories = new Map();
for (const c of chunks) {
  const title = (c.display_title || '').toLowerCase();
  let cat = 'other';
  if (title.includes('rmncaeh') || title.includes('ministry') || title.includes('programme')) cat = 'Policy';
  else if (title.includes('hiv')) cat = 'HIV';
  else if (title.includes('tb')) cat = 'TB';
  else if (title.includes('malaria')) cat = 'Malaria';
  else if (title.includes('dosage') || title.includes('dose')) cat = 'Dosage';
  
  if (!categories.has(cat)) categories.set(cat, 0);
  categories.set(cat, categories.get(cat) + 1);
}

console.log('\nContent distribution:');
for (const [cat, count] of Array.from(categories.entries()).sort((a,b) => b[1] - a[1])) {
  console.log(`  ${cat}: ${count}`);
}

if (chunks.length >= 1000) {
  console.log('\n✓ This is the consolidated Phase 24 artifact (~1,014 chunks)');
} else if (chunks.length === 588) {
  console.log('\n✗ This is still the Phase 19 artifact (588 chunks)');
  console.log('   Phase 24 artifact not yet available for testing');
} else {
  console.log(`\n? Unknown artifact state: ${chunks.length} chunks`);
}
