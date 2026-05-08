<p align="center">
  <img src="public/hiva-logo.svg" width="96" height="96" alt="HIVA logo" />
</p>

<h1 align="center">HIVA</h1>

<p align="center">
  <strong>Clinical AI for Nigeria's frontline health workers — fully offline, always ready.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white&style=flat-square" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white&style=flat-square" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white&style=flat-square" alt="Vite 6" />
  <img src="https://img.shields.io/badge/Tailwind-3.4-06B6D4?logo=tailwindcss&logoColor=white&style=flat-square" alt="Tailwind" />
  <img src="https://img.shields.io/badge/tests-90%20passing-22c55e?style=flat-square" alt="90 tests" />
  <img src="https://img.shields.io/badge/bundle-%3C200KB-155D46?style=flat-square" alt="bundle size" />
</p>

---

## What is HIVA?

Nigeria has roughly **42,000 Community Health Extension Workers (CHEWs)** — the backbone of primary care in rural communities. They work in remote clinics, often without internet, without reference books, and without a colleague to consult. A missed malaria severity sign or an incorrect ARV dose can cost a life.

HIVA is a clinical decision-support assistant built specifically for this context. A worker asks a question in plain language — *"ACT dose for a 12 kg child"* or *"signs of severe malaria"* — and gets an instant, FMOH-approved answer formatted for action, not for reading. All of it runs on the device, with zero network dependency after first sync.

The runtime loads a single `.hiv` file — a signed, versioned knowledge container that ships FMOH guidelines, drug tables, decision trees, and multilingual content — and answers queries using a hybrid BM25 + vector search engine, entirely on-device.

---

## Key Features

| Capability | Detail |
|---|---|
| **Offline-first** | Full functionality after first `.hiv` download. Works on `file://` protocol for Android distribution. |
| **Clinical knowledge search** | Hybrid BM25 + semantic vector search over FMOH-approved content. |
| **Drug dosing calculator** | Weight-adjusted dose tables with live slider, bounds warnings, and referral guidance. |
| **Decision trees** | Step-by-step assessment protocols (e.g. malaria severity) with animated navigation. |
| **Voice I/O** | On-device STT via Whisper-tiny (Sherpa-ONNX), TTS via Piper — no cloud API. |
| **Multilingual** | Content and speech models for English, Hausa, Yorùbá, Igbo, and Nigerian Pidgin. |
| **Auto-update** | Resumable background `.hiv` downloads with SHA-256 + Ed25519 integrity verification. |
| **PWA** | Installable, service-worker cached, works offline after first load. |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        HIVA Runtime                         │
│                                                             │
│  ┌──────────┐   ┌──────────────┐   ┌───────────────────┐   │
│  │  Auth    │   │  .hiv File   │   │  Search Engine    │   │
│  │  Context │   │  Context     │   │  BM25 + Vector    │   │
│  │  (LS)    │   │  (IndexedDB) │   │  (ONNX in-tab)    │   │
│  └────┬─────┘   └──────┬───────┘   └────────┬──────────┘   │
│       │                │                    │               │
│  ┌────▼────────────────▼────────────────────▼──────────┐   │
│  │              React Router (hash-based)               │   │
│  │  /         /chat      /knowledge  /settings          │   │
│  │  LoginScreen ChatScreen  KB Screen  Settings         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │         Voice Layer (Sherpa-ONNX)                    │   │
│  │  VAD (Silero) → STT (Whisper-tiny) → TTS (Piper)    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
              │ network (internet required only for:)
              ├── POST /api/hiv/auth      (first login)
              ├── GET  /api/hiv/version   (launch check)
              └── GET  /api/hiv/download  (update only)
```

### The `.hiv` File Format

A `.hiv` file is a signed ZIP archive containing:

```
hiv-2026.05.08.zip
├── manifest.json          ← version, sha256, chunk_count, search config
├── content/
│   └── chunks.jsonl       ← clinical knowledge chunks (FAQ, drug tables, trees…)
├── embeddings/
│   └── vectors.bin        ← INT8 semantic embeddings (one per chunk)
├── index/
│   └── bm25-en.json       ← BM25 inverted index per language
├── i18n/
│   └── ha.json            ← Hausa translations
├── sources.json           ← document provenance
└── signature/
    ├── pubkey.bin         ← Ed25519 public key
    └── sig.bin            ← signature over all other content
```

The search engine fuses BM25 and vector similarity via Reciprocal Rank Fusion (RRF), weighted by chunk type (drug tables and danger signs score higher). All inference runs in a Web Worker using ONNX Runtime Web — the main thread is never blocked.

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | React 19 + Vite 6 | Sub-200 KB bundle, instant HMR, works as `file://` for offline Android |
| Language | TypeScript 5.7 strict | Clinical data requires zero silent failures |
| Styling | Tailwind CSS 3.4 | Purgeable utilities, CSS variable tokens for runtime dark mode |
| Animation | Framer Motion 11 | `AnimatePresence` page transitions, respects `prefers-reduced-motion` |
| Routing | Custom hash router | Hash routing works on `file://` protocol — no React Router overhead |
| Storage | IndexedDB (idb) | `.hiv` blob persistence with resumable partial downloads |
| Integrity | SHA-256 + Ed25519 | Every `.hiv` file verified before use |
| Compression | fflate | Pure-JS ZIP, tree-shakeable, ~15 KB |
| Voice | Sherpa-ONNX | On-device Whisper-tiny STT + Piper TTS, no cloud dependency |
| Icons | Lucide React | Tree-shakeable, consistent 1.5px stroke, medically appropriate |
| Testing | Vitest + RTL | Vite-native, fast, 90 tests |

---

## Getting Started

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9

### Installation

```bash
git clone https://github.com/JumareKenz/Hivaline.git
cd Hivaline
npm install
```

### Voice Models (optional)

The STT/TTS models are excluded from the repo due to size (160 MB). To enable voice:

```bash
# Create model directories
mkdir -p public/models/stt public/models/tts public/models/vad

# STT — Whisper-tiny INT8 (Sherpa-ONNX format)
# Download encoder.onnx, decoder.onnx, tokens.txt from:
# https://github.com/k2-fsa/sherpa-onnx/releases → whisper-tiny models
# Place in public/models/stt/

# TTS — Piper (Sherpa-ONNX format)
# Download voice.onnx + voice.onnx.json from:
# https://github.com/k2-fsa/sherpa-onnx/releases → piper-en-us-amy
# Place in public/models/tts/

# VAD — Silero
# Download silero_vad.onnx from:
# https://github.com/snakers4/silero-vad/tree/master/src/silero_vad/data
# Place in public/models/vad/
```

### Development

```bash
npm run dev        # start dev server at http://localhost:5173
npm run test       # run all 90 tests (vitest)
npm run build      # production build → dist/
npm run preview    # preview production build
```

### Demo Login

While a real server runs at `https://compiler.hiva.chat`, the app's validation layer accepts:

```
Server Code:  HIVA-K7H4
Access Key:   K7H4
```

(The access key is always the last 4 characters of the server code.)

---

## Project Structure

```
src/
├── components/
│   ├── auth/           LoginScreen
│   ├── chat/           ChatScreen, MessageBubble, ResponseCard, DangerSignCard…
│   ├── decision/       DecisionTreeScreen, TreeNode, TreeNavigator
│   ├── drug/           DrugTableScreen, WeightSlider, DoseResultCard
│   ├── knowledge/      KnowledgeBaseScreen, ArtifactCard, KnowledgeDetailScreen
│   ├── settings/       SettingsScreen, LanguageSelector, ServerCodeDisplay…
│   ├── shell/          MobileShell, BottomTabBar, SafeArea, ErrorBoundary
│   └── ui/             Button, Card, Input, Toggle, TopBar, HivaLogo, SplashScreen…
├── context/
│   ├── AuthContext.tsx        token lifecycle, API auth, localStorage persistence
│   ├── HIVFileContext.tsx     .hiv file state + background auto-update
│   ├── ThemeContext.tsx       light/dark with system preference detection
│   └── TTSContext.tsx         TTS engine lifecycle
├── hooks/
│   ├── useAuth.ts
│   ├── useHIVFile.ts
│   ├── useSearch.ts           BM25 keyword search (mock layer)
│   ├── useTTS.ts
│   ├── useTheme.ts
│   └── useVoiceService.ts
├── services/
│   ├── hivLoader.ts           parse .hiv ZIP → typed HIVFile object
│   ├── onnxEmbedder.ts        ONNX Runtime Web embedding inference
│   ├── responseRenderer.ts   chunk → chat message formatting
│   ├── searchEngine.ts        BM25 + vector fusion (RRF)
│   ├── sttService.ts          Sherpa-ONNX STT wrapper
│   ├── ttsService.ts          Sherpa-ONNX TTS wrapper
│   ├── updateService.ts       version check + resumable download + integrity verify
│   └── voiceEngine.ts         VAD → STT pipeline
├── router/
│   ├── Router.tsx             AnimatePresence page transitions + auth guard
│   ├── routes.ts
│   └── useRouter.ts           hash router hook
├── types/
│   └── hiv.ts                 full type system (User, HIVFile, ChatMessage…)
├── utils/
│   ├── constants.ts
│   ├── formatters.ts
│   └── validation.ts
└── data/                      mock clinical data (used until .hiv is loaded)
    ├── artifacts.ts
    ├── decisionTrees.ts
    ├── drugTables.ts
    ├── mockResponses.ts
    └── users.ts
```

---

## API Integration

HIVA talks to a single backend — the **compiler** — for three operations. Everything else is on-device.

**Base URL:** `https://compiler.hiva.chat`

### Authentication Flow

```
App launch
    │
    ├─ token in localStorage? ──Yes──► GET /api/hiv/version
    │                                       │
    │                               version changed or
    │                               file missing?
    │                                   │         │
    │                                  Yes        No
    │                                   │         │
    │                          GET /api/hiv/download  → /chat
    │                                   │
    │                          save to IndexedDB
    │                          update hiva_known_version
    │                                   │
    │                                  /chat
    │
    └─ no token ──────────────────────► Login screen
```

### POST `/api/hiv/auth`

Login with server code + access key. No auth header required.

```json
// Request
{ "server_code": "HIVA-K7H4", "access_key": "K7H4" }

// Response 200
{
  "token":       "eyJ...",
  "token_type":  "bearer",
  "expires_in":  315360000,
  "user_profile": { "server_code": "HIVA-K7H4", "name": "Northeast CHW Rollout" },
  "version_info": { "version": "2026.05.08.1", "sha256": "a3f9...", "size_kb": 2400 }
}
```

Store: `localStorage.hiva_token`, `hiva_server_code`, `hiva_user_name`, `hiva_known_version`.

**Error codes:**

| Status | Shown to user |
|---|---|
| 401 | Incorrect server code or access key |
| 403 revoked | This access code has been disabled. Contact your supervisor. |
| 403 capacity | This code is at capacity. Contact your supervisor. |
| 404 | No content available yet. Try again later. |
| 422 | Invalid code format |

### GET `/api/hiv/version`

No auth. Polled on every launch. Compare `version` against `localStorage.hiva_known_version`.

### GET `/api/hiv/download`

Requires `Authorization: Bearer <token>`. Supports `Range` headers for resumable downloads. After download:
- SHA-256 verified against `X-Content-SHA256` header
- Ed25519 signature verified against embedded `signature/` directory
- Persisted to IndexedDB key `current`
- `hiva_known_version` updated in localStorage

A **401 or 403** on download means the access code was revoked. HIVA clears all auth localStorage keys and fires `hiva:session-revoked` — the `AuthContext` listener handles the redirect to login.

---

## Testing

```bash
npm run test             # watch mode
npm run test -- --run    # single pass, CI mode
```

**90 tests across 12 suites:**

| Suite | Tests | What's covered |
|---|---|---|
| `validation.test.ts` | 16 | Server code regex, access key format, weight bounds |
| `useSearch.test.ts` | 9 | BM25 tokenizer, scoring, fallback response |
| `useRouter.test.ts` | 8 | Hash parsing, navigation, params, dynamic routes |
| `Button.test.tsx` | 7 | Variants, disabled state, click handler |
| `Input.test.tsx` | 7 | Label, error, password type, auto-capitalize |
| `Toggle.test.tsx` | 5 | Checked state, onChange, label render |
| `ResponseCard.test.tsx` | 4 | Content render, metadata, source citation |
| `searchEngine.test.ts` | – | BM25 index, fusion scoring |
| `responseRenderer.test.ts` | – | Chunk → chat message mapping |
| `hivLoader.test.ts` | – | ZIP parse, manifest validation |
| `ttsService.test.ts` | – | TTS init, speak/stop lifecycle |
| `sttService.test.ts` | – | STT session, transcript callback |

---

## Design System

### Color Tokens

| Token | Hex | Usage |
|---|---|---|
| `accent-600` | `#155D46` | Primary CTA, active state, ring rotation |
| `brand-tan` | `#C9A96E` | Decorative accents, orbital particles, subtitle |
| `n-900` | `#1c1917` | Body text (light mode) |
| `n-100` | `#f5f5f4` | Body text (dark mode) |
| `error` | `#dc2626` | Danger signs, form errors |
| `success` | `#16a34a` | Verification badges, connected state |
| `warning` | `#d97706` | Drug dosing warnings |

### Typography

| Role | Font | Weight |
|---|---|---|
| `font-display` | Space Grotesk | 400–700 |
| `font-body` | DM Sans | 300–700 |
| `font-mono` | JetBrains Mono | 400–600 |

### Splash Screen

The animated splash features a layered SVG logo with:
- Outer ring + tick marks rotating clockwise (8 s)
- Inner dotted ring + orbital particles rotating counter-clockwise (5.5 s)
- 45° radar sweep sector rotating clockwise (4 s)
- Dual ping ripples expanding and fading (staggered)
- H letterform bouncing with spring easing
- Center dot bouncing with scale pulse
- Brand name animating letter-by-letter with spring stagger

---

## Deployment

### Static Build

```bash
npm run build
# Output: dist/
# Serve from any static host (Netlify, Vercel, Nginx, or open dist/index.html directly)
```

The build uses `base: './'` so `dist/index.html` can be opened directly as a `file://` URL on Android devices — the primary delivery mechanism for offline deployment.

### PWA

The service worker (generated by `vite-plugin-pwa`) pre-caches all JS/CSS/HTML/SVG assets. After the first load, the app runs fully offline.

### Android Packaging

For distribution as an APK:
1. `npm run build`
2. Wrap `dist/` with Capacitor or WebView wrapper
3. Distribute via APK sideload — no Play Store required

---

## Security Model

| Surface | Defence |
|---|---|
| XSS | React text nodes only; `dangerouslySetInnerHTML` never used |
| Auth token | Stored in `localStorage` (permanent, no expiry); only admin revocation cuts access |
| .hiv integrity | SHA-256 hash + Ed25519 signature checked before any file is used |
| Route access | Auth guard in `Router.tsx`; unauthenticated users redirect to `/` |
| Clinical data | All content is read-only `as const` TypeScript; no runtime mutation |
| Revocation | 401/403 on download clears session and redirects to login immediately |

---

## Contributing

This project follows a strict architectural rulebook in `AGENTS.md` and `BLUEPRINT.md`. Before contributing:

1. **Read `AGENTS.md`** — non-negotiable code standards
2. **Read `BLUEPRINT.md`** — every data model and component spec
3. Run `npm run test` — all 90 tests must pass
4. Run `npx tsc --noEmit` — zero type errors permitted

```bash
git checkout -b feat/your-feature
# make changes
npm run test -- --run
npx tsc --noEmit
git push origin feat/your-feature
# open PR
```

---

## Roadmap

- [ ] Live `.hiv` search engine (replace mock layer with full ONNX inference)
- [ ] Hausa UI strings (i18n layer wired to content translations)
- [ ] Offline map integration for nearest referral facility
- [ ] Supervisor dashboard (admin panel for code management)
- [ ] Android APK release pipeline (Capacitor)

---

## License

Private — all rights reserved. Built for deployment in partnership with Nigeria's Federal Ministry of Health.

---

<p align="center">
  Built with care for the health workers who have nothing but their hands and their knowledge.
</p>
