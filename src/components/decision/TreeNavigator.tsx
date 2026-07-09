/**
 * TreeNavigator — progress bar + breadcrumbs + back nav
 */

import React from 'react';
import type { DecisionTreeData } from '@/services/hivDataExtractor';

interface TreeNavigatorProps {
  tree: DecisionTreeData;
  history: string[];
}

const TreeNavigator: React.FC<TreeNavigatorProps> = ({ tree, history }) => {
  const totalNodes = Object.keys(tree.nodes).length;
  const progress = Math.min((history.length / (totalNodes * 0.6)) * 100, 100);

  return (
    <div className="px-4 py-3 space-y-3">
      {/* Progress bar */}
      <div className="w-full h-1 bg-n-200 dark:bg-n-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-accent-500 rounded-full transition-all duration-500 ease-smooth"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Step counter */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-mono text-n-500">
          Step {history.length + 1}
        </p>
        <p className="text-xs font-body text-n-400">
          {tree.name}
        </p>
      </div>

      {/* Breadcrumbs */}
      {history.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {history.map((nodeId, i) => {
            const node = tree.nodes[nodeId];
            const label = node?.question
              ? node.question.slice(0, 20) + '...'
              : nodeId;
            return (
              <span
                key={`${nodeId}-${i}`}
                className="px-2 py-0.5 rounded-md bg-n-100 dark:bg-n-800 text-[10px] font-body text-n-500 truncate max-w-[100px]"
              >
                {label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
};

export { TreeNavigator };
