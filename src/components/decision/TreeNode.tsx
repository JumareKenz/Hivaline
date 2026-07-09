/**
 * TreeNode — individual question/answer node renderer
 */

import React, { useCallback } from 'react';
import { clsx } from 'clsx';
import { motion } from 'framer-motion';
import { Check, X, ArrowRight, AlertTriangle, Pill } from 'lucide-react';
import type { TreeNode as TreeNodeType } from '@/types/hiv';
import { useRouter } from '@/router/useRouter';

interface TreeNodeProps {
  node: TreeNodeType;
  onSelect: (nextId: string) => void;
}

const TreeNodeComponent: React.FC<TreeNodeProps> = ({ node, onSelect }) => {
  const { navigate } = useRouter();

  const handleOption = useCallback((nextId: string) => {
    onSelect(nextId);
  }, [onSelect]);

  const handleViewDrug = useCallback(() => {
    if (node.linkedDrug) {
      navigate(`/drug-table/${node.linkedDrug}`);
    }
  }, [navigate, node.linkedDrug]);

  if (node.type === 'branch') {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <h2 className="font-display font-semibold text-xl text-n-900 dark:text-n-100 leading-relaxed">
            {node.question}
          </h2>
          {node.hint && (
            <p className="font-body text-sm text-n-500 italic">{node.hint}</p>
          )}
        </div>

        <div className="space-y-3">
          {node.options?.map((option) => (
            <motion.button
              key={option.id}
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={() => handleOption(option.next)}
              className={clsx(
                'w-full min-h-[64px] px-5 py-4 rounded-xl',
                'bg-surface border-[1.5px] border-border-subtle',
                'font-body font-semibold text-base text-n-800 dark:text-n-100',
                'flex items-center justify-between',
                'transition-all duration-150',
                'hover:border-accent-400 hover:bg-accent-50/50 dark:hover:bg-accent-900/20'
              )}
            >
              <span>{option.label}</span>
              {option.icon === 'check' && <Check className="w-5 h-5 text-success" />}
              {option.icon === 'x' && <X className="w-5 h-5 text-error" />}
            </motion.button>
          ))}
        </div>
      </div>
    );
  }

  if (node.type === 'action') {
    return (
      <div className="space-y-5">
        <div className="p-5 rounded-xl bg-success/5 border-l-4 border-l-success">
          <div className="flex items-center gap-2 mb-3">
            <Check className="w-5 h-5 text-success" />
            <h3 className="font-display font-bold text-lg text-success">{node.title}</h3>
          </div>
          <p className="font-body text-sm text-n-800 dark:text-n-100 leading-relaxed whitespace-pre-line">
            {node.instruction}
          </p>
        </div>

        {node.linkedDrug && (
          <button
            type="button"
            onClick={handleViewDrug}
            className="w-full h-12 rounded-xl bg-accent-50 dark:bg-accent-900/30 border border-accent-200 dark:border-accent-700 text-accent-500 dark:text-accent-400 font-body font-semibold flex items-center justify-center gap-2 hover:bg-accent-100 dark:hover:bg-accent-900/50 transition-colors"
          >
            <Pill className="w-4 h-4" />
            View drug table
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  }

  if (node.type === 'refer') {
    return (
      <div className="space-y-5">
        <div className="p-5 rounded-xl bg-error/5 border-l-4 border-l-error">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-error" />
            <span className="px-2 py-0.5 rounded-full bg-error/15 text-error text-xs font-display font-bold uppercase">
              {node.urgency === 'immediate' ? 'Immediate' : 'Urgent'} Referral
            </span>
          </div>
          <h3 className="font-display font-bold text-lg text-error mb-3">{node.title}</h3>

          <div className="space-y-3">
            <div>
              <p className="text-xs font-body font-semibold text-n-500 uppercase tracking-wider mb-1">
                Pre-referral care
              </p>
              <p className="font-body text-sm text-n-800 dark:text-n-100 leading-relaxed whitespace-pre-line break-words">
                {node.holdingCare}
              </p>
            </div>
            <div className="pt-3 border-t border-error/20">
              <p className="text-xs font-body font-semibold text-n-500 uppercase tracking-wider mb-1">
                Handover note
              </p>
              <p className="font-body text-sm text-n-800 dark:text-n-100 leading-relaxed break-words">
                {node.handover}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export { TreeNodeComponent as TreeNode };
