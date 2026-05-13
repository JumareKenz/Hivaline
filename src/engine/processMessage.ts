/**
 * processMessage.ts — Main message processing pipeline
 *
 * Wires all seven engine modules into the exact flow specified in the intelligence upgrade:
 * 1. Slot extraction → sessionState.slotMemory
 * 2. classifyIntent(query) → intent
 * 3. probeSentiment(query) → sessionState.pushSentiment()
 * 4. rewriteQuery(query, intent, sessionState) → RewrittenQuery
 * 5. detectDrift(rewrittenQuery, matchedChunkTopics, sessionState) → handle topic shift
 * 6. search(rewrittenQuery, sessionState, language, hivAssets) → top chunk
 * 7. detectGaps(topic, coverageManifest, sessionState) → sessionState.pendingGaps
 * 8. selectAnswerContent(chunk, sessionState, intent)
 * 9. computePatientDose (if applicable)
 * 10. buildOpener(intent, topic, aspect, openerMatrix) from manifest.json
 * 11. Assemble answer text
 * 12. buildClosing(pendingGaps, intent, turnCount)
 * 13. buildFollowUpChips(pendingGaps, gapGraph, chunkId)
 * 14. sessionState.addTurn(query, chunkId, aspects, intent)
 * 15. sessionState.markAspectsCovered(chunk.aspects)
 * 16. Return { answer, closing, chips, tone, chunkId, intent }
 */

import SessionState, { type Sentiment } from './sessionState';
import { classifyIntent, probeSentiment, detectGaps } from './intentEngine';
import { rewriteQuery } from './queryRewriter';
import { search, initSearch, type HIVAssets } from './hybridSearch';
import {
  selectAnswerContent,
  computePatientDose,
  buildOpener,
  buildClosing,
  buildFollowUpChips,
  type DoseRule,
} from './answerAssembler';
import { detectDrift, extractPrimaryTopic } from './driftDetector';
import { buildFallback } from './fallbackHandler';
import type { HIVChunk } from '@/types/hiv';

export interface ProcessMessageOptions {
  userMessage: string;
  language?: string;
  hivAssets: HIVAssets;
  coverageManifest?: Record<string, { aspects_covered: string[] }>;
  openerMatrix?: Record<string, string>;
  chunks: HIVChunk[];
}

export interface ProcessMessageResult {
  answer: string;
  closing: string;
  chips: string[];
  tone: string;
  chunkId: string | null;
  intent: string;
  fallback: boolean;
}

const CLINICAL_KEYWORDS = [
  'fever', 'malaria', 'diarrhea', 'vomiting', 'convulsion',
  'rash', 'cough', 'bleeding', 'jaundice', 'anaemia',
  'pneumonia', 'dehydration', 'malnutrition',
  'delivery', 'labour', 'pregnancy', 'anc',
  'pph', 'postpartum', 'hemorrhage', 'haemorrhage',
  'pre-eclampsia', 'preeclampsia', 'hypertension', 'eclampsia',
  'sepsis', 'obstructed labour', 'prolonged labour',
  'retained placenta', 'perineal tear', 'episiotomy',
  'newborn', 'neonatal', 'asphyxia', 'resuscitation',
  'immunization', 'vaccination', 'family planning', 'contraception',
  'sti', 'hiv', 'tb', 'nutrition', 'anemia',
  'blood pressure', 'sugar', 'diabetes',
  'injury', 'burn', 'fracture', 'wound', 'infection',
];

/**
 * Extract patient slots from the raw user message and update sessionState.
 */
function extractSlots(message: string, sessionState: SessionState): void {
  const lower = message.toLowerCase();

  const ageMatch = lower.match(/(\d+)\s*(year|month|week|day|yr|mo|wk|dy)s?\s*old/);
  if (ageMatch) {
    sessionState.slotMemory.patientAge = `${ageMatch[1]} ${ageMatch[2]}`;
    sessionState.slotMemory.patientAgeMonths = sessionState.normalizeAge(sessionState.slotMemory.patientAge);
  }

  const weightMatch = lower.match(/(\d+(?:\.\d+)?)\s*(kg|kilos?|kgs)/);
  if (weightMatch) {
    sessionState.slotMemory.patientWeight = `${weightMatch[1]} kg`;
    sessionState.slotMemory.patientWeightKg = sessionState.normalizeWeight(sessionState.slotMemory.patientWeight);
  }

  for (const keyword of CLINICAL_KEYWORDS) {
    if (lower.includes(keyword)) {
      sessionState.slotMemory.chiefComplaint = keyword;
      break;
    }
  }
}

/**
 * Get topics from a chunk for drift detection.
 */
function getChunkTopics(chunk: HIVChunk): string[] {
  const topics: string[] = [];
  const enContent = chunk.content['en'] as Record<string, unknown> | undefined;
  if (enContent && Array.isArray(enContent.topics)) {
    topics.push(...enContent.topics.map(String));
  }
  if (chunk.trigger_phrases?.en) {
    topics.push(...chunk.trigger_phrases.en.slice(0, 3));
  }
  return topics;
}

/**
 * Process a single user message through the full intelligence pipeline.
 */
export function processMessage(
  userMessage: string,
  sessionState: SessionState,
  options: ProcessMessageOptions
): ProcessMessageResult {
  const { language = 'en', hivAssets, coverageManifest = {}, openerMatrix = {}, chunks } = options;

  // Ensure search assets are initialized
  initSearch(hivAssets);

  // 1. Extract slots
  extractSlots(userMessage, sessionState);

  // 2. Classify intent
  const intent = classifyIntent(userMessage);

  // 3. Probe sentiment
  const sentiment = probeSentiment(userMessage);
  sessionState.pushSentiment(sentiment as Sentiment);

  // Handle greetings early
  if (intent === 'GREETING') {
    sessionState.addTurn(userMessage, null, [], intent);
    return {
      answer: "Hello! I'm HIVA, your clinical companion. How can I help you today?",
      closing: '',
      chips: ['What can you do?', 'How do you work offline?', 'How do I search?'],
      tone: 'calm',
      chunkId: null,
      intent,
      fallback: false,
    };
  }

  // 4. Rewrite query
  const rewritten = rewriteQuery(userMessage, intent, sessionState);

  // Note: topic shift from rewriter is intentionally NOT applied here.
  // The rewriter's extractTopic() uses a crude keyword list that doesn't
  // understand abbreviations (e.g., 'anc' ≠ 'antenatal care' as a substring).
  // Instead, extractPrimaryTopic() handles topic transitions after search,
  // using the 3-priority cascade with coverage manifest awareness.

  // 6. Search
  const searchResult = search(rewritten.rewritten, sessionState, language, hivAssets);

  const chunkMap = new Map(chunks.map((c) => [c.id, c]));
  let chunk: HIVChunk | null = null;
  if (searchResult) {
    chunk = chunkMap.get(searchResult.chunkId) ?? null;
  }

  // No chunk found → coverage-aware fallback
  if (!chunk) {
    const fallbackText = buildFallback(rewritten.rewritten, sessionState, { topics: coverageManifest });
    sessionState.addTurn(userMessage, null, [], intent);
    return {
      answer: fallbackText,
      closing: '',
      chips: ['Tell me more', "What's the dose?", 'When should I refer?'],
      tone: sessionState.getDominantSentiment(),
      chunkId: null,
      intent,
      fallback: true,
    };
  }

  const chunkTopics = getChunkTopics(chunk);

  // Determine the fused score for topic confidence threshold
  const fusedScore = searchResult?.score ?? 0;

  // 5b. Drift detection (after search, before assembly)
  const drift = detectDrift(rewritten.rewritten, chunkTopics, sessionState);
  if (drift.isDrift && drift.newTopic) {
    sessionState.onTopicShift(drift.newTopic);
  }

  // Determine primary topic using 3-priority cascade (avoids incidental-mention pollution)
  const topic = extractPrimaryTopic(
    userMessage,
    chunkTopics,
    sessionState,
    coverageManifest,
    fusedScore
  );

  // Only update sessionState.currentTopic if extractPrimaryTopic found a confident signal
  if (topic && topic !== sessionState.currentTopic) {
    // Check confidence: user named the topic, OR strong chunk match
    const queryLower = userMessage.toLowerCase();
    const topicTokens = topic.toLowerCase().split(/\s+/).filter((t: string) => t.length >= 2);
    const queryTokens = queryLower.split(/\s+/).filter((t: string) => t.length >= 2);
    const userNamedIt = topicTokens.some((t: string) => queryTokens.includes(t));

    if (userNamedIt || fusedScore > 0.6 || !sessionState.currentTopic) {
      sessionState.currentTopic = topic;
    }
    // Otherwise keep sessionState.currentTopic unchanged (weak match, no user signal)
  }

  // 7. Detect gaps
  const gaps = detectGaps(topic, { topics: coverageManifest }, sessionState);
  sessionState.pendingGaps = gaps;

  // 8. Select answer content
  let answerText = selectAnswerContent(chunk, sessionState, intent);

  // 9. Compute patient dose if applicable
  const langContent = chunk.content['en'] as Record<string, unknown> | undefined;
  if ((intent === 'DETAIL' || intent === 'PROCEDURE') && langContent?.dosage_rules) {
    const doseResult = computePatientDose(langContent.dosage_rules as DoseRule[], sessionState.slotMemory);
    if (doseResult) {
      answerText = doseResult;
    }
  }

  // Fallback to primary_question / fallback_response if no content selected
  if (!answerText && langContent?.fallback_response) {
    answerText = String(langContent.fallback_response);
  }
  if (!answerText && langContent?.primary_question) {
    answerText = String(langContent.primary_question);
  }
  if (!answerText) {
    answerText = 'I found relevant information, but the content is not available in this release.';
  }

  // 10. Build opener
  const aspect = chunk.aspects?.[0] || topic;
  const opener = buildOpener(intent, topic, aspect, openerMatrix);

  // 12. Build closing
  const closing = buildClosing(gaps, intent, sessionState);

  // 11. Assemble answer text
  let answer = answerText;
  if (opener) {
    answer = `${opener}\n\n${answer}`;
  }

  // Append companion_note if present (colleague aside)
  const companionNote = (langContent as Record<string, unknown> | undefined)?.companion_note;
  if (typeof companionNote === 'string' && companionNote.trim().length > 0) {
    answer = `${answer}\n\n\u2014 ${companionNote.trim()}`;
  }

  // 13. Build follow-up chips (reuse chunkMap from search step)
  const chips = buildFollowUpChips(gaps, hivAssets.gapGraph, chunk.id, chunkMap);

  // 14. Record turn
  const chunkAspects = chunk.aspects || [];
  sessionState.addTurn(userMessage, chunk.id, chunkAspects, intent);

  // 15. Mark aspects covered
  sessionState.markAspectsCovered(chunkAspects);

  // Ensure topic is set (only if still null — confidence gating above handles updates)
  if (!sessionState.currentTopic && topic) {
    sessionState.currentTopic = topic;
  }

  return {
    answer,
    closing,
    chips,
    tone: sessionState.getDominantSentiment(),
    chunkId: chunk.id,
    intent,
    fallback: false,
  };
}
