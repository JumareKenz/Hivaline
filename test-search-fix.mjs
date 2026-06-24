// Test the improved variant matching
import { readFile } from 'node:fs/promises';
import { parseHIVFile } from './src/services/hivLoader.ts';
import { ConversationEngine } from './src/services/conversationEngine.ts';

const buffer = await readFile('./hiv-cache.bin');
const hivFile = await parseHIVFile(buffer.buffer);

console.log('HIVFile loaded:', hivFile.manifest?.version);
console.log('Chunks:', hivFile.chunks?.length);
console.log('Variant embeddings:', hivFile.variantCount);

const engine = new ConversationEngine(hivFile);

const testQueries = [
  'Signs of ART treatment failure',
  'ART for pregnant woman with HIV',
];

for (const query of testQueries) {
  console.log(`\n=== Testing: "${query}" ===`);
  try {
    const result = await engine.respond(query);
    console.log('Response type:', result.type);
    console.log('Chunk ID:', result.chunkId);
    console.log('Message preview:', result.message.slice(0, 150));

    // Check if response is on-topic
    const msg = result.message.toLowerCase();
    if (query.includes('failure')) {
      const hasFailure = /fail|viral.*load|suppress|resistan/i.test(msg);
      console.log('✓ Contains failure-related content:', hasFailure);
    }
    if (query.includes('pregnant')) {
      const hasPregnancy = /pregnan|pmtct|mother.*child|maternal/i.test(msg);
      console.log('✓ Contains pregnancy-related content:', hasPregnancy);
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}
