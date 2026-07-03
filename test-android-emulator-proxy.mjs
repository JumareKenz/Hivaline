/**
 * test-android-emulator-proxy.mjs
 *
 * Simulates Android WebView ONNX Runtime behavior using Node.js
 * Tests all three quantization variants with identical methodology
 *
 * IMPORTANT CAVEATS:
 * - Running on x86_64 host, not ARM Android
 * - Results will be optimistic vs real ARM devices (2-4x faster expected)
 * - Uses ONNX Runtime WASM (same as Android WebView)
 * - Memory measurements approximate
 */

import { pipeline, env } from '@xenova/transformers';

const ADB = '/c/Users/INEWTON/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const DEVICE = 'emulator-5554';

// Configure same as Android WebView
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;  // Not available in Node.js
env.localModelPath = './public/models/';

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

console.log('='.repeat(80));
console.log('BGE-M3 QUANTIZATION TEST - x86 Android Emulator Proxy');
console.log('='.repeat(80));
console.log('\n⚠️  CRITICAL CAVEATS:');
console.log('- Running on x86_64 host CPU, NOT ARM Android');
console.log('- Real ARM devices expected to be 2-4x SLOWER');
console.log('- Memory measurements are approximations');
console.log('- XNNPACK execution provider NOT tested');
console.log('='.repeat(80));

// Get device info
console.log('\n📱 Device Information:');
try {
  const { execSync } = await import('child_process');
  const androidVersion = execSync(`${ADB} -s ${DEVICE} shell getprop ro.build.version.release`).toString().trim();
  const deviceModel = execSync(`${ADB} -s ${DEVICE} shell getprop ro.product.model`).toString().trim();
  const cpuAbi = execSync(`${ADB} -s ${DEVICE} shell getprop ro.product.cpu.abi`).toString().trim();

  console.log(`  Device: ${deviceModel}`);
  console.log(`  Android: ${androidVersion}`);
  console.log(`  CPU ABI: ${cpuAbi} ⚠️  (x86_64, not ARM!)`);
  console.log(`  RAM: 2GB`);
} catch (err) {
  console.log(`  Device info unavailable: ${err.message}`);
}

async function testModel(modelId, modelName) {
  console.log('\n' + '='.repeat(80));
  console.log(`TESTING: ${modelName} (${modelId})`);
  console.log('='.repeat(80));

  const startTime = Date.now();

  try {
    // 1. Cold load
    console.log('\n1️⃣  Cold Model Load...');
    const loadStart = performance.now();

    const model = await pipeline('feature-extraction', modelId, {
      quantized: true,
      progress_callback: (progress) => {
        if (progress.status === 'progress' && progress.progress !== undefined) {
          process.stdout.write(`\r   Loading: ${progress.file} (${Math.round(progress.progress)}%)`);
        }
      }
    });

    const loadTime = performance.now() - loadStart;
    console.log(`\n   ✅ Loaded in ${loadTime.toFixed(0)}ms (${(loadTime/1000).toFixed(1)}s)`);

    // 2. Verify output
    console.log('\n2️⃣  Verifying Output...');
    const refOutput = await model(referenceQuery, { pooling: 'cls', normalize: true });
    const embedding = Array.from(refOutput.data);
    const dims = embedding.length;

    if (dims !== 1024) {
      throw new Error(`Wrong dimensions: ${dims} (expected 1024)`);
    }

    console.log(`   ✅ Dimensions: ${dims}`);
    console.log(`   Sample: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);

    // 3. Warm inference
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

    // 4. Memory
    const memUsage = process.memoryUsage();
    console.log('\n4️⃣  Memory Usage:');
    console.log(`   RSS: ${(memUsage.rss / 1024 / 1024).toFixed(1)}MB`);
    console.log(`   Heap: ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)}MB`);
    console.log(`   External: ${(memUsage.external / 1024 / 1024).toFixed(1)}MB`);

    // Calculate multipliers
    const vsMinilm = (avgLatency / 10).toFixed(2);
    const vsQ8 = (avgLatency / 84).toFixed(2);

    // Summary
    console.log('\n' + '-'.repeat(80));
    console.log('📈 RESULTS SUMMARY:');
    console.log('-'.repeat(80));
    console.log(`Model: ${modelName}`);
    console.log(`Cold Load: ${loadTime.toFixed(0)}ms (${(loadTime/1000).toFixed(1)}s)`);
    console.log(`Avg Latency: ${avgLatency.toFixed(1)}ms`);
    console.log(`  vs MiniLM (10ms): ${vsMinilm}x slower`);
    console.log(`  vs q8 (84ms): ${vsQ8}x ${avgLatency > 84 ? 'SLOWER ⚠️' : 'FASTER ✅'}`);
    console.log(`Memory: ${(memUsage.rss / 1024 / 1024).toFixed(0)}MB RSS`);
    console.log(`Total Test Time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    console.log('-'.repeat(80));

    return {
      success: true,
      modelName,
      coldLoad: loadTime,
      avgLatency,
      minLatency,
      maxLatency,
      memoryRSS: memUsage.rss,
      memoryHeap: memUsage.heapUsed,
      memoryExternal: memUsage.external,
      vsMinilm,
      vsQ8,
      totalTime: Date.now() - startTime
    };

  } catch (error) {
    console.log('\n' + '-'.repeat(80));
    console.log('❌ TEST FAILED:');
    console.log('-'.repeat(80));
    console.log(`Model: ${modelName}`);
    console.log(`Error: ${error.message}`);
    console.log(`Time before failure: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    console.log('-'.repeat(80));

    return {
      success: false,
      modelName,
      error: error.message,
      timeBeforeFailure: Date.now() - startTime
    };
  }
}

// Run all tests
const results = {};

results.q8 = await testModel('bge-m3', 'q8 (int8, 560MB)');
results.q4f16 = await testModel('bge-m3-q4f16', 'q4f16 (hybrid, 668MB)');
results.q4 = await testModel('bge-m3-q4', 'q4 (full, 1.2GB)');

// Final summary
console.log('\n\n' + '='.repeat(80));
console.log('🏁 FINAL SUMMARY - All Tests Complete');
console.log('='.repeat(80));

const successful = Object.values(results).filter(r => r.success);
const failed = Object.values(results).filter(r => !r.success);

console.log(`\n✅ Successful: ${successful.length}`);
console.log(`❌ Failed: ${failed.length}`);

if (successful.length > 0) {
  console.log('\n📊 Comparison Table (Successful Tests):');
  console.log('-'.repeat(80));
  console.log('Model         | Avg Latency | vs MiniLM | vs q8   | Memory | Cold Load');
  console.log('-'.repeat(80));

  successful.forEach(r => {
    const faster = parseFloat(r.vsQ8) < 1.0 ? '✅' : '⚠️';
    console.log(
      `${r.modelName.padEnd(13)} | ` +
      `${r.avgLatency.toFixed(1).padStart(11)}ms | ` +
      `${r.vsMinilm}x     | ` +
      `${r.vsQ8}x ${faster} | ` +
      `${(r.memoryRSS / 1024 / 1024).toFixed(0).padStart(4)}MB | ` +
      `${(r.coldLoad / 1000).toFixed(1)}s`
    );
  });
  console.log('-'.repeat(80));
}

if (failed.length > 0) {
  console.log('\n❌ Failed Tests:');
  failed.forEach(r => {
    console.log(`  ${r.modelName}: ${r.error}`);
  });
}

console.log('\n⚠️  REMINDER: These are x86 emulator results.');
console.log('⚠️  Real ARM Android devices expected to be 2-4x SLOWER.');
console.log('='.repeat(80));
