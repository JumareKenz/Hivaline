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

const DRUG_CLASSES = {
  arv: [
    'arv', 'antiretroviral', 'art', 'hiv.*treatment', 'hiv.*drug',
    'dolutegravir', 'dtg', 'efavirenz', 'efv', 'nevirapine', 'nvp',
    'lopinavir', 'ltv', 'ritonavir', 'rtv', 'tenofovir', 'tdf',
    'lamivudine', '3tc', 'abacavir', 'abc', 'raltegravir', 'ral',
    'emtricitabine', 'ftc', 'bictegravir', 'btk'
  ],
};

// Test top 5 chunks
const top5Titles = [
  'Dosage Amount',
  'Dolutegravir Dosing',
  '100 mg Tablet Dosage',
  'Dosage Mention',
  'Weight-Based Dose 10-14 kg',
];

console.log('Checking boost matching for ARV query:\n');
top5Titles.forEach((title, i) => {
  const chunk = chunks.find(c => c.display_title === title);
  const chunkText = ((chunk?.display_title || '') + ' ' + JSON.stringify(chunk?.content || {})).toLowerCase();
  
  // Test each ARV term
  let matched = null;
  for (const term of DRUG_CLASSES.arv) {
    // Use proper regex for terms with .* patterns
    const pattern = term.includes('.*') ? new RegExp(term, 'i') : new RegExp('\b' + term + '\b', 'i');
    if (pattern.test(chunkText)) {
      matched = term;
      break;
    }
  }
  
  const isGeneric = /dosage|medication|dose|medicine|drug.*name/i.test(chunk?.display_title || '');
  
  let multiplier = 1;
  if (matched) {
    multiplier = 1.4;
  } else if (isGeneric) {
    multiplier = 0.6;
  }
  
  console.log(`${i+1}. "${title}"`);
  console.log(`   Matched term: ${matched || 'none'}`);
  console.log(`   Is generic: ${isGeneric ? '✓' : '✗'}`);
  console.log(`   Multiplier: ${multiplier}`);
  console.log();
});
