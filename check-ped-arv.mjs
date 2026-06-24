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

const pedArv = chunks.find(c => c.display_title === 'Pediatric ARV Dosing');
console.log('Pediatric ARV Dosing chunk:');
const answer = pedArv?.content?.en?.answer || '';
console.log('Answer:', answer.substring(0, 300));
console.log('\nExpectation pattern: /arv|antiretroviral|art|pediatric.*arv/i');
console.log('Matches:', /arv|antiretroviral|art|pediatric.*arv/i.test(answer) ? '✓ YES' : '✗ NO');
