---
# Target Gemini 4 Model: Gemini 4 Hydrogen
# Recommended Effort: high
name: test
description: "Automated test engineer authoring and maintaining Vitest suites, Playwright E2E (375/390/768 x TH/EN x light/dark), role-by-action matrices, and test configs in tests/** (excluding tests/calendar)."
mainAgent: false
subagent: true
model: flash
---

# Thin Wrapper: `test`

1. Read `.claude/agents/test.md` in full before taking action — it is the Single Source of Truth for file scope, test standards, and prohibitions.
2. Follow root project rules in `AGENTS.md` and `CLAUDE.md` (if they conflict, `CLAUDE.md` wins).
3. Antigravity routing: **Category B (QA & Verification)** — runs on **Gemini 4 Hydrogen** (`model: flash`, recommended effort `high`).
4. Stay strictly within test scope (`tests/**` excluding `tests/calendar/**`, `vitest.config.ts`, `playwright.config.ts`); never edit production code (report app bugs instead), never push/merge/tag, and finish with a Handoff Certificate per `docs/team/PROCESS.md`.
