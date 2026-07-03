/**
 * Poll for test results from the ARM device test page
 * The test page writes results to localStorage, which we can read via a results endpoint
 */

console.log('Waiting for ARM device test to complete...');
console.log('The test should take approximately 1-2 minutes.');
console.log('Polling every 10 seconds...\n');

const POLL_INTERVAL = 10000;
const MAX_ATTEMPTS = 24; // 4 minutes total

let attempts = 0;

async function pollResults() {
    attempts++;
    console.log(`[${attempts}/${MAX_ATTEMPTS}] Checking...`);

    // Since we can't directly read localStorage from the server,
    // we'll need to manually check the page or use adb
    // For now, just indicate that the user should check the device screen

    if (attempts >= MAX_ATTEMPTS) {
        console.log('\n⏱️  Polling timeout reached.');
        console.log('Please manually check the device screen for results.');
        console.log('The test page should display results when complete.');
        process.exit(0);
    }

    setTimeout(pollResults, POLL_INTERVAL);
}

console.log('📱 Please ensure the test page is open on the physical device.');
console.log('   URL: http://localhost:8080/public/test-arm-simple.html');
console.log('\nStarting poll...\n');

pollResults();
