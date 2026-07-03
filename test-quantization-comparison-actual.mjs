/**
 * test-quantization-comparison-actual.mjs
 *
 * ACTUAL EMPIRICAL MEASUREMENT of q8 vs q4 vs q4f16 quantization variants.
 * Uses identical methodology for all three to enable direct comparison.
 */

import { pipeline, env } from '@xenova/transformers';

// Configure to use local models only
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.localModelPath = './public/models/';

// EXACT same test queries used in q8 baseline measurement
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

async function testModelVariant(modelName, modelPath) {
  console.log('\n' + '='.repeat(70));
  console.log(`TESTING: ${modelName}`);
  console.log('='.repeat(70));

  try {
    // 1. Cold model load
    console.log('\n1. Cold Model Load:');
    const loadStart = performance.now();
    const model = await pipeline('feature-extraction', modelPath, {
      quantized: true,
    });
    const loadTime = performance.now() - loadStart;
    console.log(`   ✅ Loaded in ${loadTime.toFixed(0)}ms`);

    // 2. Verify dimensions with reference query
    console.log('\n2. Verify Output:');
    const refOutput = await model(referenceQuery, { pooling: 'cls', normalize: true });
    const embedding = refOutput.data;
    const dims = embedding.length;
    console.log(`   Dimensions: ${dims} (expected 1024)`);
    console.log(`   Sample: [${Array.from(embedding).slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);

    if (dims !== 1024) {
      console.error(`   ❌ WRONG DIMENSIONS: ${dims} instead of 1024`);
      return null;
    }

    // 3. Warm inference latency (EXACT same 10 queries as baseline)
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

    // 4. Memory footprint
    const memUsage = process.memoryUsage();
    console.log('\n4. Memory Usage:');
    console.log(`   RSS: ${(memUsage.rss / 1024 / 1024).toFixed(1)}MB`);
    console.log(`   Heap Used: ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)}MB`);
    console.log(`   External: ${(memUsage.external / 1024 / 1024).toFixed(1)}MB`);

    return {
      modelName,
      modelPath,
      loadTime,
      avgLatency,
      minLatency,
      maxLatency,
      memoryRSS: memUsage.rss,
      memoryHeap: memUsage.heapUsed,
      memoryExternal: memUsage.external,
      embedding: Array.from(embedding)
    };

  } catch (err) {
    console.error(`\n❌ FAILED: ${err.message}`);
    console.error(`Stack: ${err.stack}`);
    return null;
  }
}

console.log('='.repeat(70));
console.log('QUANTIZATION COMPARISON - ACTUAL MEASUREMENTS');
console.log('='.repeat(70));
console.log('\nBaseline (from prior test):');
console.log('  MiniLM: 10ms average (baseline)');
console.log('  bge-m3 q8: 79ms average (8.1x slower)');
console.log('\nTesting q4 variants now...\n');

// Test each variant
const results = {};

// Test 1: q8 (re-run for consistency check)
console.log('\n### RE-TESTING q8 BASELINE FOR CONSISTENCY ###');
results.q8 = await testModelVariant('bge-m3 q8 (int8)', 'bge-m3');

// Test 2: q4f16
console.log('\n### TESTING q4f16 VARIANT ###');
results.q4f16 = await testModelVariant('bge-m3 q4f16', 'bge-m3-q4f16');

// Test 3: q4
console.log('\n### TESTING q4 VARIANT ###');
results.q4 = await testModelVariant('bge-m3 q4', 'bge-m3-q4');

// Summary comparison
console.log('\n\n' + '='.repeat(70));
console.log('SUMMARY - ACTUAL MEASURED RESULTS');
console.log('='.repeat(70));

const minilmBaseline = 10.0; // from prior measurement

if (results.q8) {
  console.log('\n📊 q8 (int8) - 544MB:');
  console.log(`   Avg latency: ${results.q8.avgLatency.toFixed(1)}ms`);
  console.log(`   vs MiniLM: ${(results.q8.avgLatency / minilmBaseline).toFixed(2)}x slower`);
  console.log(`   Memory RSS: ${(results.q8.memoryRSS / 1024 / 1024).toFixed(1)}MB`);
}

if (results.q4f16) {
  console.log('\n📊 q4f16 - 668MB:');
  console.log(`   Avg latency: ${results.q4f16.avgLatency.toFixed(1)}ms`);
  console.log(`   vs MiniLM: ${(results.q4f16.avgLatency / minilmBaseline).toFixed(2)}x slower`);
  console.log(`   vs q8: ${(results.q4f16.avgLatency / results.q8.avgLatency).toFixed(2)}x ${results.q4f16.avgLatency > results.q8.avgLatency ? 'SLOWER' : 'FASTER'}`);
  console.log(`   Memory RSS: ${(results.q4f16.memoryRSS / 1024 / 1024).toFixed(1)}MB`);
} else {
  console.log('\n📊 q4f16 - FAILED TO LOAD');
}

if (results.q4) {
  console.log('\n📊 q4 - 1,190MB:');
  console.log(`   Avg latency: ${results.q4.avgLatency.toFixed(1)}ms`);
  console.log(`   vs MiniLM: ${(results.q4.avgLatency / minilmBaseline).toFixed(2)}x slower`);
  console.log(`   vs q8: ${(results.q4.avgLatency / results.q8.avgLatency).toFixed(2)}x ${results.q4.avgLatency > results.q8.avgLatency ? 'SLOWER' : 'FASTER'}`);
  console.log(`   Memory RSS: ${(results.q4.memoryRSS / 1024 / 1024).toFixed(1)}MB`);
} else {
  console.log('\n📊 q4 - FAILED TO LOAD');
}

// Embedding quality check (cosine similarity)
if (results.q8 && results.q4f16) {
  const dotProduct = results.q8.embedding.reduce((sum, v, i) =>
    sum + v * results.q4f16.embedding[i], 0);
  console.log(`\n🔍 Embedding Quality (q8 vs q4f16 similarity): ${dotProduct.toFixed(4)}`);
}

if (results.q8 && results.q4) {
  const dotProduct = results.q8.embedding.reduce((sum, v, i) =>
    sum + v * results.q4.embedding[i], 0);
  console.log(`🔍 Embedding Quality (q8 vs q4 similarity): ${dotProduct.toFixed(4)}`);
}

console.log('\n' + '='.repeat(70));
console.log('TEST COMPLETE - ACTUAL MEASUREMENTS RECORDED');
console.log('='.repeat(70));
