/**
 * test-bge-m3-load.mjs - Test bge-m3 model loading and basic inference
 *
 * Verifies:
 * 1. Model loads without error
 * 2. Produces 1024-dim embeddings
 * 3. Measures cold load time
 * 4. Measures warm inference latency
 */

import { pipeline, env } from '@xenova/transformers';

// Configure to use local models only
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;  // Disable cache for true cold load test
env.localModelPath = './public/models/';

console.log('=== bge-m3 Model Load Test ===\n');

// Test 1: Cold model load
console.log('Test 1: Cold Model Load');
const loadStart = performance.now();
let model;
try {
  model = await pipeline('feature-extraction', 'bge-m3', {
    quantized: true,
  });
  const loadTime = performance.now() - loadStart;
  console.log(`✅ Model loaded successfully in ${loadTime.toFixed(0)}ms`);
} catch (err) {
  console.error(`❌ Model load FAILED:`, err.message);
  process.exit(1);
}

// Test 2: Verify output dimensions
console.log('\nTest 2: Verify Output Dimensions');
const testQuery = "What is the treatment for malaria?";
try {
  const embedStart = performance.now();
  const output = await model(testQuery, { pooling: 'cls', normalize: true });
  const embedTime = performance.now() - embedStart;

  const embedding = output.data;
  const dims = embedding.length;

  if (dims === 1024) {
    console.log(`✅ Correct dimensions: ${dims}-dim (expected 1024)`);
  } else {
    console.error(`❌ Wrong dimensions: ${dims}-dim (expected 1024)`);
    process.exit(1);
  }

  console.log(`   First inference time: ${embedTime.toFixed(1)}ms`);
  console.log(`   Sample values: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);
} catch (err) {
  console.error(`❌ Inference FAILED:`, err.message);
  process.exit(1);
}

// Test 3: Warm inference latency (average over 10 runs)
console.log('\nTest 3: Warm Inference Latency');
const queries = [
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

const latencies = [];
for (const query of queries) {
  const start = performance.now();
  await model(query, { pooling: 'cls', normalize: true });
  const latency = performance.now() - start;
  latencies.push(latency);
}

const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
const minLatency = Math.min(...latencies);
const maxLatency = Math.max(...latencies);

console.log(`   Average latency: ${avgLatency.toFixed(1)}ms`);
console.log(`   Min latency: ${minLatency.toFixed(1)}ms`);
console.log(`   Max latency: ${maxLatency.toFixed(1)}ms`);

// Test 4: Memory footprint (approximate)
const memUsage = process.memoryUsage();
console.log('\nTest 4: Memory Usage (Node.js process)');
console.log(`   RSS: ${(memUsage.rss / 1024 / 1024).toFixed(1)}MB`);
console.log(`   Heap Used: ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)}MB`);
console.log(`   External: ${(memUsage.external / 1024 / 1024).toFixed(1)}MB`);

console.log('\n=== All Tests Passed ===');
