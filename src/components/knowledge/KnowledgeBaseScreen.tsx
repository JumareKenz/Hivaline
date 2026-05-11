/**
 * KnowledgeBaseScreen — artifact list grid
 */

import React, { useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Info } from 'lucide-react';
import { useHIVFile } from '@/hooks/useHIVFile';
import { extractArtifacts } from '@/services/hivDataExtractor';
import { useRouter } from '@/router/useRouter';
import { TopBar } from '@/components/ui/TopBar';
import { StatusPill } from '@/components/ui/StatusPill';
import { ArtifactCard } from './ArtifactCard';

const KnowledgeBaseScreen: React.FC = () => {
  const { navigate } = useRouter();
  const { file } = useHIVFile();

  const artifacts = useMemo(() => extractArtifacts(file), [file]);

  const handleArtifactClick = useCallback((id: string) => {
    navigate(`/knowledge/${id}`);
  }, [navigate]);

  if (!file) {
    return (
      <div className="flex flex-col h-full bg-bg-secondary">
        <TopBar
          title="Knowledge Base"
          subtitle="FMOH-approved guidelines only"
          rightElement={<StatusPill />}
        />
        <div className="flex-1 flex items-center justify-center">
          <p className="font-body text-n-500">Loading clinical data...</p>
        </div>
      </div>
    );
  }

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
            This AI has access to {artifacts.length} approved artifacts.
          </p>
        </div>

        {/* Document sources */}
        {file.manifest.document_sources && file.manifest.document_sources.length > 0 && (
          <div className="px-3 py-2.5 rounded-xl bg-surface border border-border-subtle">
            <p className="text-[10px] font-body font-medium text-n-500 uppercase tracking-wider mb-2">
              Clinical Sources
            </p>
            <div className="flex flex-wrap gap-1.5">
              {file.manifest.document_sources.map((doc) => (
                <span
                  key={doc.id}
                  className="inline-flex items-center px-2 py-0.5 rounded-md bg-accent-50 dark:bg-accent-800/20 text-accent-700 dark:text-accent-300 text-[10px] font-body font-medium"
                >
                  {doc.name}
                </span>
              ))}
            </div>
            <p className="text-[10px] font-body text-n-400 mt-1.5">
              {file.chunks.length} knowledge chunks · {file.manifest.languages.join(', ')}
            </p>
          </div>
        )}

        {/* Artifact list */}
        {artifacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <p className="font-body text-n-500">No artifacts available.</p>
            <p className="text-xs font-body text-n-400 mt-1">Check for updates in Settings.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {artifacts.map((artifact, index) => (
              <motion.div
                key={artifact.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.08 }}
              >
                <ArtifactCard
                  artifact={{
                    id: artifact.id,
                    title: artifact.title,
                    publisher: artifact.publisher,
                    year: artifact.year,
                    icon: artifact.icon,
                    colorTint: artifact.colorTint,
                    topics: artifact.topics,
                    verified: artifact.verified,
                    syncedAt: new Date().toISOString(),
                    description: artifact.description,
                  }}
                  onClick={() => handleArtifactClick(artifact.id)}
                />
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default KnowledgeBaseScreen;
