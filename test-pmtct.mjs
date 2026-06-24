// Test PMTCT specifically
import { HIVFileContext } from './src/context/HIVFileContext.tsx';
import { ConversationEngine } from './src/services/conversationEngine.ts';

console.log('Loading .hiv file...');
const ctx = new HIVFileContext();
await ctx.loadFile('hiv-cache.bin');

if (!ctx.hivFile) {
  console.error('Failed to load .hiv file');
  process.exit(1);
}

console.log('Creating conversation engine...');
const engine = new ConversationEngine(ctx.hivFile);

console.log('\nTesting: "What is PMTCT?"');
const response = await engine.respond('What is PMTCT?');
console.log('Response:', response.message.slice(0, 200));
console.log('ChunkId:', response.chunkId);
console.log('Type:', response.type);

// Check variant embeddings
console.log('\n--- Variant Analysis ---');
const variants = ctx.hivFile.variantEmbeddingsIndex || [];
const pmtctVariants = variants.filter(v => v.text.toLowerCase().includes('pmtct'));
console.log('PMTCT variants found:', pmtctVariants.length);
pmtctVariants.slice(0, 5).forEach(v => {
  console.log(`  ${v.field_type}: "${v.text}" -> chunk ${v.chunk_id}`);
});

const tptVariants = variants.filter(v => v.text.toLowerCase().includes('tpt'));
console.log('\nTPT variants found:', tptVariants.length);
tptVariants.slice(0, 5).forEach(v => {
  console.log(`  ${v.field_type}: "${v.text}" -> chunk ${v.chunk_id}`);
});
