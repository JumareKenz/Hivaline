/* ─── AUTH ─── */

export interface User {
  id: string;
  name: string;
  facility: string;
  state: string;
  serverCode: string;
  supervisor: string;
  role: 'chew' | 'supervisor';
}

export interface AuthSession {
  user: User;
  loginTime: string;
}

/* ─── ARTIFACTS ─── */

export interface Artifact {
  id: string;
  title: string;
  publisher: string;
  year: number;
  icon: string;
  colorTint: string;
  topics: string[];
  verified: boolean;
  syncedAt: string;
  description?: string;
}

/* ─── CHAT ─── */

export type MessageType = 'text' | 'response_card' | 'danger_sign' | 'drug_table' | 'decision_tree' | 'system';

export interface ChatMessage {
  id: string;
  type: MessageType;
  sender: 'user' | 'hiva';
  content: string;
  timestamp: Date;
  metadata?: MessageMetadata;
}

export interface MessageMetadata {
  artifactId?: string;
  drugId?: string;
  treeId?: string;
  topic?: string;
  source?: string;
  related?: string;
}

/* ─── DECISION TREES ─── */

export type NodeType = 'branch' | 'action' | 'refer';

export interface TreeNode {
  id: string;
  type: NodeType;
  question?: string;
  hint?: string;
  options?: TreeOption[];
  title?: string;
  instruction?: string;
  linkedDrug?: string;
  urgency?: 'immediate' | 'urgent' | 'routine';
  holdingCare?: string;
  handover?: string;
}

export interface TreeOption {
  id: string;
  label: string;
  next: string;
  icon?: 'check' | 'x';
}

export interface DecisionTree {
  id: string;
  name: string;
  artifactId: string;
  entryNode: string;
  nodes: Record<string, TreeNode>;
}

/* ─── DRUG TABLES ─── */

export interface DrugTable {
  id: string;
  name: string;
  route: string;
  form: string;
  unitDose: string;
  frequency: string;
  duration: string;
  weightRanges: WeightRange[];
  warning?: string;
  source: string;
}

export interface WeightRange {
  minKg: number;
  maxKg: number;
  dose: string;
  notes?: string;
}

/* ─── SETTINGS ─── */

export type Language = 'en' | 'ha' | 'yo' | 'ig' | 'pcm';
export type InteractionMode = 'quiet' | 'companion' | 'co-pilot';

export interface AppSettings {
  language: Language;
  theme: 'light' | 'dark' | 'system';
  interactionMode: InteractionMode;
}

/* ─── ROUTER ─── */

export type RoutePath =
  | '/'
  | '/chat'
  | '/knowledge'
  | '/knowledge/:id'
  | '/settings'
  | '/decision-tree/:id'
  | '/drug-table/:id';

export interface RouteParams {
  id?: string;
}

export interface AppRoute {
  path: RoutePath;
  screen: string;
  requiresAuth: boolean;
  tabBar?: boolean;
}

/* ─── SEARCH ─── */

export interface MockResponseRule {
  keywords: string[];
  response: Omit<ChatMessage, 'id' | 'timestamp' | 'sender'>;
}

/* ─── .HIV FILE FORMAT ─── */

export type HIVChunkType = 'faq' | 'drug_table' | 'decision_tree' | 'protocol' | 'danger_sign' | 'calculator';

export interface DocumentSource {
  id: string;
  name: string;
  publisher: string;
  year: number;
  url?: string;
}

export interface RetrievalCapabilities {
  hasLexicalIndex: boolean;
  hasStructuredExactMatch: boolean;
  embeddingDims: number;
}

export interface HIVManifest {
  version: string;
  schema_version?: string; // Explicit schema version (v2.2, v2.3, etc.) - compiler populates this
  sha256: string;
  size_kb: number;
  languages: string[];
  chunk_count: number;
  created_at: string;
  coverage_score?: number;
  document_sources?: DocumentSource[];
  document_source?: DocumentSource; // legacy single-source format
  search_config: {
    bm25_weight: number;
    vector_weight: number;
    fusion: 'RRF';
    rrf_k: number;
    type_boost: Record<HIVChunkType, number>;
  };
  retrievalCapabilities?: RetrievalCapabilities;
}

export interface HIVChunk {
  id: string;
  type: HIVChunkType;
  display_title?: string;
  trigger_phrases: Record<string, string[]>;
  question_variants?: Record<string, string[]>;
  fallback_response?: string;
  content: Record<string, unknown>;
  source: { document: string; span?: string };
  checksum: string;
  aspects?: string[];
}

export interface HIVLexicalIndex {
  [lang: string]: {
    index: Record<string, Array<{ chunk_id: string; score: number }>>;
  };
}

export interface HIVSources {
  sources: Array<{ name: string; url?: string; year?: number }>;
}

export interface HIVRules {
  [id: string]: unknown;
}

export interface HIVI18N {
  [key: string]: string;
}

export interface EmbeddingMetadata {
  chunk_id: string;
  variant_type: string;
  variant_index: number;
  text: string;
}

export interface VariantEmbeddingRecord {
  chunk_id: string;
  field_type: 'primary_question' | 'question_variant' | 'trigger_phrase' | 'display_title';
  lang: string;
  text: string;
}

export interface HIVFile {
  manifest: HIVManifest;
  chunks: HIVChunk[];
  embeddings: Int8Array[];
  embeddingMeta: EmbeddingMetadata[];
  embeddingChunkIds: string[];
  lexicalIndex?: HIVLexicalIndex;
  sources: HIVSources;
  rules: HIVRules;
  i18n: Record<string, HIVI18N>;
  gapGraph?: Record<string, Array<{ to: string; score: number; label?: string }>>;
  db?: SQLiteDatabase;
  variantEmbeddings?: Float32Array | null;
  variantEmbeddingsIndex?: VariantEmbeddingRecord[] | null;
  variantCount?: number;
  embeddingDims?: number;
  queryProxies?: Record<string, number[]>;
}

export interface SQLiteDatabase {
  run: (sql: string, params?: unknown[]) => void;
  exec: (sql: string, params?: unknown[]) => QueryExecResult[];
  getRowsModified: () => number;
  close: () => void;
}

export interface QueryExecResult {
  columns: string[];
  values: unknown[][];
}

export interface SearchResult {
  chunk_id: string;
  score: number;
}

export interface RenderedResponse {
  type: HIVChunkType;
  content: string;
  metadata?: MessageMetadata;
  related?: Array<{ id: string; type: HIVChunkType; preview: string }>;
  source?: { document: string; span?: string };
}

export interface UpdateMetadata {
  version: string;
  sha256: string;
  size_kb: number;
  languages: string[];
  chunk_count: number;
  created_at: string;
}

/* ─── CONVERSATION ENGINE ─── */

export interface ConversationTurn {
  role: 'user' | 'hiva';
  content: string;
  timestamp: number;
}

export interface ConversationSlots {
  patientAge: string | null;
  patientWeight: string | null;
  symptomDuration: string | null;
  chiefComplaint: string | null;
}

export interface ConversationState {
  turns: ConversationTurn[];
  slots: ConversationSlots;
  lastChunkId: string | null;
  turnCount: number;
  lastOpener: string | null;
  lastChiefComplaint: string | null;
}

export type IntentType = 'greeting' | 'clinical' | 'follow_up' | 'clarification' | 'urgent' | 'fallback';

export interface EngineResponse {
  message: string;
  type: IntentType;
  chunkId: string | null;
  source?: { document: string; span?: string };
  suggestedFollowUps: string[];
}
