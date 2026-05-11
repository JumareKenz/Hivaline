/**
 * DecisionTreeScreen — interactive protocol walker
 */

import React, { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';
import { useHIVFile } from '@/hooks/useHIVFile';
import { getTreeById } from '@/services/hivDataExtractor';
import { useRouter } from '@/router/useRouter';
import { TopBar } from '@/components/ui/TopBar';
import { TreeNode } from './TreeNode';
import { TreeNavigator } from './TreeNavigator';

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 100 : -100,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 100 : -100,
    opacity: 0,
  }),
};

const DecisionTreeScreen: React.FC = () => {
  const { params, goBack } = useRouter();
  const { file } = useHIVFile();
  const tree = useMemo(() => getTreeById(file, params.id ?? ''), [file, params.id]);

  const [currentNodeId, setCurrentNodeId] = useState(tree?.entryNode ?? '');
  const [history, setHistory] = useState<string[]>([]);
  const [direction, setDirection] = useState(1);

  const currentNode = useMemo(() => tree?.nodes[currentNodeId], [tree, currentNodeId]);

  const handleSelect = useCallback((nextId: string) => {
    setDirection(1);
    setHistory((prev) => [...prev, currentNodeId]);
    setCurrentNodeId(nextId);
  }, [currentNodeId]);

  const handleBack = useCallback(() => {
    if (history.length === 0) {
      goBack();
      return;
    }
    setDirection(-1);
    setHistory((prev) => {
      const newHistory = prev.slice(0, -1);
      const previousNode = newHistory[newHistory.length - 1] ?? tree?.entryNode ?? '';
      setCurrentNodeId(previousNode);
      return newHistory;
    });
  }, [history, goBack, tree]);

  if (!tree || !currentNode) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6">
        <p className="font-body text-n-500">Protocol not found.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-bg-secondary">
      <TopBar
        title={tree.name}
        showBack
      />

      <TreeNavigator
        tree={tree}
        history={history}
      />

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={currentNodeId}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          >
            <TreeNode
              node={currentNode}
              onSelect={handleSelect}
            />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Back button */}
      {history.length > 0 && (
        <div className="px-4 py-3 border-t border-border-subtle">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center gap-1.5 text-sm font-body font-medium text-n-500 hover:text-n-800 dark:hover:text-n-200 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>
        </div>
      )}
    </div>
  );
};

export default DecisionTreeScreen;
