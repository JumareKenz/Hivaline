# AGENTS.md — HIVALINE Permanent Rulebook

> READ THIS FILE FULLY BEFORE WRITING A SINGLE LINE OF CODE.
> These rules are non-negotiable. Every decision is already made.

---

## 1. PROJECT OVERVIEW

| Field | Value |
|-------|-------|
| **Name** | HIVALINE |
| **Purpose** | Offline runtime interpreter for HIVA 2.0, a clinical AI assistant for Nigeria's Community Health Extension Workers (CHEWs) |
| **Users** | Frontline health workers in rural Nigeria, on low-spec Android phones, always offline |
| **Problem Solved** | Provides instant, trustworthy, FMOH-approved clinical guidance without internet connectivity |
| **Reference** | Like a clinical colleague in your pocket — warm, fast, and always available |
| **Quality Bar** | Will be reviewed by health ministry officials, UNICEF, and international NGOs. Every pixel matters. |

---

## 2. TECH STACK — LOCKED

| Layer | Choice | Version | Rationale |
|-------|--------|---------|-----------|
| **Framework** | Vite + React | Vite 6.x, React 19.x | Bundle size <200KB target, no SSR overhead, instant HMR, `file://` protocol support for true offline |
| **Language** | TypeScript | 5.7.x, strict mode | Type safety for clinical data; strict prevents silent failures |
| **Styling** | Tailwind CSS | 3.4.x | Utility-first, purgeable, custom design tokens via CSS variables |
| **Fonts** | Google Fonts | Space Grotesk, DM Sans, JetBrains Mono | Distinctive display + refined body + monospace. Zero generic system fonts. |
| **Icons** | Lucide React | latest | Tree-shakeable, consistent, no images |
| **Animations** | Framer Motion | 11.x | Page transitions, micro-interactions; respect `prefers-reduced-motion` |
| **Routing** | Custom hash router | inline | Hash routing works on `file://` protocol (offline files). No react-router (adds ~20KB). |
| **State** | React useState / useReducer / Context | built-in | App is small enough; no Zustand/Redux needed. Prevents dependency bloat. |
| **Build Output** | Static SPA | `vite build` | Single `index.html` + assets. Served from any static host or opened directly as file. |
| **PWA** | Vite PWA plugin | `vite-plugin-pwa` | Service worker for offline caching; generate manifest.json |

### Install Commands (exact — copy-paste)

```bash
# Project init
npm create vite@latest hivaline -- --template react-ts

# Core dependencies
npm install framer-motion lucide-react

# Dev dependencies
npm install -D tailwindcss postcss autoprefixer @types/node
npx tailwindcss init -p

# PWA (for offline service worker)
npm install -D vite-plugin-pwa
```

### Design Craft Mandate

Every pixel must look like it was placed by a world-class design team (Linear, Vercel, Stripe). The UI must not feel "vibecoded" or generic.

**Typography:** Space Grotesk (display, 400-700) + DM Sans (body, 300-700) + JetBrains Mono (codes, 400-600). No system-ui, no Inter, no Roboto. Establish ruthless hierarchy — not everything is the same weight.

**Color System:** One sharp accent (teal, `#155D46`). Warm stone neutrals (NOT cold grays). Full surface layering: background → surface → surface-raised → surface-overlay. Semantic colors (success, warning, error, info) must be cohesive with the palette.

**Elevation:** NO generic `box-shadow: 0 4px 6px rgba(0,0,0,0.1)`. Use intentional elevation tokens: `shadow-sm` (subtle, 1px blur), `shadow-md` (structured, 4px blur), `shadow-lg` (focused, 12px blur). Shadows use warm-tinted blacks, not pure black.

**Atmosphere:** Subtle noise texture overlay (3% opacity) on the login gradient. Layered gradients on hero/header areas. Backdrop-filter blur on floating elements (tab bar, modals, dropdowns). Strategic 1px borders at low opacity for structure.

**Spacing:** 8pt grid system. All spacing is multiples of 4px or 8px. Generous negative space around focal elements. Deliberate asymmetry in hero areas.

**Motion:** CSS transitions on ALL interactive elements (color, background, border, transform, 150ms-200ms ease). Staggered entrance animations on page load. Hover states that actually do something (scale, translate, color shift). AnimatePresence for page transitions. 300ms minimum typing indicator for perceived confidence.

**Border Radius:** Intentional system — sm (6px) for inputs, md (8px) for buttons, lg (12px) for cards, xl (16px) for panels, 2xl (20px) for modals, full (9999px) for pills and avatars. Not everything gets the same radius.

**Dark Mode:** Use `data-theme="light" | data-theme="dark"` on `<html>`. All colors are CSS custom properties. Transition between themes with 200ms ease on background-color and color. Respect `prefers-color-scheme` on first load. Toggle is a polished sun/moon animated icon in the top bar.

### tsconfig.json strict settings (MUST use)

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

### vite.config.ts

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'HIVALINE',
        short_name: 'HIVALINE',
        description: 'Offline Clinical AI for Nigeria CHEWs',
        theme_color: '#155D46',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}']
      }
    })
  ],
  build: {
    target: 'es2020',
    minify: 'terser',
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks: undefined // force single chunk for offline simplicity
      }
    }
  }
});
```

### tailwind.config.js

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['"DM Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        accent: {
          50: '#eaf6f1',
          100: '#d4ede5',
          500: '#1a7056',
          600: '#155D46',
          700: '#114a38',
          800: '#0e3d2f',
        },
        brand: {
          tan: '#C9A96E',
          'tan-muted': 'rgba(201, 169, 110, 0.15)',
          'tan-subtle': 'rgba(201, 169, 110, 0.08)',
        },
        n: {
          0: '#ffffff',
          50: '#fafaf9',
          100: '#f5f5f4',
          200: '#e7e5e4',
          300: '#d6d3d1',
          400: '#a8a29e',
          500: '#78716c',
          600: '#57534e',
          700: '#44403c',
          800: '#292524',
          900: '#1c1917',
          950: '#0c0a09',
        },
        success: '#10b981',
        warning: '#f59e0b',
        error: '#ef4444',
        info: '#3b82f6',
      },
      borderRadius: {
        sm: '6px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        '2xl': '20px',
        full: '9999px',
      },
      transitionTimingFunction: {
        'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      keyframes: {
        'hiva-float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'pulse-dot': {
          '0%, 100%': { opacity: '0.3', transform: 'scale(0.8)' },
          '50%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'hiva-float': 'hiva-float 4s ease-in-out infinite',
        'pulse-dot': 'pulse-dot 1.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
```

---

## 3. FOLDER STRUCTURE

```
hivaline/
├── public/
│   ├── icon-192.png          # PWA icon (generate minimal geometric cross+circle)
│   ├── icon-512.png          # PWA icon large
│   └── manifest.json         # Auto-generated by vite-plugin-pwa
├── index.html                # Entry HTML with Google Fonts link
├── vite.config.ts            # Build config (see section 2)
├── tailwind.config.js        # Tailwind config (see section 2)
├── postcss.config.js         # PostCSS (auto-generated by tailwind init)
├── tsconfig.json             # TS config (see section 2)
├── package.json
└── src/
    ├── main.tsx              # React root render, wraps App in providers
    ├── App.tsx               # Router + theme class + MobileShell
    ├── index.css             # Tailwind directives + CSS variables + font imports
    │
    ├── types/
    │   └── hiv.ts            # ALL TypeScript interfaces (single source of truth)
    │
    ├── data/
    │   ├── artifacts.ts      # Mock artifact data (5 FMOH guidelines)
    │   ├── decisionTrees.ts  # Decision tree protocols (malaria, etc.)
    │   ├── drugTables.ts     # Drug dosing data with weight ranges
    │   ├── mockResponses.ts  # Keyword→response mapper for chat
    │   └── users.ts          # Mock authenticated user profile
    │
    ├── router/
    │   ├── Router.tsx        # Hash-based router: reads window.location.hash
    │   ├── Route.tsx         # Route matcher component
    │   ├── useRouter.ts      # Hook: currentRoute, navigate(), goBack()
    │   └── routes.ts         # Route definitions array (path→screen mapping)
    │
    ├── context/
    │   ├── AuthContext.tsx   # Auth state: user, isAuthenticated, login(), logout()
    │   └── ThemeContext.tsx  # Theme state: theme ('light'|'dark'), toggleTheme()
    │
    ├── hooks/
    │   ├── useSearch.ts      # Chat input → response matcher logic
    │   ├── useTheme.ts       # Re-export of ThemeContext consumer
    │   └── useAuth.ts        # Re-export of AuthContext consumer
    │
    ├── utils/
    │   ├── validation.ts     # Server code format, access key format, weight validation
    │   ├── formatters.ts     # Date formatting, weight display, text transforms
    │   └── constants.ts      # App version, regex patterns, UI constants (e.g., min touch 44px)
    │
    ├── components/
    │   ├── shell/
    │   │   ├── MobileShell.tsx      # Phone frame wrapper (~390px centered), safe-area padding
    │   │   ├── BottomTabBar.tsx     # Glassmorphic sticky tab bar (Chat, Knowledge, Settings)
    │   │   └── SafeArea.tsx         # Top/bottom safe area insets (env(safe-area-inset-*))
    │   │
    │   ├── ui/                      # Pure reusable UI primitives (NO business logic)
    │   │   ├── StatusPill.tsx       # "Offline Ready" animated status indicator
    │   │   ├── VerificationBadge.tsx# FMOH approved green checkmark badge
    │   │   ├── ServerCodeDisplay.tsx# Monospace code display with copy layout
    │   │   ├── TopBar.tsx           # Screen header with back button + title + optional status
    │   │   ├── Card.tsx             # Generic card primitive (surface, border, radius, padding)
    │   │   ├── Button.tsx           # All button variants (primary, secondary, ghost, danger)
    │   │   ├── Input.tsx            # Form input with validation state, error message
    │   │   └── Toggle.tsx           # Custom animated toggle switch (used in settings)
    │   │
    │   ├── auth/
    │   │   └── LoginScreen.tsx      # Full-screen login with gradient, inputs, validation
    │   │
    │   ├── chat/
    │   │   ├── ChatScreen.tsx       # Main chat UI: messages list + input bar
    │   │   ├── MessageBubble.tsx    # HIVA (left) and User (right) message bubbles
    │   │   ├── ResponseCard.tsx     # Compiled knowledge answer card
    │   │   ├── DangerSignCard.tsx   # Red-bordered danger sign response
    │   │   ├── DrugTableCard.tsx    # Inline drug dose mini-card in chat
    │   │   ├── SuggestionChips.tsx  # Horizontal scrollable pill buttons
    │   │   ├── TypingIndicator.tsx  # 3 pulsing dots animation
    │   │   └── ChatInput.tsx        # Bottom input bar with text field + send button
    │   │
    │   ├── knowledge/
    │   │   ├── KnowledgeBaseScreen.tsx    # Artifact list grid
    │   │   ├── KnowledgeDetailScreen.tsx  # Deep artifact view with topics + verification
    │   │   └── ArtifactCard.tsx           # Knowledge base list item card
    │   │
    │   ├── decision/
    │   │   ├── DecisionTreeScreen.tsx     # Protocol walker shell
    │   │   ├── TreeNode.tsx               # Individual question/answer node renderer
    │   │   └── TreeNavigator.tsx          # Progress bar + breadcrumbs + back nav
    │   │
    │   ├── drug/
    │   │   ├── DrugTableScreen.tsx  # Full drug dosing calculator
    │   │   ├── WeightSlider.tsx     # Custom styled range slider (3-60kg)
    │   │   └── DoseResultCard.tsx   # Live-updating dose display card
    │   │
    │   └── settings/
    │       ├── SettingsScreen.tsx       # Settings shell with sections
    │       ├── LanguageSelector.tsx     # Language list with checkmarks
    │       ├── AppearanceSettings.tsx   # Dark mode toggle + interaction mode
    │       └── ServerCodeDisplay.tsx    # Active server connection card (reuses ui/ primitive)
    │
    └── __tests__/              # Tests mirror src structure
        ├── utils/
        │   └── validation.test.ts
        ├── hooks/
        │   └── useSearch.test.ts
        ├── components/
        │   ├── ui/
        │   │   └── Button.test.tsx
        │   └── chat/
        │       └── ResponseCard.test.tsx
        └── router/
            └── useRouter.test.ts
```

---

## 4. CODE STYLE RULES

### ALWAYS

- Use **functional components** with explicit return type `React.FC` or `JSX.Element`
- Use **explicit TypeScript types** for all props, return values, and state
- Use **template literals** for className composition when conditionals exceed 2 classes
- Use **`clsx` library** (install it: `npm install clsx`) for conditional class merging
- Use **`useCallback`** for all event handlers passed as props (prevents re-renders on mobile)
- Use **`useMemo`** for all derived data (filtered lists, computed doses, formatted strings)
- Use **early returns** for guard clauses — never nest deeper than 2 levels
- Use **`const` assertions** for frozen configuration objects (routes, drug tables)
- Use **destructured props** in component signatures: `const Component: React.FC<Props> = ({ id, name }) =>`
- Use **arrow functions** for all component definitions and callbacks
- Add **`aria-label`** to every icon-only button
- Add **`role="status"`** or `role="alert"` to dynamic status messages
- Wrap every screen in **`AnimatePresence` + `motion.div`** for page transitions (see Performance rules)

### NEVER

- NEVER use `any` type — if a type is truly unknown, use `unknown` and narrow it
- NEVER use inline styles (`style={{}}`) — always use Tailwind classes or CSS variables
- NEVER use `console.log` in production code — use a no-op logger utility or remove before commit
- NEVER hardcode colors — always use Tailwind tokens (e.g., `text-accent-600`, `bg-n-50`)
- NEVER use magic numbers — define constants in `utils/constants.ts`
- NEVER nest ternary operators deeper than 1 level — use `if/else` or lookup objects
- NEVER import from `react-router-dom` — we use custom hash router only
- NEVER use `eval`, `Function`, or `new Function()` — security risk with offline data
- NEVER store sensitive data (server codes, access keys) in `localStorage` — use `sessionStorage` (cleared on close) or in-memory only
- NEVER make HTTP requests for app functionality — all clinical responses must work fully offline with zero network. The ONLY permitted network use is the `.hiv` update loop: version check, resumable download, and telemetry submission. All `fetch()` calls must be wrapped in offline-safe fallbacks that silently skip when disconnected.
- NEVER use `@ts-ignore` — fix the type error or explicitly cast with `as` and comment why
- NEVER use `!important` in CSS
- NEVER use pixel values in Tailwind where a token exists (e.g., use `p-4` not `p-[16px]`)
- NEVER leave `TODO` or `FIXME` comments in committed code — track in PROGRESS.md

---

## 5. NAMING CONVENTIONS

### Files

| Type | Pattern | Example |
|------|---------|---------|
| Components | PascalCase.tsx | `ChatScreen.tsx`, `MessageBubble.tsx` |
| Hooks | camelCase.ts, prefix `use` | `useSearch.ts`, `useTheme.ts` |
| Utilities | camelCase.ts | `validation.ts`, `formatters.ts` |
| Types/Interfaces | camelCase.ts, suffix type file | `hiv.ts` (contains all types) |
| Data files | camelCase.ts | `artifacts.ts`, `drugTables.ts` |
| Tests | Same name as file + `.test.ts(x)` | `validation.test.ts` |
| CSS | Only `index.css` and component-scoped Tailwind | No separate `.module.css` files |

### Variables & Functions

| Type | Pattern | Example |
|------|---------|---------|
| Components | PascalCase | `const ChatScreen: React.FC<Props> = ...` |
| Hooks | camelCase, prefix `use` | `const useRouter = () => ...` |
| Constants | SCREAMING_SNAKE_CASE | `const MIN_TOUCH_TARGET = 44;` |
| Boolean variables | Prefix `is`, `has`, `should` | `isAuthenticated`, `hasDangerSigns` |
| Event handlers | Prefix `handle` | `handleSendMessage`, `handleWeightChange` |
| Callback props | Prefix `on` | `onSubmit`, `onNavigate`, `onSelectOption` |
| Derived/computed | Prefix `get` or descriptive noun | `getDoseForWeight`, `formattedServerCode` |
| Type aliases | PascalCase, suffix `Type` only if ambiguous | `ChatMessage`, `Artifact`, `TreeNode` |
| Interfaces | PascalCase, no `I` prefix | `interface AuthState { ... }` |
| Enums | PascalCase + `as const` object (no TS enum) | `const ThemeMode = { Light: 'light', Dark: 'dark' } as const;` |

### CSS Classes (Tailwind)

- Use Tailwind utility classes exclusively
- For dynamic/computed classes, use `clsx` + template literal
- Group classes by concern: layout → spacing → sizing → typography → colors → effects → states
- Example:
  ```tsx
  className={clsx(
    'flex items-center justify-between',  // layout
    'px-4 py-3 gap-2',                    // spacing
    'w-full h-14',                        // sizing
    'text-sm font-body font-medium',      // typography
    'bg-white text-n-900',                // colors
    'rounded-xl shadow-sm',               // effects
    'active:scale-[0.97] transition-transform duration-100', // states
    isSelected && 'bg-accent-600 text-white'
  )}
  ```

---

## 6. COMPONENT CONVENTIONS

### Every component file MUST follow this exact order:

```tsx
// 1. Imports (see Import Order below)
// 2. Types/Interfaces (if not in shared types file)
// 3. Constants (if file-specific)
// 4. Helper functions (if file-specific, NOT exported)
// 5. Component definition
// 6. Sub-components (if small and only used here)
// 7. Default export
```

### Component signature template:

```tsx
import React, { useState, useCallback, useMemo } from 'react';
import { clsx } from 'clsx';

interface MyComponentProps {
  id: string;
  title: string;
  isActive?: boolean;
  onSelect: (id: string) => void;
}

const MyComponent: React.FC<MyComponentProps> = ({ id, title, isActive = false, onSelect }) => {
  const handleClick = useCallback(() => {
    onSelect(id);
  }, [id, onSelect]);

  const computedLabel = useMemo(() => `${title} (${id})`, [title, id]);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={isActive}
      className={clsx(
        'flex items-center px-4 py-3 w-full',
        'text-sm font-body font-medium',
        'rounded-xl transition-colors duration-200',
        isActive ? 'bg-accent-600 text-white' : 'bg-white text-n-700 hover:bg-n-50'
      )}
    >
      {computedLabel}
    </button>
  );
};

export default MyComponent;
```

### Props rules:

- Always destructure in the parameter list
- Always provide defaults for optional booleans (`= false`)
- Never pass entire objects when only 2-3 fields are needed — destructure at call site
- Callback props must always be wrapped in `useCallback` at the parent

---

## 7. IMPORT ORDER

Use this exact order, separated by blank lines:

```tsx
// 1. React and built-ins
import React, { useState, useEffect, useCallback, useMemo } from 'react';

// 2. Third-party libraries
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import { Send, Mic } from 'lucide-react';

// 3. Absolute internal imports (types, data, utils, hooks, context)
import type { ChatMessage, Artifact } from '@/types/hiv';
import { mockArtifacts } from '@/data/artifacts';
import { useRouter } from '@/router/useRouter';
import { useAuth } from '@/hooks/useAuth';

// 4. Relative sibling/child imports
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
```

Configure path aliases in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

And in `vite.config.ts`:

```typescript
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // ...rest
});
```

---

## 8. STATE MANAGEMENT RULES

### What goes where:

| State Type | Location | Examples |
|------------|----------|----------|
| **Global UI state** | React Context | `theme`, `auth` (user, isAuthenticated) |
| **Route state** | URL hash params | `currentScreen`, `selectedArtifactId`, `activeTreeId` |
| **Screen-level state** | `useState` in screen component | `messages`, `inputValue`, `isTyping` (ChatScreen) |
| **Derived/computed** | `useMemo` in component | `filteredArtifacts`, `currentDose`, `formattedWeight` |
| **Form inputs** | `useState` local to form | `serverCode`, `accessKey`, `weightInput` |
| **Transient UI** | `useState` local | `isMenuOpen`, `selectedLanguage`, `expandedSection` |

### Rules:

- **NEVER** use a global state library (Zustand, Redux, Jotai). Context + `useReducer` is sufficient.
- **NEVER** lift state higher than necessary. If only one screen uses it, keep it there.
- **ALWAYS** reset screen state when navigating away (use `useEffect` cleanup or `key` prop on route component).
- **ALWAYS** keep auth state in `AuthContext` — wrap router in provider, conditionally render Login vs App.
- **ALWAYS** persist theme preference to `localStorage` (not sensitive).
- **NEVER** persist chat messages or clinical data to `localStorage` — treat as ephemeral per session.

### AuthContext shape:

```typescript
interface AuthState {
  isAuthenticated: boolean;
  user: {
    name: string;
    facility: string;
    serverCode: string;
    supervisor: string;
  } | null;
}

interface AuthContextValue {
  state: AuthState;
  login: (serverCode: string, accessKey: string) => boolean; // validates against mock, returns success
  logout: () => void;
}
```

---

## 9. DATA FETCHING RULES

This app has **NO backend**. All data is in-memory mock data.

### Pattern:

1. All data lives in `src/data/*.ts` files as exported `const` objects/arrays.
2. Components import data directly and filter/match via `useMemo`.
3. Chat responses use a **keyword matching engine** in `useSearch.ts`:
   - Normalize input: lowercase, remove punctuation, trim
   - Tokenize into words
   - Score against keyword maps in `mockResponses.ts`
   - Return highest-confidence match or fallback response
4. Decision trees are traversed by ID lookup — no async.
5. Drug tables are pure function lookups: `getDose(drugId, weightKg)`.

### Performance rule:

- All mock data files use `as const` assertion for compile-time optimization.
- Keyword search runs in a `useMemo` with dependency on `inputText`.
- Response generation must complete in <150ms (target: <10ms since it's synchronous).

### NO async/await in data layer

- No `fetch`, no `Promise`, no `setTimeout` for "loading" (use controlled 300ms minimum display for typing indicator).

---

## 10. AUTHENTICATION RULES

### Flow:

1. On app load, check `sessionStorage` for `hivaline_session`.
2. If valid session exists, set `isAuthenticated = true` in AuthContext.
3. If not, render `LoginScreen`.
4. User enters `Server Code` + `Access Key`.
5. Validate format with regex (see `validation.ts`).
6. If format valid, check against `mockUsers.ts` hardcoded list.
7. On match: create session object, store in `sessionStorage`, set auth state, navigate to `/chat`.
8. On mismatch: show inline error pill, do NOT clear inputs.

### Validation rules:

```typescript
const SERVER_CODE_REGEX = /^FMOH-[A-Z0-9]{4}$/;  // Must be uppercase
const ACCESS_KEY_REGEX = /^[A-Z0-9]{4}$/;        // Must be uppercase
```

- Inputs should auto-uppercase on input (`text-transform: uppercase` + force upper in handler).
- Server code must include the dash: `FMOH-XXXX`.

### Session storage:

```typescript
interface SessionData {
  serverCode: string;
  userName: string;
  facility: string;
  supervisor: string;
  loginTime: string; // ISO timestamp
}
```

- Store ONLY in `sessionStorage` (cleared when browser/app closes).
- On logout: clear `sessionStorage`, reset auth state, navigate to `/`.

### Route protection:

- All routes except `/` (login) require auth.
- If unauthenticated user accesses any hash route, redirect to `/`.
- Implement in `Router.tsx` as a guard before rendering any screen.

---

## 11. SECURITY RULES

### Input Validation

- **ALWAYS** validate input format before processing (regex in `validation.ts`).
- **ALWAYS** sanitize user input before displaying in HTML (React does this by default, but NEVER use `dangerouslySetInnerHTML`).
- **NEVER** render user input as HTML. Plain text only.

### Authentication

- Store auth token/session ONLY in `sessionStorage` (NOT `localStorage`).
- Clear session on logout and on app close.
- No sensitive data in URL hashes.

### XSS Prevention

- No `dangerouslySetInnerHTML` anywhere in the app.
- No `eval` or dynamic code execution.
- All content is static mock data or user-typed strings rendered as text nodes.

### CSRF / Injection

- The `.hiv` update loop uses `fetch()` against a single known endpoint (`compiler.hiva.chat`). No user data in URLs. POST body is JSON. Always wrapped in try/catch — offline = silent skip.
- No database = no SQL injection risk.
- All mock data is hardcoded TypeScript objects, never constructed from strings.

### Secrets

- No API keys, no environment variables needed.
- If future versions add keys, use `.env` files (Vite `import.meta.env`) and NEVER commit `.env` files.

### Offline Data Integrity

- Mock data files are read-only `as const` exports.
- No user can modify clinical content.
- All responses cite source artifact for accountability.

### Rate Limiting / Abuse

- The `.hiv` update loop has built-in resumable download (`Range` header) and integrity verification (SHA-256 + Ed25519). No user credentials in update requests.
- Chat responses are instant; no need for rate limiting.

---

## 12. ERROR HANDLING RULES

### Philosophy:

Every error has a **catch location**, a **user-visible message**, and a **UI fallback**.

### Layers:

| Layer | Catch Method | User Sees | Logs To |
|-------|-------------|-----------|---------|
| **Validation** | Function return (boolean/string) | Inline error pill on input | Nothing |
| **Auth** | Context login() return | Red inline badge on login form | Nothing |
| **Routing** | Route not found guard | Redirect to safe route (`/chat` or `/`) | Nothing |
| **Component render** | React Error Boundary (wrap MobileShell) | Friendly error screen with "Restart HIVA" button | `console.error` (dev only) |
| **Chat fallback** | Keyword match failure | "I don't have information on that..." + artifact list | Nothing |

### Error boundary component:

Create `components/shell/ErrorBoundary.tsx`:
- Wraps the entire app inside `MobileShell`.
- Catches render errors.
- Shows: "Something went wrong. Your clinical data is safe. Tap to restart HIVA."
- Button: restarts app by reloading page (`window.location.reload()`).

### Chat fallback message (EXACT TEXT):

> "I don't have information on that in the current .hiv file. The loaded artifacts cover: Malaria, ANC, Child Health, Essential Medicines, and Emergency Referral. Try rephrasing or check the Knowledge Base."

### Form validation errors:

- Show inline, never use browser `alert()`.
- Red pill badge below input: "Invalid server code format. Use FMOH-XXXX."
- Input border turns `error` red.

---

## 13. TESTING RULES

### What MUST be tested:

1. **Utility functions** (`validation.ts`, `formatters.ts`): all exported functions, 100% coverage target.
2. **Hooks** (`useSearch.ts`, `useRouter.ts`): happy path, edge cases, error states.
3. **UI primitives** (`Button.tsx`, `Input.tsx`, `Toggle.tsx`): render, click, accessibility attributes.
4. **Chat flow** (`useSearch.ts` + `ChatScreen.tsx`): keyword matching, response generation, fallback.

### What does NOT need testing:

- Pure presentational components with no logic (just verify render once).
- Mock data files (static consts).
- Framer Motion animations (visual, not functional).

### Test tools:

- **Vitest** (install: `npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom`)
- Configure in `vite.config.ts`:
  ```typescript
  export default defineConfig({
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/__tests__/setup.ts',
    },
  });
  ```

### Test naming:

```typescript
// Pattern: [function/component name] › [scenario] › [expected result]
describe('validateServerCode', () => {
  it('accepts valid FMOH code in uppercase', () => { ... });
  it('rejects lowercase letters', () => { ... });
  it('rejects missing dash', () => { ... });
  it('rejects wrong prefix', () => { ... });
});
```

### Mocking rules:

- Mock `sessionStorage` in auth tests.
- Mock `window.location` in router tests.
- Mock `matchMedia` in theme tests.
- NEVER mock React itself — test real behavior.

---

## 14. PERFORMANCE RULES

### Bundle size (hard target: <200KB gzipped):

- **Single chunk** — `manualChunks: undefined` in Vite config.
- **Tree-shake Lucide** — import only used icons: `import { Send, Mic } from 'lucide-react'`.
- **No images** — all visuals are CSS, SVG (inline), or emoji.
- **Google Fonts** — load with `display=swap` to prevent FOIT.

### Runtime performance (low-spec Android):

- **No lazy loading** of core screens — pre-render all tabs.
- **`useMemo`** for all derived data (message lists, filtered artifacts, dose calculations).
- **`useCallback`** for all handlers passed to children.
- **Memoize child components** with `React.memo` if they receive complex props.
- **Framer Motion**: use `layout` prop sparingly; prefer `animate` + `transition`.
- **Respect `prefers-reduced-motion`**: disable all animations if user prefers reduced motion.
  ```tsx
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  ```

### First paint targets:

- First Meaningful Paint < 800ms.
- All mock queries < 150ms (synchronous, so instant — typing indicator enforces 300ms minimum).
- Decision tree transitions < 100ms.

### List virtualization:

- Chat messages: NOT virtualized (max ~50 messages per session, DOM is fine).
- Knowledge base: NOT virtualized (only 5 artifacts).

---

## 15. GIT COMMIT FORMAT

Use **Conventional Commits**:

```
<type>(<scope>): <description>

[optional body]
```

Types:
- `feat`: new feature
- `fix`: bug fix
- `style`: formatting, CSS, no logic change
- `refactor`: code change neither fix nor feature
- `test`: adding or updating tests
- `docs`: documentation (AGENTS.md, BLUEPRINT.md, etc.)
- `chore`: build, deps, config

Scopes:
- `chat`, `auth`, `knowledge`, `decision`, `drug`, `settings`, `ui`, `router`, `data`, `test`

Examples:
```
feat(chat): add ResponseCard component with danger sign styling
fix(auth): validate server code format before submission
test(validation): add unit tests for access key regex
style(knowledge): adjust ArtifactCard padding for mobile
```

---

## 16. SUMMARY CHECKLIST FOR EVERY AGENT

Before writing code, verify:

- [ ] I have read AGENTS.md fully
- [ ] I have read BLUEPRINT.md fully
- [ ] I have checked PROGRESS.md for my assigned task
- [ ] My code follows the naming conventions in section 5
- [ ] My component follows the structure in section 6
- [ ] My imports follow the order in section 7
- [ ] I am NOT using any library not listed in section 2
- [ ] I am NOT making HTTP requests for clinical functionality (all AI responses run 100% offline)
- [ ] `.hiv` update `fetch()` calls are wrapped in try/catch with silent offline fallback
- [ ] I am NOT using `any` or `dangerouslySetInnerHTML`
- [ ] All interactive elements are ≥44×44px
- [ ] All inputs are validated before processing
- [ ] I have written tests for all new logic
- [ ] Tests pass before I mark task complete
