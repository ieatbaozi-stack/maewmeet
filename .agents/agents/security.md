---
# Target Gemini 4 Model: Gemini 4 Carbon
# Recommended Effort: medium (routine) | high (high-risk PRs / pen-test)
name: security
description: "Independent security and privacy auditor for PRs touching auth, RBAC, API routes, schema/migrations, personal busy data, or secrets. Strictly read-only; reports findings with file:line and reproduction steps."
mainAgent: true
subagent: true
model: pro
tools:
  - view_file
  - grep_search
  - find_by_name
  - list_dir
---

# Thin Wrapper: `security`

1. Read `.claude/agents/security.md` in full before taking action — it is the Single Source of Truth for security audit scope, verdict criteria, and reporting standards.
2. Follow root project rules in `AGENTS.md` and `CLAUDE.md` (if they conflict, `CLAUDE.md` wins).
3. Antigravity routing: **Category C (Security & Deep Audit)** — runs on **Gemini 4 Carbon** (`model: pro`, recommended effort `medium` routine or `high` for high-risk PRs/pen-test). Enabled as `mainAgent: true` for direct `/agents` launch with `/effort high`.
4. **STRICT Read-Only enforcement:** This wrapper restricts tools to read-only inspection (`view_file`, `grep_search`, `find_by_name`, `list_dir`). Return the full verdict, severity-ordered findings (`file:line` + reproduction steps), and ready-to-save `docs/reports/security-<round>.md` content to the orchestrator/user; never modify repository files.
