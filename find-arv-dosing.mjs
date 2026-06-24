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

// Look for chunks that mention pediatric ARV or child ARV dosing
const pedArv = chunks.filter(c => {
  const title = (c.display_title || '').toLowerCase();
  const content = JSON.stringify(c.content || {}).toLowerCase();
  return /pediatric.*arv|child.*arv|arv.*dose|art.*pediatric|10kg/i.test(title + content);
});

console.log(`Found ${pedArv.length} chunks with pediatric ARV content\n`);
pedArv.slice(0, 10).forEach((c, i) => {
  const ans = (c.content?.en?.answer || '').substring(0, 150);
  console.log(`${i+1}. [${c.type}] "${c.display_title}"`);
  console.log(`   "${ans}..."\n`);
});
