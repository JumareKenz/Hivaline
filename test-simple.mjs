/**
 * Simple test to check if search works without embedding model
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const BASE = 'http://localhost:5173';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const hivBytes = await readFile('./hiv-cache.bin');
  console.log(`Using .hiv (${(hivBytes.length/1024/1024).toFixed(1)}MB)`);

  const browser = await chromium.launch({ headless: false });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();

  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[search]') || text.includes('[variantVectorSearch]') || text.includes('preparing')) {
      console.log('BROWSER:', text);
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
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[placeholder="Ask a clinical question..."]', { timeout: 30000 });
  await sleep(2000);

  // Send one test query
  console.log('Sending test query...');
  const input = page.locator('input[placeholder="Ask a clinical question..."]');
  const send = page.locator('button[aria-label="Send message"]');

  await input.click();
  await input.fill('What is the ARV dose for a 10kg child?');
  await sleep(100);
  await send.click();
  await sleep(3000);

  const resp = await page.locator('.justify-start p').last().innerText().catch(() => '');
  console.log('\nRESPONSE:', resp.substring(0, 200));

  await sleep(10000); // Keep browser open to inspect
  await browser.close();
})();
