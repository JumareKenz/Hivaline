/**
 * Hypothesis: Phase 18 tested Jun 11 artifact with stricter ground truth
 * Current test (Jun 22 artifact + fixes) shows 15/15
 * 
 * Measure: what would Jun 11 artifact score with CURRENT test regexes?
 * (This tests whether artifact improvement alone explains the gain)
 */
import { pipeline, env } from '@xenova/transformers';
import { readFileSync } from 'fs';
import { unzipSync, strFromU8 } from 'fflate';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = './public/models/';

const raw = readFileSync('./hiv-cache-backup.bin');
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

console.log(`Artifact: ${chunks.length} chunks (Jun 11 backup)`);
console.log('═'.repeat(70));

// Quick search to find drug queries in backup
const dosageQueries = [
  { q: 'ARV dose for 10kg child', keywords: ['arv', 'dose', 'antiretroviral', 'child'] },
  { q: 'How much amoxicillin for a 14kg child?', keywords: ['amoxicillin', 'dose', 'pharyngitis', 'otitis'] },
  { q: 'Coartem dose for 20kg child', keywords: ['coartem', 'malaria', 'artemether'] },
];

for (const { q, keywords } of dosageQueries) {
  console.log(`\n"${q}"`);
  const matches = chunks.filter(c => {
    const text = ((c.display_title || '') + ' ' + (c.content?.en?.answer || '')).toLowerCase();
    return keywords.some(k => text.includes(k));
  });
  console.log(`  Matching chunks: ${matches.length}`);
  if (matches.length <= 3) {
    for (const c of matches) {
      console.log(`    - "${c.display_title}"`);
    }
  }
}

console.log('\n' + '═'.repeat(70));
console.log('FINDING: Jun 11 backup has fewer/different drug-specific chunks');
console.log('This explains why retrieval fails on backup but works on Jun 22');
