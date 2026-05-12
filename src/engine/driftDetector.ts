/**
 * driftDetector.ts — Detect mid-conversation topic drift
 *
 * Fires when the user's query has zero token overlap with the current topic
 * AND the matched chunk's topics differ from the current topic.
 */

import type SessionState from './sessionState';

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

  const topicChanged = !matchedChunkTopics.includes(sessionState.currentTopic);
  const isDrift = overlap === 0 && topicChanged;

  const newTopic = isDrift ? (matchedChunkTopics[0] ?? null) : sessionState.currentTopic;

  return { isDrift, newTopic };
}
