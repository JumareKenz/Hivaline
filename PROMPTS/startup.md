# Agent Startup Script — HIVALINE

> Copy this prompt at the start of every agent session. It establishes the rules, context, and workflow.

---

## AGENT RULES — READ BEFORE WRITING A SINGLE LINE OF CODE

1. **READ AGENTS.md fully.** These rules are non-negotiable. Every naming convention, import order, and code style rule must be followed.
2. **READ BLUEPRINT.md fully.** Every design decision is already made. Every data model, component spec, user flow, and error case is documented. Do not invent new fields, screens, or behaviors.
3. **READ PROGRESS.md.** Find the first `[~]` task. If none, find the first `[ ]` task. Work on ONE task at a time. Complete it fully before moving on.

---

## CODE QUALITY RULES

- **Before writing any function,** check BLUEPRINT.md for its exact spec.
- **Before creating any file,** check AGENTS.md for naming and structure rules.
- **Before using any library,** confirm it is in AGENTS.md §2 (Tech Stack). If not — DO NOT use it. Note it in PROGRESS.md under "Decisions needed" instead.
- **Match the style of existing files exactly.** Read 2-3 existing files first.
- **Never introduce a pattern not already in AGENTS.md.**

---

## EXPLORE BEFORE YOU WRITE

Before implementing anything, write out your approach in a comment block at the top of the file. Consider:

- Is there a simpler way?
- Is this secure?
- Could this fail?

If you see a better approach than what's in BLUEPRINT.md, note it in PROGRESS.md under "Decisions needed" — do NOT deviate silently.

---

## SECURITY RULES

- Validate all inputs before processing.
- Never expose secrets, never log sensitive data.
- Apply auth checks exactly as described in AGENTS.md §10-11.
- If a security concern isn't covered, stop and note it in PROGRESS.md.
- NEVER use `dangerouslySetInnerHTML`, `eval`, or dynamic code execution.
- NEVER make HTTP requests for clinical functionality — all AI responses run 100% offline. The ONLY permitted network use is the `.hiv` update loop (version check, resumable download, telemetry). All `fetch()` calls must be wrapped in offline-safe fallbacks that silently skip when disconnected.

---

## TEST AS YOU CODE

- Every function you write gets a test immediately after.
- Test: the happy path, at least one edge case, at least one failure case.
- Tests live next to the file they test (see AGENTS.md §13 for convention).
- Do not move to the next task if the current task's tests are failing.

---

## WHEN YOU FINISH A TASK

1. Mark it `[x]` in PROGRESS.md.
2. Write one line under it: what you built and any edge case you handled.
3. Confirm tests are passing before marking done.
4. Identify the next `[ ]` task and note it as `[~]`.

---

## IF ANYTHING IS UNCLEAR

1. Check BLUEPRINT.md first.
2. Check AGENTS.md second.
3. If still unclear, note it in PROGRESS.md under "Blocked — needs clarification".
4. Do NOT guess. Do NOT invent.

---

## REMEMBER

- This app is used by health workers in rural Nigeria at 2am with a sick child. Clarity and reliability are life-or-death.
- Every pixel matters. Warmth over sterility. Trust over flash.
- Build as if UNICEF is reviewing your code tomorrow.

---

*HIVALINE v2.0 · Agent Startup Script*
