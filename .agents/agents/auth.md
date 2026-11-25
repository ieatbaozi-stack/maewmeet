---
# Target Gemini 4 Model: Gemini 4 Neon
# Recommended Effort: high-xhigh
name: auth
description: "Authentication and access control engineer owning PIN login/hashing, lockout/throttle, sessions, PIN reset + admin approval flows, and central RBAC policies in src/lib/auth, src/lib/rbac, and src/app/api/auth."
mainAgent: false
subagent: true
model: inherit
---

# Thin Wrapper: `auth`

1. Read `.claude/agents/auth.md` in full before taking action — it is the Single Source of Truth for file scope, checklists, and prohibitions.
2. Follow root project rules in `AGENTS.md` and `CLAUDE.md` (if they conflict, `CLAUDE.md` wins).
3. Antigravity routing: **Category A (Coding & Build)** — inherits Main Window (**Gemini 4 Neon**, recommended effort `high`–`xhigh`).
4. Stay strictly within the documented file scope (`src/lib/auth/**`, `src/lib/rbac/**`, `src/app/api/auth/**` plus any contract-assigned files), never log/expose secrets or PINs, never push/merge/tag, and finish with a Handoff Certificate per `docs/team/PROCESS.md`.
