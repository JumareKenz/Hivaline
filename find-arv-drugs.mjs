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

// Find unique ARV drug names mentioned
const arvDrugs = new Set();
chunks.forEach(c => {
  const text = ((c.display_title || '') + ' ' + JSON.stringify(c.content || {})).toLowerCase();
  if (/arv|antiretroviral|art|hiv.*treatment|hiv.*drug/i.test(text)) {
    // Extract drug names
    const drugs = text.match(/\b(dolutegravir|dtg|efavirenz|efv|nevirapine|nvp|lopinavir|ltv|ritonavir|rtv|tenofovir|tdf|lamivudine|3tc|abacavir|abc|raltegravir|ral|emtricitabine|ftc|bictegravir|btk)\b/g);
    if (drugs) drugs.forEach(d => arvDrugs.add(d));
  }
});

console.log('ARV drug names found:', [...arvDrugs].sort().join(', '));
