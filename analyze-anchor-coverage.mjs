/**
 * Analyze anchor heuristic coverage:
 * 1. Which query classes have rare-term anchors (≤5 postings)?
 * 2. Do non-drug terms trigger spurious boosts?
 * 3. What's the distribution of anchor term posting counts?
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

const lexRaw = getFile('index/lexical.json');
const bm25Index = lexRaw ? JSON.parse(strFromU8(lexRaw)) : {};
const idx = bm25Index?.en?.index || {};

// Analyze term distribution
console.log('ANCHOR HEURISTIC COVERAGE ANALYSIS');
console.log('═══════════════════════════════════════════════════\n');

// 1. How many terms are rare (≤5 postings)?
const allTerms = Object.entries(idx);
const rareTerms = allTerms.filter(([term, postings]) => {
  if (term.length < 4 || !/^[a-z]+$/i.test(term)) return false;
  return postings.length > 0 && postings.length <= 5;
});

console.log(`Total BM25 terms: ${allTerms.length}`);
console.log(`Rare terms (4+ chars, alpha-only, ≤5 postings): ${rareTerms.length} (${(rareTerms.length/allTerms.length*100).toFixed(1)}%)\n`);

// 2. Break down rare terms by category
const drugTerms = rareTerms.filter(([t]) => /artem|coartem|amox|dolutegravir|dtg|cotrim|isoniazid|inh|rifamp|rifabu|nevirap|efavirenz|protease|lopinavir|abacavir|zidovudine|lamivudine|tenofovir|emtricitabine|integrase/i.test(t));
const conditionTerms = rareTerms.filter(([t]) => /tb|malaria|pneumocystis|pjp|oesophageal|cryptococcal|candidiasis|toxoplasmosis|cmv|mac|tuberculosis/i.test(t));
const otherTerms = rareTerms.filter(([t]) => !drugTerms.some(([d]) => d === t) && !conditionTerms.some(([c]) => c === t));

console.log(`Drug-name anchors: ${drugTerms.length}`);
console.log(`Condition/disease anchors: ${conditionTerms.length}`);
console.log(`Other anchors: ${otherTerms.length}`);

if (otherTerms.length > 0) {
  console.log(`\nSample other rare terms (non-drug, non-condition):`);
  for (const [term, postings] of otherTerms.slice(0, 15)) {
    console.log(`  "${term}" (${postings.length} postings)`);
  }
}

// 3. Distribution of posting counts
console.log('\nPosting count distribution for rare terms:');
const distribution = new Map();
for (const [, postings] of rareTerms) {
  const count = postings.length;
  distribution.set(count, (distribution.get(count) || 0) + 1);
}
for (let i = 1; i <= 5; i++) {
  const count = distribution.get(i) || 0;
  console.log(`  ${i} posting: ${count} terms`);
}

// 4. Test 10 random non-drug queries to ensure no spurious boosts
console.log('\n' + '═'.repeat(55));
console.log('SPURIOUS BOOST CHECK — 10 non-drug queries');
console.log('═'.repeat(55) + '\n');

const nonDrugQueries = [
  'symptoms of TB in children',
  'how to diagnose HIV',
  'PMTCT guidelines',
  'postpartum hemorrhage management',
  'breastfeeding and HIV',
  'opportunistic infections screening',
  'CD4 count interpretation',
  'viral load monitoring',
  'immune reconstitution',
  'adherence counseling strategies'
];

const chunksRaw = strFromU8(getFile('content/chunks.jsonl'));
const chunks = chunksRaw.split('\n').filter(l => l.trim()).map(l => {
  try { return JSON.parse(l); } catch { return null; }
}).filter(Boolean);

function testQuery(query) {
  const terms = query.toLowerCase().split(/\s+/).map(t => t.replace(/[^\w]/g, '')).filter(t => t.length >= 2);
  
  // Find anchor terms
  const anchors = [];
  for (const term of terms) {
    if (term.length < 4 || !/^[a-z]+$/i.test(term)) continue;
    const postings = idx[term] || [];
    if (postings.length > 0 && postings.length <= 5) {
      anchors.push({ term, count: postings.length });
    }
  }
  
  return { query, anchors };
}

for (const q of nonDrugQueries) {
  const { anchors } = testQuery(q);
  if (anchors.length > 0) {
    console.log(`"${q}"`);
    console.log(`  Anchors: ${anchors.map(a => `${a.term}(${a.count})`).join(', ')}`);
  }
}

console.log('\n✓ If no anchors appear above, non-drug queries are unaffected.');
