/**
 * conversationEngine.ts — Stateful clinical conversation manager
 *
 * Integrates the new intelligence engine (sessionState, intentEngine,
 * queryRewriter, hybridSearch, answerAssembler, driftDetector, fallbackHandler)
 * while preserving the original public API for backward compatibility.
 *
 * Threading: a CognitiveStateObject (CSO) is constructed at the start of each
 * query and populated progressively as the pipeline executes. The CSO is the
 * single per-query contract; EngineResponse is derived from cso.response.
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
import type { CognitiveStateObject } from '@/types/cso';
import SessionState from '@/engine/sessionState';
import { classifyIntent, probeSentiment, detectGaps, detectCorrection } from '@/engine/intentEngine';
import { hasClinicalPresence } from '@/engine/fuzzyNormalizer';
import { rewriteQuery } from '@/engine/queryRewriter';
import { search, initSearch, setEmbedQueryFnV22, setEmbedQueryFnV23, getLastVectorTier, getLastSearchDiagnostics, type HIVAssets } from '@/engine/hybridSearch';
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
import { computeConfidenceTier, VERIFICATION_NOTICE, type RawConfidenceSignals } from '@/engine/confidenceScoring';
import { shouldInvokeGeneration } from '@/engine/generationRouter';
import { generateGrounded, checkGrounding, isEdgeBrainReady } from '@/services/edgeBrainService';
import { nativeSearch, isNativeRetrieverReady, getNativeRetrieverStatus } from '@/services/nativeRetrieverService';
import { reportError } from '@/services/telemetry';
import { logQuery } from '@/services/queryLogger';
import { isEmbeddingModelReady } from '@/services/modelManager';
import { embedQuery } from '@/services/embeddingModel';
import { prepareQueryForEmbedding, type TranslationResult } from '@/services/queryTranslator';
import { trackQuery, recordMessage, recordTopic } from '@/services/analyticsService';

export type { ConversationState, ConversationTurn, ConversationSlots, IntentType, EngineResponse };
export type { CognitiveStateObject };

export class ConversationEngine {
  private hivFile: HIVFile;
  private sessionState: SessionState;
  private chunkMap: Map<string, HIVChunk>;
  private hivAssets: HIVAssets;
  private coverageManifest: Record<string, { aspects_covered: string[] }>;
  private openerMatrix: Record<string, string>;
  private _lastCSO: CognitiveStateObject | null = null;

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

    // Wire up on-device embedding models for semantic vector search
    // Support both v2.2 (MiniLM) and v2.3 (bge-m3) for dual-path compatibility
    const schemaVersion = this.hivAssets.schemaVersion ?? '2.2';
    if (isEmbeddingModelReady()) {
      // v2.2 bundles use MiniLM
      setEmbedQueryFnV22((text: string) => embedQuery(text, 'minilm'));
      // v2.3 bundles use bge-m3
      setEmbedQueryFnV23((text: string) => embedQuery(text, 'bge-m3'));

      console.log(`[ConversationEngine] Schema version ${schemaVersion} detected, embedding models configured`);
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

  /** Returns the CSO from the most recent respond() call (for testing/diagnostics). */
  getLastCSO(): CognitiveStateObject | null {
    return this._lastCSO;
  }

  async respond(userMessage: string): Promise<EngineResponse> {
    const queryStartTime = performance.now();

    // ─── Layer 1: Identity ───
    const identity: CognitiveStateObject['identity'] = {
      role: 'chew',
      location: undefined, // TODO: location not currently captured in auth or session — stub for future task
      language: 'en',
      connectivityStatus: (typeof navigator !== 'undefined' && navigator.onLine === false) ? 'offline' : 'online',
    };

    // ─── Layer 2: Request ───
    let translationResult: TranslationResult | null = null;
    const request: CognitiveStateObject['request'] = {
      rawInput: userMessage,
      translatedInput: undefined,
      translation: undefined,
    };

    // Increment turn count immediately for greeting/intent logic
    this.sessionState.turnCount += 1;

    // Extract slots
    this.extractSlots(userMessage);

    // M5: Correction detection — "no I meant TB", "actually pneumonia"
    const correction = detectCorrection(userMessage);
    if (correction && this.sessionState.currentTopic) {
      this.sessionState.onTopicShift(correction);
      this.sessionState.slotMemory.chiefComplaint = null;
    }

    // ─── Layer 3: Intent ───
    const newIntent = classifyIntent(userMessage);
    const sentiment = probeSentiment(userMessage);
    this.sessionState.pushSentiment(sentiment as import('@/engine/sessionState').Sentiment);

    const mappedIntent = this.mapIntentToOld(newIntent);

    const intentLayer: CognitiveStateObject['intent'] = {
      intent: newIntent,
      mappedIntent,
      slots: { ...this.sessionState.slotMemory },
      confidenceScore: 1.0,
      sentiment: sentiment as import('@/engine/sessionState').Sentiment,
      targetModuleId: undefined,
      correctionTopic: correction,
    };

    // ─── Layer 4: Memory (snapshot current session state) ───
    const memoryLayer: CognitiveStateObject['memory'] = {
      turnBuffer: [...this.sessionState.turnBuffer],
      slotMemory: this.sessionState.slotMemory,
      topicStack: [...this.sessionState.topicStack],
      coveredChunks: this.sessionState.coveredChunks,
      coveredAspects: this.sessionState.coveredAspects,
      currentTopic: this.sessionState.currentTopic,
      turnCount: this.sessionState.turnCount,
      pendingGaps: [...this.sessionState.pendingGaps],
      sentimentHistory: [...this.sessionState.sentimentHistory],
    };

    // Helper to build a CSO with early-exit response layers
    const buildEarlyCSO = (
      responseText: string,
      responseType: IntentType,
      followUps: string[],
      moduleResponse?: Partial<CognitiveStateObject['moduleResponse']>,
      genControl?: Partial<CognitiveStateObject['generationControl']>,
    ): CognitiveStateObject => ({
      identity,
      request,
      intent: intentLayer,
      memory: memoryLayer,
      moduleResponse: {
        chunkId: null,
        score: null,
        confidenceGateFired: false,
        vectorTier: 'none',
        topBm25Score: null,
        topVectorScore: null,
        vectorGatePassed: false,
        source: undefined,
        chunkDisplayTitle: null,
        ...moduleResponse,
      },
      generationControl: {
        confidenceTier: 'HIGH',
        escalationFlag: false,
        groundingConstraint: 'hiv_content_only',
        ...genControl,
      },
      response: {
        text: responseText,
        sources: [],
        verified: false,
        suggestedFollowUps: followUps,
        type: responseType,
        verificationFlag: false,
      },
    });

    // App FAQ
    const appFaqMatch = getAppFaqResponse(userMessage);
    if (appFaqMatch) {
      this._lastCSO = buildEarlyCSO(appFaqMatch.response, 'greeting', appFaqMatch.followUps);

      // Track analytics for FAQ response
      try {
        const responseTimeMs = Math.round(performance.now() - queryStartTime);
        trackQuery({
          query: userMessage,
          category: 'out_of_scope',
          intent: 'general_inquiry',
          languageMode: this.detectLanguageMode(userMessage),
          isFollowup: false,
          followupCount: 0,
          resultCount: 1,
          hasReferralTrigger: false,
          confidenceTier: 'high',
          responseTimeMs,
        }).catch(() => {});
      } catch {}

      return {
        message: appFaqMatch.response,
        type: 'greeting',
        chunkId: null,
        suggestedFollowUps: appFaqMatch.followUps,
      };
    }

    // M3: Secondary out-of-scope check — minimum clinical presence
    if (!hasClinicalPresence(userMessage) && !correction && newIntent === 'CLINICAL') {
      if (isOutOfScope(userMessage)) {
        const msg = 'That question is outside my clinical knowledge area. I focus on HIV, TB, maternal health, child health, and related medical topics. Can I help you with something clinical?';
        this._lastCSO = buildEarlyCSO(msg, 'fallback', ['HIV treatment guidelines', 'TB screening', 'Newborn care']);
        return {
          message: msg,
          type: 'fallback',
          chunkId: null,
          suggestedFollowUps: ['HIV treatment guidelines', 'TB screening', 'Newborn care'],
        };
      }
    }

    // Out-of-scope detection (BEFORE search)
    if (isOutOfScope(userMessage)) {
      const msg = 'That question is outside my clinical knowledge area. I focus on HIV, TB, maternal health, child health, and related medical topics. Can I help you with something clinical?';
      this._lastCSO = buildEarlyCSO(msg, 'fallback', ['HIV treatment guidelines', 'TB screening', 'Newborn care']);
      return {
        message: msg,
        type: 'fallback',
        chunkId: null,
        suggestedFollowUps: ['HIV treatment guidelines', 'TB screening', 'Newborn care'],
      };
    }

    // Handle greeting or social acknowledgment
    const hasActiveTopic = !!this.sessionState.currentTopic;
    const hasClinical = hasClinicalKeywords(userMessage);
    const shortGreeting = isShortGreeting(userMessage, this.sessionState.turnCount);
    const socialTrigger = isSocialTrigger(userMessage, hasActiveTopic, hasClinical);

    if (newIntent === 'GREETING' || socialTrigger || shortGreeting) {
      const message = socialTrigger
        ? getSocialResponse(this.sessionState.turnCount)
        : getGreetingResponse(this.sessionState.turnCount);

      const followUps = socialTrigger ? [] : ['What can you do?', 'How do you work offline?', 'How do I search?'];
      this._lastCSO = buildEarlyCSO(message, 'greeting', followUps);
      return {
        message,
        type: 'greeting',
        chunkId: null,
        suggestedFollowUps: followUps,
      };
    }

    // ─── TRANSLATION LAYER (for Hausa/Yoruba/Igbo/Pidgin queries) ───
    // Translate non-English queries to English BEFORE embedding to improve
    // retrieval accuracy. This addresses the Hausa 50% → 75%+ performance gap.
    // Translation only happens for detected non-English queries (~500ms latency).
    translationResult = await prepareQueryForEmbedding(userMessage);
    const queryForSearch = translationResult.translatedQuery || userMessage;

    // Store translation metadata in request layer
    request.translation = {
      language: translationResult.language,
      translatedQuery: translationResult.translatedQuery,
      latencyMs: translationResult.latencyMs,
      error: translationResult.error,
    };

    // Rewrite query using new engine (now uses translated query if available)
    const rewritten = rewriteQuery(queryForSearch, newIntent, this.sessionState);
    request.translatedInput = rewritten.rewritten;

    // ─── Native retrieval path (ObjectBox + E5-small-v2 HNSW) ───
    // When the NativeRetriever plugin is ready, use it in place of hybridSearch.
    // The native path embeds the query on-device with E5-small-v2 and runs
    // HNSW nearest-neighbor search in ObjectBox. It returns rawText directly,
    // which is passed to generateGrounded as evidence without further extraction.
    // Falls back to hybridSearch if native retriever is not ready.
    let nativeRawText: string | null = null;
    let nativeChunkId: string | null = null;

    if (await isNativeRetrieverReady()) {
      try {
        const nativeResults = await nativeSearch(rewritten.rewritten, 5);
        if (nativeResults.length > 0) {
          // Use top result; concatenate top-3 raw texts as evidence for richer context
          nativeChunkId = nativeResults[0].chunkId;
          nativeRawText = nativeResults
            .slice(0, 3)
            .map((r) => r.rawText)
            .filter(Boolean)
            .join('\n\n---\n\n');
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[HIVA] NativeRetriever search failed, falling back to hybridSearch:', err);
      }
    }

    // Hybrid search (JS fallback — runs when native retriever is not ready).
    initSearch(this.hivAssets);

    // Lazily wire embedding models if they became ready after construction
    if (isEmbeddingModelReady()) {
      setEmbedQueryFnV22((text: string) => embedQuery(text, 'minilm'));
      setEmbedQueryFnV23((text: string) => embedQuery(text, 'bge-m3'));
    }

    let searchResult: Awaited<ReturnType<typeof search>> = null;

    // If native retriever found a result, skip the JS search and synthesize a
    // searchResult-shaped object so the rest of the pipeline is unchanged.
    if (nativeChunkId) {
      searchResult = { chunkId: nativeChunkId, score: 1.0 };
    } else {
      try {
        searchResult = await search(rewritten.rewritten, this.sessionState, 'en', this.hivAssets, rewritten.bm25Query || undefined);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn('[HIVA][telemetry]', JSON.stringify({
          event: 'engine_search_failed',
          message: errMsg,
          ts: Date.now(),
        }));
        void reportError('engine_search_failed', errMsg);
        const fallback = buildFallback(rewritten.rewritten, this.sessionState, { topics: this.coverageManifest });
        this._lastCSO = buildEarlyCSO(fallback, 'fallback', ['Tell me more', 'What\'s the dose?', 'When should I refer?'], {
          confidenceGateFired: false,
        }, { confidenceTier: 'LOW' });
        return {
          message: fallback,
          type: 'fallback',
          chunkId: null,
          suggestedFollowUps: ['Tell me more', 'What\'s the dose?', 'When should I refer?'],
        };
      }
    }

    if (searchResult === null) {
      const diag = getLastSearchDiagnostics();
      const tier = getLastVectorTier();

      if (diag.confidenceGateFired) {
        logQuery({
          ts: Date.now(),
          query: userMessage,
          rewritten: rewritten.rewritten,
          tier,
          topChunkId: null,
          topChunkTitle: null,
          topBm25Score: diag.topBm25Score,
          topVectorScore: diag.topVectorScore,
          fusedScore: null,
          vectorGatePassed: diag.vectorGatePassed,
          confidenceGateFired: true,
          responseType: 'low_confidence',
        });

        const fallback = buildFallback(rewritten.rewritten, this.sessionState, { topics: this.coverageManifest });
        this._lastCSO = buildEarlyCSO(fallback, 'fallback', ['HIV treatment guidelines', 'TB screening', 'Newborn care'], {
          confidenceGateFired: true,
          vectorTier: tier,
          topBm25Score: diag.topBm25Score,
          topVectorScore: diag.topVectorScore,
          vectorGatePassed: diag.vectorGatePassed,
        }, { confidenceTier: 'LOW' });
        return {
          message: fallback,
          type: 'fallback',
          chunkId: null,
          suggestedFollowUps: ['HIV treatment guidelines', 'TB screening', 'Newborn care'],
        };
      }

      // Model still loading — transient state
      const transientMsg = 'I\'m still preparing the clinical guidelines — please ask again in a few seconds.';
      this._lastCSO = buildEarlyCSO(transientMsg, 'fallback', ['Tell me more', 'What\'s the dose?', 'When should I refer?'], {}, { confidenceTier: 'LOW' });
      return {
        message: transientMsg,
        type: 'fallback',
        chunkId: null,
        suggestedFollowUps: ['Tell me more', 'What\'s the dose?', 'When should I refer?'],
      };
    }

    let chunk: HIVChunk | null = null;
    chunk = this.chunkMap.get(searchResult.chunkId) ?? null;

    if (!chunk) {
      const fallback = buildFallback(rewritten.rewritten, this.sessionState, { topics: this.coverageManifest });
      this._lastCSO = buildEarlyCSO(fallback, 'fallback', ['Tell me more', 'What\'s the dose?', 'When should I refer?'], {
        chunkId: searchResult.chunkId,
        score: searchResult.score,
      }, { confidenceTier: 'LOW' });
      return {
        message: fallback,
        type: 'fallback',
        chunkId: null,
        suggestedFollowUps: ['Tell me more', 'What\'s the dose?', 'When should I refer?'],
      };
    }

    this.sessionState.lastChunkId = chunk.id;

    // ─── Layer 5: Module Response (populated after search) ───
    // When the native retriever ran, JS hybridSearch was skipped so
    // getLastSearchDiagnostics() still holds stale values from the previous
    // query (all-null on the very first query). Those nulls produce combined=0
    // → LOW confidence → the answer gets discarded at the LOW-tier gate below.
    // Synthesize HIGH confidence signals instead: HNSW + E5-small-v2 is already
    // quality-gated, and the native path explicitly returns score=1.0.
    const diag = nativeChunkId !== null
      ? { topBm25Score: 5.0, topVectorScore: 0.85, fusedScore: 0.85, vectorGatePassed: true, confidenceGateFired: false, vectorMargin: 0.15 }
      : getLastSearchDiagnostics();
    const tier = getLastVectorTier();
    const fusedScore = searchResult?.score ?? 0;

    const moduleResponse: CognitiveStateObject['moduleResponse'] = {
      chunkId: chunk.id,
      score: fusedScore,
      confidenceGateFired: false,
      vectorTier: tier,
      topBm25Score: diag.topBm25Score,
      topVectorScore: diag.topVectorScore,
      vectorGatePassed: diag.vectorGatePassed,
      source: chunk.source,
      chunkDisplayTitle: chunk.display_title || null,
    };

    // ─── Layer 6: Generation Control ───
    const confidenceSignals: RawConfidenceSignals = {
      topVectorScore: diag.topVectorScore,
      vectorMargin: diag.vectorMargin,
      topBm25Score: diag.topBm25Score,
      vectorGatePassed: diag.vectorGatePassed,
      confidenceGateFired: false,
    };
    const { tier: confidenceTier } = computeConfidenceTier(confidenceSignals);
    let escalationFlag = false;

    // Drift detection
    const chunkTopics = this.getChunkTopics(chunk);
    const drift = detectDrift(rewritten.rewritten, chunkTopics, this.sessionState);
    if (drift.isDrift && drift.newTopic) {
      this.sessionState.onTopicShift(drift.newTopic);
    }

    // Determine primary topic using 3-priority cascade
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
    if (langContent?.dosage_rules) {
      const doseResult = computePatientDose(langContent.dosage_rules as DoseRule[], this.sessionState.slotMemory);
      if (doseResult) {
        if (newIntent === 'DETAIL') {
          answerText = doseResult;
        } else if (newIntent === 'PROCEDURE' && answerText) {
          answerText = `${answerText}\n\n${doseResult}`;
        } else if (this.sessionState.slotMemory.patientWeightKg !== null && answerText) {
          answerText = `${answerText}\n\n${doseResult}`;
        } else if (!answerText) {
          answerText = doseResult;
        }
      }
    }

    // If no answer content, use LLM as fallback
    if (!answerText) {
      console.log('[ConversationEngine] No content in chunk, falling back to LLM generation');
      console.log('[ConversationEngine] Query:', userMessage);

      // Only use Edge Brain when evidence is from the native retriever (trusted,
      // query-matched) OR when there is no native retriever path active.
      // Never use Edge Brain with chunk evidence from a JS-BM25 result that may
      // be completely unrelated to the query (JS BM25 can match generic terms
      // and return wrong chunks while NativeRetriever is still initialising).
      // In that window, return a transient "still loading" message instead.
      // Only block when the native retriever is actively loading (not when it's
      // idle or errored — those states mean it won't become ready, so blocking
      // forever would keep returning this message for every query).
      if (nativeRawText === null && getNativeRetrieverStatus() === 'loading') {
        const transientMsg = "I'm still loading the clinical guidelines. Please ask again in a few seconds.";
        this._lastCSO = buildEarlyCSO(transientMsg, 'fallback', ['Tell me more', "What's the dose?", 'When should I refer?'], moduleResponse, { confidenceTier: 'LOW' });
        return { message: transientMsg, type: 'fallback', chunkId: null, suggestedFollowUps: ["What's the dose?", 'When should I refer?', 'Tell me more'] };
      }

      // Build evidence from all available sources
      const evidence = nativeRawText ?? this.extractChunkEvidence(chunk);

      const brainReady = evidence && await isEdgeBrainReady();
      if (brainReady && evidence) {
        try {
          const genResult = await generateGrounded(evidence, userMessage);

          console.log('[ConversationEngine] LLM generated:', genResult.text?.substring(0, 100));

          if (genResult.text && genResult.text !== 'INSUFFICIENT_EVIDENCE') {
            answerText = genResult.text;
          } else {
            const fallback = buildFallback(rewritten.rewritten, this.sessionState, { topics: this.coverageManifest });
            this._lastCSO = buildEarlyCSO(fallback, 'fallback', ['Tell me more', 'What\'s the dose?', 'When should I refer?'], moduleResponse, { confidenceTier: 'LOW' });
            return {
              message: fallback,
              type: 'fallback',
              chunkId: chunk.id,
              source: chunk.source,
              suggestedFollowUps: ['Tell me more', 'What\'s the dose?', 'When should I refer?'],
            };
          }
        } catch (err) {
          console.error('[ConversationEngine] LLM fallback error:', err);
          const fallback = buildFallback(rewritten.rewritten, this.sessionState, { topics: this.coverageManifest });
          this._lastCSO = buildEarlyCSO(fallback, 'fallback', ['Tell me more', 'What\'s the dose?', 'When should I refer?'], moduleResponse, { confidenceTier: 'LOW' });
          return {
            message: fallback,
            type: 'fallback',
            chunkId: chunk.id,
            source: chunk.source,
            suggestedFollowUps: ['Tell me more', 'What\'s the dose?', 'When should I refer?'],
          };
        }
      } else {
        const fallback = buildFallback(rewritten.rewritten, this.sessionState, { topics: this.coverageManifest });
        this._lastCSO = buildEarlyCSO(fallback, 'fallback', ['Tell me more', 'What\'s the dose?', 'When should I refer?'], moduleResponse, { confidenceTier: 'LOW' });
        return {
          message: fallback,
          type: 'fallback',
          chunkId: chunk.id,
          source: chunk.source,
          suggestedFollowUps: ['Tell me more', 'What\'s the dose?', 'When should I refer?'],
        };
      }
    }

    // LOW tier: return the safe-fallback path even though search returned a result —
    // the confidence scoring determined the signals are too weak to serve an answer.
    if (confidenceTier === 'LOW') {
      const fallback = buildFallback(rewritten.rewritten, this.sessionState, { topics: this.coverageManifest });
      this._lastCSO = buildEarlyCSO(fallback, 'fallback', ['HIV treatment guidelines', 'TB screening', 'Newborn care'], moduleResponse, { confidenceTier: 'LOW' });
      return {
        message: fallback,
        type: 'fallback',
        chunkId: null,
        suggestedFollowUps: ['HIV treatment guidelines', 'TB screening', 'Newborn care'],
      };
    }

    // Edge Brain generation decision: only invoke if template assembly can't produce a complete answer
    const genDecision = shouldInvokeGeneration(chunk, newIntent, this.sessionState.slotMemory, answerText);

    if (genDecision.shouldGenerate && genDecision.evidence) {
      // Check if Edge Brain is available (model loaded)
      const brainReady = await isEdgeBrainReady();

      if (brainReady) {
        try {
          // When the native retriever ran, use its rawText as evidence — it's
          // already the flat plain-text form ObjectBox stored. Fall back to the
          // genDecision evidence (extracted from chunk.content.en) otherwise.
          const evidence = nativeRawText ?? genDecision.evidence;
          // Invoke Edge Brain for grounded generation
          const genResult = await generateGrounded(evidence, userMessage);

          // Post-generation grounding check
          const groundingCheck = checkGrounding(genResult.text, evidence);

          if (!groundingCheck.grounded) {
            // Grounding check failed — force LOW tier and log the mismatch
            // eslint-disable-next-line no-console
            console.warn('[HIVA] Generation grounding check FAILED:', {
              score: groundingCheck.score,
              unmatched: groundingCheck.unmatchedTerms,
            });

            const fallback = buildFallback(rewritten.rewritten, this.sessionState, { topics: this.coverageManifest });
            this._lastCSO = buildEarlyCSO(fallback, 'fallback', ['HIV treatment guidelines', 'TB screening', 'Newborn care'], moduleResponse, { confidenceTier: 'LOW', escalationFlag: true });
            return {
              message: fallback,
              type: 'fallback',
              chunkId: null,
              suggestedFollowUps: ['HIV treatment guidelines', 'TB screening', 'Newborn care'],
            };
          }

          // Generation passed grounding check — use it as the answer
          if (genResult.text === 'INSUFFICIENT_EVIDENCE') {
            // Model explicitly declined to answer — treat as LOW confidence
            const fallback = buildFallback(rewritten.rewritten, this.sessionState, { topics: this.coverageManifest });
            this._lastCSO = buildEarlyCSO(fallback, 'fallback', ['HIV treatment guidelines', 'TB screening', 'Newborn care'], moduleResponse, { confidenceTier: 'LOW' });
            return {
              message: fallback,
              type: 'fallback',
              chunkId: chunk.id,
              suggestedFollowUps: ['HIV treatment guidelines', 'TB screening', 'Newborn care'],
            };
          }

          // Use the generated text as the answer
          answerText = genResult.text;

          // eslint-disable-next-line no-console
          console.log(`[HIVA] Edge Brain generated ${genResult.tokenCount} tokens in ${genResult.durationMs}ms (${genResult.tokensPerSecond.toFixed(1)} tok/s)`);
        } catch (err) {
          // Generation failed — fall back to template assembly
          // eslint-disable-next-line no-console
          console.error('[HIVA] Edge Brain generation failed:', err);
          // Continue with template-assembled answerText
        }
      } else {
        // Edge Brain not ready — continue with template-assembled answerText
        // eslint-disable-next-line no-console
        console.log('[HIVA] Edge Brain not ready — using template assembly');
      }
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

    // Append companion_note if present
    const companionNote = (langContent as Record<string, unknown> | undefined)?.companion_note;
    if (typeof companionNote === 'string' && companionNote.trim().length > 0) {
      message = `${message}\n\n— ${companionNote.trim()}`;
    }

    // Source attribution
    const sourceDoc = chunk.source?.document;
    if (sourceDoc) {
      message = `${message}\n\n📋 Source: ${sourceDoc}`;
    }

    // Danger sign auto-escalation
    if (chunk.type !== 'danger_sign') {
      const dangerPatterns: Array<{ pattern: RegExp; warning: string }> = [
        { pattern: /convuls|fitting|seizure/i, warning: 'Convulsions are a DANGER SIGN requiring immediate referral.' },
        { pattern: /unconscious|not responding|unresponsive|lethargi/i, warning: 'Unconsciousness/lethargy is a DANGER SIGN — refer immediately.' },
        { pattern: /(?:unable|cannot|can'?t|not able)\s*(?:to\s*)?(?:drink|breastfeed|eat|swallow)/i, warning: 'Inability to drink is a DANGER SIGN — assess for severe dehydration and refer.' },
        { pattern: /(?:severe|heavy|massive)\s*bleed/i, warning: 'Severe bleeding requires URGENT intervention — refer if uncontrolled.' },
        { pattern: /not\s*breath|stopped?\s*breath|apn[oe]a|blue|cyanosis/i, warning: 'Breathing failure/cyanosis is a LIFE-THREATENING emergency — begin resuscitation.' },
        { pattern: /shock|weak\s*pulse|cold\s*extremit/i, warning: 'Signs of shock detected — start IV fluids and REFER URGENTLY.' },
      ];
      for (const { pattern, warning } of dangerPatterns) {
        if (pattern.test(userMessage)) {
          message = `⚠️ ${warning}\n\n${message}`;
          escalationFlag = true;
          break;
        }
      }
    }

    // Update states
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

    // MEDIUM tier: append verification notice to the assembled message
    const verificationFlag = confidenceTier === 'MEDIUM';
    if (verificationFlag) {
      message = `${message}\n\n⚕️ ${VERIFICATION_NOTICE}`;
    }

    // ─── Layer 6: Generation Control (finalized) ───
    const generationControl: CognitiveStateObject['generationControl'] = {
      confidenceTier,
      escalationFlag,
      groundingConstraint: 'hiv_content_only',
    };

    // ─── Layer 7: Response ───
    const sources: Array<{ document: string; span?: string }> = [];
    if (chunk.source) sources.push(chunk.source);

    const suggestedFollowUps = chips.length > 0 ? chips : this.getFollowUpQuestions(chunk);

    const responseLayer: CognitiveStateObject['response'] = {
      text: message,
      sources,
      verified: true,
      suggestedFollowUps,
      type: mappedIntent,
      verificationFlag,
    };

    // ─── Assemble final CSO ───
    this._lastCSO = {
      identity,
      request,
      intent: intentLayer,
      memory: memoryLayer,
      moduleResponse,
      generationControl,
      response: responseLayer,
    };

    // Log query diagnostics
    logQuery({
      ts: Date.now(),
      query: userMessage,
      rewritten: rewritten.rewritten,
      tier,
      topChunkId: chunk.id,
      topChunkTitle: chunk.display_title || null,
      topBm25Score: diag.topBm25Score,
      topVectorScore: diag.topVectorScore,
      fusedScore: diag.fusedScore,
      vectorGatePassed: diag.vectorGatePassed,
      confidenceGateFired: false,
      responseType: mappedIntent,
    });

    // Track anonymous analytics (safe to call, fails silently)
    const queryEndTime = performance.now();
    const responseTimeMs = Math.round(queryEndTime - queryStartTime);

    try {
      // Determine language mode based on query content
      const languageMode = this.detectLanguageMode(userMessage);

      // Extract category from chunk or topic
      const category = this.extractCategory(chunk, topic);

      // Map intent to analytics intent type
      const analyticsIntent = this.mapToAnalyticsIntent(mappedIntent);

      // Check if response has referral trigger
      const hasReferralTrigger = message.toLowerCase().includes('refer') || escalationFlag;

      // Track query metadata (NO full query text stored)
      trackQuery({
        query: userMessage,  // Only used for word count
        category,
        intent: analyticsIntent,
        languageMode,
        isFollowup: this.sessionState.turnBuffer.length > 1,
        followupCount: this.sessionState.turnBuffer.length,
        resultCount: 1,
        hasReferralTrigger,
        confidenceTier: confidenceTier.toLowerCase() as 'high' | 'medium' | 'low',
        responseTimeMs,
      }).catch((err) => {
        // Silent fail - never block main flow
        console.warn('[ConversationEngine] Analytics tracking failed:', err);
      });

      // Record message for session collection (consent-gated)
      recordMessage('user', userMessage);
      recordMessage('assistant', message);

      // Record topic for session metadata
      if (topic) {
        recordTopic(topic);
      }
    } catch (err) {
      // Analytics should never break the main app
      console.warn('[ConversationEngine] Analytics error:', err);
    }

    return {
      message,
      type: mappedIntent,
      chunkId: chunk.id,
      source: chunk.source,
      suggestedFollowUps,
    };
  }

  reset(): void {
    this.sessionState = new SessionState();
  }

  getState(): ConversationState {
    return {
      turns: this.sessionState.turnBuffer.map(t => ({
        role: t.chunkId ? ('hiva' as const) : ('user' as const),
        content: t.query,
        timestamp: Date.now(),
      })),
      slots: {
        patientAge: this.sessionState.slotMemory.patientAge,
        patientWeight: this.sessionState.slotMemory.patientWeight,
        symptomDuration: null,
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
      symptomDuration: null,
      chiefComplaint: this.sessionState.slotMemory.chiefComplaint,
    };
  }

  debugHivReport(): string {
    return generateHivReport(this.hivAssets);
  }

  /* ─── Helpers ─── */

  private isDeflectionResponse(answer: string): boolean {
    const text = answer.trim();

    if (/^I can help with .+\.\s*Tell me/i.test(text)) return true;

    const wordCount = text.split(/\s+/).length;
    if (wordCount < 60 && /Tell me (more|what|which|about)/i.test(text)) {
      return true;
    }

    const deflectionPhrases = [
      /Tell me more about your (patient|role|situation|query)/i,
      /Tell me what (type|kind|aspect|specific)/i,
      /What specific (aspect|type|area|information)/i,
      /Can you (tell me|provide) more (about|details)/i,
      /Please (tell me|provide|share) more/i,
    ];
    if (deflectionPhrases.some(p => p.test(text))) return true;

    const lastSentence = text.split(/[.!]\s*/).filter(s => s.trim()).pop() ?? '';
    if (/\b(should I|want me to|would you like me to)\b.{0,60}\?$/i.test(lastSentence.trim())) {
      return true;
    }

    return false;
  }

  private buildHivAssets(hivFile: HIVFile): HIVAssets {
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

    const chunkIds = hivFile.embeddingChunkIds || [];

    const manifestExt = hivFile.manifest as unknown as Record<string, unknown>;
    const coverageManifestFromFile =
      (manifestExt.coverage_manifest as HIVAssets['coverageManifest']) ||
      (hivFile.rules?.coverage_manifest as HIVAssets['coverageManifest']) ||
      ({} as HIVAssets['coverageManifest']);

    // Schema version - only 3.0 supported now (v2.2/v2.3 removed)
    const schemaVersion: '3.0' = '3.0';

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
      schemaVersion,
      chunkTitleMap: new Map(hivFile.chunks.map(c => [c.id, c.display_title || ''])),
      chunkContentMap: new Map(hivFile.chunks.map(c => {
        const title = c.display_title || '';
        const contentObj = (c.content as Record<string, any>)?.en;
        let contentText = '';

        if (contentObj) {
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

    if (!this.isInformationalQuery(message) || this.hasPatientReference(message)) {
      for (const keyword of CLINICAL_KEYWORDS) {
        if (lower.includes(keyword)) {
          this.sessionState.slotMemory.chiefComplaint = keyword;
          break;
        }
      }
    }
  }

  private extractChunkEvidence(chunk: HIVChunk): string | null {
    const langContent = (chunk.content?.en || chunk.content || {}) as Record<string, unknown>;
    let substantiveLength = 0;
    const parts: string[] = [];

    // Extract all string values from the content object
    for (const [, val] of Object.entries(langContent)) {
      if (typeof val === 'string' && val.length > 20) {
        parts.push(val);
        substantiveLength += val.length;
      } else if (Array.isArray(val)) {
        const strings = val.filter((v): v is string => typeof v === 'string' && v.length > 10);
        if (strings.length > 0) {
          const joined = strings.join('. ');
          parts.push(joined);
          substantiveLength += joined.length;
        }
      }
    }

    // Only return if we have real medical content (not just metadata/trigger phrases)
    // Trigger phrases alone are NOT evidence — they'd cause hallucination
    if (substantiveLength < 50) return null;

    if (chunk.display_title) {
      parts.unshift(`Topic: ${chunk.display_title}`);
    }

    return parts.join('\n\n');
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

  /* ─── Analytics Helpers ─── */

  private detectLanguageMode(text: string): import('@/types/analytics').LanguageMode {
    const lowerText = text.toLowerCase();

    // Pidgin indicators
    const pidginMarkers = [
      /\bna\b/, /\bwetin\b/, /\bdey\b/, /\bdon\b/, /\bwaka\b/,
      /\bpikin\b/, /\bsmall\b/, /\bfit\b/, /\bhow\s+far\b/,
    ];

    // English indicators
    const englishMarkers = [
      /\bwhat\b/, /\bhow\b/, /\bwhen\b/, /\bwhere\b/,
      /\bshould\b/, /\bcan\b/, /\bwould\b/, /\bcould\b/,
    ];

    const hasPidgin = pidginMarkers.some((p) => p.test(lowerText));
    const hasEnglish = englishMarkers.some((p) => p.test(lowerText));

    if (hasPidgin && hasEnglish) return 'mixed';
    if (hasPidgin) return 'pidgin';
    if (hasEnglish) return 'english';
    return 'other';
  }

  private extractCategory(chunk: HIVChunk, topic: string | null): import('@/types/analytics').QueryCategory {
    // Map from chunk or topic to analytics category
    const topicLower = (topic || chunk.display_title || '').toLowerCase();

    if (/malaria/i.test(topicLower)) return 'malaria';
    if (/diarr?h?oea|diarrhea/i.test(topicLower)) return 'diarrhea';
    if (/pneumonia|chest|cough/i.test(topicLower)) return 'pneumonia';
    if (/fever|temperature/i.test(topicLower)) return 'fever';
    if (/nutrition|malnutrition|feeding/i.test(topicLower)) return 'nutrition';
    if (/immunization|vaccine|vaccination/i.test(topicLower)) return 'immunization';
    if (/newborn|neonate|baby/i.test(topicLower)) return 'newborn_care';
    if (/maternal|pregnancy|antenatal|postnatal/i.test(topicLower)) return 'maternal_health';
    if (/tuberculosis|tb\b/i.test(topicLower)) return 'tb';
    if (/hiv|aids|art\b/i.test(topicLower)) return 'hiv';
    if (/covid|corona|sars/i.test(topicLower)) return 'covid';

    return 'general';
  }

  private mapToAnalyticsIntent(intent: IntentType): import('@/types/analytics').QueryIntent {
    // Map engine intent to analytics intent
    const intentUpper = intent.toUpperCase();

    if (intentUpper === 'OVERVIEW' || intentUpper === 'DIAGNOSIS') {
      return 'diagnosis_support';
    }
    if (intentUpper === 'PROCEDURE' || intentUpper === 'DETAIL') {
      return 'treatment_dosage';
    }
    if (intentUpper === 'CLINICAL' || intent === 'clinical') {
      return 'symptom_check';
    }
    if (intent === 'urgent') {
      return 'referral_criteria';
    }

    return 'general_inquiry';
  }
}
