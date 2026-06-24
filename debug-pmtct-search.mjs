// Simpler debug - just check what hybridSearch sees
import fs from 'fs';

// Read the .hiv file directly as binary
const buffer = fs.readFileSync('hiv-cache.bin');
console.log('HIV file size:', (buffer.length / 1024 / 1024).toFixed(2), 'MB');

// Check if it's a ZIP file (starts with PK)
const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B;
console.log('Is ZIP format:', isZip);

// Check modification time
const stats = fs.statSync('hiv-cache.bin');
console.log('Last modified:', stats.mtime.toISOString());
console.log('File created:', stats.birthtime.toISOString());

// Simple test - check the test file
const testContent = fs.readFileSync('src/__tests__/engine/processMessage.integration.test.ts', 'utf8');

// Extract the PMTCT test case
const pmtctMatch = testContent.match(/\[hiv\].*PMTCT.*?query:.*?['"](.+?)['"]/s);
if (pmtctMatch) {
  console.log('\nPMTCT test query:', pmtctMatch[1]);
}

// Check what the issue actually is from the test output
console.log('\n--- From test output ---');
console.log('PMTCT test returned: "On Tpt Management: I can help with TPT management..."');
console.log('This means PMTCT query is matching TPT content');
console.log('\nPossible causes:');
console.log('1. No PMTCT variants in variantEmbeddingsIndex');
console.log('2. PMTCT variants have wrong chunk_id');
console.log('3. Keyword overlap between "pmtct" and "tpt" is triggering wrong match');
console.log('4. Pattern router is boosting wrong chunk');
