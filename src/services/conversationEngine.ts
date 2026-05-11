/**
 * conversationEngine.ts — Stateful clinical conversation manager
 *
 * Maintains turn history, extracts patient slots, classifies intent,
 * enriches queries with context, and returns composed responses.
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
import { variantSearch, hybridSearch } from './searchEngine';
import { composeResponse } from './responseComposer';

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
  'anaemia', 'pneumonia', 'dehydration', 'malnutrition',
  'delivery', 'labour', 'pregnancy', 'anc',
];

const FOLLOW_UP_TRIGGERS = [
  'what about', 'and the', 'how much', 'what if',
  'is that safe', 'what else', 'and for', 'dose for',
  'also', 'another', 'what about', 'how about',
  'what is', 'the dose', 'dose?', 'how many', 'when should',
  'can i', 'should i', 'do i', 'is it',
];

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

export class ConversationEngine {
  private state: ConversationState;
  private hivFile: HIVFile;

  constructor(hivFile: HIVFile) {
    this.hivFile = hivFile;
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
    };
  }

  async respond(userMessage: string): Promise<EngineResponse> {
    const now = Date.now();
    this.state.turnCount += 1;

    // Record user turn
    this.state.turns.push({
      role: 'user',
      content: userMessage,
      timestamp: now,
    });

    // Extract slots from this message
    this.extractSlots(userMessage);

    // Classify intent
    const intent = this.classifyIntent(userMessage);

    // Handle greeting or social acknowledgment
    if (intent === 'greeting') {
      const lower = userMessage.toLowerCase().trim();
      const isSocial = SOCIAL_TRIGGERS.some(t => lower === t || lower.startsWith(t + ' '));

      if (isSocial) {
        // Social acknowledgment (thanks, ok, got it, etc.)
        const socialIndex = (this.state.turnCount - 1) % SOCIAL_RESPONSES.length;
        return {
          message: SOCIAL_RESPONSES[socialIndex],
          type: 'greeting',
          chunkId: null,
          suggestedFollowUps: [],
        };
      }

      // True greeting (hello, hi, etc.)
      const greetingIndex = (this.state.turnCount - 1) % GREETING_RESPONSES.length;
      return {
        message: GREETING_RESPONSES[greetingIndex],
        type: 'greeting',
        chunkId: null,
        suggestedFollowUps: ['My patient has fever', 'Child is convulsing', 'ANC checkup'],
      };
    }

    // Build enriched search query
    const searchQuery = this.buildSearchQuery(userMessage, intent);

    // Search for matching chunk
    const chunk = await this.findChunk(searchQuery, intent);

    if (!chunk) {
      this.recordHivaTurn("I don't have information on that. Try rephrasing or check the Knowledge Base.");
      return {
        message: "I don't have information on that. Try rephrasing or check the Knowledge Base.",
        type: 'fallback',
        chunkId: null,
        suggestedFollowUps: ['Tell me more', 'What\'s the dose?', 'When should I refer?'],
      };
    }

    this.state.lastChunkId = chunk.id;

    // Compose response
    const composed = composeResponse(chunk, this.state, intent);

    // Get follow-up questions from chunk
    const followUps = this.getFollowUpQuestions(chunk);

    this.recordHivaTurn(composed);

    return {
      message: composed,
      type: intent,
      chunkId: chunk.id,
      source: chunk.source,
      suggestedFollowUps: followUps,
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
    };
  }

  getState(): ConversationState {
    return { ...this.state };
  }

  getSlots(): ConversationSlots {
    return { ...this.state.slots };
  }

  private recordHivaTurn(content: string): void {
    this.state.turns.push({
      role: 'hiva',
      content,
      timestamp: Date.now(),
    });
  }

  private classifyIntent(message: string): IntentType {
    const lower = message.toLowerCase().trim();
    const words = lower.split(/\s+/);

    // Check for danger signs first (highest priority)
    for (const danger of DANGER_KEYWORDS) {
      if (lower.includes(danger)) return 'urgent';
    }

    // Check for social/conversational utterances (thanks, ok, got it, etc.)
    // These are single-word or short phrases with no clinical keywords
    for (const trigger of SOCIAL_TRIGGERS) {
      if (lower === trigger || lower.startsWith(trigger + ' ')) {
        const hasClinical = CLINICAL_KEYWORDS.some(k => lower.includes(k));
        if (!hasClinical) return 'greeting';
      }
    }

    // Check for follow-up triggers
    for (const trigger of FOLLOW_UP_TRIGGERS) {
      if (lower.includes(trigger)) return 'follow_up';
    }

    // Greeting on first turn with short message
    if (this.state.turnCount === 1 && words.length < 6) {
      const hasClinical = CLINICAL_KEYWORDS.some(k => lower.includes(k));
      if (!hasClinical) return 'greeting';
    }

    // Default to clinical
    return 'clinical';
  }

  private extractSlots(message: string): void {
    const lower = message.toLowerCase();

    // Age extraction
    const ageMatch = lower.match(/(\d+)\s*(year|month|week|day|yr|mo|wk|dy)s?\s*old/);
    if (ageMatch) {
      this.state.slots.patientAge = `${ageMatch[1]} ${ageMatch[2]}`;
    }

    // Weight extraction
    const weightMatch = lower.match(/(\d+(?:\.\d+)?)\s*(kg|kilos?|kgs)/);
    if (weightMatch) {
      this.state.slots.patientWeight = `${weightMatch[1]} kg`;
    }

    // Duration extraction
    const durationMatch = lower.match(/(\d+)\s*(day|hour|week|month)s?/) ||
                         lower.match(/since\s+(yesterday|today|last\s+night|this\s+morning)/);
    if (durationMatch) {
      this.state.slots.symptomDuration = durationMatch[0];
    }

    // Chief complaint extraction
    for (const keyword of CLINICAL_KEYWORDS) {
      if (lower.includes(keyword)) {
        this.state.slots.chiefComplaint = keyword;
        break;
      }
    }
  }

  private buildSearchQuery(message: string, intent: IntentType): string {
    const parts: string[] = [message];

    if (intent === 'follow_up' || intent === 'clinical') {
      if (this.state.slots.chiefComplaint) {
        parts.push(this.state.slots.chiefComplaint);
      }
      if (this.state.slots.patientAge) {
        parts.push(this.state.slots.patientAge);
      }
    }

    return parts.filter(Boolean).join(' ');
  }

  private async findChunk(query: string, _intent: IntentType): Promise<HIVChunk | null> {
    // Try variant search first
    const { matches: variantMatches } = variantSearch(query, this.hivFile, 5);

    if (variantMatches.length > 0) {
      const chunkMap = new Map(this.hivFile.chunks.map(c => [c.id, c]));
      const chunk = chunkMap.get(variantMatches[0].chunk_id);
      if (chunk) return chunk;
    }

    // Fall back to BM25
    const bm25Results = hybridSearch(query, null, this.hivFile, 'en', 5);
    if (bm25Results.length > 0) return bm25Results[0];

    return null;
  }

  private getFollowUpQuestions(chunk: HIVChunk): string[] {
    const langContent = chunk.content['en'] as Record<string, unknown> | undefined;
    if (!langContent) return ['Tell me more', 'What\'s the dose?', 'When should I refer?'];

    const followUps = langContent.follow_up_questions;
    if (Array.isArray(followUps) && followUps.length > 0) {
      return followUps.slice(0, 3).map(String);
    }

    // Generic fallbacks based on chunk type
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
