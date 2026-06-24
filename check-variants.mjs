// Check variant embeddings in .hiv file
import fs from 'fs';
import msgpack from '@msgpack/msgpack';

const buffer = fs.readFileSync('hiv-cache.bin');
const hivFile = msgpack.decode(buffer);

console.log('HIV file loaded');
console.log('Variant count:', hivFile.variantCount);
console.log('Variant embeddings dims:', hivFile.embeddingDims);

if (hivFile.variantEmbeddingsIndex) {
  const variants = hivFile.variantEmbeddingsIndex;
  console.log('Total variants in index:', variants.length);

  // Search for PMTCT
  const pmtctVariants = variants.filter(v => v.text.toLowerCase().includes('pmtct'));
  console.log('\n=== PMTCT variants ===');
  pmtctVariants.slice(0, 10).forEach(v => {
    console.log(`  [${v.field_type}] "${v.text}" -> ${v.chunk_id}`);
  });

  // Search for TPT
  const tptVariants = variants.filter(v =>
    v.text.toLowerCase().includes('tpt') ||
    v.text.toLowerCase().includes('preventive therapy')
  );
  console.log('\n=== TPT/Preventive Therapy variants ===');
  tptVariants.slice(0, 10).forEach(v => {
    console.log(`  [${v.field_type}] "${v.text}" -> ${v.chunk_id}`);
  });

  // Search for "what is" patterns
  const whatIsVariants = variants.filter(v => v.text.toLowerCase().startsWith('what is'));
  console.log('\n=== "What is" variants ===');
  whatIsVariants.slice(0, 10).forEach(v => {
    console.log(`  [${v.field_type}] "${v.text}" -> ${v.chunk_id}`);
  });

  // Search for chunks that might have PMTCT content
  console.log('\n=== Chunks with PMTCT ===');
  if (hivFile.chunks) {
    const pmtctChunks = hivFile.chunks.filter(c =>
      c.display_title?.toLowerCase().includes('pmtct') ||
      JSON.stringify(c.content).toLowerCase().includes('pmtct')
    );
    console.log('Found', pmtctChunks.length, 'chunks with PMTCT');
    pmtctChunks.slice(0, 3).forEach(c => {
      console.log(`  ${c.id}: ${c.display_title}`);
    });
  }
} else {
  console.log('No variantEmbeddingsIndex in file');
}
