# PROGRESS.md — HIVALINE Living Task Tracker

> This file tracks what is done, what is in progress, and what remains. Agents update this after every task. No task is considered complete until its tests pass.

---

## CURRENT FOCUS

**Phase:** COMPLETE — All foundation, screens, tests, and QA done.
**Active Task:** None. Project ready for deployment.

---

## PHASE 1 — FOUNDATION

### 1.1 Project Bootstrap
- [x] Initialize Vite project with React + TypeScript template
- [x] Install all dependencies (framer-motion, lucide-react, clsx, tailwindcss, postcss, autoprefixer, vite-plugin-pwa)
- [x] Configure `tsconfig.json` with strict settings (see AGENTS.md §2)
- [x] Configure `vite.config.ts` with PWA plugin + path aliases + single chunk output + relative base for file:// support
- [x] Configure `tailwind.config.js` with full design system tokens (colors, fonts, radius, animations)
- [x] Create `postcss.config.js`
- [x] Configure `index.html` with Google Fonts link + viewport meta + theme-color meta
- [x] Create `src/index.css` with Tailwind directives + CSS variables + font imports + noise texture + glass utility
- [x] Create public folder with placeholder PWA icons (SVG cross+circle geometric icons)

**References:** AGENTS.md §2 (Tech Stack), BLUEPRINT.md §9 (Design Tokens)

### 1.2 Type System
- [x] Create `src/types/hiv.ts` with ALL interfaces (User, Artifact, ChatMessage, TreeNode, DrugTable, AppSettings, etc.)
- [x] Ensure zero `any` types; use `unknown` with narrowing where needed
- [x] Export all types for use across the app

**References:** BLUEPRINT.md §1 (Data Models)

### 1.3 Utility Layer
- [x] Create `src/utils/constants.ts` — app version, regex patterns, UI constants (MIN_TOUCH_TARGET = 44, etc.)
- [x] Create `src/utils/validation.ts` — `validateServerCode()`, `validateAccessKey()`, `validateWeight()`
- [x] Create `src/utils/formatters.ts` — `formatDate()`, `formatWeight()`, `toTitleCase()`
- [x] Write unit tests for validation functions: `src/__tests__/utils/validation.test.ts` (16 tests, all passing)

**References:** AGENTS.md §10 (Authentication), BLUEPRINT.md §2 (API Surface)

### 1.4 Mock Data Layer
- [x] Create `src/data/users.ts` — mock user + `findUserByCode()`
- [x] Create `src/data/artifacts.ts` — 5 FMOH artifacts + `getArtifactById()`
- [x] Create `src/data/drugTables.ts` — 2 drug tables + `getDrugById()` + `getDoseForWeight()`
- [x] Create `src/data/decisionTrees.ts` — malaria assessment tree + `getTreeById()`
- [x] Create `src/data/mockResponses.ts` — keyword rules + FALLBACK_RESPONSE
- [x] All data files use `as const` assertion

**References:** BLUEPRINT.md §1.2 (Mock Data Files)

### 1.5 Router Infrastructure
- [x] Create `src/router/routes.ts` — route definitions array
- [x] Create `src/router/useRouter.ts` — hook with `currentRoute`, `navigate()`, `goBack()`, `params`
- [x] Create `src/router/Route.tsx` — route matcher component
- [x] Create `src/router/Router.tsx` — hash router with auth guard + AnimatePresence
- [x] Write unit tests: `src/__tests__/router/useRouter.test.ts` (8 tests, all passing)

**References:** AGENTS.md §2 (Routing), BLUEPRINT.md §5 (State Map — Route State)

### 1.6 Context Providers
- [x] Create `src/context/AuthContext.tsx` — auth state, login/logout, sessionStorage sync
- [x] Create `src/context/ThemeContext.tsx` — theme state, toggle, localStorage sync, system preference detection
- [x] Create `src/hooks/useAuth.ts` — re-export consumer hook
- [x] Create `src/hooks/useTheme.ts` — re-export consumer hook
- [x] Wrap `App.tsx` with both providers

**References:** AGENTS.md §8 (State Management), BLUEPRINT.md §5 (Global State)

### 1.7 Search Engine
- [x] Create `src/hooks/useSearch.ts` — keyword tokenizer + scoring + response selection
- [x] Implement exact algorithm from BLUEPRINT.md §2 (search algorithm spec)
- [x] Handle edge cases: empty input, all-punctuation input, no-match fallback
- [x] Write unit tests: `src/__tests__/hooks/useSearch.test.ts` (9 tests, all passing)

**References:** BLUEPRINT.md §2 (Chat Search), AGENTS.md §9 (Data Fetching)

### 1.8 App Shell
- [x] Create `src/components/shell/MobileShell.tsx` — phone frame wrapper, safe-area padding, `h-[100dvh]` on mobile
- [x] Create `src/components/shell/SafeArea.tsx` — env(safe-area-inset-*) padding wrapper
- [x] Create `src/components/shell/BottomTabBar.tsx` — glassmorphic sticky tab bar with 3 tabs
- [x] Create `src/components/shell/ErrorBoundary.tsx` — catch render errors, show restart UI
- [x] Wire shell into `App.tsx`: MobileShell → ErrorBoundary → Router → BottomTabBar

**References:** AGENTS.md §12 (Error Handling), BLUEPRINT.md §3 (Shell Components)

---

## PHASE 2 — CORE SCREENS

### 2.1 UI Primitives
- [x] Create `src/components/ui/Card.tsx` — generic card primitive (default/danger/success variants)
- [x] Create `src/components/ui/Button.tsx` — primary/secondary/ghost/danger variants, sizes, fullWidth, icon
- [x] Create `src/components/ui/Input.tsx` — labeled input with validation state, error message, auto-uppercase option
- [x] Create `src/components/ui/Toggle.tsx` — custom animated toggle switch
- [x] Create `src/components/ui/TopBar.tsx` — screen header with back button, title, subtitle, right element
- [x] Create `src/components/ui/StatusPill.tsx` — animated offline ready indicator
- [x] Create `src/components/ui/VerificationBadge.tsx` — FMOH approved green checkmark badge
- [x] Write unit tests for Button, Input, Toggle: `src/__tests__/components/ui/*.test.tsx` (19 tests, all passing)

**References:** AGENTS.md §4 (Code Style), BLUEPRINT.md §3 (UI Primitives)

### 2.2 Login Screen
- [x] Create `src/components/auth/LoginScreen.tsx`
- [x] Full-screen gradient background (accent-600 → accent-800) with noise overlay
- [x] HIVA logo mark (SVG geometric cross+circle in rounded square)
- [x] Title + subtitle + instruction label
- [x] Server code input (auto-uppercase, placeholder "FMOH–XXXX")
- [x] Access key input (auto-uppercase, placeholder "XXXX")
- [x] CTA button "Connect to HIVA →"
- [x] Inline validation + error pills
- [x] Success animation (green checkmark pulse) → navigate to /chat
- [x] Version tag at bottom

**References:** BLUEPRINT.md §3 (LoginScreen), AGENTS.md §10 (Authentication)

### 2.3 Chat Screen
- [x] Create `src/components/chat/MessageBubble.tsx` — HIVA (left) and User (right) variants
- [x] Create `src/components/chat/TypingIndicator.tsx` — 3 pulsing dots animation
- [x] Create `src/components/chat/SuggestionChips.tsx` — horizontal scrollable pill buttons
- [x] Create `src/components/chat/ResponseCard.tsx` — compiled knowledge answer card with header, content, warning, source, actions
- [x] Create `src/components/chat/DangerSignCard.tsx` — red-bordered danger sign response
- [x] Create `src/components/chat/DrugTableCard.tsx` — inline drug dose mini-card with "View dosing table" link
- [x] Create `src/components/chat/ChatInput.tsx` — bottom input bar with mic icon, text field, send button
- [x] Create `src/components/chat/ChatScreen.tsx` — assemble all chat sub-components
- [x] Implement welcome state with floating HIVA icon animation
- [x] Implement message sending flow: add user msg → typing indicator → search → add HIVA msg
- [x] Implement pre-filled message from knowledge detail navigation
- [x] Write tests: `src/__tests__/components/chat/ResponseCard.test.tsx` (4 tests, all passing)

**References:** BLUEPRINT.md §3 (Chat Components), §4 (Flows 2-4)

### 2.4 Knowledge Base Screens
- [x] Create `src/components/knowledge/ArtifactCard.tsx` — list item with emoji, title, year, publisher, topic chips
- [x] Create `src/components/knowledge/KnowledgeBaseScreen.tsx` — header + artifact list + info notice
- [x] Create `src/components/knowledge/KnowledgeDetailScreen.tsx` — gradient header, topics list, verification banner, CTA
- [x] Wire navigation: list → detail → chat (pre-filled)

**References:** BLUEPRINT.md §3 (Knowledge Components), §4 (Flow 5)

### 2.5 Decision Tree Screens
- [x] Create `src/components/decision/TreeNode.tsx` — branch question/options OR action/refer terminal
- [x] Create `src/components/decision/TreeNavigator.tsx` — progress bar + step counter + breadcrumbs
- [x] Create `src/components/decision/DecisionTreeScreen.tsx` — tree state management, slide animations, back navigation
- [x] Implement history stack (push on answer, pop on back)
- [x] Implement terminal node navigation to drug table (if linkedDrug present)

**References:** BLUEPRINT.md §3 (Decision Components), §4 (Flow 3)

### 2.6 Drug Table Screens
- [x] Create `src/components/drug/WeightSlider.tsx` — large weight display, range slider, +/- buttons
- [x] Create `src/components/drug/DoseResultCard.tsx` — live dose display with bounds warning
- [x] Create `src/components/drug/DrugTableScreen.tsx` — header + slider + result card
- [x] Support pre-filled weight from URL param
- [x] Animate dose value on weight change

**References:** BLUEPRINT.md §3 (Drug Components), §4 (Flow 2)

### 2.7 Settings Screen
- [x] Create `src/components/settings/LanguageSelector.tsx` — 5-language list with checkmarks
- [x] Create `src/components/settings/AppearanceSettings.tsx` — dark mode toggle + interaction mode radio pills
- [x] Create `src/components/settings/ServerCodeDisplay.tsx` — active server connection card
- [x] Create `src/components/settings/SettingsScreen.tsx` — settings shell with all sections
- [x] Persist settings to localStorage
- [x] Implement logout flow

**References:** BLUEPRINT.md §3 (Settings Components), §4 (Flows 6-7)

---

## PHASE 3 — POLISH

### 3.1 Animations & Micro-interactions
- [x] Add page transition animations (horizontal slide) to all screen changes
- [x] Add `active:scale-[0.97]` to all tappable elements
- [x] Add card hover states (desktop): `translate-y(-1px)`, shadow increase
- [x] Implement `prefers-reduced-motion` detection and disable animations
- [x] Verify all Framer Motion transitions respect reduced motion

**References:** AGENTS.md §14 (Performance), BLUEPRINT.md §3 (Interaction Patterns)

### 3.2 Dark Mode
- [x] Verify all screens render correctly in dark mode
- [x] Verify dark mode token overrides (bg-primary → n-900, etc.)
- [x] Test toggle in Settings → immediate reflection
- [x] Verify message bubble colors in dark mode
- [x] Full CSS custom property system on `:root` and `.dark`
- [x] 200ms transition on background-color and color

**References:** BLUEPRINT.md §9 (Design Tokens — dark mode overrides)

### 3.3 Accessibility Audit
- [x] All interactive elements ≥44×44px touch targets
- [x] All icon-only buttons have `aria-label`
- [x] Status pills have `role="status"`
- [x] Danger sign cards have `role="alert"`
- [x] Color contrast ≥ 4.5:1 for all text (spot check key screens)
- [x] Form inputs have associated labels
- [x] Focus states visible and clear

**References:** AGENTS.md §4 (ALWAYS rules — a11y)

### 3.4 Responsive & Mobile Testing
- [x] Test at 390px width (primary target)
- [x] Test at 320px width (minimum)
- [x] MobileShell uses `h-[100dvh]` for proper mobile viewport
- [x] Verify safe area insets on notched devices (env vars)
- [x] Verify bottom tab bar doesn't overlap content

**References:** AGENTS.md §14 (Performance — mobile targets)

### 3.5 Offline Verification
- [x] Verify app opens from `file://` protocol (relative paths in dist/)
- [x] Configure `base: './'` in vite.config.ts for relative asset paths
- [x] Verify PWA manifest is generated with relative paths
- [x] Verify service worker caches all assets (9 entries precached)
- [x] Add placeholder SVG PWA icons (icon-192.svg, icon-512.svg)

**References:** AGENTS.md §2 (PWA config)

---

## PHASE 4 — DEPLOY

### 4.1 Build & Bundle Check
- [x] Run `npm run build`
- [x] Verify bundle size < 200KB gzipped (actual: 112 KB gzipped)
- [x] Verify single JS chunk output (no code splitting)
- [x] Verify all assets inlined or in `dist/`

### 4.2 Final QA
- [x] Complete login flow end-to-end
- [x] Complete chat → drug table flow
- [x] Complete chat → decision tree flow
- [x] Complete knowledge base → detail → chat flow
- [x] Complete settings → logout → login flow
- [x] Test all 5 demo conversation flows from brief
- [x] Test fallback response for unknown query

### 4.3 Testing
- [x] validation.test.ts — 16 tests passing
- [x] useSearch.test.ts — 9 tests passing
- [x] useRouter.test.ts — 8 tests passing
- [x] Button.test.tsx — 7 tests passing
- [x] Input.test.tsx — 7 tests passing
- [x] Toggle.test.tsx — 5 tests passing
- [x] ResponseCard.test.tsx — 4 tests passing
- [x] **Total: 56 tests, 0 failures**

### 4.4 Documentation
- [x] AGENTS.md updated with Design Craft Mandate
- [x] BLUEPRINT.md reflects final implementation
- [x] PROGRESS.md marks all tasks complete

---

## DECISIONS LOG

| Date | Decision | Reason | Made By |
|------|----------|--------|---------|
| 2026-05-07 | Vite + React (not Next.js) | Bundle size, file:// support, no SSR overhead | Architect |
| 2026-05-07 | Custom hash router | Works offline on file:// protocol | Architect |
| 2026-05-07 | Context + useState (no Zustand/Redux) | 3 global state slices, bundle target <200KB | Architect |
| 2026-05-07 | sessionStorage for auth | Cleared on close, no sensitive data persists | Architect |
| 2026-05-07 | localStorage for theme/settings only | Non-sensitive, user preference persistence | Architect |
| 2026-05-07 | No lazy loading | Low-spec Android, instant tab switching | Architect |
| 2026-05-07 | Single chunk output | Offline simplicity, no network requests for chunks | Architect |
| 2026-05-07 | 300ms minimum typing indicator | Perceived confidence even with instant mock data | Architect |
| 2026-05-07 | `base: './'` for file:// support | Absolute paths break on file:// protocol | Build |
| 2026-05-07 | SVG PWA icons | Scalable, minimal size, geometric cross+circle design | Build |
| 2026-05-07 | `h-[100dvh]` on mobile | Dynamic viewport height fixes mobile browser toolbar issues | Build |
| 2026-05-07 | HivaLogo component | Consistent brand mark across all screens (login, chat, settings) | Design |
| 2026-05-07 | Voice recording UI enabled | MediaRecorder API for audio capture; STT/TTS models external | Voice |
| 2026-05-07 | Sherpa-ONNX architecture | Models NOT bundled (40-100MB each); loaded as external .onnx files | Voice |
| 2026-05-07 | Whisper-tiny INT8 + Piper TTS | Recommended offline setup for 2GB RAM African language support | Voice |
| 2026-05-07 | Voice state management | idle → recording → processing → playing → error with toast feedback | Voice |

---

## KNOWN RISKS / TRICKY PARTS

⚠️ **Risk:** Google Fonts CDN may not be available on first offline use. Mitigation: fonts cached by browser after first load. Future optimization: subset and inline critical fonts.

⚠️ **Risk:** `sessionStorage` cleared when app is backgrounded on some Android browsers. Mitigation: documented as expected behavior; user re-logs in.

⚠️ **Risk:** Service worker registration may fail on `file://` protocol in some browsers. Mitigation: app works without SW (static files only). SW is a progressive enhancement.

---

*HIVALINE v2.0 Progress Tracker · COMPLETE*
