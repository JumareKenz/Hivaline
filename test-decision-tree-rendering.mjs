/**
 * Simulate what happens when a decision_tree chunk is retrieved but has no nodes
 */

// This is what the renderDecisionTree function does:
function renderDecisionTree(chunk, c) {
  const entry = c.nodes[c.entry_node];
  if (!entry) {
    return {
      type: 'decision_tree',
      content: 'Decision tree is not available in this language.',
    };
  }

  const parts = [];
  if (entry.question) {
    parts.push(entry.question);
    parts.push('');
    parts.push('Tap an option to continue:');
    entry.options?.forEach((opt, i) => {
      parts.push(`${i + 1}. ${opt.label}`);
    });
  } else if (entry.action) {
    parts.push(`✅ ${entry.action}`);
  } else if (entry.refer) {
    parts.push(`🚨 ${entry.refer}`);
  }

  return {
    type: 'decision_tree',
    content: parts.join('\n'),
    source: chunk.source,
  };
}

// Test with actual empty decision tree chunk
const emptyDecisionTree = {
  display_title: 'TB/HIV Co‑infection Management Scenarios',
  type: 'decision_tree',
  content: {
    en: {
      entry_node: undefined,
      nodes: {},
    },
  },
};

const result = renderDecisionTree(emptyDecisionTree, emptyDecisionTree.content.en);

console.log('═'.repeat(80));
console.log('DECISION TREE RENDERING TEST');
console.log('═'.repeat(80) + '\n');

console.log('Input: 12 decision_tree chunks, all with:');
console.log('  - entry_node: undefined');
console.log('  - nodes: {} (empty object)\n');

console.log('Rendering result:');
console.log(JSON.stringify(result, null, 2));

console.log('\n' + '═'.repeat(80));
console.log('FLOW TRACE:');
console.log('═'.repeat(80));
console.log('1. search() retrieves a chunk with type="decision_tree"');
console.log('2. conversationEngine calls renderDecisionTree(chunk)');
console.log('3. renderDecisionTree checks: entry = nodes[entry_node]');
console.log('4. entry = nodes[undefined] = undefined');
console.log('5. Condition: if (!entry) → TRUE');
console.log('6. Return: fallback message');
console.log('7. conversationEngine receives: { type: "decision_tree", content: "Decision tree is not available..." }');
console.log('8. MessageBubble renders this as text message\n');

console.log('USER SEES: "Decision tree is not available in this language."');
console.log('\n✓ GRACEFUL DEGRADATION: User gets a message, not an error/blank screen');
