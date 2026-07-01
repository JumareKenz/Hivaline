/**
 * edgeBrainService.ts — On-device LLM inference via native llama.cpp plugin
 *
 * Wraps the EdgeBrain Capacitor plugin (Kotlin + JNI + llama.cpp) for grounded
 * generation. The model (Qwen2.5-1.5B-Instruct Q4_0_4_4, ~990 MB) lives in the
 * app's internal files directory and is loaded on first generation call.
 *
 * This service NEVER answers from the model's parametric knowledge — it only
 * reformulates retrieved evidence into natural language. The prompt template
 * explicitly offers "INSUFFICIENT_EVIDENCE" as a valid output when context
 * doesn't support an answer.
 */

import { registerPlugin } from '@capacitor/core';
import { isModelDownloaded } from './modelDownloader';

export interface EdgeBrainPlugin {
  loadModel(): Promise<{ success: boolean; loadTimeMs: number }>;
  generate(options: GenerateOptions): Promise<GenerateResult>;
  isModelLoaded(): Promise<{ loaded: boolean }>;
  unloadModel(): Promise<{ success: boolean }>;
  getModelInfo(): Promise<ModelInfo>;
}

export interface GenerateOptions {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  repeatPenalty?: number;
  stopSequences?: string[];
}

export interface GenerateResult {
  text: string;
  tokenCount: number;
  durationMs: number;
  tokensPerSecond: number;
}

export interface ModelInfo {
  exists: boolean;
  path: string;
  sizeMB: number;
  loaded: boolean;
}

const EdgeBrain = registerPlugin<EdgeBrainPlugin>('EdgeBrain');

export type EdgeBrainStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface EdgeBrainState {
  status: EdgeBrainStatus;
  error: string | null;
  loadTimeMs: number | null;
}

let state: EdgeBrainState = {
  status: 'idle',
  error: null,
  loadTimeMs: null,
};

const listeners = new Set<(s: EdgeBrainState) => void>();

function emit(next: Partial<EdgeBrainState>): void {
  state = { ...state, ...next };
  for (const fn of listeners) fn(state);
}

export function getEdgeBrainState(): EdgeBrainState {
  return { ...state };
}

export function subscribeEdgeBrainState(fn: (s: EdgeBrainState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => { listeners.delete(fn); };
}

/**
 * Load the Edge Brain model (idempotent).
 * Safe to call repeatedly — will short-circuit if already loaded.
 *
 * @throws {Error} If model file is not downloaded
 */
export async function loadEdgeBrain(): Promise<void> {
  if (state.status === 'ready') return;
  if (state.status === 'loading') {
    // Wait for existing load to complete
    while (state.status === 'loading') {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return;
  }

  // Check if model is downloaded
  const downloaded = await isModelDownloaded();
  if (!downloaded) {
    const error = 'Model not downloaded. Please download the model first.';
    emit({ status: 'error', error });
    throw new Error(error);
  }

  emit({ status: 'loading', error: null });

  try {
    const result = await EdgeBrain.loadModel();
    emit({ status: 'ready', loadTimeMs: result.loadTimeMs });
    // eslint-disable-next-line no-console
    console.log(`[EdgeBrain] Model loaded in ${result.loadTimeMs}ms`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    emit({ status: 'error', error: errMsg });
    // eslint-disable-next-line no-console
    console.error('[EdgeBrain] Model load failed:', errMsg);
    throw err;
  }
}

/**
 * Check if the model is loaded and ready for generation.
 */
export async function isEdgeBrainReady(): Promise<boolean> {
  if (state.status === 'ready') return true;
  try {
    const { loaded } = await EdgeBrain.isModelLoaded();
    if (loaded) {
      emit({ status: 'ready' });
    }
    return loaded;
  } catch {
    return false;
  }
}

/**
 * Generate grounded text from retrieved evidence.
 * Throws if the model is not loaded — call loadEdgeBrain() first.
 */
export async function generateGrounded(
  evidence: string,
  query: string,
  options?: Partial<GenerateOptions>
): Promise<GenerateResult> {
  if (state.status !== 'ready') {
    throw new Error('Edge Brain not loaded. Call loadEdgeBrain() first.');
  }

  const prompt = buildGroundedPrompt(evidence, query);

  return EdgeBrain.generate({
    prompt,
    maxTokens: options?.maxTokens ?? 256,
    temperature: options?.temperature ?? 0.1,
    topP: options?.topP ?? 0.9,
    repeatPenalty: options?.repeatPenalty ?? 1.1,
    stopSequences: options?.stopSequences ?? ['<|im_end|>', '\n\nQuery:', 'Evidence:'],
  });
}

/**
 * Build the grounded generation prompt template.
 *
 * Hard constraints:
 * - Context is ONLY the retrieved evidence — no open-ended framing
 * - "INSUFFICIENT_EVIDENCE" is explicitly offered as a valid, unpenalized output
 * - The model is instructed to NEVER use its own knowledge
 */
function buildGroundedPrompt(evidence: string, query: string): string {
  return `<|im_start|>system
You are a clinical decision support assistant. Your role is to reformulate retrieved medical evidence into clear, actionable answers for healthcare workers.

CRITICAL RULES:
1. ONLY use information from the Evidence section below. NEVER use your own medical knowledge.
2. If the Evidence does not contain enough information to answer the Query, output exactly: "INSUFFICIENT_EVIDENCE"
3. Do not apologize, do not explain why evidence is insufficient, just output "INSUFFICIENT_EVIDENCE"
4. If the Evidence supports an answer, reformulate it into natural, concise language
5. Keep answers under 150 words
6. Be direct and specific — no hedging or unnecessary caveats

Evidence:
${evidence}

Query: ${query}
<|im_end|>
<|im_start|>assistant
`;
}

/**
 * Get information about the model file on disk.
 */
export async function getModelInfo(): Promise<ModelInfo> {
  return EdgeBrain.getModelInfo();
}

/**
 * Unload the model from memory (frees ~1-2 GB RAM).
 */
export async function unloadEdgeBrain(): Promise<void> {
  await EdgeBrain.unloadModel();
  emit({ status: 'idle', loadTimeMs: null });
  // eslint-disable-next-line no-console
  console.log('[EdgeBrain] Model unloaded');
}

/**
 * Post-generation grounding check: verify that every factual claim in the
 * generated text appears in or is directly derivable from the source evidence.
 *
 * Simple n-gram overlap method: extract key medical terms and numeric values
 * from the output and ensure they exist in the evidence. If <70% of key terms
 * are grounded, the check fails.
 *
 * Returns: { grounded: boolean, score: number (0-1), unmatchedTerms: string[] }
 */
export interface GroundingCheckResult {
  grounded: boolean;
  score: number;
  unmatchedTerms: string[];
}

export function checkGrounding(generatedText: string, evidence: string): GroundingCheckResult {
  // If model output "INSUFFICIENT_EVIDENCE", it's perfectly grounded
  if (generatedText.trim() === 'INSUFFICIENT_EVIDENCE') {
    return { grounded: true, score: 1.0, unmatchedTerms: [] };
  }

  // Extract key terms from generated text
  const keyTerms = extractKeyTerms(generatedText);
  if (keyTerms.length === 0) {
    // No factual claims to verify — likely a malformed response
    return { grounded: false, score: 0, unmatchedTerms: [] };
  }

  // Check each key term against evidence
  const evidenceLower = evidence.toLowerCase();
  const unmatchedTerms: string[] = [];
  let matchedCount = 0;

  for (const term of keyTerms) {
    if (evidenceLower.includes(term.toLowerCase())) {
      matchedCount++;
    } else {
      unmatchedTerms.push(term);
    }
  }

  const score = matchedCount / keyTerms.length;
  const grounded = score >= 0.7; // 70% threshold

  return { grounded, score, unmatchedTerms };
}

/**
 * Extract key medical terms and numeric values from text.
 * These are the factual claims that must be grounded in evidence.
 */
function extractKeyTerms(text: string): string[] {
  const terms: string[] = [];

  // Medical terms: drug names, condition names (capitalized, possibly multi-word)
  // Include single capital letters (e.g., "Vitamin K")
  const capitalizedWords = text.match(/\b[A-Z](?:[a-z]+)?(?:\s+[A-Z](?:[a-z]+)?)*\b/g);
  if (capitalizedWords) {
    const commonWords = new Set(['Give', 'Use', 'Administer', 'Children', 'For', 'The', 'This', 'Continue', 'Treatment', 'Suitable']);
    for (const word of capitalizedWords) {
      if (word.length <= 1) continue;
      // Strip leading common words: "Give Fabricazole" → "Fabricazole"
      const parts = word.split(/\s+/);
      const filtered = parts.filter(p => !commonWords.has(p));
      if (filtered.length > 0) {
        terms.push(filtered.join(' '));
      }
    }
  }

  // Dosages with units: "10mg/kg", "500mg", "1mg IM"
  // Match compound units like "mg/kg" as a single term
  const dosages = text.match(/\b\d+(?:\.\d+)?\s*(?:mg\/kg|ml\/kg|mg|ml|g|kg|IU|mcg|units?)\b/gi);
  if (dosages) {
    terms.push(...dosages);
  }

  // Route of administration (if standalone)
  const routes = text.match(/\b(IM|IV|PO|SC)\b/g);
  if (routes) {
    terms.push(...routes);
  }

  // Age/weight ranges: "15-25kg", "6 months to 5 years"
  const ranges = text.match(/\b\d+\s*-\s*\d+\s*(?:kg|months?|years?|weeks?)\b/gi);
  if (ranges) {
    terms.push(...ranges);
  }

  // Duration phrases: "for 3 days", "for 10 days"
  const durations = text.match(/\bfor\s+\d+\s+(?:days?|weeks?|months?)\b/gi);
  if (durations) {
    terms.push(...durations);
  }

  // Frequency patterns: "3 days", "three times", "once daily"
  const frequency = text.match(/\b(?:once|twice|three\s+times)\s+(?:daily|per\s+day)\b/gi);
  if (frequency) {
    terms.push(...frequency);
  }

  const numericDays = text.match(/\b\d+\s+days?\b/gi);
  if (numericDays) {
    terms.push(...numericDays);
  }

  // Unique terms only
  return Array.from(new Set(terms));
}
