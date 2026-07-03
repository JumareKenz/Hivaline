/**
 * test-physical-android.mjs
 *
 * Final measurement: bge-m3 q8 on PHYSICAL ARM Android device
 * This is the definitive test - real hardware, real performance
 *
 * Device: Xiaomi Redmi Note 14 Pro (25040RP0AL)
 * Chipset: ARM64-v8a, 8 cores
 * RAM: 4GB (3.7GB usable)
 * Android: 15
 *
 * This test will:
 * 1. Measure q8 cold load + warm inference (same methodology as prior tests)
 * 2. Test dual-model residency (bge-m3 + MiniLM simultaneously loaded)
 * 3. Report actual memory pressure and OOM behavior
 * 4. Compare to emulator (x86) and sandbox (Windows) baselines
 */

import { pipeline, env } from '@xenova/transformers';

// Same test queries as all prior measurements
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

const referenceQuery = "What is the treatment for malaria?";

// Configure for local models
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.localModelPath = './public/models/';

console.log('='.repeat(80));
console.log('BGE-M3 Q8 - PHYSICAL ARM ANDROID DEVICE - FINAL MEASUREMENT');
console.log('='.repeat(80));
console.log('\n📱 Device: Xiaomi Redmi Note 14 Pro');
console.log('   Chipset: ARM64-v8a (8 cores)');
console.log('   RAM: 4GB');
console.log('   Android: 15');
console.log('\n🎯 This is the REAL test - actual target hardware class');
console.log('='.repeat(80));

// Test 1: q8 single model
console.log('\n\n' + '='.repeat(80));
console.log('TEST 1: bge-m3 q8 (SINGLE MODEL)');
console.log('='.repeat(80));

const startTime = Date.now();

try {
  // Cold load
  console.log('\n1️⃣  Cold Model Load...');
  const loadStart = performance.now();

  const model = await pipeline('feature-extraction', 'bge-m3', {
    quantized: true,
    progress_callback: (progress) => {
      if (progress.status === 'progress' && progress.progress !== undefined) {
        process.stdout.write(`\r   Loading: ${progress.file} (${Math.round(progress.progress)}%)`);
      }
    }
  });

  const loadTime = performance.now() - loadStart;
  console.log(`\n   ✅ Loaded in ${loadTime.toFixed(0)}ms (${(loadTime/1000).toFixed(1)}s)`);

  // Verify output
  console.log('\n2️⃣  Verifying Output...');
  const refOutput = await model(referenceQuery, { pooling: 'cls', normalize: true });
  const embedding = Array.from(refOutput.data);
  const dims = embedding.length;

  if (dims !== 1024) {
    throw new Error(`Wrong dimensions: ${dims} (expected 1024)`);
  }

  console.log(`   ✅ Dimensions: ${dims}`);
  console.log(`   Sample: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);

  // Warm inference
  console.log('\n3️⃣  Warm Inference Latency (10 queries)...');
  const latencies = [];

  for (let i = 0; i < testQueries.length; i++) {
    const query = testQueries[i];
    const start = performance.now();
    await model(query, { pooling: 'cls', normalize: true });
    const latency = performance.now() - start;
    latencies.push(latency);
    console.log(`   Query ${i+1}: ${latency.toFixed(1)}ms`);
  }

  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const minLatency = Math.min(...latencies);
  const maxLatency = Math.max(...latencies);

  console.log(`\n   📊 Average: ${avgLatency.toFixed(1)}ms`);
  console.log(`   📊 Min: ${minLatency.toFixed(1)}ms`);
  console.log(`   📊 Max: ${maxLatency.toFixed(1)}ms`);

  // Memory
  const memUsage = process.memoryUsage();
  console.log('\n4️⃣  Memory Usage:');
  console.log(`   RSS: ${(memUsage.rss / 1024 / 1024).toFixed(1)}MB`);
  console.log(`   Heap: ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)}MB`);
  console.log(`   External: ${(memUsage.external / 1024 / 1024).toFixed(1)}MB`);

  // Comparisons
  const vsMinilm = (avgLatency / 10).toFixed(2);
  const vsQ8Sandbox = (avgLatency / 84).toFixed(2);
  const vsQ8Emulator = (avgLatency / 90.9).toFixed(2);

  console.log('\n' + '='.repeat(80));
  console.log('📈 SINGLE MODEL RESULTS:');
  console.log('='.repeat(80));
  console.log(`Cold Load: ${loadTime.toFixed(0)}ms (${(loadTime/1000).toFixed(1)}s)`);
  console.log(`Avg Latency: ${avgLatency.toFixed(1)}ms`);
  console.log(`  vs MiniLM baseline (10ms): ${vsMinilm}x slower`);
  console.log(`  vs q8 sandbox/Windows (84ms): ${vsQ8Sandbox}x`);
  console.log(`  vs q8 emulator/x86 (90.9ms): ${vsQ8Emulator}x`);
  console.log(`Memory RSS: ${(memUsage.rss / 1024 / 1024).toFixed(0)}MB`);
  console.log('='.repeat(80));

  // Save results for dual-model test
  const singleModelResults = {
    loadTime,
    avgLatency,
    minLatency,
    maxLatency,
    memoryRSS: memUsage.rss,
    memoryHeap: memUsage.heapUsed,
    vsMinilm,
    vsQ8Sandbox,
    vsQ8Emulator
  };

  // Test 2: Dual-model residency
  console.log('\n\n' + '='.repeat(80));
  console.log('TEST 2: DUAL-MODEL RESIDENCY (bge-m3 + MiniLM)');
  console.log('='.repeat(80));
  console.log('\nℹ️  bge-m3 q8 already loaded from Test 1');
  console.log('   Now loading MiniLM v2.2 to test dual-residency...\n');

  try {
    const minilmLoadStart = performance.now();
    const minilmModel = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true,
      progress_callback: (progress) => {
        if (progress.status === 'progress' && progress.progress !== undefined) {
          process.stdout.write(`\r   Loading MiniLM: ${progress.file} (${Math.round(progress.progress)}%)`);
        }
      }
    });
    const minilmLoadTime = performance.now() - minilmLoadStart;
    console.log(`\n   ✅ MiniLM loaded in ${minilmLoadTime.toFixed(0)}ms`);

    // Test both models work
    console.log('\n   Testing both models...');
    const bgeTest = await model("Test query for bge-m3", { pooling: 'cls', normalize: true });
    console.log(`   ✅ bge-m3: ${Array.from(bgeTest.data).length} dims`);

    const minilmTest = await minilmModel("Test query for MiniLM", { pooling: 'mean', normalize: true });
    console.log(`   ✅ MiniLM: ${Array.from(minilmTest.data).length} dims`);

    // Memory with both loaded
    const dualMemUsage = process.memoryUsage();
    console.log('\n   📊 Memory with BOTH models loaded:');
    console.log(`   RSS: ${(dualMemUsage.rss / 1024 / 1024).toFixed(1)}MB`);
    console.log(`   Heap: ${(dualMemUsage.heapUsed / 1024 / 1024).toFixed(1)}MB`);
    console.log(`   External: ${(dualMemUsage.external / 1024 / 1024).toFixed(1)}MB`);

    const memoryIncrease = (dualMemUsage.rss - memUsage.rss) / 1024 / 1024;
    console.log(`\n   📊 Memory increase from adding MiniLM: ${memoryIncrease.toFixed(1)}MB`);
    console.log(`   📊 Total dual-model footprint: ${(dualMemUsage.rss / 1024 / 1024).toFixed(0)}MB`);

    // Check if within 4GB device limit
    const deviceRAM = 3893332 / 1024; // From device specs (in MB)
    const memoryPercent = (dualMemUsage.rss / 1024 / 1024) / deviceRAM * 100;
    console.log(`\n   📊 Device RAM: ${deviceRAM.toFixed(0)}MB`);
    console.log(`   📊 Usage: ${memoryPercent.toFixed(1)}% of device RAM`);

    if (dualMemUsage.rss / 1024 / 1024 < deviceRAM * 0.8) {
      console.log('   ✅ DUAL-MODEL VIABLE: Fits within device memory with headroom');
    } else if (dualMemUsage.rss / 1024 / 1024 < deviceRAM) {
      console.log('   ⚠️  DUAL-MODEL MARGINAL: Fits but with little headroom, OOM risk');
    } else {
      console.log('   ❌ DUAL-MODEL NOT VIABLE: Exceeds device RAM');
    }

    console.log('\n' + '='.repeat(80));
    console.log('📈 DUAL-MODEL RESULTS:');
    console.log('='.repeat(80));
    console.log(`Single model (bge-m3 only): ${(memUsage.rss / 1024 / 1024).toFixed(0)}MB`);
    console.log(`Dual model (bge-m3 + MiniLM): ${(dualMemUsage.rss / 1024 / 1024).toFixed(0)}MB`);
    console.log(`MiniLM overhead: ${memoryIncrease.toFixed(0)}MB`);
    console.log(`Device capacity: ${deviceRAM.toFixed(0)}MB (${memoryPercent.toFixed(1)}% used)`);
    console.log('='.repeat(80));

  } catch (dualModelError) {
    console.log('\n❌ DUAL-MODEL TEST FAILED:');
    console.log(`   Error: ${dualModelError.message}`);
    console.log('   This likely indicates OOM or resource constraints');
  }

  // Final summary
  console.log('\n\n' + '='.repeat(80));
  console.log('🏁 FINAL SUMMARY - Physical ARM Android Device');
  console.log('='.repeat(80));
  console.log('\n📱 Device: Xiaomi Redmi Note 14 Pro (4GB RAM, ARM64)');
  console.log('\n📊 q8 Performance:');
  console.log(`   Cold Load: ${(loadTime/1000).toFixed(1)}s`);
  console.log(`   Avg Latency: ${avgLatency.toFixed(1)}ms (${vsMinilm}x vs MiniLM)`);
  console.log(`   Memory: ${(memUsage.rss / 1024 / 1024).toFixed(0)}MB`);

  console.log('\n📊 Cross-Environment Comparison:');
  console.log('   Environment              | Avg Latency | vs MiniLM | Memory');
  console.log('   '.padEnd(80, '-'));
  console.log(`   Windows/Node.js sandbox  | 84.0ms      | 8.4x      | 2,190MB`);
  console.log(`   x86 Android emulator     | 90.9ms      | 9.1x      | 2,169MB`);
  console.log(`   ARM Android REAL DEVICE  | ${avgLatency.toFixed(1)}ms${' '.repeat(Math.max(0, 7 - avgLatency.toFixed(1).length))} | ${vsMinilm}x${' '.repeat(Math.max(0, 6 - vsMinilm.length))} | ${(memUsage.rss / 1024 / 1024).toFixed(0)}MB`);

  console.log('\n📊 Emulator Projection Accuracy:');
  const emulatorProjectedMin = 90.9 * 2; // 2x projection
  const emulatorProjectedMax = 90.9 * 4; // 4x projection
  console.log(`   Emulator measured: 90.9ms`);
  console.log(`   Emulator projected (2-4x): ${emulatorProjectedMin.toFixed(1)}-${emulatorProjectedMax.toFixed(1)}ms`);
  console.log(`   ARM actual: ${avgLatency.toFixed(1)}ms`);

  if (avgLatency < emulatorProjectedMin) {
    console.log(`   ✅ Projection was PESSIMISTIC (real device faster than 2x)`);
  } else if (avgLatency <= emulatorProjectedMax) {
    console.log(`   ✅ Projection was ACCURATE (within 2-4x range)`);
  } else {
    console.log(`   ⚠️  Projection was OPTIMISTIC (real device worse than 4x)`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('🎯 SHIP/NO-SHIP VERDICT:');
  console.log('='.repeat(80));

  // Decision logic
  const isAcceptableLatency = avgLatency <= 50; // 50ms = 5x MiniLM, generous threshold
  const isAcceptableMemory = memUsage.rss / 1024 / 1024 < 2500; // Under 2.5GB

  console.log(`\nLatency: ${avgLatency.toFixed(1)}ms (${isAcceptableLatency ? '✅ ACCEPTABLE' : '❌ TOO SLOW'})`);
  console.log(`  Threshold: ≤50ms (5x MiniLM baseline)`);
  console.log(`  Actual: ${vsMinilm}x MiniLM`);

  console.log(`\nMemory: ${(memUsage.rss / 1024 / 1024).toFixed(0)}MB (${isAcceptableMemory ? '✅ ACCEPTABLE' : '❌ TOO HIGH'})`);
  console.log(`  Threshold: ≤2,500MB for 4GB devices`);

  if (isAcceptableLatency && isAcceptableMemory) {
    console.log('\n✅ VERDICT: **SHIP** - bge-m3 q8 is viable on target hardware');
  } else {
    console.log('\n❌ VERDICT: **DO NOT SHIP** - Performance not acceptable for target hardware');
    if (!isAcceptableLatency) {
      console.log(`   Reason: ${avgLatency.toFixed(1)}ms latency = ${vsMinilm}x slower than MiniLM baseline`);
      console.log('   Impact: User experience will be noticeably degraded');
    }
    if (!isAcceptableMemory) {
      console.log(`   Reason: ${(memUsage.rss / 1024 / 1024).toFixed(0)}MB exceeds acceptable footprint`);
      console.log('   Impact: OOM risk on lower-end devices, resource pressure');
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`Total test time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log('='.repeat(80));

} catch (error) {
  console.log('\n' + '='.repeat(80));
  console.log('❌ TEST FAILED');
  console.log('='.repeat(80));
  console.log(`Error: ${error.message}`);
  console.log(`Stack: ${error.stack}`);
  console.log(`Time before failure: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log('='.repeat(80));
  process.exit(1);
}
