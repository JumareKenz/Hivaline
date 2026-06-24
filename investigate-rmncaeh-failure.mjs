/**
 * Why do RMNCAEH queries score 1/5?
 * These are governance/policy questions, not clinical content
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

console.log(`Artifact: ${chunks.length} chunks`);
console.log('═'.repeat(70));
console.log('CHECKING RMNCAEH CONTENT COVERAGE');
console.log('═'.repeat(70) + '\n');

const rmncaehKeywords = ['rmncaeh', 'reproductive', 'maternal', 'newborn', 'adolescent', 'elderly', 'nutrition', 'ministry', 'government', 'initiative', 'programme', 'partner', 'family health'];

const matching = chunks.filter(c => {
  const text = ((c.display_title || '') + ' ' + JSON.stringify(c.content)).toLowerCase();
  return rmncaehKeywords.some(kw => text.includes(kw));
});

console.log(`Chunks matching RMNCAEH keywords: ${matching.length}/${chunks.length}`);
console.log(`\nFirst 10 matching chunks:`);
for (const c of matching.slice(0, 10)) {
  console.log(`  - "${c.display_title}"`);
}

const policyContent = chunks.filter(c => {
  const title = (c.display_title || '').toLowerCase();
  return title.includes('rmncaeh') || title.includes('programme') || title.includes('government') || title.includes('partnership');
});

console.log(`\nChunks with governance/policy focus: ${policyContent.length}`);
for (const c of policyContent.slice(0, 10)) {
  console.log(`  - "${c.display_title}"`);
}

console.log('\n' + '═'.repeat(70));
if (policyContent.length === 0) {
  console.log('⚠️  NO POLICY/GOVERNANCE CONTENT IN ARTIFACT');
  console.log('   Jun 22 artifact is CLINICAL-ONLY (HIV, TB, Malaria, Dosage)');
  console.log('   RMNCAEH smoke test is INVALID for this artifact');
} else {
  console.log('✓ Policy content exists — investigate retrieval logic');
}
