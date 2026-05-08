# BLUEPRINT.md — HIVALINE Complete System Design

> This file contains every design decision. No agent should ever invent a field, endpoint, or component behavior. If it's not here, it doesn't exist.

---

## 1. FULL DATA MODELS

### 1.1 Core Types (`src/types/hiv.ts`)

```typescript
// ─── AUTH ───

export interface User {
  id: string;
  name: string;
  facility: string;
  state: string; // e.g., "Kano State"
  serverCode: string; // e.g., "FMOH-K7H4"
  supervisor: string;
  role: 'chew' | 'supervisor';
}

export interface AuthSession {
  user: User;
  loginTime: string; // ISO 8601
}

// ─── ARTIFACTS (Clinical Guidelines) ───

export interface Artifact {
  id: string; // kebab-case, e.g., "malaria-2024"
  title: string;
  publisher: string; // e.g., "FMOH", "FMOH/WHO"
  year: number;
  icon: string; // single emoji
  colorTint: string; // Tailwind bg class, e.g., "bg-accent-50"
  topics: string[];
  verified: boolean;
  syncedAt: string; // human-readable, e.g., "today"
  description?: string; // short summary for detail view
}

// ─── CHAT ───

export type MessageType = 'text' | 'response_card' | 'danger_sign' | 'drug_table' | 'decision_tree' | 'system';

export interface ChatMessage {
  id: string; // uuid or timestamp-based
  type: MessageType;
  sender: 'user' | 'hiva';
  content: string; // plain text, NEVER HTML
  timestamp: Date;
  metadata?: MessageMetadata;
}

export interface MessageMetadata {
  artifactId?: string; // source artifact
  drugId?: string; // for drug table responses
  treeId?: string; // for decision tree responses
  topic?: string; // e.g., "ACT Dose"
  source?: string; // e.g., "FMOH Malaria Guidelines 2024"
}

// ─── DECISION TREES ───

export type NodeType = 'branch' | 'action' | 'refer';

export interface TreeNode {
  id: string; // e.g., "q1", "action-uncomplicated"
  type: NodeType;
  question?: string; // for branch nodes
  hint?: string; // optional sub-text for branch nodes
  options?: TreeOption[]; // for branch nodes
  title?: string; // for terminal nodes
  instruction?: string; // for action nodes
  linkedDrug?: string; // drugId for action nodes
  urgency?: 'immediate' | 'urgent' | 'routine'; // for refer nodes
  holdingCare?: string; // for refer nodes
  handover?: string; // for refer nodes
}

export interface TreeOption {
  id: string; // unique within node, e.g., "yes", "no"
  label: string; // display text
  next: string; // next node id
  icon?: 'check' | 'x'; // optional icon hint
}

export interface DecisionTree {
  id: string; // e.g., "malaria-assessment"
  name: string; // display name
  artifactId: string; // links to artifact
  entryNode: string; // starting node id
  nodes: Record<string, TreeNode>; // node id → node
}

// ─── DRUG TABLES ───

export interface DrugTable {
  id: string; // e.g., "act-artemether"
  name: string; // e.g., "Artemether/Lumefantrine (ACT)"
  route: string; // e.g., "Oral"
  form: string; // e.g., "Tablet 20/120mg"
  unitDose: string; // e.g., "1 tablet"
  frequency: string; // e.g., "Twice daily"
  duration: string; // e.g., "3 days"
  weightRanges: WeightRange[]; // sorted ascending
  warning?: string; // e.g., "Vomits within 30min → Repeat once"
  source: string;
}

export interface WeightRange {
  minKg: number; // inclusive
  maxKg: number; // inclusive
  dose: string; // e.g., "1 tablet"
  notes?: string;
}

// ─── SETTINGS ───

export type Language = 'en' | 'ha' | 'yo' | 'ig' | 'pcm';
export type InteractionMode = 'quiet' | 'companion' | 'co-pilot';

export interface AppSettings {
  language: Language;
  theme: 'light' | 'dark' | 'system';
  interactionMode: InteractionMode;
}

// ─── ROUTER ───

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
  screen: string; // component name
  requiresAuth: boolean;
  tabBar?: boolean;
}
```

### 1.2 Mock Data Files

#### `src/data/users.ts`

```typescript
import type { User } from '@/types/hiv';

export const MOCK_USERS: readonly User[] = [
  {
    id: 'user-001',
    name: 'Nurse Amaka',
    facility: 'Kano State PHC',
    state: 'Kano State',
    serverCode: 'FMOH-K7H4',
    supervisor: 'Kano State FMOH Supervisor',
    role: 'chew',
  },
] as const;

export const findUserByCode = (serverCode: string, accessKey: string): User | undefined => {
  // Access key is always "K7H4" for mock (last 4 of server code)
  const expectedKey = serverCode.split('-')[1] ?? '';
  if (accessKey !== expectedKey) return undefined;
  return MOCK_USERS.find((u) => u.serverCode === serverCode);
};
```

#### `src/data/artifacts.ts`

```typescript
import type { Artifact } from '@/types/hiv';

export const MOCK_ARTIFACTS: readonly Artifact[] = [
  {
    id: 'malaria-2024',
    title: 'Malaria Case Management',
    publisher: 'FMOH',
    year: 2024,
    icon: '🦟',
    colorTint: 'bg-accent-50',
    topics: ['Diagnosis & RDT use', 'ACT dosing by weight', 'Severe malaria criteria', 'Post-treatment follow-up'],
    verified: true,
    syncedAt: 'today',
    description: 'Comprehensive guidelines for diagnosing and treating malaria in children and adults, including RDT procedures and ACT dosing.',
  },
  {
    id: 'anc-2024',
    title: 'Antenatal Care (ANC)',
    publisher: 'FMOH/WHO',
    year: 2024,
    icon: '🤱',
    colorTint: 'bg-brand-tan-subtle',
    topics: ['Visit schedule', 'Danger signs in pregnancy', 'Iron & folate dosing', 'Tetanus immunization'],
    verified: true,
    syncedAt: 'today',
    description: 'ANC guidelines for routine visits, danger sign identification, and supplementation schedules.',
  },
  {
    id: 'imci-2023',
    title: 'Child Health (IMCI)',
    publisher: 'FMOH',
    year: 2023,
    icon: '👶',
    colorTint: 'bg-warning/10',
    topics: ['Pneumonia assessment', 'Diarrhoea management', 'Malnutrition screening', 'Immunization catch-up'],
    verified: true,
    syncedAt: 'today',
    description: 'Integrated Management of Childhood Illness protocols for frontline assessment and referral.',
  },
  {
    id: 'essential-meds-2024',
    title: 'Essential Medicines',
    publisher: 'FMOH',
    year: 2024,
    icon: '💊',
    colorTint: 'bg-info/10',
    topics: ['Drug dosing by weight', 'Drug interactions', 'Storage conditions', 'Expired medication protocol'],
    verified: true,
    syncedAt: 'today',
    description: 'Reference for essential drug dosing, interaction checks, and safe storage practices.',
  },
  {
    id: 'emergency-referral-2024',
    title: 'Emergency Referral',
    publisher: 'FMOH',
    year: 2024,
    icon: '🏥',
    colorTint: 'bg-error/10',
    topics: ['Referral criteria', 'Pre-referral stabilization', 'Handover communication', 'Transport arrangement'],
    verified: true,
    syncedAt: 'today',
    description: 'When and how to refer patients urgently, including stabilization steps and handover notes.',
  },
] as const;

export const getArtifactById = (id: string): Artifact | undefined =>
  MOCK_ARTIFACTS.find((a) => a.id === id);
```

#### `src/data/drugTables.ts`

```typescript
import type { DrugTable } from '@/types/hiv';

export const MOCK_DRUGS: readonly DrugTable[] = [
  {
    id: 'act-artemether',
    name: 'Artemether/Lumefantrine (ACT)',
    route: 'Oral',
    form: 'Tablet 20/120mg',
    unitDose: '1 tablet',
    frequency: 'Twice daily',
    duration: '3 days',
    weightRanges: [
      { minKg: 5, maxKg: 14, dose: '1 tablet (20/120mg)', notes: 'Crush if needed' },
      { minKg: 15, maxKg: 24, dose: '2 tablets (20/120mg)', notes: '' },
      { minKg: 25, maxKg: 34, dose: '3 tablets (20/120mg)', notes: '' },
      { minKg: 35, maxKg: 100, dose: '4 tablets (20/120mg)', notes: 'Adult dose' },
    ],
    warning: '⚠ If child vomits within 30 minutes → Repeat dose once',
    source: 'FMOH Malaria Guidelines 2024',
  },
  {
    id: 'amoxicillin-250',
    name: 'Amoxicillin',
    route: 'Oral',
    form: 'Suspension 250mg/5ml',
    unitDose: '5ml',
    frequency: 'Twice daily',
    duration: '5 days',
    weightRanges: [
      { minKg: 4, maxKg: 9, dose: '2.5ml (125mg)', notes: '' },
      { minKg: 10, maxKg: 19, dose: '5ml (250mg)', notes: '' },
      { minKg: 20, maxKg: 29, dose: '7.5ml (375mg)', notes: '' },
      { minKg: 30, maxKg: 100, dose: '10ml (500mg)', notes: '' },
    ],
    warning: 'Watch for allergic reaction (rash, swelling, difficulty breathing)',
    source: 'FMOH Essential Medicines 2024',
  },
] as const;

export const getDrugById = (id: string): DrugTable | undefined =>
  MOCK_DRUGS.find((d) => d.id === id);

export const getDoseForWeight = (drugId: string, weightKg: number): { dose: string; notes: string; inRange: boolean } => {
  const drug = getDrugById(drugId);
  if (!drug) return { dose: 'Unknown drug', notes: '', inRange: false };

  const range = drug.weightRanges.find((r) => weightKg >= r.minKg && weightKg <= r.maxKg);
  if (range) {
    return { dose: range.dose, notes: range.notes || '', inRange: true };
  }

  // Out of range
  const min = drug.weightRanges[0]?.minKg ?? 0;
  const max = drug.weightRanges[drug.weightRanges.length - 1]?.maxKg ?? 100;
  return {
    dose: 'Outside safe range',
    notes: `Safe range: ${min}-${max}kg. Refer patient.`,
    inRange: false,
  };
};
```

#### `src/data/decisionTrees.ts`

```typescript
import type { DecisionTree } from '@/types/hiv';

export const MOCK_TREES: readonly DecisionTree[] = [
  {
    id: 'malaria-assessment',
    name: 'Malaria Assessment',
    artifactId: 'malaria-2024',
    entryNode: 'q1',
    nodes: {
      q1: {
        id: 'q1',
        type: 'branch',
        question: 'Does the child have a fever or history of fever in the last 48 hours?',
        hint: 'Ask the caregiver. Feel the child\'s forehead or use a thermometer.',
        options: [
          { id: 'yes', label: 'Yes — fever present', next: 'q2' },
          { id: 'no', label: 'No — no fever', next: 'action-no-malaria' },
        ],
      },
      q2: {
        id: 'q2',
        type: 'branch',
        question: 'Is the child able to drink or breastfeed?',
        hint: 'Observe the child. Attempted feeding counts if they try.',
        options: [
          { id: 'yes', label: 'Yes — drinking normally', next: 'q3' },
          { id: 'no', label: 'No — cannot drink', next: 'refer-severe' },
        ],
      },
      q3: {
        id: 'q3',
        type: 'branch',
        question: 'Does the child have any danger signs?',
        hint: 'Danger signs: convulsions, lethargy, vomiting everything, unable to sit/stand.',
        options: [
          { id: 'no', label: 'No danger signs', next: 'action-uncomplicated' },
          { id: 'yes', label: 'Yes — danger signs present', next: 'refer-severe' },
        ],
      },
      'action-uncomplicated': {
        id: 'action-uncomplicated',
        type: 'action',
        title: 'Uncomplicated Malaria',
        instruction: 'Give ACT (Artemether/Lumefantrine) as per weight. Counsel caregiver on completion of full course. Follow up in 3 days.',
        linkedDrug: 'act-artemether',
      },
      'refer-severe': {
        id: 'refer-severe',
        type: 'refer',
        urgency: 'immediate',
        title: 'Severe Malaria — Refer Urgently',
        holdingCare: 'Give rectal artesunate if available. Maintain airway. Position child on side if unconscious. IV access if possible. Keep warm.',
        handover: 'Child with features of severe malaria. Unable to drink / danger signs present. Pre-referral artesunate given.',
      },
      'action-no-malaria': {
        id: 'action-no-malaria',
        type: 'action',
        title: 'Malaria Unlikely',
        instruction: 'Perform RDT to confirm. If negative, assess for other causes of fever (pneumonia, meningitis, ear infection).',
      },
    },
  },
] as const;

export const getTreeById = (id: string): DecisionTree | undefined =>
  MOCK_TREES.find((t) => t.id === id);
```

#### `src/data/mockResponses.ts`

```typescript
import type { ChatMessage } from '@/types/hiv';

export interface MockResponseRule {
  keywords: string[];
  response: Omit<ChatMessage, 'id' | 'timestamp' | 'sender'>;
}

export const MOCK_RESPONSE_RULES: readonly MockResponseRule[] = [
  {
    keywords: ['act', 'dose', 'artemether', 'lumefantrine', 'malaria', 'tablet', 'kg'],
    response: {
      type: 'drug_table',
      content: 'Based on the FMOH Malaria Guidelines 2024, here is the ACT dosing for this child:',
      metadata: { drugId: 'act-artemether', topic: 'ACT Dose', source: 'FMOH Malaria Guidelines 2024' },
    },
  },
  {
    keywords: ['severe', 'malaria', 'danger', 'sign', 'convulsion', 'unconscious', 'cannot', 'drink'],
    response: {
      type: 'decision_tree',
      content: 'Let me walk you through the malaria assessment protocol to check for severe features.',
      metadata: { treeId: 'malaria-assessment', topic: 'Severe Malaria Assessment', source: 'FMOH Malaria Guidelines 2024' },
    },
  },
  {
    keywords: ['convulsion', 'seizure', 'fitting', 'stiff'],
    response: {
      type: 'danger_sign',
      content: '⚠ CONVULSION IS A DANGER SIGN\n\nImmediate action:\n1. Place child on their side (recovery position)\n2. Do NOT put anything in their mouth\n3. Check airway and breathing\n4. Give rectal diazepam if available and trained\n5. REFER URGENTLY after stabilization\n\nThis child needs immediate referral.',
      metadata: { topic: 'Danger Sign: Convulsion', source: 'FMOH Emergency Referral 2024' },
    },
  },
  {
    keywords: ['anc', 'antenatal', 'pregnancy', 'pregnant', 'first visit'],
    response: {
      type: 'response_card',
      content: 'ANC First Visit Checklist:\n\n• Confirm pregnancy (history + exam)\n• Check BP and weight\n• Test for HIV, HBV, syphilis\n• Give iron & folate (daily)\n• Tetanus toxoid dose 1\n• Counsel on nutrition and danger signs\n• Schedule next visit in 4 weeks\n\nDanger signs to explain:\n→ Vaginal bleeding, severe headache, blurred vision, swollen hands/face, fever, decreased fetal movement',
      metadata: { artifactId: 'anc-2024', topic: 'ANC First Visit', source: 'FMOH/WHO ANC Guidelines 2024' },
    },
  },
  {
    keywords: ['pneumonia', 'cough', 'fast breathing', 'chest'],
    response: {
      type: 'response_card',
      content: 'Pneumonia Assessment (IMCI):\n\nCount breaths in one minute:\n• <2 months: ≥60/min → fast\n• 2-11 months: ≥50/min → fast\n• 12-59 months: ≥40/min → fast\n\nIf fast breathing + cough:\n→ Give amoxicillin for 5 days\n→ Soothe throat, keep warm\n→ Follow up in 2 days\n\nDanger signs (refer urgently):\n→ Chest indrawing, stridor, unable to drink, convulsions, lethargy',
      metadata: { artifactId: 'imci-2023', topic: 'Pneumonia', source: 'FMOH IMCI 2023' },
    },
  },
] as const;

export const FALLBACK_RESPONSE: Omit<ChatMessage, 'id' | 'timestamp' | 'sender'> = {
  type: 'text',
  content: "I don't have information on that in the current .hiv file. The loaded artifacts cover: Malaria, ANC, Child Health, Essential Medicines, and Emergency Referral. Try rephrasing or check the Knowledge Base.",
};
```

---

## 2. FULL API SURFACE (Mock Data Layer)

All "APIs" are synchronous TypeScript functions. No async. No HTTP.

### Auth Functions (`src/data/users.ts`)

| Function | Input | Output | Behavior |
|----------|-------|--------|----------|
| `findUserByCode(serverCode, accessKey)` | `string, string` | `User \| undefined` | Validates accessKey matches last 4 chars of serverCode, returns matching user |

### Artifact Functions (`src/data/artifacts.ts`)

| Function | Input | Output | Behavior |
|----------|-------|--------|----------|
| `MOCK_ARTIFACTS` | — | `readonly Artifact[]` | Static array of all 5 artifacts |
| `getArtifactById(id)` | `string` | `Artifact \| undefined` | O(1) lookup by id |

### Drug Functions (`src/data/drugTables.ts`)

| Function | Input | Output | Behavior |
|----------|-------|--------|----------|
| `MOCK_DRUGS` | — | `readonly DrugTable[]` | Static array |
| `getDrugById(id)` | `string` | `DrugTable \| undefined` | O(1) lookup |
| `getDoseForWeight(drugId, weightKg)` | `string, number` | `{ dose, notes, inRange }` | Finds matching weight range; returns out-of-range message if no match |

### Tree Functions (`src/data/decisionTrees.ts`)

| Function | Input | Output | Behavior |
|----------|-------|--------|----------|
| `MOCK_TREES` | — | `readonly DecisionTree[]` | Static array |
| `getTreeById(id)` | `string` | `DecisionTree \| undefined` | O(1) lookup |

### Chat Search (`src/hooks/useSearch.ts`)

| Function | Input | Output | Behavior |
|----------|-------|--------|----------|
| `searchResponse(input: string)` | `string` | `MockResponseRule['response']` | Normalizes input, tokenizes, scores against keyword arrays, returns highest match or FALLBACK_RESPONSE |

#### Search algorithm (exact spec):

```typescript
const searchResponse = (input: string): MockResponseRule['response'] => {
  const normalized = input.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const tokens = normalized.split(/\s+/).filter(Boolean);
  
  let bestMatch: MockResponseRule | null = null;
  let bestScore = 0;
  
  for (const rule of MOCK_RESPONSE_RULES) {
    let score = 0;
    for (const token of tokens) {
      for (const keyword of rule.keywords) {
        if (keyword.includes(token) || token.includes(keyword)) {
          score += 1;
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = rule;
    }
  }
  
  return bestMatch ? bestMatch.response : FALLBACK_RESPONSE;
};
```

- Minimum match threshold: score >= 1. If no rule scores >= 1, return fallback.

---

## 3. FULL COMPONENT MAP

### Shell Components

#### `MobileShell`
- **Props**: `{ children: ReactNode }`
- **Renders**: 
  - Desktop: centered container ~390px wide, phone-like shadow, rounded corners, subtle border
  - Mobile: full width, no frame, edge-to-edge
  - Adds `env(safe-area-inset-*)` padding
  - Wraps children in `ErrorBoundary`
- **State**: none
- **Calls**: none

#### `BottomTabBar`
- **Props**: `{ activeTab: 'chat' | 'knowledge' | 'settings' }`
- **Renders**: 
  - Frosted glass bar (`backdrop-filter: blur(20px)`, `bg-white/85`)
  - 3 tabs: Chat (MessageCircle), Knowledge (BookOpen), Settings (Settings)
  - Active: accent-600 icon + label, subtle underline/dot indicator
  - Labels: DM Sans 500 10px, letter-spacing 0.05em
  - Height: 64px + safe-area-bottom
- **State**: none (controlled)
- **Calls**: `navigate()` on tab press

#### `SafeArea`
- **Props**: `{ children: ReactNode, className?: string }`
- **Renders**: div with `pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]`

### UI Primitives

#### `StatusPill`
- **Props**: `{ status: 'offline' | 'online' | 'syncing'; label?: string }`
- **Renders**: 
  - Green dot (animated pulse for offline/online) + text
  - `bg-success/10 border border-success/30 rounded-full px-2 py-0.5`
  - Default label: "Offline Ready"

#### `VerificationBadge`
- **Props**: `{ verified: boolean; label?: string }`
- **Renders**: 
  - Green checkmark circle icon + "FMOH Approved Content" text
  - `bg-success/5 border border-success/20 rounded-lg p-3`

#### `ServerCodeDisplay`
- **Props**: `{ code: string; supervisor?: string; onUpdate?: () => void }`
- **Renders**: Card with monospace code, green dot badge, supervisor label, action buttons

#### `TopBar`
- **Props**: `{ title: string; subtitle?: string; showBack?: boolean; rightElement?: ReactNode }`
- **Renders**: 
  - White/surface bg, subtle bottom border, 56px height
  - Left: back chevron (if showBack) or HIVA avatar
  - Center: title + subtitle
  - Right: rightElement (e.g., StatusPill)

#### `Card`
- **Props**: `{ children; variant?: 'default' | 'danger' | 'success'; className?: string }`
- **Renders**: 
  - Default: white bg, `border-n-200`, `rounded-xl`, `p-4`
  - Danger: `border-l-4 border-l-error bg-error/5`
  - Success: `border-l-4 border-l-success bg-success/5`

#### `Button`
- **Props**: `{ children; variant: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg'; onClick; disabled?; fullWidth?; icon?: ReactNode }`
- **Renders**: 
  - Primary: `bg-accent-600 text-white`
  - Secondary: `bg-white border border-n-300 text-n-800`
  - Ghost: `bg-transparent text-accent-600`
  - Danger: `bg-error text-white`
  - All: `rounded-xl`, `active:scale-[0.97]`, `transition-transform duration-100`
  - Size sm: 32px height, md: 44px, lg: 56px
  - FullWidth: `w-full`

#### `Input`
- **Props**: `{ value; onChange; placeholder?; label?; error?; type?: 'text' | 'password'; autoCapitalize? }`
- **Renders**: 
  - Label above (if provided)
  - Input: `bg-white border rounded-xl h-14 px-4 font-body text-base`
  - Focus: `ring-2 ring-accent-600 border-accent-600`
  - Error: `border-error ring-error`
  - Error message below in red text

#### `Toggle`
- **Props**: `{ checked; onChange; label?: string }`
- **Renders**: 
  - Custom switch: 48px wide, 28px tall, rounded-full
  - Track: `bg-n-300` off, `bg-accent-600` on
  - Thumb: white circle, slides with `transform transition`

### Auth Screen

#### `LoginScreen`
- **Props**: none (uses `useAuth`)
- **Renders**:
  - Full-screen gradient (`from-accent-600 to-accent-800`)
  - Centered HIVA logo (geometric cross+circle SVG, 64px, white on teal rounded square)
  - "HIVA" title (Space Grotesk 700, 36px, white)
  - "RUNTIME INTERPRETER V2.0" subtitle (JetBrains Mono, brand-tan, 11px, tracking-widest)
  - Instruction label: "ENTER CODE FROM YOUR SUPERVISOR"
  - Server Code input: placeholder "FMOH–XXXX", monospace, auto-uppercase
  - Access Key input: placeholder "XXXX", monospace, auto-uppercase
  - CTA: "Connect to HIVA →" (white bg, accent-600 text, full width, 56px height)
  - Error pill: red badge on invalid format
  - Success: green checkmark pulse, then `navigate('/chat')`
  - Bottom: "v2.0 · FMOH Certified · Offline Ready"
- **State**: `serverCode`, `accessKey`, `error`, `isSuccess`
- **Calls**: `login(serverCode, accessKey)`, `navigate()`

### Chat Screen

#### `ChatScreen`
- **Props**: none
- **Renders**:
  - TopBar with HIVA avatar + name + StatusPill
  - Message list (scrollable, flex-col-reverse or scroll-to-bottom)
  - Welcome state (if no messages): greeting + subtitle + SuggestionChips + floating HIVA icon
  - ChatInput at bottom (above tab bar)
- **State**: `messages: ChatMessage[]`, `inputValue`, `isTyping`, `suggestions`
- **Calls**: `sendMessage()`, `searchResponse()`, `navigate()`

#### `MessageBubble`
- **Props**: `{ message: ChatMessage }`
- **Renders**:
  - HIVA (left): white bg, warm stone border, `rounded-lg rounded-bl-none`, shadow-sm
  - User (right): `bg-accent-600`, white text, `rounded-lg rounded-br-none`
  - Timestamp below: 11px muted
  - For type !== 'text', renders appropriate sub-card inside bubble

#### `ResponseCard`
- **Props**: `{ message: ChatMessage }`
- **Renders**:
  - White card, `border border-accent-100`, `rounded-xl`, `p-4`
  - Header chip: `bg-accent-50 text-accent-600 rounded-md px-2 py-1 text-xs font-display font-semibold`
  - Content: DM Sans 400 14px, line-height 1.6, whitespace-pre-line
  - Warning line (if present): `border-l-3 border-warning bg-warning/5 p-2 rounded-r`
  - Source: 11px muted, JetBrains Mono
  - Action buttons: "Ask follow-up" + "Save" (ghost buttons)

#### `DangerSignCard`
- **Props**: `{ message: ChatMessage }`
- **Renders**:
  - `border-l-4 border-l-error bg-error/5`
  - Header: "⚠ DANGER SIGN" badge in red pill
  - Content: bold, larger text (16px), high contrast
  - Immediate action in bold
  - Never collapsible — always fully visible

#### `DrugTableCard`
- **Props**: `{ drugId: string }`
- **Renders**:
  - Inline mini-card in chat
  - Drug name + route/form
  - "View dosing table →" button → navigates to `/drug-table/:id`

#### `SuggestionChips`
- **Props**: `{ suggestions: string[]; onSelect: (text: string) => void }`
- **Renders**:
  - Horizontal scroll container
  - Pill buttons: `bg-brand-tan-subtle border border-brand-tan-muted text-brand-tan rounded-full h-8 px-4`
  - Tap: `active:scale-95`, calls `onSelect`

#### `TypingIndicator`
- **Props**: none
- **Renders**: 3 dots in accent-600, pulsing sequentially with 100ms stagger

#### `ChatInput`
- **Props**: `{ value; onChange; onSend; disabled? }`
- **Renders**:
  - 52px height bar, white bg, warm stone top border
  - Mic icon left (grayed out, `opacity-40`)
  - Text input: `rounded-xl h-10 px-3`, placeholder "Ask a clinical question…"
  - Send button: `bg-accent-600` circle, white arrow icon, disabled if empty

### Knowledge Screens

#### `KnowledgeBaseScreen`
- **Props**: none
- **Renders**:
  - Header: "Knowledge Base" + subtitle + StatusPill + info notice (amber pill)
  - Vertical list of ArtifactCards
- **State**: none (static data)
- **Calls**: `navigate('/knowledge/:id')` on card tap

#### `ArtifactCard`
- **Props**: `{ artifact: Artifact }`
- **Renders**:
  - White card, `border-n-200`, `rounded-xl`, `p-4`
  - Top row: emoji icon (32px in 48px tinted circle) + title + year badge
  - Publisher: muted text
  - Topic chips row: `bg-brand-tan-subtle text-brand-tan rounded-full text-xs`

#### `KnowledgeDetailScreen`
- **Props**: `route.params.id` (from router)
- **Renders**:
  - TopBar with back button
  - Gradient header section (`from-accent-600 to-accent-500`)
  - Large emoji in white circle, title, publisher + edition
  - "TOPICS COVERED" section with bullet rows
  - VerificationBanner
  - CTA: "Ask HIVA about [Artifact Name]"
- **State**: `artifact` (derived from param id)
- **Calls**: `navigate('/chat')` with pre-filled context

### Decision Tree Screen

#### `DecisionTreeScreen`
- **Props**: `route.params.id`
- **Renders**:
  - TopBar with back + protocol name
  - `TreeNavigator` (progress bar + breadcrumbs)
  - `TreeNode` (current question or terminal)
  - Bottom nav: "← Back" ghost button
- **State**: `currentNodeId`, `history: string[]` (stack of visited node ids)
- **Calls**: `navigate()` on completion (action nodes may link to drug table)

#### `TreeNode`
- **Props**: `{ node: TreeNode; onSelect: (nextId: string) => void }`
- **Renders**:
  - Branch: large card with question text + stacked option buttons
  - Action: green-bordered result card with instructions + optional "View drug table" link
  - Refer: red-bordered result card with urgency badge + holding care + handover text

#### `TreeNavigator`
- **Props**: `{ tree: DecisionTree; currentNodeId: string; history: string[] }`
- **Renders**:
  - Progress bar: `(history.length / totalDepth) * 100%` fill in accent-600
  - Step counter: "Step N of M"
  - Breadcrumb pills: collapsed list of answered nodes

### Drug Table Screen

#### `DrugTableScreen`
- **Props**: `route.params.id`, optional `route.params.weight` (from chat)
- **Renders**:
  - TopBar with back
  - Drug name + route/form
  - WeightSlider (or pre-set weight if from chat)
  - DoseResultCard (live updating)
  - Bounds warning if out of range
- **State**: `weightKg` (default 12 or param)
- **Calls**: `getDoseForWeight(drugId, weightKg)`

#### `WeightSlider`
- **Props**: `{ value; min; max; onChange }`
- **Renders**:
  - Large display: "12 kg" (Space Grotesk 700, 48px, accent-600)
  - Range input: custom styled with accent-600 track, white thumb
  - +/- buttons for fine adjustment
- **State**: none (controlled)

#### `DoseResultCard`
- **Props**: `{ drugId: string; weightKg: number }`
- **Renders**:
  - White card, `border-accent-100`, `rounded-xl`
  - "DOSE" label + large value (Space Grotesk 700, 28px)
  - Frequency, duration, route rows
  - Warning banner (amber) if present
  - Bounds warning (red) if `inRange === false`

### Settings Screen

#### `SettingsScreen`
- **Props**: none
- **Renders**:
  - Header: "Settings" + user name/facility
  - LanguageSelector section
  - ServerCodeDisplay section
  - AppearanceSettings section
  - App Info section (version, .hiv file, sync time, changelog link)
- **State**: none (all sub-components manage own state or read context)

#### `LanguageSelector`
- **Props**: none (reads/writes settings)
- **Renders**: 
  - List of 5 languages as rows (English ✓, Hausa, Yorùbá, Igbo, Pidgin)
  - 52px height rows, checkmark on selected, warm stone tap bg

#### `AppearanceSettings`
- **Props**: none
- **Renders**:
  - Dark mode Toggle
  - Interaction mode selector: Quiet / Companion / Co-pilot (radio pill group, v2.1 placeholder)

---

## 4. FULL USER FLOWS

### Flow 1: Login → Chat

1. User opens app (or reloads)
2. `AuthContext` checks `sessionStorage` for `hivaline_session`
3. If found + valid: set `isAuthenticated = true`, render app shell
4. If not found: render `LoginScreen`
5. User types server code + access key
6. On input change: auto-uppercase, clear previous error
7. On submit: validate format with regex
8. If invalid format: show red error pill below inputs, stay on screen
9. If valid format: call `findUserByCode()`
10. If no match: show "Invalid code or key" error
11. If match: store session in `sessionStorage`, set auth state
12. Show green checkmark pulse animation (300ms)
13. `navigate('/chat')`
14. `ChatScreen` mounts with welcome state

### Flow 2: Chat → Drug Dosing Response

1. User taps suggestion chip "ACT dose for 12kg child" OR types message
2. `ChatInput` calls `onSend(inputValue)`
3. `ChatScreen` adds user message to `messages` array
4. Set `isTyping = true`
5. Call `searchResponse(inputValue)` — synchronous, <10ms
6. Wait minimum 300ms (controlled delay for perceived confidence)
7. Set `isTyping = false`
8. Add HIVA response message to `messages`
9. If response type is `drug_table`: render `DrugTableCard` inline
10. User taps "View dosing table →"
11. `navigate('/drug-table/act-artemether?weight=12')`
12. `DrugTableScreen` mounts with weight pre-set to 12
13. `DoseResultCard` computes and displays dose immediately
14. User can adjust weight with slider; dose updates live

### Flow 3: Chat → Decision Tree

1. User types "Signs of severe malaria"
2. Chat processes message, returns `type: 'decision_tree'` response
3. HIVA message renders with "Start assessment →" button
4. User taps button
5. `navigate('/decision-tree/malaria-assessment')`
6. `DecisionTreeScreen` mounts, loads tree, sets `currentNodeId = tree.entryNode`
7. Renders first question ("Does the child have fever...")
8. User selects "Yes"
9. Push current node id to `history`, set `currentNodeId = option.next`
10. Animate slide transition (right-to-left) to next node
11. Repeat until terminal node reached
12. Terminal node renders action or refer card
13. User taps "← Back" → pop history, slide left-to-right
14. On action node with `linkedDrug`: show "View drug table" button → navigate to drug screen

### Flow 4: Chat → Danger Sign

1. User types "Child has convulsions"
2. `searchResponse` matches danger sign keywords
3. Returns `type: 'danger_sign'` response
4. `MessageBubble` renders `DangerSignCard` with red border
5. Card is fully expanded, no collapse
6. Content shows immediate actions in bold
7. Source citation at bottom
8. User can type follow-up or navigate to knowledge base

### Flow 5: Knowledge Base → Detail → Chat

1. User taps "Knowledge" tab
2. `KnowledgeBaseScreen` renders list of 5 artifacts
3. User taps "Malaria Case Management" card
4. `navigate('/knowledge/malaria-2024')`
5. `KnowledgeDetailScreen` mounts, loads artifact by id
6. Renders gradient header, topics list, verification banner
7. User taps "Ask HIVA about Malaria Case Management"
8. `navigate('/chat')` with pre-filled message in state (or URL param)
9. `ChatScreen` receives pre-filled message, auto-sends or populates input

### Flow 6: Settings → Language Change

1. User taps "Settings" tab
2. `SettingsScreen` renders
3. User taps "Language" option (e.g., "Hausa")
4. `LanguageSelector` updates settings state
5. UI immediately reflects new language (if i18n implemented; for MVP, English only, but UI state updates)
6. Settings persist to `localStorage` as `hivaline_settings`

### Flow 7: Settings → Logout

1. User in Settings
2. Taps "Logout" or "Update Code" (which triggers logout)
3. `AuthContext.logout()` clears `sessionStorage`
4. `isAuthenticated = false`
5. Router redirects to `/` (LoginScreen)
6. All screen state resets (mount new LoginScreen)

---

## 5. FULL STATE MAP

### Global State (React Context)

| State | Location | Initial | Persists? | Reset When? |
|-------|----------|---------|-----------|-------------|
| `auth.state` | `AuthContext` | `{ isAuthenticated: false, user: null }` | `sessionStorage` | Logout, session expiry |
| `theme` | `ThemeContext` | `'light'` | `localStorage` (key: `hivaline_theme`) | Never (user toggle only) |
| `settings` | `SettingsContext` (or local in SettingsScreen) | `{ language: 'en', theme: 'light', interactionMode: 'companion' }` | `localStorage` (key: `hivaline_settings`) | Never |

### Route State (URL Hash)

| State | Hash Pattern | Example |
|-------|-------------|---------|
| Current screen | `/#/path` | `/#/chat`, `/#/knowledge/malaria-2024` |
| Query params | `?key=value` | `?weight=12` |

### Screen-Level State

#### `LoginScreen`
| State | Type | Initial |
|-------|------|---------|
| `serverCode` | `string` | `''` |
| `accessKey` | `string` | `''` |
| `error` | `string \| null` | `null` |
| `isSuccess` | `boolean` | `false` |

#### `ChatScreen`
| State | Type | Initial |
|-------|------|---------|
| `messages` | `ChatMessage[]` | `[]` |
| `inputValue` | `string` | `''` |
| `isTyping` | `boolean` | `false` |

#### `DecisionTreeScreen`
| State | Type | Initial |
|-------|------|---------|
| `currentNodeId` | `string` | `tree.entryNode` |
| `history` | `string[]` | `[]` |

#### `DrugTableScreen`
| State | Type | Initial |
|-------|------|---------|
| `weightKg` | `number` | `12` (or from URL param) |

### Derived State (useMemo)

| Derived From | Computed Value | Where |
|-------------|----------------|-------|
| `messages` | `hasMessages` (boolean) | `ChatScreen` |
| `currentNodeId + tree` | `currentNode` (TreeNode) | `DecisionTreeScreen` |
| `history + tree` | `progressPercent` (number) | `TreeNavigator` |
| `weightKg + drugId` | `doseResult` (DoseResult) | `DoseResultCard` |
| `route.path` | `activeTab` (string) | `BottomTabBar` |

### State Reset Rules

- On logout: all Context state resets. Screen components unmount (route change).
- On navigating away from a screen: local `useState` resets on remount.
- Chat messages: ephemeral — lost on reload (acceptable for MVP, no persistence).
- Decision tree history: lost on back navigation out of screen.

---

## 6. FULL ERROR MAP

| Error | Where Caught | User Sees | Fallback Action |
|-------|-------------|-----------|-----------------|
| Invalid server code format | `validation.ts` → `LoginScreen` | Red pill: "Invalid server code. Use FMOH-XXXX." | None (stay on form) |
| Invalid access key format | `validation.ts` → `LoginScreen` | Red pill: "Access key must be 4 characters." | None (stay on form) |
| Login credentials don't match | `findUserByCode()` → `LoginScreen` | Red pill: "Invalid code or key. Check with your supervisor." | None (stay on form) |
| Unauthenticated access to route | `Router.tsx` guard | Redirect to `/` | Redirect |
| Invalid route path | `Router.tsx` fallback | Redirect to `/chat` (if auth) or `/` (if not) | Redirect |
| Artifact not found by id | `getArtifactById()` → `KnowledgeDetailScreen` | "Artifact not found" message + back button | Navigate back |
| Drug not found by id | `getDrugById()` → `DrugTableScreen` | "Drug information not available." | Navigate back |
| Tree not found by id | `getTreeById()` → `DecisionTreeScreen` | "Protocol not found." | Navigate back |
| Weight out of safe range | `getDoseForWeight()` → `DoseResultCard` | Red banner: "Weight outside safe dosing range — REFER" | Show referral guidance |
| Chat keyword no match | `searchResponse()` → `ChatScreen` | Fallback message (see AGENTS.md) | None |
| Component render error | `ErrorBoundary` | "Something went wrong. Your clinical data is safe. Tap to restart HIVA." | Reload page |
| `sessionStorage` read error | `AuthContext` init | Treat as unauthenticated | Render LoginScreen |

---

## 7. FULL SECURITY MAP

| Attack Surface | Defense | Implementation |
|---------------|---------|----------------|
| **XSS via user input** | React escapes all text by default | Never use `dangerouslySetInnerHTML`. All user input rendered as text nodes. |
| **XSS via mock data** | Static typed data only | Mock data is `as const` TypeScript objects, never constructed from strings. |
| **Code injection** | No dynamic code execution | Ban `eval`, `Function`, `setTimeout(string)`. All logic is static TS. |
| **Session hijacking** | Session in `sessionStorage` only | `sessionStorage` cleared on app close. No `localStorage` for auth. |
| **Sensitive data leak in URL** | No sensitive data in hash | Route params only use opaque IDs (e.g., `malaria-2024`), never user data. |
| **LocalStorage tampering** | Only non-sensitive settings | `localStorage` stores theme + language only. No clinical data. |
| **Offline file integrity** | Read-only mock data | All `.ts` data files are `as const`. No runtime mutation allowed. |
| **UI spoofing** | Consistent branding + verification badges | Every clinical response shows source. VerificationBadge on all artifact views. |
| **Accidental data loss** | No destructive actions without confirmation | No delete operations in MVP. Logout is reversible (re-login). |
| **CSRF** | `.hiv` update uses POST to single known endpoint | `fetch()` wrapped in try/catch; offline = silent skip. No user data in URLs. |
| **SQL Injection** | N/A (no database) | No database = no SQL injection. |

---

## 8. ARCHITECTURE DECISIONS LOG

### Routing

✅ **CHOSEN: Custom hash router** — because the app must work opened as a local `file://` URL on Android devices. Hash routing (`/#/chat`) works without a server. Implementation is <100 lines.

❌ **REJECTED: React Router** — adds ~20KB gzipped, requires DOM history API which behaves inconsistently on `file://` protocol, and is overkill for 6 routes.

❌ **REJECTED: Next.js App Router** — adds ~80KB+ bundle, built for SSR/SSG, introduces server-centric patterns we don't need. Static export possible but heavier than Vite.

### State Management

✅ **CHOSEN: React Context + useState/useReducer** — app has minimal global state (auth, theme, settings). No prop drilling issues. Keeps bundle tiny.

❌ **REJECTED: Zustand / Jotai / Redux** — each adds 1-5KB and introduces external dependency. Not needed for 3 global state slices.

### Build Tool

✅ **CHOSEN: Vite** — instant HMR, smaller bundle than CRA/Next.js, `file://` compatible output, simple static export.

❌ **REJECTED: Create React App** — deprecated by React team, slower builds, larger bundles, no native TS path aliases.

❌ **REJECTED: Next.js** — see Routing rejection. Over-engineered for a zero-backend SPA.

### Styling

✅ **CHOSEN: Tailwind CSS + CSS variables** — purgeable utilities keep CSS small. CSS variables enable runtime theme switching (light/dark) without JS recalculation.

❌ **REJECTED: CSS Modules** — more files to manage, no built-in design system tokens, harder to maintain consistency.

❌ **REJECTED: Styled-components / Emotion** — adds JS runtime cost (bad for low-spec Android), larger bundle, harder to tree-shake.

❌ **REJECTED: UI library (MUI, Chakra)** — too heavy for 200KB target, generic look violates "warmth" design requirement.

### Animation

✅ **CHOSEN: Framer Motion** — declarative API, `AnimatePresence` for page transitions, respects `prefers-reduced-motion`.

❌ **REJECTED: CSS animations only** — page transitions and gesture animations are too complex to manage purely in CSS.

❌ **REJECTED: GSAP** — larger bundle, imperative API harder for agents to use correctly.

### Data Layer

✅ **CHOSEN: In-memory mock data as TypeScript `as const` objects** — zero latency, type-safe, works offline, no serialization cost.

❌ **REJECTED: IndexedDB / localStorage for clinical data** — unnecessary complexity, slower, risk of tampering.

❌ **REJECTED: JSON imports** — loses TypeScript type safety and intellisense.

### Icons

✅ **CHOSEN: Lucide React** — tree-shakeable, consistent stroke width, medically appropriate icon set.

❌ **REJECTED: SVG sprites / inline SVGs** — harder to maintain, no tree-shaking benefit at this scale.

❌ **REJECTED: Emoji as primary icons** — used for artifact decorative icons only, not for UI controls (accessibility).

### Fonts

✅ **CHOSEN: Google Fonts CDN with `display=swap`** — warm, professional, free, no self-hosting needed.

❌ **REJECTED: Self-hosted fonts** — adds build complexity and file count for minimal gain.

❌ **REJECTED: System fonts only** — cannot achieve the "warmth + clinical trust" design requirement with system defaults.

### Testing

✅ **CHOSEN: Vitest + React Testing Library** — fast, Vite-native, modern API, jsdom for DOM tests.

❌ **REJECTED: Jest** — slower, requires more config with Vite, older ecosystem.

---

## 9. DESIGN TOKENS QUICK REFERENCE

| Token | Value | Usage |
|-------|-------|-------|
| Primary CTA bg | `bg-accent-600` | Send buttons, active tabs, primary actions |
| Primary CTA text | `text-white` | On accent backgrounds |
| Secondary accent | `text-brand-tan` | Decorative chips, badges, verified indicators |
| Body text | `text-n-800` light / `text-n-100` dark | All readable text |
| Muted text | `text-n-500` | Timestamps, subtitles, hints |
| Card surface | `bg-white` light / `bg-n-800` dark | Cards, bubbles |
| Card border | `border-n-200` light / `border-n-700` dark | Card outlines |
| Danger surface | `bg-error/5` | Danger sign cards |
| Danger border | `border-l-error` | Danger sign left border |
| Success surface | `bg-success/5` | Verification banners |
| Warning surface | `bg-warning/5` | Warning callouts |
| Touch target min | `min-w-[44px] min-h-[44px]` | All buttons, inputs, tappable rows |
| Page padding | `px-4` (16px) | Horizontal padding on all screens |
| Section gap | `gap-4` (16px) | Between major sections |
| Card padding | `p-4` (16px) | Inside all cards |
| Heading font | `font-display` | Space Grotesk |
| Body font | `font-body` | DM Sans |
| Mono font | `font-mono` | JetBrains Mono (codes, sources) |

---

*HIVALINE v2.0 Blueprint · Last updated: May 2026*
