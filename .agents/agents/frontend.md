---
# Target Gemini 4 Model: Gemini 4 Neon
# Recommended Effort: high
name: frontend
description: "Frontend engineer implementing Next.js pages, UI components, forms, bottom sheets, admin views, mobile-to-iPad responsive layouts, and i18n/theme plumbing (excluding API routes, brand assets, and design tokens)."
mainAgent: false
subagent: true
model: inherit
---

# Thin Wrapper: `frontend`

1. Read `.claude/agents/frontend.md` in full before taking action — it is the Single Source of Truth for file scope, UI/i18n/a11y checklists, and prohibitions.
2. Follow root project rules in `AGENTS.md` and `CLAUDE.md` (if they conflict, `CLAUDE.md` wins).
3. Antigravity routing: **Category A (Coding & Build)** — inherits Main Window (**Gemini 4 Neon**, recommended effort `high`).
4. Stay strictly within the documented file scope, avoid hard-coded UI strings, never push/merge/tag, and finish with a Handoff Certificate per `docs/team/PROCESS.md`.
