/**
 * test-q4-only.mjs - Test ONLY the q4 model
 */

import { pipeline, env } from '@xenova/transformers';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.localModelPath = './public/models/';

const warmupQueries = [
  "How do I treat HIV?",
  "Dosage for children 5-10kg",
  "What are the symptoms of tuberculosis?",
  "When should I refer a patient?",
  "Malaria prophylaxis for pregnant women",
  "Side effects of artemisinin",
  "How to diagnose pneumonia",
  "Treatment for severe malnutrition",
  "Signs of dehydration",
  "Vaccination schedule for infants"
];

const referenceQuery = "What is the treatment for malaria?";

console.log('='.repeat(70));
console.log('TESTING: bge-m3 q4 (1.2GB)');
console.log('='.repeat(70));

// 1. Cold load
console.log('\n1. Cold Model Load:');
const loadStart = performance.now();
const model = await pipeline('feature-extraction', 'bge-m3-q4', {
  quantized: true,
});
const loadTime = performance.now() - loadStart;
console.log(`   ✅ Loaded in ${loadTime.toFixed(0)}ms`);

// 2. Verify
console.log('\n2. Verify Output:');
const refOutput = await model(referenceQuery, { pooling: 'cls', normalize: true });
const embedding = refOutput.data;
const dims = embedding.length;
console.log(`   Dimensions: ${dims} (expected 1024)`);
console.log(`   Sample: [${Array.from(embedding).slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);

// 3. Warm inference
console.log('\n3. Warm Inference Latency (10 queries):');
const latencies = [];
for (let i = 0; i < warmupQueries.length; i++) {
  const query = warmupQueries[i];
  const start = performance.now();
  await model(query, { pooling: 'cls', normalize: true });
  const latency = performance.now() - start;
  latencies.push(latency);
  console.log(`   Query ${i+1}: ${latency.toFixed(1)}ms`);
}

const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
const minLatency = Math.min(...latencies);
const maxLatency = Math.max(...latencies);

console.log(`\n   Average: ${avgLatency.toFixed(1)}ms`);
console.log(`   Min: ${minLatency.toFixed(1)}ms`);
console.log(`   Max: ${maxLatency.toFixed(1)}ms`);

// 4. Memory
const memUsage = process.memoryUsage();
console.log('\n4. Memory Usage:');
console.log(`   RSS: ${(memUsage.rss / 1024 / 1024).toFixed(1)}MB`);
console.log(`   External: ${(memUsage.external / 1024 / 1024).toFixed(1)}MB`);

// Summary
console.log('\n' + '='.repeat(70));
console.log('SUMMARY');
console.log('='.repeat(70));
console.log(`q4 (1,190MB file):`);
console.log(`  Cold load: ${loadTime.toFixed(0)}ms`);
console.log(`  Avg latency: ${avgLatency.toFixed(1)}ms`);
console.log(`  vs MiniLM (10ms): ${(avgLatency / 10).toFixed(2)}x slower`);
console.log(`  vs q8 (84ms): ${(avgLatency / 84).toFixed(2)}x ${avgLatency > 84 ? 'SLOWER' : 'FASTER'}`);
console.log(`  Memory: ${(memUsage.rss / 1024 / 1024).toFixed(0)}MB RSS`);
console.log('='.repeat(70));
