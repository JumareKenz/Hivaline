/**
 * HIVA QA Test — full conversation quality with ONNX model loaded
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const BASE = 'http://localhost:5173';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const QUERIES = [
  // Drug Dosing
  { q: 'ARV dose for 10kg child', cat: 'drug_dose', check: s => /arv|art|hiv|antiretroviral|lopinavir|abacavir|dolutegravir|nevirapine|zidovudine/i.test(s) && !/amoxicillin/i.test(s) },
  { q: 'Coartem dose for 20kg child', cat: 'drug_dose', check: s => /coartem|act|artemether|lumefantrine|malaria|tablet/i.test(s) },
  { q: 'How much amoxicillin for a 14kg child?', cat: 'drug_dose', check: s => /amoxicillin|250mg|mg/i.test(s) },
  { q: 'Isoniazid dose for children', cat: 'drug_dose', check: s => /isoniazid|inh|10.*mg.*kg|tpt|preventive/i.test(s) },
  // Drug Interactions
  { q: 'Can I give rifampicin with dolutegravir?', cat: 'interaction', check: s => /rifampicin|dolutegravir|dose.*adjust|double|50.*mg.*twice/i.test(s) },
  { q: 'What drugs interact with atazanavir?', cat: 'interaction', check: s => /atazanavir|ritonavir|interact|boost/i.test(s) },
  // Clinical Protocols
  { q: 'When to start ART in adults', cat: 'protocol', check: s => /start|initiat|same.*day|rapid|regardless|cd4/i.test(s) },
  { q: 'ART for pregnant woman with HIV', cat: 'protocol', check: s => /pregnant|pmtct|immediate|initiat|option.*b|maternal/i.test(s) },
  { q: 'How to screen for TB in PLHIV', cat: 'protocol', check: s => /screen|symptom|cough|fever|weight.*loss|night.*sweat/i.test(s) },
  // Danger Signs
  { q: 'Newborn danger signs', cat: 'danger', check: s => /convuls|not.*feed|fever|breath|lethargi|jaundice|cord|refer/i.test(s) },
  { q: 'Signs of ART treatment failure', cat: 'danger', check: s => /viral.*load|fail|1000|suppress|resistan/i.test(s) },
  // KMC
  { q: 'What is kangaroo mother care?', cat: 'kmc', check: s => /kangaroo|skin.*to.*skin|kmc|preterm|low.*birth/i.test(s) },
  { q: 'When to stop KMC', cat: 'kmc', check: s => /stop|discharg|weight|1500|2500|criteria/i.test(s) },
  // TB Preventive Therapy
  { q: 'TPT options for PLHIV', cat: 'tpt', check: s => /3hp|3hr|6h|1hp|ipt|isoniazid|rifapentine|preventive/i.test(s) },
  { q: 'How long is IPT?', cat: 'tpt', check: s => /6.*month|isoniazid|ipt|daily|preventive/i.test(s) },
  // HIV Prevention
  { q: 'What is PMTCT?', cat: 'hiv', check: s => /pmtct|mother.*to.*child|prevent|transmis|pregnant/i.test(s) },
  // Edge Cases / Negative
  { q: 'What is the capital of Nigeria?', cat: 'out_of_scope', check: s => /scope|can.*help|clinical|guidelines|don.*t.*have|beyond/i.test(s) || s.length < 100 },
  { q: 'Diabetes management', cat: 'out_of_scope', check: s => /scope|can.*help|don.*t.*have|guidelines|beyond|not.*cover/i.test(s) || s.length < 80 },
  // Multi-turn slot
  { q: 'My patient is 3 years old and weighs 14kg, what ARV dose?', cat: 'slot_dose', check: s => /arv|art|dose|mg|kg|hiv|antiretroviral/i.test(s) && !/amoxicillin/i.test(s) },
  // Social
  { q: 'Thank you', cat: 'social', check: s => /glad|welcome|help|care|got.*this/i.test(s) },
];

(async () => {
  let hivBytes = await readFile('./hiv-cache.bin').catch(() => null);
  if (!hivBytes) {
    console.log('Downloading .hiv (44MB)...');
    const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJISVZBLUZQOUEiLCJ0eXBlIjoicnVudGltZSIsImV4cCI6MjA5NjM0MTg0M30.hjvzjfNRJXFa4YfTiW4gLqdo1ypeYUKOFwewpC9kDwg';
    const res = await fetch('https://compiler.hiva.chat/api/hiv/download', { headers: { Authorization: `Bearer ${TOKEN}` } });
    hivBytes = Buffer.from(await res.arrayBuffer());
    await (await import('node:fs/promises')).writeFile('./hiv-cache.bin', hivBytes);
    console.log(`Downloaded ${(hivBytes.length/1024/1024).toFixed(1)}MB`);
  } else {
    console.log(`Using cached .hiv (${(hivBytes.length/1024/1024).toFixed(1)}MB)`);
  }

  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox', '--disable-quic'] });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', msg => {
    if (msg.text().includes('[embeddingModel]') || msg.text().includes('[modelManager]')) {
      console.log('BROWSER:', msg.text());
    }
  });

  await page.goto(BASE);
  await page.waitForSelector('input[placeholder*="HIVA"], input[placeholder="Ask a clinical question..."]', { timeout: 30000 });
  await sleep(400);

  // Login
  if (await page.locator('input[placeholder*="HIVA"]').isVisible({ timeout: 1500 }).catch(() => false)) {
    await page.locator('input[placeholder*="HIVA"]').fill('HIVA-FP9A');
    await sleep(100);
    await page.locator('input').nth(1).fill('FP9A');
    await sleep(100);
    await page.locator('button', { hasText: /connect/i }).first().click();
    await page.waitForSelector('input[placeholder="Ask a clinical question..."]', { timeout: 20000 });
    await sleep(400);
  }

  // Inject .hiv
  console.log('Injecting .hiv into IndexedDB...');
  const CHUNK = 4 * 1024 * 1024;
  const nChunks = Math.ceil(hivBytes.length / CHUNK);
  await page.evaluate(t => { window.__hiv = new Uint8Array(t); window.__o = 0; }, hivBytes.length);
  for (let i = 0; i < nChunks; i++) {
    const b64 = hivBytes.subarray(i * CHUNK, (i+1) * CHUNK).toString('base64');
    await page.evaluate(({ b64 }) => { const b=atob(b64);const a=new Uint8Array(b.length);for(let j=0;j<b.length;j++)a[j]=b.charCodeAt(j);window.__hiv.set(a,window.__o);window.__o+=a.length; }, { b64 });
  }
  await page.evaluate(async () => {
    await new Promise(r => { const rq=indexedDB.open('hivaline-hiv',1); rq.onupgradeneeded=()=>{if(!rq.result.objectStoreNames.contains('files'))rq.result.createObjectStore('files')}; rq.onsuccess=()=>{const tx=rq.result.transaction('files','readwrite');tx.objectStore('files').put({blob:window.__hiv,version:'2026.06.05.52',downloadedAt:new Date().toISOString()},'current').onsuccess=()=>r()}; });
    localStorage.setItem('hiva_known_version','2026.06.05.52');
  });

  // Reload to mount
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('input[placeholder="Ask a clinical question..."]', { timeout: 30000 });
  await sleep(2000);

  // Wait for embedding model to download and become ready (up to 5 min for 118MB ONNX + 17MB tokenizer)
  console.log('Waiting for WASM embedding model to load (up to 300s)...');
  const input = page.locator('input[placeholder="Ask a clinical question..."]');
  const send = page.locator('button[aria-label="Send message"]');
  let modelReady = false;
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    await input.click(); await input.fill('test malaria'); await sleep(50); await send.click();
    await sleep(2500);
    const resp = await page.locator('.justify-start p').last().innerText().catch(() => '');
    if (!resp.includes('preparing') && !resp.includes('not loaded') && resp.length > 50) {
      modelReady = true;
      console.log(`Model ready after ~${(i+1)*5}s`);
      break;
    }
    if (i % 4 === 3) console.log(`  Still loading... (${(i+1)*5}s)`);
  }
  if (!modelReady) console.log('WARNING: Model may not be fully loaded');

  // Clear and start fresh conversation
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('input[placeholder="Ask a clinical question..."]', { timeout: 20000 });
  await sleep(3000);

  // Run queries
  console.log(`\nRunning ${QUERIES.length} quality queries...`);
  const results = [];
  let hivaCount = 0;

  for (let i = 0; i < QUERIES.length; i++) {
    const { q, cat, check } = QUERIES[i];
    await input.click(); await input.fill(q); await sleep(50);
    const t0 = Date.now();
    await send.click();
    hivaCount++;

    let ready = false;
    for (let w = 0; w < 40; w++) {
      await sleep(500);
      const c = await page.locator('.justify-start p').count();
      const typing = await page.locator('[class*="typing"]').isVisible().catch(() => false);
      if (c >= hivaCount && !typing) { ready = true; break; }
    }
    const lat = Date.now() - t0;
    const resp = await page.locator('.justify-start p').last().innerText().catch(() => '');
    const pass = ready && !resp.includes('preparing') && check(resp);
    results.push({ q, cat, lat, resp: resp.trim(), pass });
    const icon = pass ? '✓' : resp.includes('preparing') ? '⏳' : '✗';
    process.stdout.write(`  ${icon} [${cat}] "${q.slice(0,40)}" (${lat}ms)\n`);
  }

  await browser.close();

  // Final report
  console.log('\n' + '═'.repeat(72));
  console.log('  HIVA CONVERSATION QUALITY REPORT');
  console.log('  Model loaded: ' + (modelReady ? 'YES' : 'NO (proxy fallback only)'));
  console.log('═'.repeat(72));

  const categories = {};
  for (const r of results) {
    if (!categories[r.cat]) categories[r.cat] = { pass: 0, total: 0 };
    categories[r.cat].total++;
    if (r.pass) categories[r.cat].pass++;
  }

  for (const r of results) {
    const short = r.resp.replace(/\n/g, ' ').slice(0, 180);
    const icon = r.pass ? '✓' : r.resp.includes('preparing') ? '⏳' : '✗';
    console.log(`\n${icon} [${r.cat}] "${r.q}" (${r.lat}ms)`);
    console.log(`  → ${short}`);
    if (!r.pass && !r.resp.includes('preparing')) {
      console.log(`  ⚠ QUALITY ISSUE: response may be off-topic or incomplete`);
    }
  }

  const totalPass = results.filter(r => r.pass).length;
  const totalLoading = results.filter(r => r.resp.includes('preparing')).length;
  const totalFail = results.length - totalPass - totalLoading;

  console.log('\n' + '─'.repeat(72));
  console.log('  CATEGORY BREAKDOWN:');
  for (const [cat, { pass: p, total: t }] of Object.entries(categories)) {
    console.log(`    ${cat}: ${p}/${t}`);
  }
  console.log(`\n  TOTAL: ${totalPass}/${results.length} PASS | ${totalLoading} loading | ${totalFail} FAIL`);
  console.log(`  Avg latency: ${Math.round(results.reduce((s,r) => s+r.lat, 0) / results.length)}ms`);
  if (errs.length) console.log(`  Page errors: ${errs.length}`);
  console.log('═'.repeat(72));
})();
