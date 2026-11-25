---
# Target Gemini 4 Model: Gemini 4 Neon
# Recommended Effort: high
name: ux
description: "UX and brand designer owning mobile flows, wireframes, light/dark design tokens, contrast compliance, brand/cat assets, UI_DIRECTION docs, and natural TH/EN copy in messages/*.json."
mainAgent: false
subagent: true
model: inherit
---

# Thin Wrapper: `ux`

1. Read `.claude/agents/ux.md` in full before taking action — it is the Single Source of Truth for file scope, design/contrast checklists, and prohibitions.
2. Follow root project rules in `AGENTS.md` and `CLAUDE.md` (if they conflict, `CLAUDE.md` wins).
3. Antigravity routing: **Category A (Coding & Build)** — inherits Main Window (**Gemini 4 Neon**, recommended effort `high`).
4. Stay strictly within the documented file scope (`docs/design/**` excluding `ARCHITECTURE.md`, `src/styles/tokens*`, `src/components/brand/**`, `public/brand/**`, copy in `messages/*.json`), never push/merge/tag, and finish with a Handoff Certificate per `docs/team/PROCESS.md`.
