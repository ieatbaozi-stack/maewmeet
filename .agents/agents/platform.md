---
# Target Gemini 4 Model: Gemini 4 Neon
# Recommended Effort: high (xhigh for complex cross-file or calendar/timezone logic)
name: platform
description: "Backend platform engineer owning Drizzle schema/migrations, API routes (except auth/health), data layer, audit logs, central calendar/timezone library (src/lib/calendar and tests/calendar), and integrations."
mainAgent: false
subagent: true
model: inherit
---

# Thin Wrapper: `platform`

1. Read `.claude/agents/platform.md` in full before taking action — it is the Single Source of Truth for file scope, checklists, and prohibitions.
2. Follow root project rules in `AGENTS.md` and `CLAUDE.md` (if they conflict, `CLAUDE.md` wins).
3. Antigravity routing: **Category A (Coding & Build)** — inherits Main Window (**Gemini 4 Neon**, recommended effort `high`, or `xhigh` for complex cross-file/calendar logic).
4. Stay strictly within the documented file scope, enforce server-side RBAC via `src/lib/rbac/**` and date math via `src/lib/calendar/**`, never push/merge/tag, and finish with a Handoff Certificate per `docs/team/PROCESS.md`.
