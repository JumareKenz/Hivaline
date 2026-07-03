/**
 * test-bge-m3-q4-comparison.mjs - Compare q4 vs q8 quantization
 *
 * Measures:
 * 1. Cold model load time
 * 2. Warm inference latency
 * 3. Memory footprint
 * 4. Model size on disk
 * 5. Embedding quality (cosine similarity check)
 */

import { pipeline, env } from '@xenova/transformers';
import { readFileSync, statSync } from 'fs';

// Configure to use local models only
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.localModelPath = './public/models/';

console.log('=== bge-m3 q4 vs q8 Quantization Comparison ===\n');

// Test queries for recall/quality check
const testQueries = [
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

// Reference query for quality comparison
const referenceQuery = "What is the treatment for malaria?";

async function testModel(modelName, modelPath) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${modelName}`);
  console.log('='.repeat(60));

  // 1. Model size on disk
  try {
    const stats = statSync(`public/models/${modelPath}/onnx/model_quantized.onnx`);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
    console.log(`\n1. Model Size: ${sizeMB}MB`);
  } catch (err) {
    console.log(`\n1. Model Size: Unable to stat (${err.message})`);
  }

  // 2. Cold model load
  console.log('\n2. Cold Model Load:');
  const loadStart = performance.now();
  let model;
  try {
    model = await pipeline('feature-extraction', modelPath, {
      quantized: true,
    });
    const loadTime = performance.now() - loadStart;
    console.log(`   ✅ Loaded in ${loadTime.toFixed(0)}ms`);
  } catch (err) {
    console.error(`   ❌ FAILED: ${err.message}`);
    return null;
  }

  // 3. Verify dimensions with reference query
  console.log('\n3. Reference Embedding:');
  const refOutput = await model(referenceQuery, { pooling: 'cls', normalize: true });
  const refEmbedding = Array.from(refOutput.data);
  console.log(`   Dimensions: ${refEmbedding.length}`);
  console.log(`   Sample: [${refEmbedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);

  // 4. Warm inference latency
  console.log('\n4. Warm Inference Latency:');
  const latencies = [];
  for (const query of testQueries) {
    const start = performance.now();
    await model(query, { pooling: 'cls', normalize: true });
    const latency = performance.now() - start;
    latencies.push(latency);
  }

  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const minLatency = Math.min(...latencies);
  const maxLatency = Math.max(...latencies);

  console.log(`   Average: ${avgLatency.toFixed(1)}ms`);
  console.log(`   Min: ${minLatency.toFixed(1)}ms`);
  console.log(`   Max: ${maxLatency.toFixed(1)}ms`);

  // 5. Memory footprint
  const memUsage = process.memoryUsage();
  console.log('\n5. Memory Usage:');
  console.log(`   RSS: ${(memUsage.rss / 1024 / 1024).toFixed(1)}MB`);
  console.log(`   External: ${(memUsage.external / 1024 / 1024).toFixed(1)}MB`);

  return {
    modelName,
    modelPath,
    loadTime: performance.now() - loadStart,
    avgLatency,
    minLatency,
    maxLatency,
    memoryRSS: memUsage.rss,
    memoryExternal: memUsage.external,
    refEmbedding
  };
}

// Run tests
const q8Results = await testModel('bge-m3 (q8)', 'bge-m3');
const q4Results = await testModel('bge-m3 (q4)', 'bge-m3-q4');

// Comparison summary
if (q8Results && q4Results) {
  console.log('\n\n' + '='.repeat(60));
  console.log('COMPARISON SUMMARY');
  console.log('='.repeat(60));

  // Latency comparison
  const latencyRatio = q8Results.avgLatency / q4Results.avgLatency;
  const latencyDelta = q8Results.avgLatency - q4Results.avgLatency;
  console.log('\n📊 Inference Latency:');
  console.log(`   q8: ${q8Results.avgLatency.toFixed(1)}ms`);
  console.log(`   q4: ${q4Results.avgLatency.toFixed(1)}ms`);
  console.log(`   Improvement: ${latencyRatio.toFixed(2)}x faster (${latencyDelta.toFixed(1)}ms saved)`);

  // Memory comparison
  const memRatio = q8Results.memoryRSS / q4Results.memoryRSS;
  const memDelta = (q8Results.memoryRSS - q4Results.memoryRSS) / 1024 / 1024;
  console.log('\n💾 Memory Footprint (RSS):');
  console.log(`   q8: ${(q8Results.memoryRSS / 1024 / 1024).toFixed(1)}MB`);
  console.log(`   q4: ${(q4Results.memoryRSS / 1024 / 1024).toFixed(1)}MB`);
  console.log(`   Reduction: ${memRatio.toFixed(2)}x (${memDelta.toFixed(1)}MB saved)`);

  // Embedding similarity (quality check)
  console.log('\n🔍 Embedding Quality (Cosine Similarity):');
  const dotProduct = q8Results.refEmbedding.reduce((sum, v, i) =>
    sum + v * q4Results.refEmbedding[i], 0);
  const similarity = dotProduct; // Already normalized
  console.log(`   q8 vs q4 similarity: ${similarity.toFixed(4)}`);

  if (similarity > 0.99) {
    console.log(`   ✅ Embeddings are nearly identical (>0.99)`);
  } else if (similarity > 0.95) {
    console.log(`   ⚠️  Minor quality degradation (0.95-0.99)`);
  } else {
    console.log(`   ❌ Significant quality degradation (<0.95)`);
  }

  console.log('\n' + '='.repeat(60));
}

console.log('\n=== Test Complete ===');
