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

// Show top 5 chunks and their boost status
const top5 = [
  { title: 'Dosage Amount', score: 8.67 },
  { title: 'Dolutegravir Dosing', score: 8.27 },
  { title: '100 mg Tablet Dosage', score: 8.15 },
  { title: 'Dosage Mention', score: 8.15 },
  { title: 'Weight-Based Dose 10-14 kg', score: 7.58 },
];

console.log('ARV Query Boost Analysis:\n');
top5.forEach((item, i) => {
  const chunk = chunks.find(c => c.display_title === item.title);
  const chunkText = (chunk?.display_title || '') + ' ' + JSON.stringify(chunk?.content || {});
  
  const hasArv = /arv|antiretroviral|art/i.test(chunkText);
  const isGeneric = /dosage|medication|dose|medicine|drug.*name/i.test(chunk?.display_title || '');
  
  let multiplier = 1;
  if (hasArv) {
    multiplier = 1.4;
  } else if (isGeneric) {
    multiplier = 0.6;
  }
  
  const newScore = item.score * multiplier;
  console.log(`${i+1}. "${item.title}"`);
  console.log(`   Raw: ${item.score.toFixed(2)} × ${multiplier.toFixed(1)} = ${newScore.toFixed(2)}`);
  console.log(`   Has ARV: ${hasArv ? '✓' : '✗'} | Generic: ${isGeneric ? '✓' : '✗'}`);
  console.log();
});
