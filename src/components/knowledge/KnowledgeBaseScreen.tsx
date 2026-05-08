/**
 * KnowledgeBaseScreen — artifact list grid
 */

import React, { useCallback } from 'react';
import { motion } from 'framer-motion';
import { Info } from 'lucide-react';
import { MOCK_ARTIFACTS } from '@/data/artifacts';
import { useRouter } from '@/router/useRouter';
import { TopBar } from '@/components/ui/TopBar';
import { StatusPill } from '@/components/ui/StatusPill';
import { ArtifactCard } from './ArtifactCard';

const KnowledgeBaseScreen: React.FC = () => {
  const { navigate } = useRouter();

  const handleArtifactClick = useCallback((id: string) => {
    navigate(`/knowledge/${id}`);
  }, [navigate]);

  return (
    <div className="flex flex-col h-full bg-bg-secondary">
      <TopBar
        title="Knowledge Base"
        subtitle="FMOH-approved guidelines only"
        rightElement={<StatusPill />}
      />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Info notice */}
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-warning/5 border border-warning/20">
          <Info className="w-4 h-4 text-warning flex-shrink-0" />
          <p className="text-xs font-body text-warning-800 dark:text-warning">
            This AI only has access to these {MOCK_ARTIFACTS.length} approved artifacts.
          </p>
        </div>

        {/* Artifact list */}
        <div className="space-y-3">
          {MOCK_ARTIFACTS.map((artifact, index) => (
            <motion.div
              key={artifact.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.08 }}
            >
              <ArtifactCard
                artifact={artifact}
                onClick={() => handleArtifactClick(artifact.id)}
              />
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default KnowledgeBaseScreen;
