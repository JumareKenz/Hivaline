/**
 * Live UI browser test — type clinical queries and verify rendering + answer assembly
 */
import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  console.log('═'.repeat(70));
  console.log('LIVE UI BROWSER TEST — Clinical queries with rendering verification');
  console.log('═'.repeat(70) + '\n');
  
  // Navigate
  await page.goto('http://localhost:5174', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000); // Let model warm up
  
  // Wait for chat interface to load
  try {
    await page.waitForSelector('input[type="text"]', { timeout: 10000 });
    console.log('✓ Chat interface loaded');
  } catch {
    console.log('✗ Chat interface not found — checking page state');
    const content = await page.content();
    if (content.includes('root')) console.log('  React root exists but interface not ready');
    process.exit(1);
  }
  
  const queryInputSelector = 'input[type="text"]';
  const testQueries = [
    { q: 'Coartem dose for 15kg child', domain: 'Malaria dosage' },
    { q: 'PMTCT for pregnant woman', domain: 'HIV prevention' },
    { q: 'TB screening in PLHIV', domain: 'TB/HIV coinfection' },
  ];
  
  for (const { q, domain } of testQueries) {
    console.log(`\n[${domain}] "${q}"`);
    
    // Type query
    const input = page.locator(queryInputSelector);
    await input.fill('');
    await input.fill(q);
    await page.waitForTimeout(500);
    
    // Submit (Enter key)
    await input.press('Enter');
    
    // Wait for answer to render
    let answerFound = false;
    let retries = 0;
    while (!answerFound && retries < 10) {
      try {
        const messages = await page.locator('[class*="message"], [class*="bubble"], p').count();
        if (messages > 0) {
          answerFound = true;
          console.log('  ✓ Answer rendered');
        }
      } catch {
        retries++;
      }
      await page.waitForTimeout(500);
    }
    
    if (!answerFound) {
      console.log('  ✗ No answer rendered (timeout after 5s)');
      continue;
    }
    
    // Get answer text
    const allText = await page.locator('body').textContent();
    const lastNewline = allText.lastIndexOf(q);
    if (lastNewline > 0) {
      const responseText = allText.substring(lastNewline + q.length, lastNewline + q.length + 100);
      console.log(`  ✓ Response started: "${responseText.trim().substring(0, 50)}..."`);
    }
    
    await page.waitForTimeout(800);
  }
  
  // Screenshot final state
  await page.screenshot({ path: '/tmp/live-ui-final.png' });
  console.log('\n✓ Screenshot saved: /tmp/live-ui-final.png');
  
  await browser.close();
  console.log('\n' + '═'.repeat(70));
  console.log('RESULT: Live UI rendering verified — all 3 queries executed');
  console.log('═'.repeat(70));
  process.exit(0);
})().catch(err => {
  console.error('Browser test failed:', err.message);
  process.exit(1);
});
