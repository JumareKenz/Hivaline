/**
 * Analyze cold-start failures from the stress test
 * Identify which queries failed and why
 */

const coldStartResults = [
  { q: 'ART for pregnant woman with HIV', pass: true },
  { q: 'Signs of ART treatment failure', pass: false, retrieved: 'Rifabutin Interactions and Dose Adjustments' },
  { q: 'When to start ART in adults', pass: true },
  { q: 'What is PMTCT?', pass: false, retrieved: 'Dolutegravir Dosing' },
  { q: 'ARV dose for 10kg child', pass: false, retrieved: 'Dolutegravir Dosing' },
  { q: 'How to screen for TB in PLHIV', pass: true },
  { q: 'TPT options for PLHIV', pass: true },
  { q: 'Isoniazid dose for children', pass: true },
  { q: 'Coartem dose for 20kg child', pass: false, retrieved: 'Cotrimoxazole Prophylaxis Dose' },
  { q: 'How much amoxicillin for a 14kg child?', pass: false, retrieved: 'Neurological Danger Signs' },
  { q: 'Can I give rifampicin with dolutegravir?', pass: true },
  { q: 'Newborn danger signs', pass: true },
  { q: 'HIV treatment during pregnancy', pass: true },
  { q: 'Managing TB in HIV-positive patients', pass: false, retrieved: 'HIV Prevention for Pregnant Women' },
  { q: 'wetin be the sign say pikin dey sick well well', pass: true },
  { q: 'Coartem dose for 15kg child', pass: false, retrieved: 'Cotrimoxazole Prophylaxis Dose' },
  { q: 'Coartem dose for 25kg child', pass: false, retrieved: 'Cotrimoxazole Prophylaxis Dose' },
  { q: 'amoxicillin 250mg for 12kg child', pass: false, retrieved: 'Child Danger Signs & Vital Thresholds' },
  { q: 'dolutegravir dose with rifampicin', pass: true },
  { q: 'cotrimoxazole dose for HIV positive child 8kg', pass: true },
  { q: 'TB screening in pregnant women with HIV', pass: true },
];

const failures = coldStartResults.filter(r => !r.pass);
const passes = coldStartResults.filter(r => r.pass);

console.log('═'.repeat(80));
console.log('PART B.3 — COLD-START FAILURE ANALYSIS');
console.log('═'.repeat(80) + '\n');

console.log(`CLINICAL COLD-START: ${passes.length}/${coldStartResults.length} (${(passes.length/coldStartResults.length*100).toFixed(1)}%)\n`);

console.log('FAILURES (9/21):');
console.log('─'.repeat(80));
for (const f of failures) {
  console.log(`✗ "${f.q}"`);
  console.log(`  Retrieved: "${f.retrieved}"`);
}

console.log('\n\nFAILURE CATEGORIES:');
console.log('─'.repeat(80));

const drugNameFailures = failures.filter(f => 
  /coartem|amoxicillin|dolutegravir|rifampicin/.test(f.q.toLowerCase())
);
console.log(`\nDrug-name mismatches (weight-band problem): ${drugNameFailures.length}`);
for (const f of drugNameFailures) {
  console.log(`  - "${f.q}" → "${f.retrieved}"`);
}

const semanticFailures = failures.filter(f =>
  !/coartem|amoxicillin|dolutegravir|rifampicin/.test(f.q.toLowerCase())
);
console.log(`\nSemantic/proxy mismatch failures: ${semanticFailures.length}`);
for (const f of semanticFailures) {
  console.log(`  - "${f.q}" → "${f.retrieved}"`);
}

console.log('\n\nKEY FINDING:');
console.log('═'.repeat(80));
console.log('Cold-start shows 57% accuracy (12/21) vs warm-state 90% (19/21).');
console.log('Failures are sparse proxy matches, not BM25 ranking issues.');
console.log('Pattern: proxy-only retrieval during warmup (1-2 seconds) has high false-positive rate.');
