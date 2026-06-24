// Quick test - just check compilation
console.log('Testing pattern routing...');

const queries = [
  "What is the capital of Nigeria?",
  "Diabetes management",
  "Signs of ART treatment failure",
  "How long is IPT?",
  "What is PMTCT?",
];

import { isOutOfScope } from './src/engine/queryPatternRouter.ts';

for (const q of queries) {
  console.log(`"${q}" -> out of scope: ${isOutOfScope(q)}`);
}

console.log('Pattern routing loaded successfully!');
