/**
 * sessionState.ts — Session State Manager
 *
 * Single session state object that persists for the lifetime of the conversation.
 * Every other module reads from and writes to this object.
 */

export interface Turn {
  query: string;
  chunkId: string | null;
  aspects: string[];
  intent: string;
}

export type Sentiment = 'calm' | 'panic' | 'confused' | 'affirm';

export interface SlotMemory {
  patientAge: string | null;
  patientAgeMonths: number | null;
  patientWeight: string | null;
  patientWeightKg: number | null;
  chiefComplaint: string | null;
  chiefComplaintTurn: number | null;  // turn number when chiefComplaint was set
  currentDrug: string | null;
  gender: 'male' | 'female' | null;
}

export class SessionState {
  turnBuffer: Turn[];
  topicStack: string[];
  slotMemory: SlotMemory;
  coveredChunks: Set<string>;
  coveredAspects: Set<string>;
  pendingGaps: string[];
  sentimentHistory: Sentiment[];
  currentTopic: string | null;
  turnCount: number;
  lastClosing: string | null;
  lastChunkId: string | null;
  lastOpener: string | null;
  lastChiefComplaint: string | null;

  constructor() {
    this.turnBuffer = [];
    this.topicStack = [];
    this.slotMemory = {
      patientAge: null,
      patientAgeMonths: null,
      patientWeight: null,
      patientWeightKg: null,
      chiefComplaint: null,
      chiefComplaintTurn: null,
      currentDrug: null,
      gender: null,
    };
    this.coveredChunks = new Set();
    this.coveredAspects = new Set();
    this.pendingGaps = [];
    this.sentimentHistory = [];
    this.currentTopic = null;
    this.turnCount = 0;
    this.lastClosing = null;
    this.lastChunkId = null;
    this.lastOpener = null;
    this.lastChiefComplaint = null;
  }

  /**
   * Add a completed turn. Trims turnBuffer to max 8 entries.
   */
  addTurn(query: string, chunkId: string | null, aspects: string[], intent: string): void {
    this.turnBuffer.push({ query, chunkId, aspects, intent });
    if (this.turnBuffer.length > 8) {
      this.turnBuffer.shift();
    }
    this.turnCount += 1;
    if (chunkId) {
      this.coveredChunks.add(chunkId);
    }
  }

  /**
   * Returns true if this chunkId was already returned in this session.
   */
  wasChunkServed(chunkId: string): boolean {
    return this.coveredChunks.has(chunkId);
  }

  /**
   * Mark a set of aspects as covered for the current topic.
   */
  markAspectsCovered(aspects: string[]): void {
    for (const aspect of aspects) {
      this.coveredAspects.add(aspect);
    }
  }

  /**
   * Returns array of aspects still uncovered for current topic.
   */
  getUncoveredAspects(allAspectsForTopic: string[]): string[] {
    return allAspectsForTopic.filter((a) => !this.coveredAspects.has(a));
  }

  /**
   * Expire chiefComplaint after 2 turns of non-use.
   * chiefComplaint enriches the immediately following follow-up turn but must
   * not persist across unrelated clinical scenarios (malaria → PPH → hypertension).
   * Call once at the start of each respond() cycle, before slot injection.
   */
  expireStaleSlots(): void {
    const TTL = 2;
    if (
      this.slotMemory.chiefComplaint !== null &&
      this.slotMemory.chiefComplaintTurn !== null &&
      this.turnCount - this.slotMemory.chiefComplaintTurn > TTL
    ) {
      this.slotMemory.chiefComplaint = null;
      this.slotMemory.chiefComplaintTurn = null;
    }
  }

  /**
   * Detect if a new query represents a topic shift.
   */
  detectTopicShift(newTopic: string | null): boolean {
    if (!this.currentTopic || !newTopic) return false;
    return newTopic !== this.currentTopic;
  }

  /**
   * Called on topic shift — resets aspect tracking but preserves slot memory.
   */
  onTopicShift(newTopic: string): void {
    if (this.currentTopic) {
      this.topicStack.unshift(this.currentTopic);
      if (this.topicStack.length > 5) {
        this.topicStack.pop();
      }
    }
    this.currentTopic = newTopic;
    this.coveredAspects.clear();
    this.pendingGaps = [];
    // Clear chiefComplaint on topic shift — new topic = likely different clinical situation
    this.slotMemory.chiefComplaint = null;
    this.slotMemory.chiefComplaintTurn = null;
    // Clear age slot if it was inferred from a non-numeric term ('newborn', 'infant', 'child').
    // Numeric ages ('5 year', '3 month') describe a specific patient and persist across turns.
    // Inferred sentinels are per-query context only — they must not bleed into unrelated topics.
    const inferredAgeLabels = ['newborn', 'infant', 'child'];
    if (this.slotMemory.patientAge !== null && inferredAgeLabels.includes(this.slotMemory.patientAge)) {
      this.slotMemory.patientAge = null;
      this.slotMemory.patientAgeMonths = null;
    }
  }

  /**
   * Push a new sentiment reading.
   */
  pushSentiment(sentiment: Sentiment): void {
    this.sentimentHistory.push(sentiment);
    if (this.sentimentHistory.length > 5) {
      this.sentimentHistory.shift();
    }
  }

  /**
   * Returns dominant sentiment from last 3 turns.
   */
  getDominantSentiment(): Sentiment {
    const recent = this.sentimentHistory.slice(-3);
    if (recent.length === 0) return 'calm';

    const counts: Record<string, number> = {};
    for (const s of recent) {
      counts[s] = (counts[s] || 0) + 1;
    }

    let best: Sentiment = 'calm';
    let bestCount = 0;
    for (const [sentiment, count] of Object.entries(counts)) {
      if (count > bestCount) {
        bestCount = count;
        best = sentiment as Sentiment;
      }
    }
    return best;
  }

  /**
   * Normalize age string → integer months.
   */
  normalizeAge(rawAge: string): number | null {
    if (!rawAge) return null;
    const match = rawAge.match(/(\d+(?:\.\d+)?)\s*(year|month|week|day|yr|mo|wk|dy)s?/i);
    if (!match) return null;

    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase();

    if (unit.startsWith('year') || unit === 'yr') return Math.round(value * 12);
    if (unit.startsWith('month') || unit === 'mo') return Math.round(value);
    if (unit.startsWith('week') || unit === 'wk') return Math.round(value / 4.345);
    if (unit.startsWith('day') || unit === 'dy') return Math.round(value / 30.44);
    return null;
  }

  /**
   * Normalize weight string → float kg.
   */
  normalizeWeight(rawWeight: string): number | null {
    if (!rawWeight) return null;
    const match = rawWeight.match(/(\d+(?:\.\d+)?)\s*(kg|kilos?|kgs|g|grams?)/i);
    if (!match) return null;

    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase();

    if (unit.startsWith('kg') || unit.startsWith('kilo')) return value;
    if (unit.startsWith('g') || unit.startsWith('gram')) return value / 1000;
    return null;
  }
}

export default SessionState;
