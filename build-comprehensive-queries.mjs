/**
 * Build comprehensive query sets by sampling from artifact content
 * Goal: Create queries that exercise the full breadth of both clinical + policy domains
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

console.log(`Artifact: ${chunks.length} chunks\n`);

// Categorize chunks
const categories = new Map();
for (const c of chunks) {
  const title = (c.display_title || '').toLowerCase();
  let cat = 'other';
  if (title.includes('hiv') || title.includes('art') || title.includes('arv')) cat = 'HIV';
  else if (title.includes('tb') || title.includes('tuberculosis')) cat = 'TB';
  else if (title.includes('malaria') || title.includes('coartem') || title.includes('artemether')) cat = 'Malaria';
  else if (title.includes('dosage') || title.includes('dose') || title.includes('dosing')) cat = 'Dosage';
  else if (title.includes('newborn') || title.includes('maternal') || title.includes('pregnancy') || title.includes('infant')) cat = 'Maternal';
  else if (title.includes('decision') || title.includes('algorithm')) cat = 'Decision';
  else if (title.includes('rmncaeh') || title.includes('ministry') || title.includes('programme') || title.includes('partner') || title.includes('government')) cat = 'Policy';
  
  if (!categories.has(cat)) categories.set(cat, []);
  categories.get(cat).push(c);
}

console.log('Category breakdown:');
for (const [cat, items] of categories) {
  console.log(`  ${cat}: ${items.length} chunks`);
}

// Find decision trees
const decisionTrees = chunks.filter(c => c.decision_tree);
console.log(`\nDecision trees: ${decisionTrees.length}`);
if (decisionTrees.length > 0) {
  console.log('Sample trees:');
  for (const c of decisionTrees.slice(0, 3)) {
    console.log(`  - "${c.display_title}"`);
  }
}

// Find variant-rich chunks (multiple question variants)
const variantRich = chunks.filter(c => (c.trigger_phrases?.en?.length || 0) > 3);
console.log(`\nVariant-rich chunks (4+ trigger phrases): ${variantRich.length}`);

// Sample chunk titles for generating queries
console.log('\n' + '═'.repeat(70));
console.log('CLINICAL DOMAIN CHUNK SAMPLES (for query generation):');
console.log('═'.repeat(70) + '\n');

const clinicalCats = ['HIV', 'TB', 'Malaria', 'Dosage', 'Maternal'];
for (const cat of clinicalCats) {
  const items = categories.get(cat) || [];
  console.log(`${cat} (${items.length} chunks):`);
  for (const c of items.slice(0, 4)) {
    console.log(`  - "${c.display_title}"`);
  }
}

console.log('\n' + '═'.repeat(70));
console.log('POLICY DOMAIN CHUNK SAMPLES:');
console.log('═'.repeat(70) + '\n');

const policyItems = categories.get('Policy') || [];
console.log(`Policy (${policyItems.length} chunks):`);
for (const c of policyItems.slice(0, 8)) {
  console.log(`  - "${c.display_title}"`);
}
