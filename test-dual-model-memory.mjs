/**
 * test-dual-model-memory.mjs - Test memory footprint with both models loaded
 *
 * Measures the critical dual-residency scenario flagged in prior tasks:
 * A user with both v2.2 and v2.3 bundles cached would have both models loaded
 */

import { pipeline, env } from '@xenova/transformers';

// Configure to use local models only
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.localModelPath = './public/models/';

console.log('=== Dual Model Memory Test ===\n');

// Baseline memory
const baseline = process.memoryUsage();
console.log('Baseline Memory (empty process):');
console.log(`   RSS: ${(baseline.rss / 1024 / 1024).toFixed(1)}MB`);
console.log(`   Heap: ${(baseline.heapUsed / 1024 / 1024).toFixed(1)}MB`);
console.log(`   External: ${(baseline.external / 1024 / 1024).toFixed(1)}MB\n`);

// Load MiniLM
console.log('Loading MiniLM (v2.2 model)...');
const loadStart1 = performance.now();
const miniLM = await pipeline('feature-extraction', 'embed', { quantized: true });
const loadTime1 = performance.now() - loadStart1;
console.log(`✅ MiniLM loaded in ${loadTime1.toFixed(0)}ms`);

const afterMiniLM = process.memoryUsage();
console.log('Memory after MiniLM:');
console.log(`   RSS: ${(afterMiniLM.rss / 1024 / 1024).toFixed(1)}MB (+${((afterMiniLM.rss - baseline.rss) / 1024 / 1024).toFixed(1)}MB)`);
console.log(`   External: ${(afterMiniLM.external / 1024 / 1024).toFixed(1)}MB (+${((afterMiniLM.external - baseline.external) / 1024 / 1024).toFixed(1)}MB)\n`);

// Load bge-m3
console.log('Loading bge-m3 (v2.3 model)...');
const loadStart2 = performance.now();
const bgeM3 = await pipeline('feature-extraction', 'bge-m3', { quantized: true });
const loadTime2 = performance.now() - loadStart2;
console.log(`✅ bge-m3 loaded in ${loadTime2.toFixed(0)}ms`);

const afterBoth = process.memoryUsage();
console.log('Memory after BOTH models:');
console.log(`   RSS: ${(afterBoth.rss / 1024 / 1024).toFixed(1)}MB (+${((afterBoth.rss - baseline.rss) / 1024 / 1024).toFixed(1)}MB total)`);
console.log(`   External: ${(afterBoth.external / 1024 / 1024).toFixed(1)}MB (+${((afterBoth.external - baseline.external) / 1024 / 1024).toFixed(1)}MB total)\n`);

// Calculate incremental cost of second model
const bgeM3Incremental = (afterBoth.rss - afterMiniLM.rss) / 1024 / 1024;
console.log(`bge-m3 incremental cost: +${bgeM3Incremental.toFixed(1)}MB on top of MiniLM`);

// Test that both models still work
console.log('\nVerifying both models functional:');
const testQuery = "Malaria treatment dosage";

const miniLMOutput = await miniLM(testQuery, { pooling: 'mean', normalize: true });
console.log(`✅ MiniLM: ${miniLMOutput.data.length}-dim embedding`);

const bgeM3Output = await bgeM3(testQuery, { pooling: 'cls', normalize: true });
console.log(`✅ bge-m3: ${bgeM3Output.data.length}-dim embedding`);

console.log('\n=== Summary ===');
console.log(`MiniLM alone: ${((afterMiniLM.rss - baseline.rss) / 1024 / 1024).toFixed(1)}MB`);
console.log(`bge-m3 alone (from first test): ~2169MB (estimated)`);
console.log(`Both models together: ${((afterBoth.rss - baseline.rss) / 1024 / 1024).toFixed(1)}MB`);
console.log(`\n⚠️  CRITICAL: Dual-model scenario adds ${bgeM3Incremental.toFixed(1)}MB on devices with mixed v2.2/v2.3 bundles`);
