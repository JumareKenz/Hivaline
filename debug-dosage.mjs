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

const dosageAmount = chunks.find(c => c.display_title === 'Dosage Amount');
if (dosageAmount) {
  console.log('DOSAGE AMOUNT:');
  console.log('Full answer:', dosageAmount.content?.en?.answer);
  console.log('\nDoes it match ARV pattern?', /arv|antiretroviral|art|pediatric/i.test(dosageAmount.content?.en?.answer || ''));
}

// Find a chunk that DOES mention ARV + dose
const arvDoseChunks = chunks.filter(c => {
  const text = (c.display_title || '') + ' ' + JSON.stringify(c.content || {});
  return /arv|antiretroviral|art/i.test(text) && /dose|dosing|mg|10kg|pediatric/i.test(text);
});

console.log(`\nFound ${arvDoseChunks.length} chunks mentioning ARV + dose\n`);
arvDoseChunks.slice(0, 5).forEach(c => {
  console.log(`[${c.type}] "${c.display_title}"`);
  const ans = c.content?.en?.answer || '';
  console.log(`  Length: ${ans.length} chars`);
  console.log(`  Preview: "${ans.substring(0, 100)}..."`);
});
