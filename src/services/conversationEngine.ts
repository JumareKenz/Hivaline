/**
 * conversationEngine.ts — Stateful clinical conversation manager
 *
 * Integrates the new intelligence engine (sessionState, intentEngine,
 * queryRewriter, hybridSearch, answerAssembler, driftDetector, fallbackHandler)
 * while preserving the original public API for backward compatibility.
 */

import type {
  HIVFile,
  HIVChunk,
  ConversationState,
  ConversationTurn,
  ConversationSlots,
  IntentType,
  EngineResponse,
} from '@/types/hiv';
import SessionState from '@/engine/sessionState';
import { classifyIntent, probeSentiment, detectGaps } from '@/engine/intentEngine';
import { rewriteQuery } from '@/engine/queryRewriter';
import { search, initSearch, type HIVAssets } from '@/engine/hybridSearch';
import {
  selectAnswerContent,
  computePatientDose,
  buildOpener,
  buildClosing,
  buildFollowUpChips,
  type DoseRule,
} from '@/engine/answerAssembler';
import { detectDrift } from '@/engine/driftDetector';
import { buildFallback } from '@/engine/fallbackHandler';
import { variantSearch, bm25Search } from './searchEngine';
import { composeResponse } from './responseComposer';

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
  'deal', 'dealing', 'key', 'thing', 'things', 'meaning',
]);

const MIN_VARIANT_SCORE = 15;
const MIN_BM25_SCORE = 2.0;

export type { ConversationState, ConversationTurn, ConversationSlots, IntentType, EngineResponse };

const GREETING_RESPONSES = [
  "Hello! I'm HIVA, your clinical companion. How can I help you today?",
  'Hi there — ready to help. How can I help you today?',
  'Good to have you here. How can I help you today?',
  'Hello! How can I help you today?',
];

const DANGER_KEYWORDS = [
  'convulsing', 'convulsion', 'fitting', 'seizure',
  'not breathing', 'cant breathe', 'difficulty breathing',
  'unconscious', 'unresponsive', 'collapsed',
  'bleeding heavily', 'severe bleeding', 'hemorrhage',
  'cyanosis', 'blue lips', 'blue skin',
  'shock', 'cold extremities',
];

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

const PRONOUNS = new Set(['it', 'this', 'that', 'they', 'them', 'their', 'its', 'those']);

const SOCIAL_TRIGGERS = [
  'thanks', 'thank you', 'thank', 'thx',
  'ok', 'okay', 'got it', 'understood', 'noted',
  'great', 'good', 'perfect', 'awesome', 'nice',
  'alright', 'all right', 'cool', 'sure',
  'yes', 'no', 'yeah', 'nope',
  'bye', 'goodbye', 'see you', 'later',
];

const SOCIAL_RESPONSES = [
  "You're welcome! Let me know if anything else comes up.",
  'Glad to help. Stay confident — you\'ve got this.',
  'Anytime. Your patients are lucky to have you.',
  'Happy to help. Reach out whenever you need guidance.',
];

const APP_FAQ: Array<{ patterns: string[]; response: string; followUps: string[] }> = [
  {
    patterns: ['what can you do', 'what do you do', 'who are you', 'what is hiva', 'what are you', 'your features', 'your capabilities'],
    response: "I'm HIVA — your offline clinical companion. I can help you with:\n\n• FMOH-approved clinical guidelines (malaria, ANC, child health, essential medicines, emergency referral)\n• Drug dosing calculations by patient weight\n• Step-by-step decision trees for common conditions\n• Danger sign recognition and urgent referral guidance\n• All of this works completely offline — no internet needed after your first login.",
    followUps: ['How do you work offline?', 'How do I get updates?', 'How do I search?'],
  },
  {
    patterns: ['offline', 'no internet', 'without network', 'work offline', 'how do you work offline', 'offline mode'],
    response: "HIVA is built to work entirely offline. Here's how:\n\n• After your first login, the app downloads all clinical guidelines as a single .hiv file\n• This file is stored securely on your device — no internet needed to use it\n• Everything runs locally: search, drug tables, decision trees, and responses\n• You only need internet briefly to check for guideline updates (we'll prompt you)\n• Perfect for rural health facilities with unreliable connectivity.",
    followUps: ['How do I get updates?', 'What can you do?', 'What is my access code?'],
  },
  {
    patterns: ['update', 'get updates', 'how do i get updates', 'check for updates', 'new version', 'download update'],
    response: "Getting updates is simple:\n\n• Go to Settings → tap 'Check for Updates'\n• If a newer version of clinical data is available, HIVA will download it automatically\n• Updates happen in the background — you can keep using the app\n• The app also checks for updates automatically after each login\n• Your current version, chunk count, and coverage score are shown in Settings → Clinical Data.",
    followUps: ['How do you work offline?', 'What can you do?', 'How do I search?'],
  },
  {
    patterns: ['access code', 'server code', 'my code', 'what is my access code', 'login code', 'facility code', 'credentials'],
    response: "Your access credentials are provided by your facility supervisor or state coordinator:\n\n• Server Code: looks like HIVA-XXXX (your facility identifier)\n• Access Key: a 4-character key (e.g., A7B2) given to you personally\n• Both are required to log in\n• If you forget them, contact your supervisor — they can reissue your Access Key\n• Never share your Access Key with others.",
    followUps: ['How do I get updates?', 'How do you work offline?', 'What can you do?'],
  },
  {
    patterns: ['how do i search', 'how do i query', 'how to search', 'how to query', 'how does search work', 'ask questions', 'type questions'],
    response: "Just type your question naturally in the chat box and hit send — that's it!\n\n• I understand plain English: 'child with fever for 3 days', 'ACT dose for 15kg', 'signs of severe malaria'\n• I also have a Knowledge Base tab where you can browse all approved guidelines\n• For drug dosing, use the Drug Tables tab with the weight slider\n• For step-by-step protocols, check the Decision Trees tab\n• Voice input is available too — tap the microphone icon.",
    followUps: ['What can you do?', 'How do you work offline?', 'How do I get updates?'],
  },
];

export class ConversationEngine {
  private state: ConversationState;
  private hivFile: HIVFile;
  private sessionState: SessionState;
  private chunkMap: Map<string, HIVChunk>;
  private hivAssets: HIVAssets;
  private coverageManifest: Record<string, { aspects_covered: string[] }>;
  private openerMatrix: Record<string, string>;

  constructor(hivFile: HIVFile) {
    this.hivFile = hivFile;
    this.chunkMap = new Map(hivFile.chunks.map((c) => [c.id, c]));
    this.sessionState = new SessionState();
    this.hivAssets = this.buildHivAssets(hivFile);

    // Attempt to load new-format metadata from manifest/rules
    const manifestExt = hivFile.manifest as unknown as Record<string, unknown>;
    this.coverageManifest =
      (manifestExt.coverage_manifest as Record<string, { aspects_covered: string[] }>) ||
      (hivFile.rules?.coverage_manifest as Record<string, { aspects_covered: string[] }>) ||
      {};
    this.openerMatrix =
      (manifestExt.opener_matrix as Record<string, string>) ||
      (hivFile.rules?.opener_matrix as Record<string, string>) ||
      {};

    this.state = {
      turns: [],
      slots: {
        patientAge: null,
        patientWeight: null,
        symptomDuration: null,
        chiefComplaint: null,
      },
      lastChunkId: null,
      turnCount: 0,
      lastOpener: null,
      lastChiefComplaint: null,
    };
  }

  async respond(userMessage: string): Promise<EngineResponse> {
    const now = Date.now();
    this.state.turnCount += 1;

    // Record user turn (old state)
    this.state.turns.push({
      role: 'user',
      content: userMessage,
      timestamp: now,
    });

    // Extract slots into both old and new state
    this.extractSlots(userMessage);

    // New intent classification
    const newIntent = classifyIntent(userMessage);

    // Probe sentiment and push to session state
    const sentiment = probeSentiment(userMessage);
    this.sessionState.pushSentiment(sentiment as import('@/engine/sessionState').Sentiment);

    // App FAQ (unchanged behavior)
    const appFaqMatch = this.matchAppFaq(userMessage);
    if (appFaqMatch) {
      this.recordHivaTurn(appFaqMatch.response);
      return {
        message: appFaqMatch.response,
        type: 'greeting',
        chunkId: null,
        suggestedFollowUps: appFaqMatch.followUps,
      };
    }

    // Handle greeting or social acknowledgment
    // Also catch short turn-1 messages with no clinical keywords (old greeting heuristic)
    const lowerMsg = userMessage.toLowerCase();
    const isUrgentMsg = DANGER_KEYWORDS.some((k) => lowerMsg.includes(k));
    const isShortGreeting =
      this.state.turnCount === 1 &&
      userMessage.trim().split(/\s+/).length < 6 &&
      !CLINICAL_KEYWORDS.some((k) => lowerMsg.includes(k)) &&
      !isUrgentMsg;

    if (newIntent === 'GREETING' || this.isSocialTrigger(userMessage) || isShortGreeting) {
      const lower = userMessage.toLowerCase().trim();
      const isSocial = SOCIAL_TRIGGERS.some((t) => lower === t || lower.startsWith(t + ' '));

      if (isSocial) {
        const socialIndex = (this.state.turnCount - 1) % SOCIAL_RESPONSES.length;
        return {
          message: SOCIAL_RESPONSES[socialIndex],
          type: 'greeting',
          chunkId: null,
          suggestedFollowUps: [],
        };
      }

      const greetingIndex = (this.state.turnCount - 1) % GREETING_RESPONSES.length;
      return {
        message: GREETING_RESPONSES[greetingIndex],
        type: 'greeting',
        chunkId: null,
        suggestedFollowUps: ['What can you do?', 'How do you work offline?', 'How do I search?'],
      };
    }

    // Map new intent to old IntentType for backward-compatible response shape
    const mappedIntent = this.mapIntentToOld(newIntent);

    // Rewrite query using new engine
    const rewritten = rewriteQuery(userMessage, newIntent, this.sessionState);

    // Topic shift handling
    if (rewritten.isTopicShift && rewritten.detectedTopic) {
      this.sessionState.onTopicShift(rewritten.detectedTopic);
    }

    // Hybrid search (new engine)
    initSearch(this.hivAssets);
    const searchResult = search(rewritten.rewritten, this.sessionState, 'en', this.hivAssets);

    let chunk: HIVChunk | null = null;
    if (searchResult) {
      chunk = this.chunkMap.get(searchResult.chunkId) ?? null;
    }

    // Fallback to legacy search if new engine finds nothing (backward compatibility)
    if (!chunk) {
      const legacyQuery = this.buildSearchQuery(userMessage, mappedIntent);
      chunk = await this.findChunk(legacyQuery, mappedIntent);
    }

    if (!chunk) {
      const fallback = buildFallback(rewritten.rewritten, this.sessionState, { topics: this.coverageManifest });
      this.recordHivaTurn(fallback);
      return {
        message: fallback,
        type: 'fallback',
        chunkId: null,
        suggestedFollowUps: ['Tell me more', 'What\'s the dose?', 'When should I refer?'],
      };
    }

    this.state.lastChunkId = chunk.id;

    // Drift detection
    const chunkTopics = this.getChunkTopics(chunk);
    const drift = detectDrift(rewritten.rewritten, chunkTopics, this.sessionState);
    if (drift.isDrift && drift.newTopic) {
      this.sessionState.onTopicShift(drift.newTopic);
    }

    // Determine topic
    const topic = this.sessionState.currentTopic || rewritten.detectedTopic || chunkTopics[0] || '';
    if (!this.sessionState.currentTopic && topic) {
      this.sessionState.currentTopic = topic;
    }

    // Gap detection
    const gaps = detectGaps(topic, { topics: this.coverageManifest }, this.sessionState);
    this.sessionState.pendingGaps = gaps;

    // Try new answer assembly first
    let answerText = selectAnswerContent(chunk, this.sessionState, newIntent);

    // Slot-aware dose computation
    const langContent = chunk.content['en'] as Record<string, unknown> | undefined;
    if ((newIntent === 'DETAIL' || newIntent === 'PROCEDURE') && langContent?.dosage_rules) {
      const doseResult = computePatientDose(langContent.dosage_rules as DoseRule[], this.sessionState.slotMemory);
      if (doseResult) {
        answerText = doseResult;
      }
    }

    // If new assembly produced nothing, fall back to legacy composer
    if (!answerText) {
      const composed = composeResponse(chunk, this.state, mappedIntent);
      const chunkAspects = chunk.aspects || [];
      this.sessionState.addTurn(userMessage, chunk.id, chunkAspects, newIntent);
      this.sessionState.markAspectsCovered(chunkAspects);
      this.state.lastChiefComplaint = this.state.slots.chiefComplaint;
      this.recordHivaTurn(composed);
      return {
        message: composed,
        type: mappedIntent,
        chunkId: chunk.id,
        source: chunk.source,
        suggestedFollowUps: this.getFollowUpQuestions(chunk),
      };
    }

    // Build opener, closing, and chips using new engine
    const aspect = chunk.aspects?.[0] || topic;
    const opener = buildOpener(newIntent, topic, aspect, this.openerMatrix);
    const closing = buildClosing(gaps, newIntent, this.sessionState.turnCount);
    const chips = buildFollowUpChips(gaps, this.hivAssets.gapGraph, chunk.id);

    // Assemble final message
    let message = answerText;
    if (opener) {
      message = `${opener}\n\n${message}`;
    }
    if (closing && !message.trim().endsWith('?')) {
      message = `${message}\n\n${closing}`;
    }

    // Update states
    const chunkAspects = chunk.aspects || [];
    this.sessionState.addTurn(userMessage, chunk.id, chunkAspects, newIntent);
    this.sessionState.markAspectsCovered(chunkAspects);
    this.sessionState.currentTopic = topic;
    this.state.lastChiefComplaint = this.state.slots.chiefComplaint;
    this.recordHivaTurn(message);

    return {
      message,
      type: mappedIntent,
      chunkId: chunk.id,
      source: chunk.source,
      suggestedFollowUps: chips.length > 0 ? chips : this.getFollowUpQuestions(chunk),
    };
  }

  reset(): void {
    this.state = {
      turns: [],
      slots: {
        patientAge: null,
        patientWeight: null,
        symptomDuration: null,
        chiefComplaint: null,
      },
      lastChunkId: null,
      turnCount: 0,
      lastOpener: null,
      lastChiefComplaint: null,
    };
    this.sessionState = new SessionState();
  }

  getState(): ConversationState {
    return { ...this.state };
  }

  getSlots(): ConversationSlots {
    return { ...this.state.slots };
  }

  /* ─── Helpers ─── */

  private buildHivAssets(hivFile: HIVFile): HIVAssets {
    // Convert Int8Array quantized embeddings to a single Float32Array buffer
    let embeddingsBuffer: ArrayBuffer | undefined;
    if (hivFile.embeddings.length > 0 && hivFile.embeddings[0].length > 0) {
      const dims = hivFile.embeddings[0].length;
      const total = hivFile.embeddings.length;
      const buffer = new ArrayBuffer(total * dims * 4);
      const view = new Float32Array(buffer);
      for (let i = 0; i < total; i++) {
        const int8Vec = hivFile.embeddings[i];
        for (let j = 0; j < dims; j++) {
          view[i * dims + j] = int8Vec[j] / 127.0;
        }
      }
      embeddingsBuffer = buffer;
    }

    // Build chunk_id list aligned with embedding index
    const chunkIds: string[] = [];
    for (let i = 0; i < hivFile.embeddingMeta.length; i++) {
      chunkIds.push(hivFile.embeddingMeta[i]?.chunk_id ?? String(i));
    }

    return {
      embeddingsBuffer,
      embeddingsIndex: {
        dimensions: hivFile.embeddings[0]?.length,
        total_chunks: hivFile.embeddings.length,
        chunk_ids: chunkIds,
      },
      bm25Index: hivFile.lexicalIndex,
      chunks: hivFile.chunks,
      // queryProxies and gapGraph come from newer .hiv files; missing = graceful fallback
    };
  }

  private isSocialTrigger(message: string): boolean {
    const lower = message.toLowerCase().trim();
    for (const trigger of SOCIAL_TRIGGERS) {
      if (lower === trigger || lower.startsWith(trigger + ' ')) {
        const hasClinical = CLINICAL_KEYWORDS.some((k) => lower.includes(k));
        if (!hasClinical) return true;
      }
    }
    return false;
  }

  private mapIntentToOld(intent: string): IntentType {
    switch (intent) {
      case 'URGENT':
        return 'urgent';
      case 'GREETING':
        return 'greeting';
      case 'AFFIRM':
      case 'NEGATE':
      case 'DEFINE':
      case 'SCOPE':
      case 'DETAIL':
      case 'PROCEDURE':
      case 'REFERRAL': {
        // In the old system, follow-up is detected by trigger words or turn count
        if (this.state.turnCount > 1 && this.state.slots.chiefComplaint) {
          return 'follow_up';
        }
        return 'clinical';
      }
      default:
        return 'clinical';
    }
  }

  private recordHivaTurn(content: string): void {
    this.state.turns.push({
      role: 'hiva',
      content,
      timestamp: Date.now(),
    });
  }

  private matchAppFaq(message: string): { response: string; followUps: string[] } | null {
    const lower = message.toLowerCase().trim();
    for (const faq of APP_FAQ) {
      if (faq.patterns.some((p) => lower.includes(p))) {
        return { response: faq.response, followUps: faq.followUps };
      }
    }
    return null;
  }

  private extractSlots(message: string): void {
    const lower = message.toLowerCase();

    const ageMatch = lower.match(/(\d+)\s*(year|month|week|day|yr|mo|wk|dy)s?\s*old/);
    if (ageMatch) {
      this.state.slots.patientAge = `${ageMatch[1]} ${ageMatch[2]}`;
      this.sessionState.slotMemory.patientAge = this.state.slots.patientAge;
      this.sessionState.slotMemory.patientAgeMonths = this.sessionState.normalizeAge(this.state.slots.patientAge);
    }

    const weightMatch = lower.match(/(\d+(?:\.\d+)?)\s*(kg|kilos?|kgs)/);
    if (weightMatch) {
      this.state.slots.patientWeight = `${weightMatch[1]} kg`;
      this.sessionState.slotMemory.patientWeight = this.state.slots.patientWeight;
      this.sessionState.slotMemory.patientWeightKg = this.sessionState.normalizeWeight(this.state.slots.patientWeight);
    }

    const durationMatch =
      lower.match(/(\d+)\s*(day|hour|week|month)s?/) ||
      lower.match(/since\s+(yesterday|today|last\s+night|this\s+morning)/);
    if (durationMatch) {
      this.state.slots.symptomDuration = durationMatch[0];
    }

    for (const keyword of CLINICAL_KEYWORDS) {
      if (lower.includes(keyword)) {
        this.state.slots.chiefComplaint = keyword;
        this.sessionState.slotMemory.chiefComplaint = keyword;
        break;
      }
    }
  }

  /**
   * Replace anaphoric pronouns with the chiefComplaint slot value.
   */
  private resolvePronouns(message: string): string {
    const complaint = this.state.slots.chiefComplaint;
    if (!complaint) return message;

    const pronounPattern = new RegExp(
      '\\b(' + Array.from(PRONOUNS).join('|') + ')\\b',
      'gi'
    );
    return message.replace(pronounPattern, complaint);
  }

  private deduplicateQuery(query: string): string {
    const seen = new Set<string>();
    const parts: string[] = [];
    for (const part of query.split(/\s+/)) {
      const normalized = part.toLowerCase().replace(/[^\w]/g, '');
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      parts.push(part);
    }
    return parts.join(' ');
  }

  private buildSearchQuery(message: string, intent: IntentType): string {
    let cleaned = this.resolvePronouns(message);

    const parts: string[] = [cleaned];
    const lower = cleaned.toLowerCase();

    if (intent === 'follow_up' || intent === 'clinical') {
      if (this.state.slots.chiefComplaint) {
        parts.push(this.state.slots.chiefComplaint);
      }
      if (this.state.slots.patientAge) {
        parts.push(this.state.slots.patientAge);
      }
    }

    if (this.state.lastChunkId && this.hasUnresolvedPronouns(cleaned)) {
      const lastChunk = this.chunkMap.get(this.state.lastChunkId);
      if (lastChunk) {
        const topicTerms = this.getChunkTopicTerms(lastChunk);
        for (const term of topicTerms.slice(0, 3)) {
          if (term && !lower.includes(term.toLowerCase())) {
            parts.push(term);
          }
        }
      }
    }

    if (intent === 'follow_up' && this.state.lastChunkId) {
      const lastChunk = this.chunkMap.get(this.state.lastChunkId);
      if (lastChunk) {
        const topicTerms = this.getChunkTopicTerms(lastChunk);
        for (const term of topicTerms.slice(0, 2)) {
          if (term && !lower.includes(term.toLowerCase())) {
            parts.push(term);
          }
        }
      }
    }

    return this.deduplicateQuery(parts.filter(Boolean).join(' '));
  }

  private hasUnresolvedPronouns(message: string): boolean {
    const words = message.toLowerCase().split(/\s+/);
    return words.some((w) => PRONOUNS.has(w.replace(/[^\w]/g, '')));
  }

  private getChunkTopics(chunk: HIVChunk): string[] {
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

  private getChunkTopicTerms(chunk: HIVChunk): string[] {
    const terms: string[] = [];
    terms.push(chunk.type.replace(/_/g, ' '));

    const enTriggers = chunk.trigger_phrases?.en ?? [];
    for (const phrase of enTriggers.slice(0, 3)) {
      terms.push(phrase);
    }

    const enVariants = chunk.question_variants?.en ?? [];
    for (const variant of enVariants.slice(0, 2)) {
      terms.push(variant);
    }

    const enContent = chunk.content['en'] as Record<string, unknown> | undefined;
    if (enContent) {
      if (typeof enContent.title === 'string') terms.push(enContent.title);
      if (typeof enContent.topic === 'string') terms.push(enContent.topic);
      if (typeof enContent.primary_question === 'string') terms.push(enContent.primary_question);
    }

    return terms;
  }

  private getMeaningfulTerms(query: string): string[] {
    return query
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.replace(/[^\w]/g, ''))
      .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
  }

  private isChunkRelevant(chunk: HIVChunk, queryTerms: string[]): boolean {
    if (queryTerms.length === 0) return false;

    const searchable = [
      ...(chunk.trigger_phrases?.en ?? []),
      ...(chunk.question_variants?.en ?? []),
      chunk.fallback_response ?? '',
      JSON.stringify(chunk.content),
    ]
      .join(' ')
      .toLowerCase();

    return queryTerms.some((term) => searchable.includes(term));
  }

  private async findChunk(query: string, intent: IntentType): Promise<HIVChunk | null> {
    const meaningfulTerms = this.getMeaningfulTerms(query);
    const isUrgent = intent === 'urgent';

    const minVariantScore = isUrgent ? 5 : MIN_VARIANT_SCORE;
    const minBm25Score = isUrgent ? 0.5 : MIN_BM25_SCORE;

    const { matches: variantMatches } = variantSearch(query, this.hivFile, 5);
    if (variantMatches.length > 0 && variantMatches[0].score >= minVariantScore) {
      const chunk = this.chunkMap.get(variantMatches[0].chunk_id);
      if (chunk && (isUrgent || this.isChunkRelevant(chunk, meaningfulTerms))) {
        return chunk;
      }
    }

    const bm25Results = bm25Search(query, this.hivFile, 'en', 5);
    if (bm25Results.length > 0 && bm25Results[0].score >= minBm25Score) {
      const chunk = this.chunkMap.get(bm25Results[0].chunk_id);
      if (chunk && (isUrgent || this.isChunkRelevant(chunk, meaningfulTerms))) {
        return chunk;
      }
    }

    return null;
  }

  private getFollowUpQuestions(chunk: HIVChunk): string[] {
    const langContent = chunk.content['en'] as Record<string, unknown> | undefined;
    if (!langContent) return ['Tell me more', 'What\'s the dose?', 'When should I refer?'];

    const followUps = langContent.follow_up_questions;
    if (Array.isArray(followUps) && followUps.length > 0) {
      return followUps.slice(0, 3).map(String);
    }

    if (chunk.type === 'drug_table') {
      return ['What\'s the dose?', 'Any side effects?', 'How long to take?'];
    }
    if (chunk.type === 'danger_sign') {
      return ['What should I do now?', 'How do I refer?', 'First aid steps?'];
    }
    if (chunk.type === 'decision_tree') {
      return ['What\'s the next step?', 'When to refer?', 'What are the options?'];
    }

    return ['Tell me more', 'What\'s the dose?', 'When should I refer?'];
  }
}
