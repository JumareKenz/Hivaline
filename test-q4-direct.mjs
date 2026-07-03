/**
 * test-q4-direct.mjs - Direct test of q4 model
 */

import { pipeline, env, AutoTokenizer, AutoModel } from '@xenova/transformers';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.localModelPath = './public/models/';

console.log('Testing q4 model load...\n');

try {
  console.log('Attempting to load tokenizer from bge-m3-q4...');
  const tokenizer = await AutoTokenizer.from_pretrained('bge-m3-q4');
  console.log('✅ Tokenizer loaded');

  console.log('Attempting to load model from bge-m3-q4...');
  const model = await AutoModel.from_pretrained('bge-m3-q4', {
    quantized: true,
  });
  console.log('✅ Model loaded');

  // Test inference
  const inputs = tokenizer('What is the treatment for malaria?');
  console.log('✅ Tokenized input');

  const outputs = await model(inputs);
  console.log('✅ Model inference complete');
  console.log(`Output shape: ${outputs.last_hidden_state.dims}`);

} catch (err) {
  console.error('❌ Error:', err.message);
  console.error('Stack:', err.stack);
  process.exit(1);
}
