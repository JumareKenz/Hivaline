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
console.log('Title:', dtg?.display_title);
console.log('Type:', dtg?.type);
const answer = dtg?.content?.en?.answer || '';
console.log('Content length:', answer.length);
console.log('Content preview:', answer.substring(0, 200));
console.log('\nLowercase check:');
const text = (dtg?.display_title + ' ' + JSON.stringify(dtg?.content || {})).toLowerCase();
console.log('Contains dolutegravir:', text.includes('dolutegravir'));
console.log('Contains dtg:', text.includes('dtg'));
console.log('Contains pediatric:', text.includes('pediatric'));
