/**
 * KnowledgeDetailScreen — deep artifact view
 */

import React, { useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { useHIVFile } from '@/hooks/useHIVFile';
import { getArtifactById } from '@/services/hivDataExtractor';
import { useRouter } from '@/router/useRouter';
import { TopBar } from '@/components/ui/TopBar';
import { VerificationBadge } from '@/components/ui/VerificationBadge';

const KnowledgeDetailScreen: React.FC = () => {
  const { params, navigate } = useRouter();
  const { file } = useHIVFile();
  const artifact = useMemo(() => getArtifactById(file, params.id ?? ''), [file, params.id]);

  const handleAskHiva = useCallback(() => {
    if (artifact) {
      navigate('/chat');
    }
  }, [navigate, artifact]);

  if (!artifact) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6">
        <p className="font-body text-n-500">Artifact not found.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-bg-secondary">
      <TopBar
        title="Knowledge Base"
        showBack
      />

      <div className="flex-1 overflow-y-auto">
        {/* Gradient header */}
        <div className="relative px-4 pt-6 pb-8" style={{ background: 'linear-gradient(135deg, #163A28 0%, #1E5A3C 60%, #C99338 100%)' }}>
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex flex-col items-center text-center"
          >
            <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-4xl mb-4">
              {artifact.icon}
            </div>
            <h1 className="font-display font-bold text-2xl text-white mb-1">
              {artifact.title}
            </h1>
            <p className="font-body text-sm text-white/75">
              {artifact.publisher} · {artifact.year} Edition
            </p>
          </motion.div>
        </div>

        <div className="px-4 py-5 space-y-5 -mt-4">
          {/* Topics */}
          <div className="bg-surface rounded-xl border border-border-subtle p-4">
            <p className="text-[11px] font-body font-medium text-n-500 uppercase tracking-widest mb-3">
              Topics Covered
            </p>
            <div className="space-y-2">
              {artifact.topics.map((topic) => (
                <div
                  key={topic}
                  className="flex items-center gap-3 py-2 border-b border-border-subtle last:border-0"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-500 flex-shrink-0" />
                  <span className="font-body text-sm text-n-800 dark:text-n-100">{topic}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Verification */}
          <VerificationBadge />

          {/* Description */}
          {artifact.description && (
            <p className="font-body text-sm text-n-600 dark:text-n-400 leading-relaxed px-1">
              {artifact.description}
            </p>
          )}

          {/* CTA */}
          <button
            type="button"
            onClick={handleAskHiva}
            className="w-full h-14 rounded-xl bg-accent-500 text-white font-display font-semibold flex items-center justify-center gap-2 hover:bg-accent-400 active:scale-[0.98] transition-all"
          >
            Ask HIVA about {artifact.title}
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default KnowledgeDetailScreen;
