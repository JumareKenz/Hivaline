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

const dtg = chunks.find(c => c.display_title === 'Dolutegravir Dosing');
console.log('Dolutegravir Dosing chunk:');
console.log('Full answer:', dtg?.content?.en?.answer);
console.log('\nExpectation pattern: /arv|antiretroviral|art|pediatric.*arv/i');
console.log('Matches:', /arv|antiretroviral|art|pediatric.*arv/i.test(dtg?.content?.en?.answer || ''));

// Now check what it should match
console.log('\nChecking content for drug and dosage keywords:');
const answer = dtg?.content?.en?.answer || '';
console.log('Has DTG/dolutegravir:', /dtg|dolutegravir/i.test(answer) ? '✓' : '✗');
console.log('Has dose:', /dose|mg|daily/i.test(answer) ? '✓' : '✗');
console.log('Has pediatric:', /pediatric|child|kg/i.test(answer) ? '✓' : '✗');
