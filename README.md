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
  <img src="https://img.shields.io/badge/Capacitor-8-119EFF?logo=capacitor&logoColor=white&style=flat-square" alt="Capacitor 8" />
  <img src="https://img.shields.io/badge/Tailwind-3.4-06B6D4?logo=tailwindcss&logoColor=white&style=flat-square" alt="Tailwind" />
</p>

---

## What is HIVA?

Nigeria has roughly **42,000 Community Health Extension Workers (CHEWs)** — the backbone of primary care in rural communities. They work in remote clinics, often without internet, without reference books, and without a colleague to consult. A missed malaria severity sign or an incorrect ARV dose can cost a life.

HIVA is a clinical decision-support assistant built specifically for this context. A worker asks a question in plain language — *"ACT dose for a 12 kg child"* or *"signs of severe malaria"* — and gets an instant, FMOH-approved answer formatted for action, not for reading. Everything runs on-device, with zero network dependency after first sync.

The runtime loads a single `.hiv` file — a signed, versioned knowledge container that ships FMOH guidelines, drug tables, decision trees, and multilingual content — and answers queries using a hybrid BM25 + vector retrieval engine, entirely on-device. On Android, retrieval and generation are additionally backed by native plugins so the app works fully packaged as a standalone APK, not just a web shell.

---

## Key Features

| Capability | Detail |
|---|---|
| **Offline-first** | Full functionality after first `.hiv` download. Works on `file://` protocol for Android distribution. |
| **Clinical knowledge search** | Hybrid BM25 + semantic vector search over FMOH-approved content, with a fine-tuned e5-small-v2 embedding model. |
| **On-device generation** | Native Android LLM plugin (LEAP/EdgeBrain) for grounded, retrieval-augmented answers with no cloud call. |
| **Drug dosing calculator** | Weight-adjusted dose tables with live slider, bounds warnings, and referral guidance. |
| **Decision trees** | Step-by-step assessment protocols (e.g. malaria severity) with animated navigation. |
| **Voice I/O** | On-device STT/TTS via Sherpa-ONNX, plus a native Android TTS plugin. |
| **Multilingual** | Content and query normalization for English, Hausa, Yorùbá, Igbo, and Nigerian Pidgin. |
| **Privacy-first analytics** | Offline-first, on-device analytics with background sync — no PII leaves the device without consent. |
| **Auto-update** | Resumable background `.hiv` downloads with SHA-256 + Ed25519 integrity verification. |
| **PWA** | Installable, service-worker cached, works offline after first load. |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          HIVA Runtime                             │
│                                                                    │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────────────┐  │
│  │  Auth    │  │  .hiv File   │  │      Conversation Engine    │  │
│  │  Context │  │  Context     │  │  intentEngine → hybridSearch│  │
│  │  (LS)    │  │  (IndexedDB) │  │  → answerAssembler/generation│  │
│  └────┬─────┘  └──────┬───────┘  └───────────────┬──────────────┘  │
│       │               │                          │                │
│  ┌────▼───────────────▼──────────────────────────▼──────────┐  │
│  │              React Router (hash-based)                     │  │
│  │  /   /chat   /knowledge   /settings   /decision-tree/:id    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌───────────────────────┐   ┌────────────────────────────────┐  │
│  │  Voice Layer (Sherpa)  │   │  Android Native Plugins         │  │
│  │  VAD → STT → TTS       │   │  NativeRetriever · EdgeBrain    │  │
│  │                        │   │  (LEAP LLM) · NativeTTS         │  │
│  └───────────────────────┘   └────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
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

Retrieval fuses BM25 and vector similarity via Reciprocal Rank Fusion (RRF), weighted by chunk type (drug tables and danger signs score higher), then routes through confidence gating and a generation layer before rendering an answer. On web, embedding inference runs in a Web Worker via ONNX Runtime Web; on Android, `NativeRetrieverPlugin` and `EdgeBrainPlugin` handle retrieval and generation natively.

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | React 19 + Vite 6 | Fast HMR, works as `file://` for offline Android |
| Mobile shell | Capacitor 8 | Wraps the web build as a native Android app with native plugin bridges |
| Language | TypeScript 5.7 strict | Clinical data requires zero silent failures |
| Styling | Tailwind CSS 3.4 | Purgeable utilities, HIVA brand tokens (green/gold), CSS variables for dark mode |
| Animation | Framer Motion 11 | `AnimatePresence` page transitions, respects `prefers-reduced-motion` |
| Routing | Custom hash router | Works on `file://` protocol — no React Router overhead |
| Storage | IndexedDB (idb) | `.hiv` blob persistence with resumable partial downloads |
| Integrity | SHA-256 + Ed25519 (`@noble/curves`) | Every `.hiv` file verified before use |
| Compression | fflate | Pure-JS ZIP, tree-shakeable |
| Retrieval | ONNX Runtime Web + native Kotlin plugin | Hybrid BM25 + vector search, fine-tuned e5-small-v2-medichat embeddings |
| On-device LLM | Native LEAP/EdgeBrain plugin (Android) | Grounded generation with no cloud dependency |
| Voice | Sherpa-ONNX + native TTS plugin | On-device STT/TTS |
| Icons | Lucide React | Tree-shakeable, consistent stroke weight |
| Testing | Vitest + RTL | Vite-native, 60+ test suites across engine, services, components |

---

## Getting Started

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9
- Android Studio + JDK 17 (only if building the Android app)

### Installation

```bash
git clone https://github.com/JumareKenz/Hivaline.git
cd Hivaline
npm install
```

### Voice & Embedding Models (optional)

Large model binaries are excluded from the repo — see `.gitignore`. To enable voice and on-device retrieval locally:

```bash
mkdir -p public/models/stt public/models/tts public/models/vad public/models/embed

# STT — Whisper-tiny INT8 (Sherpa-ONNX format)
# https://github.com/k2-fsa/sherpa-onnx/releases → whisper-tiny models
# Place encoder.onnx, decoder.onnx, tokens.txt in public/models/stt/

# TTS — Piper (Sherpa-ONNX format)
# https://github.com/k2-fsa/sherpa-onnx/releases → piper-en-us-amy
# Place voice.onnx + voice.onnx.json in public/models/tts/

# VAD — Silero
# https://github.com/snakers4/silero-vad
# Place silero_vad.onnx in public/models/vad/

# Embedding — fine-tuned e5-small-v2-medichat (fused ONNX)
# Place the fused model in android/app/src/main/assets/models/e5-small-v2/
# for native Android retrieval.
```

### Development

```bash
npm run dev        # start dev server at http://localhost:5173
npm run test       # run all tests (vitest)
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
│   ├── drug/            DrugTableScreen, WeightSlider, DoseResultCard
│   ├── knowledge/       KnowledgeBaseScreen, ArtifactCard, KnowledgeDetailScreen
│   ├── settings/        SettingsScreen, LanguageSelector, TTSSettings, AnalyticsSettings…
│   ├── shell/            MobileShell, BottomTabBar, SafeArea, ErrorBoundary
│   └── ui/               Button, Card, Input, Toggle, TopBar, HivaLogo, SplashScreen…
├── context/
│   ├── AuthContext.tsx        token lifecycle, API auth, localStorage persistence
│   ├── HIVFileContext.tsx     .hiv file state + background auto-update
│   ├── ThemeContext.tsx       light/dark with system preference detection
│   └── TTSContext.tsx         TTS engine lifecycle
├── engine/
│   ├── intentEngine.ts         query intent classification
│   ├── hybridSearch.ts         BM25 + vector fusion (RRF)
│   ├── confidenceScoring.ts    confidence gate before answering
│   ├── generationRouter.ts     routes to native LLM or template answer
│   ├── answerAssembler.ts      chunk → structured answer
│   ├── clinicalFaqDetector.ts / appFaqDetector.ts
│   ├── queryRewriter.ts / fuzzyNormalizer.ts / narrativeNormalizer.ts
│   ├── driftDetector.ts / fallbackHandler.ts
│   └── processMessage.ts       top-level message pipeline
├── services/
│   ├── hivLoader.ts             parse .hiv ZIP → typed HIVFile object
│   ├── onnxEmbedder.ts          ONNX Runtime Web embedding inference
│   ├── nativeRetrieverService.ts  bridge to Android NativeRetrieverPlugin
│   ├── edgeBrainService.ts      bridge to Android EdgeBrain/LEAP LLM plugin
│   ├── nativeTTSService.ts / ttsService.ts / sttService.ts
│   ├── responseRenderer.ts      chunk → chat message formatting
│   ├── updateService.ts         version check + resumable download + integrity verify
│   ├── analyticsService.ts / analyticsSyncService.ts / analyticsStorage.ts
│   ├── queryTranslator.ts / queryLogger.ts / telemetry.ts
│   └── modelManager.ts / modelDownloader.ts / moduleLoader.ts / moduleRegistry.ts
├── router/
│   ├── Router.tsx               AnimatePresence page transitions + auth guard
│   ├── routes.ts
│   └── useRouter.ts             hash router hook
├── types/
│   └── hiv.ts                   full type system (User, HIVFile, ChatMessage…)
└── utils/
    ├── constants.ts / formatters.ts / validation.ts / security.ts

android/
├── app/src/main/java/com/hiva/runtime/
│   ├── llm/              EdgeBrainPlugin.kt, EdgeBrainLeapDelegate.kt — on-device LLM
│   ├── retriever/        NativeRetrieverPlugin.kt — native hybrid retrieval
│   └── speech/           NativeTTSPlugin.kt — native TTS
└── app/src/main/cpp/     llama.cpp + edgebrain_jni.cpp — native inference bridge
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

Test suites cover the engine pipeline (intent, hybrid search, confidence scoring, generation routing, drift detection), services (hiv loader, embedder, TTS/STT, analytics, model management), UI components, hooks, router, and security (auth, signature verification, hiv loader hardening).

---

## Design System

### Color Tokens

HIVA's official brand identity — green & gold, white backgrounds.

| Token | Hex | Usage |
|---|---|---|
| `accent-500` / `brand-forest` | `#163A28` | Primary brand green — CTAs, active state |
| `brand-gold` | `#C99338` | Accent, highlights, verification badges |
| `n-0` | `#ffffff` | Base background |
| `n-900` | `#0f172a` | Body text (light mode) |
| `success` | `#10b981` | Verification badges, connected state |
| `warning` | `#f59e0b` | Drug dosing warnings |
| `error` | `#ef4444` | Danger signs, form errors |

### Typography

| Role | Font |
|---|---|
| `font-display` / `font-body` | Poppins |
| `font-mono` | JetBrains Mono |

---

## Deployment

### Static Build

```bash
npm run build
# Output: dist/
# Serve from any static host (Netlify, Vercel, Nginx, or open dist/index.html directly)
```

The build uses `base: './'` so `dist/index.html` can be opened directly as a `file://` URL — used for offline web deployment.

### PWA

The service worker (generated by `vite-plugin-pwa`) pre-caches all JS/CSS/HTML/SVG assets. After the first load, the app runs fully offline.

### Android

HIVA ships as a native Android app via Capacitor, with native Kotlin plugins for retrieval, on-device LLM generation, and TTS.

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleRelease
```

APKs are distributed via direct sideload — no Play Store dependency required.

---

## Security Model

| Surface | Defence |
|---|---|
| XSS | React text nodes only; `dangerouslySetInnerHTML` never used |
| Auth token | Stored in `localStorage` (permanent, no expiry); only admin revocation cuts access |
| `.hiv` integrity | SHA-256 hash + Ed25519 signature checked before any file is used |
| Route access | Auth guard in `Router.tsx`; unauthenticated users redirect to `/` |
| Clinical data | All content is read-only TypeScript; no runtime mutation |
| Revocation | 401/403 on download clears session and redirects to login immediately |

---

## License

Private — all rights reserved. Built for deployment in partnership with Nigeria's Federal Ministry of Health.

---

<p align="center">
  Built with care for the health workers who have nothing but their hands and their knowledge.
</p>
