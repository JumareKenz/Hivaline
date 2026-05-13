/**
 * driftDetector.ts — Detect mid-conversation topic drift
 *
 * Fires when the user's query has zero token overlap with the current topic
 * AND the matched chunk's topics differ from the current topic.
 *
 * Also exports extractPrimaryTopic() which picks the best topic for a turn
 * using a 3-priority cascade that avoids incidental-mention pollution.
 */

import type SessionState from './sessionState';

const TOPIC_CONFIDENCE_THRESHOLD = 0.6;

/**
 * Strip leading section numbers from topic strings.
 * "1.1. federal ministry of health" → "federal ministry of health"
 * "2" → ""
 * "state ministry of health" → "state ministry of health"
 */
export function cleanTopic(topic: string): string {
  if (!topic) return topic;
  return topic
    .replace(/^\d+(\.\d+)*\.?\s+/, '')
    .replace(/^\d+(\.\d+)*\.?$/, '')
    .trim();
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
}

function intersect(a: string[], b: string[]): string[] {
  const setB = new Set(b);
  return a.filter((x) => setB.has(x));
}

export interface DriftResult {
  isDrift: boolean;
  newTopic: string | null;
}

/**
 * Extract the primary topic for this turn using a 3-priority cascade.
 *
 * Priority 1: If query contains a known topic name from coverageManifest, use it
 *   (the user named it explicitly — strongest signal).
 * Priority 2: chunk.topics[0] — first topic is primary by convention.
 *   Only used if the chunk match is strong (fusedScore > 0.6) or if no current topic exists.
 * Priority 3: sessionState.currentTopic — keep existing if no clear signal.
 *
 * Never uses topics[1..n] unless Priority 1 and 2 both fail.
 *
 * @param query — user's raw query
 * @param chunkTopics — topics array from the matched chunk (topics[0] is primary)
 * @param sessionState — current session state
 * @param coverageManifest — coverage manifest keys (topic names)
 * @param fusedScore — BM25+vector fused score of the matched chunk (0..1)
 */
export function extractPrimaryTopic(
  query: string,
  chunkTopics: string[],
  sessionState: SessionState,
  coverageManifest: Record<string, unknown>,
  fusedScore: number
): string {
  const queryLower = query.toLowerCase();
  const queryTokens = tokenize(queryLower);

  // Priority 1: user explicitly named a topic from the coverage manifest
  const manifestTopics = Object.keys(coverageManifest);
  for (const topic of manifestTopics) {
    const topicLower = topic.toLowerCase();
    // Check if the full topic name appears in the query
    if (queryLower.includes(topicLower)) {
      return cleanTopic(topicLower);
    }
    // Check token overlap: every token in the topic name appears in the query
    const topicTokens = tokenize(topicLower);
    if (topicTokens.length > 0 && topicTokens.every((t) => queryTokens.includes(t))) {
      return cleanTopic(topicLower);
    }
  }

  // Priority 2: chunk.topics[0] if chunk match is strong OR no current topic exists
  const primaryChunkTopic = chunkTopics[0] ?? null;
  if (primaryChunkTopic) {
    const primaryLower = primaryChunkTopic.toLowerCase();

    // Check if the user's query tokens overlap with the primary chunk topic
    const primaryTokens = tokenize(primaryLower);
    const queryOverlap = intersect(queryTokens, primaryTokens).length;
    const userNamedIt = queryOverlap > 0;

    if (userNamedIt) {
      return cleanTopic(primaryLower);
    }

    // Strong match (high fused score) → trust the primary chunk topic
    if (fusedScore > TOPIC_CONFIDENCE_THRESHOLD) {
      return cleanTopic(primaryLower);
    }

    // No current topic yet → accept whatever the chunk says
    if (!sessionState.currentTopic) {
      return cleanTopic(primaryLower);
    }
  }

  // Priority 3: keep existing topic (already cleaned on prior set)
  return cleanTopic(sessionState.currentTopic ?? '');
}

/**
 * Detect when the user has shifted to a new clinical topic mid-conversation.
 * @param query — rewritten user query
 * @param matchedChunkTopics — topics from the matched chunk
 * @param sessionState — current session state
 * @returns drift detection result
 */
export function detectDrift(query: string, matchedChunkTopics: string[], sessionState: SessionState): DriftResult {
  if (!sessionState.currentTopic) return { isDrift: false, newTopic: null };

  const queryTokens = tokenize(query);
  const currentTopicTokens = tokenize(sessionState.currentTopic);
  const overlap = intersect(queryTokens, currentTopicTokens).length;

  const topicChanged = !matchedChunkTopics.some(
    (t) => t.toLowerCase() === sessionState.currentTopic?.toLowerCase()
  );
  const isDrift = overlap === 0 && topicChanged;

  const newTopic = isDrift ? (matchedChunkTopics[0] ?? null) : sessionState.currentTopic;

  return { isDrift, newTopic };
}
