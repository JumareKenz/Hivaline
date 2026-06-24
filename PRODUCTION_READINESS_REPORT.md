# HivaLine / HIVA — Production-Readiness Audit

**Auditor:** Senior mobile engineering review
**Date:** 2026-06-04
**Branch:** `master`
**Scope:** Full repository investigation + empirical testing (Phases 1–4)

---

## ⚠️ Reading this report: verified vs. inferred

Findings are tagged so you know what to trust and what to re-test:

- **[VERIFIED]** — directly observed this session (ran the command, read the file).
- **[INFERRED]** — traced through code with high confidence, but **not** observed at runtime. No sample `.hiv` exists in the repo and the live backend (`compiler.hiva.chat`) was not contacted, so the end-to-end clinical/offline paths could not be executed.

The two most severe findings (offline cold-start lockout, embed-on-query network dependency) are **[INFERRED]**. They should be reproduced on a device before and after any fix.

---

## 0. Headline correction: this is not the app the brief describes

The task brief assumes a **bare React Native** app with a **Kotlin `.hiv` native module (JSI/old-arch bridge)**, **MiniSearch**, **MMKV/AsyncStorage**, and **background-fetch**. **None of that exists.** [VERIFIED]

The actual app is:

| Brief assumed | Reality (verified) |
|---|---|
| React Native (bare) | **React 19 + Vite 6 + TypeScript 5.7**, wrapped by **Capacitor 8** WebView |
| Kotlin `.hiv` native module | **No native module.** `.hiv` is parsed in JS (`fflate` unzip) on the WebView main thread |
| MiniSearch | **Custom BM25** (`hybridSearch.ts`) + dense vector search (`@xenova/transformers`) |
| MMKV / AsyncStorage | **`sessionStorage`/`localStorage`** (auth) + **IndexedDB** (`.hiv` blob) |
| React Navigation / Expo Router | **Custom hash router** (`src/router/`) |
| Background fetch library | **In-app `fetch()` on launch** (`updateService.ts`); no OS background task |

The Android side is the stock Capacitor scaffold (`MainActivity.java`, a WebView). Every Phase-1 question about a Kotlin reader, JSI bridge, or signature verification "on the Android side" resolves to: **it lives in TypeScript/WASM inside the WebView, not in native Android.**

---

# PHASE 1 — REPOSITORY MAP

### 1. Directory structure [VERIFIED]
- `src/` — all app code: `components/`, `engine/` (the intelligence layer), `services/` (loaders, search, voice, update), `context/`, `hooks/`, `router/`, `types/`, `utils/`.
- `android/` — stock Capacitor Android project (WebView host). No custom Kotlin/Java beyond `MainActivity.java`.
- `ios/` — **does not exist.**
- `src/__tests__/` — 35 test files, 553 tests.
- `public/` — PWA assets + **voice models present on disk** (`models/stt` 99 MB, `models/tts` 61 MB, `models/vad` 632 KB) + `sherpa-onnx.wasm` (12.8 MB) + `sql-wasm.wasm`.
- Entry point: `index.html` → `src/main.tsx` → `src/App.tsx`.
- **Config files:** `vite.config.ts`, `capacitor.config.ts`, `tsconfig.json`, `tailwind.config.js`, `postcss.config.js`. **No `.env` / `.env.example`.** No env vars; the backend URL is **hardcoded** (`https://compiler.hiva.chat` in `updateService.ts` and `AuthContext.tsx`).
- **Expo or bare?** Neither — it is a **Capacitor-wrapped web app.**

### 2. Tech stack [VERIFIED]
- React 19, Vite 6, TypeScript 5.7 **strict** (but currently **failing**, see Phase 2).
- Routing: custom hash router. State: React Context (`Auth`, `HIVFile`, `Theme`, `TTS`) — no Redux/Zustand.
- Search: **no MiniSearch.** Custom BM25 from a pre-built lexical index + dense vector search via `@xenova/transformers` (`Xenova/paraphrase-multilingual-MiniLM-L12-v2`).
- Storage: `sessionStorage` (token), `localStorage` (known version), **IndexedDB via `idb`** (`.hiv` blob, key `current`; resumable `partial`).
- Crypto: `@noble/curves` (Ed25519). Zip: `fflate`. SQLite: `sql.js` (WASM). Voice: `sherpa-onnx`. UI: Tailwind + framer-motion + lucide-react.
- Background update: **none at OS level.** A `fetch()` version check runs on app launch / after login only.

### 3. `.hiv` runtime audit [VERIFIED unless noted]
- Reader: `src/services/hivLoader.ts` (`parseHIVFile`) — pure JS. Parses `manifest.json`, `content/chunks.jsonl`, `index/embeddings.bin`, `index/variant_embeddings.bin`, `index/lexical.json`, `index/gap_graph.json`, `index/coverage_manifest.json`, `content/sources.json`, `rules/*`, `i18n/*`, optional `data/data.db` (SQLite).
- API exposed: `parseHIVFile`, `detectCapabilities`, `getChunkFromDB`, `searchChunksDB`. Update side: `checkForUpdate`, `downloadHIV`, `loadStoredHIV`, `verifySignature` (private).
- **Ed25519 verification exists** (`updateService.ts` `verifySignature`) but is **architecturally unsound** — see Security, finding S-1.
- **No bundled `.hiv` file anywhere in the repo.** [VERIFIED — `find` returned nothing] First launch **requires network** to log in and download.
- Fallback if `.hiv` absent/corrupt: the app does **not crash**, but renders empty states ("No clinical data loaded…", "Loading clinical data…"). There is **no offline content** to fall back to.

### 4. Index audit [VERIFIED]
- BM25 index is **pre-built inside the `.hiv`** (`index/lexical.json`), loaded into memory on `.hiv` parse. Vector search uses pre-computed `variant_embeddings.bin` + on-device query embedding.
- Fields/ranking: BM25 postings keyed by term → `{chunk_id, score}`, plus a title-match bonus and a session topic-continuity bonus (`hybridSearch.ts`).
- **Language filtering:** vector search filters variant records to `record.lang === language || 'en'`. **BM25 path is hardcoded to `'en'`** in `conversationEngine.respond` (`search(..., 'en', ...)`) — language switching does **not** reach the lexical search. See Phase 2 #9.
- Persistence: the **`.hiv` blob** persists in IndexedDB; the **in-memory indexes are rebuilt on every launch** by re-parsing the blob.
- Load time on a 2 GB device: **not measurable** — no sample `.hiv`. Risk: parse + unzip + SQLite-WASM init + Int8→Float32 embedding expansion all happen **on the WebView main thread** (no Web Worker, contrary to the README). [INFERRED risk]

### 5. Query engine audit [VERIFIED]
- Handler: `src/services/conversationEngine.ts` `respond()` (and a parallel `src/engine/processMessage.ts`).
- Flow: slot extraction → `classifyIntent` → `probeSentiment` → app/clinical FAQ shortcuts → greeting/social gate → `rewriteQuery` → **`search()` (BM25 + dense vector RRF fusion + gap-graph boost + dead-end escape)** → topic/drift/gap analysis → `selectAnswerContent` → optional dose computation → opener/closing/chips → string response.
- Normalisation: lowercasing + punctuation strip + token length ≥2. No diacritic stripping, no language detection.
- Zero results → `buildFallback` (coverage-aware deflection text).
- Fuzzy match: **none** at the BM25 token level (exact term postings); fuzziness comes only from the vector path.

### 6. Block renderer audit [VERIFIED]
The components exist, but the **chat does not use them as structured renderers:**
- `engine` always returns a **single `message` string** with `type` ∈ {clinical, greeting, fallback, urgent…}. `ChatScreen` maps only `urgent → danger_sign`, everything else → `text`.
- `DangerSignCard` / `ResponseCard` accept a **string** `message.content` (they do not consume structured `signs/action/referral` or table rows). `DangerSignCard` renders the text inside a red, `role="alert"` card with a "DANGER SIGN" badge — **visually distinct and urgent** ✅ — but it is just the engine's prose.
- `DrugTableCard` / decision-tree blocks are **never produced by the chat engine** (no code path sets `type: 'drug_table'`/`'decision_tree'` for a chat message).
- **Structured rendering does exist on dedicated screens** (`DrugTableScreen`, `DecisionTreeScreen`, `KnowledgeBaseScreen`) which read real `.hiv` data via `hivDataExtractor.ts`. These are reached via `/knowledge`, `/drug-table/:id`, `/decision-tree/:id` — **not** from the chat answer.
- Generic/unknown fallback renderer: `text` bubble. No `<1.5s` render measurement possible without a `.hiv`.

---

# PHASE 2 — FUNCTIONAL TESTING

### 7. Build test [VERIFIED]
- `npm install`: dependencies resolve (repo already has `node_modules`; `sharp`, `onnxruntime-web`, `@xenova/transformers` present).
- **`npx tsc --noEmit` → FAILS, exit 2, ~13 errors:**
  - `src/engine/debugReport.ts` — imports non-existent `HivAssets` (it's `HIVAssets`), multiple `unknown`-typed values (7 errors).
  - `src/engine/queryRewriter.ts` — unused `PRONOUNS`, unused `countClinicalKeywords` (2 errors, `noUnusedLocals`).
  - `src/services/conversationEngine.ts:407` — coverage-manifest type mismatch.
  - `src/services/hivLoader.ts:65,70` — unsafe `HIVChunk → Record` casts.
- **`npm run build` is therefore broken**: the script is `tsc && vite build`; the `tsc` gate fails so `vite build` never runs. The `dist/` in the repo is a **stale build from May 13** (174 MB), not reproducible from the current tree.
- **`npx vite build` (bypassing the gate): SUCCEEDS** (exit 0, 12.2 s, 2058 modules). So the ~13 type errors are the *only* thing blocking a build — fixing them is sufficient to bundle. Output: `index.js` **516 KB** (gzip 165 KB) + a separate **`transformers.js` 827 KB** (gzip 193 KB) chunk. Warnings: chunks >500 KB; **`onnxruntime-web` uses `eval`** (CSP risk under Capacitor + minification warning). PWA precache = 17 entries / **1.5 MB only** — the 50 MB embed model and 160 MB voice models are **above the 5 MB cache cap and are NOT precached**, so even the PWA service worker will not make them available offline.
- ESLint: not configured as a script; inline `eslint-disable` comments exist but no runnable lint task.
- Gradle: a valid Capacitor Gradle project exists. **`minSdkVersion = 24`** (Android 7.0) — **below the API-26 target.** Release `buildType` has **`minifyEnabled false`** and **no signing config** (release artifacts would be unsigned).
- Metro: **N/A** (no React Native). Dev server is `vite`.

> **Why 553 tests pass while tsc fails:** Vitest transpiles with esbuild (no type-check) and `tsconfig.json` **excludes `src/__tests__`**. Green tests + red `tsc` is consistent, not contradictory.

### 8. `.hiv` integration test — **BLOCKED** [VERIFIED blocker]
No sample/bundled `.hiv` exists and the live backend was not contacted. The 10 clinical queries **could not be executed**. What can be said from code:
- *If* a valid `.hiv` with `variant_embeddings.bin` loads, each query embeds on-device → fuses BM25+vector → returns the top chunk's prose. Result quality is entirely a function of `.hiv` content, which is unavailable for inspection.
- The unit/integration **tests** (`processMessage.integration.test.ts`, `hybridSearch.test.ts`) pass against **fixtures**, not a real `.hiv`.

### 9. Language switching test — **partially broken** [INFERRED from code]
- `LanguageSelector` + `STTLanguageSelector` exist; types support `en|ha|yo|ig|pcm`.
- **The chat engine hardcodes BM25 to `'en'`** (`conversationEngine.respond` → `search(query, state, 'en', assets)`). Vector search would include the requested language only if the caller passed it — but the chat caller doesn't. So **switching UI language does not switch clinical answer language** in chat. i18n UI strings are also listed as an open roadmap item.

### 10. Offline simulation test — **FAILS the core promise** [INFERRED]
- **Cold reopen offline → user is locked out.** Auth lives in **`sessionStorage`** (`AuthContext.tsx`), which is **cleared when the app process is killed**. On relaunch, `loadStoredAuth()` finds no token → `isAuthenticated:false` → `Router` redirects every protected route to `/` (LoginScreen) → login needs `POST /api/hiv/auth` → **offline = stuck on login**, even though the `.hiv` is sitting in IndexedDB. This is the **#1 release blocker.**
- Even within a live session, **the dense search path calls the network**: `hybridSearch` imports `embedQuery` from `embeddingModel.ts`, which lazily downloads a ~50 MB HF model (`Xenova/paraphrase-multilingual-MiniLM-L12-v2`) with **no `env.allowRemoteModels=false` and no bundled model**. Offline + uncached → `embedQuery` throws → `search()` rejects → `respond()` has **no try/catch** → rejection propagates to `ChatScreen`'s `await` → **`isTyping` stuck on, frozen typing indicator** (an async-handler rejection; `ErrorBoundary` won't catch it).
  - Corroborating evidence the team hit this: there are **two embedders** — `onnxEmbedder.ts` was disabled "due to WASM MIME type issues" (BM25-only), but `hybridSearch` wires the **other, network-dependent** one.

### 11. Background update test [VERIFIED code behavior]
- There is **no OS background task.** `checkForUpdate()` runs on launch (`HIVFileContext.reload`) and after login. 5-min in-memory version cache.
- Resumable download via `Range` header + IndexedDB `partial` key ✅.
- Integrity: SHA-256 vs `meta.sha256` ✅; Ed25519 signature ✅ **but** unsound (S-1); **in `import.meta.env.DEV` a failed signature is accepted** (dev-only).
- Old `.hiv` retained on failed/incomplete download ✅ (only `current` is overwritten on full success).
- No user interruption during update ✅ (silent, swaps state on completion).

---

# PHASE 3 — UX & QUALITY

### 12. Offline-intelligence quality vs. "as seamless as Claude Sonnet, offline"
- **Latency:** BM25 is instant; the **dense path embeds on-device** — first query pays model load (tens of MB) and per-query embedding cost. On a 2 GB device this is likely **seconds, not <500 ms**, and **fails entirely offline** (#10). [INFERRED]
- **Completeness:** answers are **pre-authored `.hiv` chunks**, not generative. Quality is bounded by the (unavailable) `.hiv` content. No synthesis across chunks.
- **Contextual flow:** genuinely strong design — `sessionState` tracks slots (age/weight/complaint), covered aspects, sentiment, topic drift, and gap-graph follow-ups. This is the app's best asset **when it runs.**
- **Worst case (zero results):** coverage-aware deflection text + generic chips. Graceful.
- **Error states:** missing `.hiv` → empty-state banners (no crash). Corrupt embeddings → loader validates header and falls back to BM25-only. Invalid signature → rejected (prod) / accepted (dev). **But** the offline embed-throw path (#10) is **unhandled.**
- **Language UX:** selector reflects immediately in UI state, but does not change clinical answer language (#9).

### 13. Clinical UX walkthrough [INFERRED — no live run]
**Scenario A — Eclampsia (BP 162/108, Zamfara, offline).**
- Midwife types e.g. "eclampsia magnesium sulphate" / "high blood pressure pregnant convulsing".
- *If online & `.hiv` loaded:* `classifyIntent` likely flags URGENT → rendered in a red `DangerSignCard` with "DANGER SIGN" badge and source line — **appropriately urgent**. Dose visibility depends on whether the matched chunk's prose includes MgSO₄ dosing and whether `dosage_rules` + patient weight trigger `computePatientDose`.
- *Realistic field case (offline cold start):* she is **stuck at the login screen** (#10) and gets **nothing**. This is the dominant real-world outcome.

**Scenario B — HIV+ pregnant woman (Borno, offline).**
- CHEW types "HIV positive pregnant woman ART" / "PMTCT".
- *If online & loaded:* returns the best-matching chunk's prose + follow-up chips; a follow-up like "what's the dose?" is handled by `intent=DETAIL` + slot memory + gap graph — **good continuity design.**
- *Offline cold start:* same lockout as A.

### 14. Deployment readiness checklist
| Item | Status | Note |
|---|---|---|
| Android release build w/o errors | **FAIL** | `tsc` gate fails; release has no signing config |
| Proguard/R8 for native modules | **N/A / MISSING** | No native modules; `minifyEnabled false`, rules file empty |
| Signed `.hiv` bundled for first-launch offline | **FAIL** | No `.hiv` in repo; first launch needs network |
| Public key hardcoded (not fetchable) | **FAIL** | `pubkey.bin` read from inside the `.hiv` ZIP (S-1) |
| Graceful degradation if `.hiv` absent | **PASS** | Empty-state banners, no crash |
| Min Android version (API 26) | **FAIL** | `minSdkVersion = 24` |
| App icon & splash (HIVA branding) | **PASS** | mipmaps + splash drawables present |
| Onboarding: language selection on first launch | **FAIL/MISSING** | Selector lives in Settings; no first-launch onboarding |
| Crash reporting (Sentry/Crashlytics) | **MISSING** | None in deps or native |
| APK < 50 MB | **FAIL** | `dist` 174 MB; voice models 160 MB; JS bundle 506 KB |
| Deep-link handling for update notifications | **MISSING** | No intent filters beyond LAUNCHER |
| Privacy policy screen | **MISSING** | Not present |

Also: manifest sets `usesCleartextTraffic="true"` while `capacitor.config.ts` sets `cleartext:false` — contradictory; cleartext should be off.

---

# PHASE 4 — REPORT

## ┌─ WHAT IS WORKING ─┐
- **Test suite:** 553 tests / 35 files **pass** [VERIFIED] (README's "90 tests" is stale).
- **`.hiv` parser** (`hivLoader.ts`): robust ZIP parse, header validation, embedding count/bounds checks, SQLite-optional, capability detection, path-traversal test coverage.
- **Conversation intelligence layer** (`engine/*`): intent classification, slot memory, sentiment, query rewriting, BM25+vector RRF fusion, gap-graph follow-ups, drift detection, dead-end escape. Well-structured and well-tested.
- **Resumable download + integrity hash** (`updateService.ts`): SHA-256 verified, `Range` resume, old file retained on failure.
- **Graceful empty states** when no `.hiv` is loaded (no crash).
- **Danger-sign UI** is visually urgent and accessible (`role="alert"`).
- **Dedicated structured screens** (drug table calculator with weight slider, decision-tree navigator, knowledge base) read live `.hiv` data.
- **Voice models present** on disk; STT/TTS service wrappers + tests exist.

## ┌─ WHAT IS NOT WORKING ─┐
- **TypeScript build** [VERIFIED]: `tsc --noEmit` fails (~13 errors) → `npm run build` broken.
- **Offline cold-start** [INFERRED, severe]: `sessionStorage` token wiped on app kill → forced re-login → re-login needs network → locked out while `.hiv` sits unused in IndexedDB.
- **Dense search offline** [INFERRED, severe]: `embedQuery` fetches a ~50 MB HF model at query time; offline it throws and the unhandled rejection freezes the typing indicator.
- **Language switching** [INFERRED]: chat BM25 hardcoded to `'en'`; UI language change does not change clinical answers.
- **Structured block rendering in chat** [VERIFIED]: drug tables / decision trees from `.hiv` are flattened to plain prose in the chat thread.
- **Ed25519 signature** [VERIFIED] provides **no authenticity** (S-1).

## ┌─ WHAT IS MISSING ─┐
- A **bundled signed `.hiv`** for offline-from-first-launch.
- **Persistent, offline-survivable auth** (token in durable storage; offline grace).
- **Bundled, offline embedding model** (or removal of the network embed dependency in favor of the shipped `variant_embeddings.bin` + a local/quantized query encoder).
- **Crash reporting**, **privacy policy screen**, **first-launch onboarding/language selection**.
- **Release signing config**, **API-26 floor**, **cleartext disabled**, **R8** decision.
- **i18n UI strings** + true multilingual clinical retrieval.
- **No iOS project** at all.

## ┌─ WHAT IT CAN DO TODAY ─┐
With network available and after a successful login that downloads a valid `.hiv`, a worker gets a polished, context-aware chat: ask a clinical question, receive an FMOH-sourced answer with urgent items in a red danger card, follow-up chips, a weight-based drug calculator, decision trees, and optional voice. The conversation engine is genuinely good. **But the moment the app process is killed and reopened without signal — the normal next-morning field scenario — the worker is dropped at a login screen that cannot complete offline, and gets nothing.** Within a live session, any query that hits the dense path while offline freezes the typing indicator.

## ┌─ WHAT IT CANNOT DO YET ─┐
- **Be trusted offline** — the headline promise. Cold-start lockout + network-dependent embedding break it.
- **Match Claude Sonnet's flexibility** — answers are retrieved pre-authored chunks, no synthesis; exact-term BM25 with limited fuzziness; English-only retrieval in chat.
- **Ship** — doesn't compile, APK ≫ 50 MB, no signing/crash-reporting/privacy/onboarding, minSdk too low, signature is theater.

## ┌─ PRODUCTION DEPLOYMENT VERDICT ─┐
### **NOT READY**
The discriminating test — *can a CHEW reopen the app offline the next morning and get an answer?* — **fails**, and the app **does not compile** from a clean tree. The 553 green tests are reassuring but **do not exercise the offline cold-start or the embed-network path** — the two most severe defects. Broad unit coverage, zero coverage where the offline guarantee actually lives.

## ┌─ PRIORITISED ACTION PLAN ─┐
1. **[P1] Make auth survive offline restart** — move token to durable storage (Capacitor Preferences/`localStorage`) and gate routes on "have a valid `.hiv`," not "have a fresh server token." Allow full offline use post-first-sync. *Outcome: the core promise holds. ~1–2 d.*
2. **[P1] Remove the network embedding dependency from the query path** — set `@xenova` `allowRemoteModels=false` + bundle the model, OR drop runtime query embedding and rely on shipped `variant_embeddings.bin` + a local encoder; wrap `search()`/`respond()` in try/catch with BM25 fallback. *Outcome: queries never hang offline. ~1–3 d.*
3. **[P1] Fix the build** — resolve the ~13 `tsc` errors so `npm run build` passes. *Outcome: shippable artifact. ~0.5 d.*
4. **[P1] Bundle a signed `.hiv`** in app assets and load it if IndexedDB is empty. *Outcome: real offline-from-first-launch. ~1 d + content.*
5. **[P1] Fix the signature trust anchor (S-1)** — hardcode the Ed25519 public key in the app; ignore any in-ZIP `pubkey.bin`. Add TLS cert pinning to `compiler.hiva.chat`. *Outcome: tamper resistance. ~0.5–1 d.*
6. **[P2] Restore offline structured rendering in chat** — have the engine emit chunk type + structured payload so drug tables/trees render as cards, not prose. *Outcome: clinical clarity. ~2–3 d.*
7. **[P2] Wire language end-to-end** — pass the selected language into BM25/vector search and add i18n UI strings. *Outcome: real multilingual support. ~2–4 d.*
8. **[P2] Android release hardening** — `minSdkVersion=26`, release signing config, decide R8, disable cleartext, reconcile `capacitor.config`. *Outcome: Play/sideload-ready. ~1 d.*
9. **[P2] APK size budget** — split/stream voice & embedding models as optional downloads to get the base APK under target. *Outcome: distributable on low-end devices. ~2–3 d.*
10. **[P3] Compliance & ops** — add crash reporting (Crashlytics/Sentry), a privacy-policy screen, first-launch onboarding + language pick. *Outcome: store-eligible, supportable. ~2–3 d.*

---

### Investigation blockers (documented, not skipped)
- **No sample `.hiv`** in the repo and the live backend was not contacted → Phase-2 #8 query battery, Phase-2 #10/#11 live runs, and Phase-3 live UX walkthroughs are **code-inferred, not executed.** Re-run all of these on a device with a real `.hiv`, specifically targeting the offline cold-start and offline-query paths, before accepting any fix.
