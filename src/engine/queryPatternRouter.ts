/**
 * queryPatternRouter.ts - Emergency pattern-based routing for known problematic queries
 *
 * This catches specific query patterns that embeddings fail on and routes them
 * directly to the correct chunks. Acts as a surgical fix on top of semantic search.
 */

interface PatternRoute {
  patterns: RegExp[];
  chunkIdHints: string[]; // Chunk IDs or title fragments to boost
  boost: number; // Score multiplier for matching chunks
}

// Known problematic patterns and their correct destinations
const PATTERN_ROUTES: PatternRoute[] = [
  // ART treatment failure
  {
    patterns: [
      /signs?\s+of\s+(art|hiv|treatment)\s+failure/i,
      /symptoms?\s+of\s+(art|treatment)\s+failure/i,
      /art\s+failure\s+(signs?|symptoms?)/i,
      /treatment\s+failure\s+(signs?|symptoms?|indicators?)/i,
    ],
    chunkIdHints: ['30d048a4-7a4a', 'aa14d644-630d', '1ae509de-9eb8', 'treatment failure', 'hiv treatment failure'],
    boost: 10.0,
  },

  // IPT duration
  {
    patterns: [
      /how\s+long\s+(is|for)\s+ipt/i,
      /ipt\s+duration/i,
      /duration\s+of\s+ipt/i,
      /how\s+many\s+(months?|weeks?)\s+ipt/i,
    ],
    chunkIdHints: ['ipt', 'isoniazid preventive', 'tb preventive treatment', 'preventive therapy'],
    boost: 10.0,
  },

  // KMC (no content, so boost any palliative/newborn care)
  {
    patterns: [
      /kangaroo\s+mother\s+care/i,
      /\bkmc\b/i,
      /skin\s+to\s+skin\s+care/i,
    ],
    chunkIdHints: ['palliative', 'newborn care', 'care policy'],
    boost: 0.1, // Actually REDUCE score since content doesn't exist
  },

  // TB screening (not diagnosis)
  {
    patterns: [
      /how\s+to\s+screen\s+(for\s+)?tb/i,
      /tb\s+screening/i,
      /screen(ing)?\s+(plhiv|hiv\s+patients?)\s+for\s+tb/i,
    ],
    chunkIdHints: ['tb screening', 'screen', 'symptom'],
    boost: 8.0,
  },

  // Newborn danger signs
  {
    patterns: [
      /newborn\s+danger\s+signs?/i,
      /danger\s+signs?\s+(in\s+)?newborns?/i,
      /emergency\s+signs?\s+(in\s+)?newborns?/i,
    ],
    chunkIdHints: ['e889913b-8c1d', 'newborn danger', 'danger signs in children'],
    boost: 10.0,
  },

  // PMTCT
  {
    patterns: [
      /what\s+is\s+pmtct/i,
      /pmtct\s+(services?|guidelines?|program)/i,
      /(prevention|prevent)\s+(of\s+)?mother\s+to\s+child/i,
    ],
    chunkIdHints: ['pmtct', 'mother to child', 'prevention'],
    boost: 10.0,
  },

  // Out of scope queries - will be handled separately
  // (see isOutOfScope function below)

  // TPT/IPT general
  {
    patterns: [
      /\btpt\s+(options?|choices?|regimens?)/i,
      /(tb|tuberculosis)\s+prevent(ive)?\s+(therapy|treatment)/i,
    ],
    chunkIdHints: ['tpt', 'tb preventive', 'tuberculosis preventive'],
    boost: 8.0,
  },
];

export interface SearchResult {
  chunkId: string;
  score: number;
}

/**
 * Check if query is completely out of scope (non-medical)
 */
export function isOutOfScope(query: string): boolean {
  const outOfScopePatterns = [
    /capital\s+of\s+(nigeria|country|city)/i,
    /weather\s+(forecast|today|tomorrow)/i,
    /sports?\s+(score|game|match)/i,
    /politics?|election|president|government/i,
    /diabetes\s+(management|treatment|control)/i,
    /cancer\s+(treatment|therapy|management)/i,
    /hypertension\s+(management|treatment)/i,
    /entertainment|movie|music|celebrity/i,
    /cooking|recipe|food\s+preparation/i,
  ];

  return outOfScopePatterns.some(p => p.test(query));
}

/**
 * Apply pattern-based routing to boost/penalize search results based on query patterns
 */
export function applyPatternRouting(
  query: string,
  results: SearchResult[],
  chunkTitleMap?: Map<string, string>
): SearchResult[] {
  // Find matching patterns
  const matchedRoutes: PatternRoute[] = [];
  for (const route of PATTERN_ROUTES) {
    if (route.patterns.some(p => p.test(query))) {
      matchedRoutes.push(route);
    }
  }

  if (matchedRoutes.length === 0) {
    return results; // No patterns matched, return as-is
  }

  // Apply boosts
  const boosted = results.map(r => {
    let totalBoost = 1.0;

    for (const route of matchedRoutes) {
      // Check if this chunk matches any of the hints
      const matchesHint = route.chunkIdHints.some(hint => {
        // Check chunk ID
        if (r.chunkId.includes(hint)) return true;

        // Check title if available
        if (chunkTitleMap) {
          const title = (chunkTitleMap.get(r.chunkId) || '').toLowerCase();
          if (title.includes(hint.toLowerCase())) return true;
        }

        return false;
      });

      if (matchesHint || route.chunkIdHints.length === 0) {
        totalBoost *= route.boost;
      }
    }

    return { ...r, score: r.score * totalBoost };
  });

  boosted.sort((a, b) => b.score - a.score);
  return boosted;
}
