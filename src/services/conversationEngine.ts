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
import { search, initSearch, setEmbedQueryFn, type HIVAssets } from '@/engine/hybridSearch';
import {
  selectAnswerContent,
  computePatientDose,
  buildOpener,
  buildClosing,
  buildFollowUpChips,
  type DoseRule,
} from '@/engine/answerAssembler';
import { detectDrift, extractPrimaryTopic } from '@/engine/driftDetector';
import { buildFallback } from '@/engine/fallbackHandler';
import { getAppFaqResponse } from '@/engine/appFaqDetector';
import { isOutOfScope } from '@/engine/queryPatternRouter';
import {
  isShortGreeting,
  isSocialTrigger,
  hasClinicalKeywords,
  getGreetingResponse,
  getSocialResponse,
  CLINICAL_KEYWORDS,
} from '@/engine/greetingHandler';
import { generateHivReport } from '@/engine/debugReport';
import { reportError } from '@/services/telemetry';
import { isEmbeddingModelReady } from '@/services/modelManager';
import { embedQuery } from '@/services/embeddingModel';

export type { ConversationState, ConversationTurn, ConversationSlots, IntentType, EngineResponse };

export class ConversationEngine {
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

    // Wire up on-device embedding model for semantic vector search
    if (isEmbeddingModelReady()) {
      setEmbedQueryFn(embedQuery);
    }

    // Warn if critical engine features are missing
    if (!this.hivAssets.gapGraph || Object.keys(this.hivAssets.gapGraph).length === 0) {
      // eslint-disable-next-line no-console
      console.warn('[HIVA] gap_graph loaded but has no edges — chips will be generic');
    }
    if (!this.hivAssets.coverageManifest?.topics ||
        Object.keys(this.hivAssets.coverageManifest.topics).length === 0) {
      // eslint-disable-next-line no-console
      console.warn('[HIVA] coverage_manifest loaded but has no topics — gap detection disabled');
    }

  }

  async respond(userMessage: string): Promise<EngineResponse> {
    // Increment turn count immediately for greeting/intent logic
    this.sessionState.turnCount += 1;

    // Extract slots
    this.extractSlots(userMessage);

    // New intent classification
    const newIntent = classifyIntent(userMessage);

    // Probe sentiment and push to session state
    const sentiment = probeSentiment(userMessage);
    this.sessionState.pushSentiment(sentiment as import('@/engine/sessionState').Sentiment);

    // App FAQ
    const appFaqMatch = getAppFaqResponse(userMessage);
    if (appFaqMatch) {
      return {
        message: appFaqMatch.response,
        type: 'greeting',
        chunkId: null,
        suggestedFollowUps: appFaqMatch.followUps,
      };
    }

    // Out-of-scope detection (BEFORE search)
    if (isOutOfScope(userMessage)) {
      return {
        message: 'That question is outside my clinical knowledge area. I focus on HIV, TB, maternal health, child health, and related medical topics. Can I help you with something clinical?',
        type: 'fallback',
        chunkId: null,
        suggestedFollowUps: ['HIV treatment guidelines', 'TB screening', 'Newborn care'],
      };
    }

    // Clinical FAQ (pattern-matched Q&A pairs) - DISABLED for now to prevent false matches
    // const clinicalFaqMatch = getClinicalFaqResponse(userMessage);
    // if (clinicalFaqMatch) {
    //   return {
    //     message: clinicalFaqMatch.response,
    //     type: 'clinical',
    //     chunkId: null,
    //     suggestedFollowUps: clinicalFaqMatch.followUps,
    //   };
    // }

    // Handle greeting or social acknowledgment
    const hasActiveTopic = !!this.sessionState.currentTopic;
    const hasClinical = hasClinicalKeywords(userMessage);
    const shortGreeting = isShortGreeting(userMessage, this.sessionState.turnCount);
    const socialTrigger = isSocialTrigger(userMessage, hasActiveTopic, hasClinical);

    if (newIntent === 'GREETING' || socialTrigger || shortGreeting) {
      const message = socialTrigger
        ? getSocialResponse(this.sessionState.turnCount)
        : getGreetingResponse(this.sessionState.turnCount);

      return {
        message,
        type: 'greeting',
        chunkId: null,
        suggestedFollowUps: socialTrigger ? [] : ['What can you do?', 'How do you work offline?', 'How do I search?'],
      };
    }

    // Map new intent to old IntentType for backward-compatible response shape
    const mappedIntent = this.mapIntentToOld(newIntent);

    // Rewrite query using new engine
    const rewritten = rewriteQuery(userMessage, newIntent, this.sessionState);

    // Note: topic shift from rewriter is NOT applied here — extractPrimaryTopic()
    // handles topic transitions after search with proper confidence gating.

    // Hybrid search (new engine — async for dense variant embedding).
    // Guard the whole search: any failure (e.g. embedding error while offline)
    // must produce a graceful clinical fallback, never reject and freeze the UI.
    initSearch(this.hivAssets);

    // Lazily wire the embedding model if it became ready after construction
    if (isEmbeddingModelReady()) {
      setEmbedQueryFn(embedQuery);
    }

    let searchResult: Awaited<ReturnType<typeof search>> = null;
    try {
      searchResult = await search(rewritten.rewritten, this.sessionState, 'en', this.hivAssets);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn('[HIVA][telemetry]', JSON.stringify({
        event: 'engine_search_failed',
        message,
        ts: Date.now(),
      }));
      void reportError('engine_search_failed', message);
      const fallback = buildFallback(rewritten.rewritten, this.sessionState, { topics: this.coverageManifest });
      return {
        message: fallback,
        type: 'fallback',
        chunkId: null,
        suggestedFollowUps: ['Tell me more', 'What\'s the dose?', 'When should I refer?'],
      };
    }

    // null means the embedding model is still loading — show a temporary message
    if (searchResult === null) {
      return {
        message: 'I\'m still preparing the clinical guidelines — please ask again in a few seconds.',
        type: 'fallback',
        chunkId: null,
        suggestedFollowUps: ['Tell me more', 'What\'s the dose?', 'When should I refer?'],
      };
    }

    let chunk: HIVChunk | null = null;
    chunk = this.chunkMap.get(searchResult.chunkId) ?? null;

    if (!chunk) {
      const fallback = buildFallback(rewritten.rewritten, this.sessionState, { topics: this.coverageManifest });
      return {
        message: fallback,
        type: 'fallback',
        chunkId: null,
        suggestedFollowUps: ['Tell me more', 'What\'s the dose?', 'When should I refer?'],
      };
    }

    this.sessionState.lastChunkId = chunk.id;

    // Drift detection
    const chunkTopics = this.getChunkTopics(chunk);
    const drift = detectDrift(rewritten.rewritten, chunkTopics, this.sessionState);
    if (drift.isDrift && drift.newTopic) {
      this.sessionState.onTopicShift(drift.newTopic);
    }

    // Determine primary topic using 3-priority cascade
    const fusedScore = searchResult?.score ?? 0;
    const topic = extractPrimaryTopic(
      userMessage,
      chunkTopics,
      this.sessionState,
      this.coverageManifest,
      fusedScore
    );

    // Only update sessionState.currentTopic if confident signal exists
    if (topic && topic !== this.sessionState.currentTopic) {
      const queryLower = userMessage.toLowerCase();
      const topicTokens = topic.toLowerCase().split(/\s+/).filter((t: string) => t.length >= 2);
      const queryTokens = queryLower.split(/\s+/).filter((t: string) => t.length >= 2);
      const userNamedIt = topicTokens.some((t: string) => queryTokens.includes(t));

      if (userNamedIt || fusedScore > 0.6 || !this.sessionState.currentTopic) {
        this.sessionState.currentTopic = topic;
      }
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

    // If no answer content, return fallback
    if (!answerText) {
      const fallback = 'I found relevant information, but the content is not available in this release.';
      // recordHivaTurn removed(fallback);
      return {
        message: fallback,
        type: 'fallback',
        chunkId: chunk.id,
        source: chunk.source,
        suggestedFollowUps: ['Tell me more', 'What\'s the dose?', 'When should I refer?'],
      };
    }

    // Build opener, closing, and chips using new engine
    const aspect = chunk.aspects?.[0] || topic;
    const opener = buildOpener(
      newIntent,
      chunk?.display_title || topic,
      aspect,
      this.openerMatrix
    );
    const closing = buildClosing(gaps, newIntent, this.sessionState);
    const chunkMap = new Map(this.hivFile.chunks.map((c) => [c.id, c]));
    const chips = buildFollowUpChips(gaps, this.hivAssets.gapGraph, chunk.id, chunkMap);

    // Warn if chips are dropped (UI layer should display them)
    if (chips.length === 0) {
      // eslint-disable-next-line no-console
      console.warn('[HIVA Engine] buildFollowUpChips returned empty array for chunk', chunk.id);
    }

    // Assemble final message
    let message = answerText;
    if (opener) {
      message = `${opener}\n\n${message}`;
    }
    if (closing && !message.trim().endsWith('?')) {
      message = `${message}\n\n${closing}`;
    }

    // Append companion_note if present (colleague aside, not clinical answer)
    const companionNote = (langContent as Record<string, unknown> | undefined)?.companion_note;
    if (typeof companionNote === 'string' && companionNote.trim().length > 0) {
      message = `${message}\n\n\u2014 ${companionNote.trim()}`;
    }

    // Update states (don't double-increment turnCount since we already did it at the start)
    const chunkAspects = chunk.aspects || [];
    this.sessionState.turnBuffer.push({
      query: userMessage,
      chunkId: chunk.id,
      aspects: chunkAspects,
      intent: newIntent,
    });
    if (this.sessionState.turnBuffer.length > 8) {
      this.sessionState.turnBuffer.shift();
    }
    // Only mark aspects covered if the response is not a deflection
    if (!this.isDeflectionResponse(answerText)) {
      this.sessionState.markAspectsCovered(chunkAspects);
    }
    if (chunk.id) {
      this.sessionState.coveredChunks.add(chunk.id);
    }
    if (!this.sessionState.currentTopic && topic) {
      this.sessionState.currentTopic = topic;
    }
    this.sessionState.lastChiefComplaint = this.sessionState.slotMemory.chiefComplaint;
    // recordHivaTurn removed(message);

    return {
      message,
      type: mappedIntent,
      chunkId: chunk.id,
      source: chunk.source,
      suggestedFollowUps: chips.length > 0 ? chips : this.getFollowUpQuestions(chunk),
    };
  }

  reset(): void {
    this.sessionState = new SessionState();
  }

  getState(): ConversationState {
    // For backward compatibility, return old state format from sessionState
    return {
      turns: this.sessionState.turnBuffer.map(t => ({
        role: t.chunkId ? ('hiva' as const) : ('user' as const),
        content: t.query,
        timestamp: Date.now(),
      })),
      slots: {
        patientAge: this.sessionState.slotMemory.patientAge,
        patientWeight: this.sessionState.slotMemory.patientWeight,
        symptomDuration: null, // deprecated
        chiefComplaint: this.sessionState.slotMemory.chiefComplaint,
      },
      lastChunkId: this.sessionState.lastChunkId,
      turnCount: this.sessionState.turnCount,
      lastOpener: this.sessionState.lastOpener,
      lastChiefComplaint: this.sessionState.lastChiefComplaint,
    };
  }

  getSlots(): ConversationSlots {
    return {
      patientAge: this.sessionState.slotMemory.patientAge,
      patientWeight: this.sessionState.slotMemory.patientWeight,
      symptomDuration: null, // deprecated
      chiefComplaint: this.sessionState.slotMemory.chiefComplaint,
    };
  }

  debugHivReport(): string {
    return generateHivReport(this.hivAssets);
  }

  /* ─── Helpers ─── */

  private isDeflectionResponse(answer: string): boolean {
    const text = answer.trim();

    // Pattern 1: "I can help with X. Tell me [more/what/which]"
    if (/^I can help with .+\.\s*Tell me/i.test(text)) return true;

    // Pattern 2: Ends with an open question after minimal content
    // Short responses (under 60 words) that end with "Tell me..."
    const wordCount = text.split(/\s+/).length;
    if (wordCount < 60 && /Tell me (more|what|which|about)/i.test(text)) {
      return true;
    }

    // Pattern 3: Explicit deflection phrases
    const deflectionPhrases = [
      /Tell me more about your (patient|role|situation|query)/i,
      /Tell me what (type|kind|aspect|specific)/i,
      /What specific (aspect|type|area|information)/i,
      /Can you (tell me|provide) more (about|details)/i,
      /Please (tell me|provide|share) more/i,
    ];
    if (deflectionPhrases.some(p => p.test(text))) return true;

    // Pattern 4: Last sentence is a redirect question
    // ("Should I explain...", "Want me to...", "Would you like me to...")
    const lastSentence = text.split(/[.!]\s*/).filter(s => s.trim()).pop() ?? '';
    if (/\b(should I|want me to|would you like me to)\b.{0,60}\?$/i.test(lastSentence.trim())) {
      return true;
    }

    return false;
  }

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

    // Use chunk IDs from embeddings_index.json
    const chunkIds = hivFile.embeddingChunkIds || [];

    // Get coverage manifest from rules (already has { topics: {...} } structure)
    const manifestExt = hivFile.manifest as unknown as Record<string, unknown>;
    const coverageManifestFromFile =
      (manifestExt.coverage_manifest as HIVAssets['coverageManifest']) ||
      (hivFile.rules?.coverage_manifest as HIVAssets['coverageManifest']) ||
      ({} as HIVAssets['coverageManifest']);

    return {
      embeddingsBuffer,
      embeddingsIndex: {
        dimensions: hivFile.embeddings[0]?.length,
        total_chunks: hivFile.embeddings.length,
        chunk_ids: chunkIds,
      },
      queryProxies: hivFile.queryProxies,
      bm25Index: hivFile.lexicalIndex,
      chunks: hivFile.chunks,
      gapGraph: hivFile.gapGraph,
      coverageManifest: coverageManifestFromFile,
      variantEmbeddings: hivFile.variantEmbeddings ?? null,
      variantEmbeddingsIndex: hivFile.variantEmbeddingsIndex ?? null,
      variantCount: hivFile.variantCount ?? 0,
      embeddingDims: hivFile.embeddingDims ?? 384,
      chunkTitleMap: new Map(hivFile.chunks.map(c => [c.id, c.display_title || ''])),
      chunkContentMap: new Map(hivFile.chunks.map(c => {
        // Build searchable text from title + content
        const title = c.display_title || '';
        const contentObj = (c.content as Record<string, any>)?.en;
        let contentText = '';

        if (contentObj) {
          // Extract text from various content fields
          const extractText = (obj: any): string => {
            if (typeof obj === 'string') return obj;
            if (Array.isArray(obj)) return obj.map(extractText).join(' ');
            if (obj && typeof obj === 'object') {
              return Object.values(obj).map(extractText).join(' ');
            }
            return '';
          };
          contentText = extractText(contentObj);
        }

        return [c.id, (title + ' ' + contentText).toLowerCase()];
      })),
    };
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
      case 'REFERRAL':
      case 'HEADING_LOOKUP': {
        // In the old system, follow-up is detected by trigger words or turn count
        if (this.sessionState.turnCount > 1 && this.sessionState.slotMemory.chiefComplaint) {
          return 'follow_up';
        }
        return 'clinical';
      }
      default:
        return 'clinical';
    }
  }


  private hasPatientReference(query: string): boolean {
    const signals = [
      /\bpatient\b/i, /\bmy patient\b/i, /\bthe baby\b/i, /\bbaby\b/i,
      /\bthe child\b/i, /\bchild\b/i, /\bthe mother\b/i, /\bmother\b/i,
      /\bpikin\b/i, /\byears? old\b/i, /\bmonths? old\b/i, /\bweeks? old\b/i,
      /\bdays? old\b/i, /\bkg\b/i, /\bpregnant\b/i, /\bshe\b/i, /\bhe\b/i,
      /\bthe woman\b/i, /\bthe man\b/i, /\bher\b/i, /\bhim\b/i,
      /\binfant\b/i, /\btoddler\b/i, /\bboy\b/i, /\bgirl\b/i,
    ];
    return signals.some(p => p.test(query));
  }

  private isInformationalQuery(query: string): boolean {
    // Queries that are clearly asking ABOUT a topic, not treating a patient
    const informationalPatterns = [
      /\bwhat is\b/i, /\bwhat are\b/i, /\bwhat does\b/i,
      /\bdefine\b/i, /\bexplain\b/i, /\btell me about\b/i,
      /\bcoverage\b/i, /\binsurance\b/i, /\bnhis\b/i, /\bscheme\b/i,
      /\beligibility\b/i, /\baccreditation\b/i, /\bregistration\b/i,
      /\brequirements\b/i, /\bhow to register\b/i, /\bhow to enroll\b/i,
    ];
    return informationalPatterns.some(p => p.test(query));
  }

  private extractSlots(message: string): void {
    const lower = message.toLowerCase();

    const ageMatch = lower.match(/(\d+)\s*(year|month|week|day|yr|mo|wk|dy)s?\s*old/);
    if (ageMatch) {
      const ageStr = `${ageMatch[1]} ${ageMatch[2]}`;
      this.sessionState.slotMemory.patientAge = ageStr;
      this.sessionState.slotMemory.patientAgeMonths = this.sessionState.normalizeAge(ageStr);
    }

    const weightMatch = lower.match(/(\d+(?:\.\d+)?)\s*(kg|kilos?|kgs)/);
    if (weightMatch) {
      const weightStr = `${weightMatch[1]} kg`;
      this.sessionState.slotMemory.patientWeight = weightStr;
      this.sessionState.slotMemory.patientWeightKg = this.sessionState.normalizeWeight(weightStr);
    }

    // Note: symptomDuration not used in new engine; could be removed

    // Only set chiefComplaint if NOT a purely informational query
    // OR if there's an explicit patient reference
    if (!this.isInformationalQuery(message) || this.hasPatientReference(message)) {
      for (const keyword of CLINICAL_KEYWORDS) {
        if (lower.includes(keyword)) {
          this.sessionState.slotMemory.chiefComplaint = keyword;
          break;
        }
      }
    }
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
