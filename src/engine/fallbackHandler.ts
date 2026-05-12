/**
 * fallbackHandler.ts — Coverage-aware fallback messages
 *
 * Replaces internal-file-name exposure with helpful, actionable fallbacks
 * using the coverage_manifest and gap_graph.
 */

import type SessionState from './sessionState';

const STOP_WORDS = new Set([
  'what', 'how', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'the', 'a',
  'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'by', 'from', 'as', 'about', 'into', 'through', 'during', 'before',
  'after', 'above', 'below', 'between', 'under', 'again', 'further',
  'then', 'once', 'here', 'there', 'when', 'where', 'why', 'all', 'any',
  'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'tell', 'me', 'my', 'i', 'you', 'your', 'it', 'this', 'that', 'these',
  'those', 'am', 'get', 'got', 'give', 'take', 'make', 'go', 'come',
  'know', 'see', 'look', 'use', 'want', 'like', 'help', 'work', 'find',
]);

export interface CoverageManifest {
  topics: Record<string, { aspects_covered: string[] }>;
}

/**
 * Extract prominent noun/topic from query.
 */
function extractTopic(query: string): string | null {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return words[0] || null;
}

/**
 * Jaccard similarity between two strings.
 */
function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 1));
  const setB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 1));
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

/**
 * Find closest topic by string similarity.
 */
function findClosestTopic(queryTopic: string, topicNames: string[]): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const topic of topicNames) {
    const score = jaccardSimilarity(queryTopic, topic);
    if (score > bestScore) {
      bestScore = score;
      best = topic;
    }
  }
  return best;
}

/**
 * Build coverage-aware fallback message.
 * Never mentions file names, artifact names, or internal chunk IDs.
 * @param query — rewritten query string
 * @param sessionState — current session state
 * @param coverageManifest — parsed index/coverage_manifest.json
 * @returns fallback message string
 */
export function buildFallback(query: string, sessionState: SessionState, coverageManifest: CoverageManifest): string {
  const queryTopic = extractTopic(query);
  const topics = coverageManifest?.topics || {};

  if (queryTopic && topics[queryTopic]) {
    const topicData = topics[queryTopic];
    const aspects = topicData.aspects_covered || [];
    const uncovered = sessionState.getUncoveredAspects(aspects);

    if (uncovered.length > 0) {
      return `I have information on ${queryTopic} but not the specific ${uncovered[0]}. Here's what I do have: ${aspects.join(', ')}. What would you like to know?`;
    }
    return `I have information on ${queryTopic}. Here's what I cover: ${aspects.join(', ')}. What would you like to know?`;
  }

  const topicNames = Object.keys(topics);
  const closest = findClosestTopic(queryTopic || query, topicNames);

  if (closest) {
    return `I don't have information on ${queryTopic || 'that topic'}. The closest I have is ${closest}. Want me to check that instead?`;
  }

  return "I don't have information on that. Try rephrasing or check the Knowledge Base.";
}
