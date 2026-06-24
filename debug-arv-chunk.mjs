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

// Find ARV-specific chunks
const arvChunks = chunks.filter(c => {
  const title = (c.display_title || '').toLowerCase();
  const content = JSON.stringify(c.content || {}).toLowerCase();
  return /arv|antiretroviral|art dosing|arv dose|pediatric arv/i.test(title + ' ' + content);
});

console.log(`Found ${arvChunks.length} ARV-related chunks\n`);
arvChunks.slice(0, 10).forEach(c => {
  const answer = (c.content?.en?.answer || '').substring(0, 100);
  console.log(`[${c.type}] "${c.display_title}"`);
  console.log(`  Answer: "${answer}..."\n`);
});

// Also find "Dosage Amount"
const dosageAmount = chunks.find(c => c.display_title === 'Dosage Amount');
if (dosageAmount) {
  console.log(`\n${'='.repeat(80)}`);
  console.log('DOSAGE AMOUNT CHUNK:');
  console.log(`Type: ${dosageAmount.type}`);
  const answer = (dosageAmount.content?.en?.answer || '').substring(0, 200);
  console.log(`Answer: "${answer}..."`);
}
