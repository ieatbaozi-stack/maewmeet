# Antigravity Model Routing & Thin Wrapper Guide (Gemini 4)

This folder (`.agents/`) is a **thin Antigravity wrapper layer** over `.claude/agents/*.md` (Single Source of Truth) and root rules (`AGENTS.md`, `CLAUDE.md`). Never duplicate full role checklists here — update `.claude/agents/*.md` instead.

## Gemini 4 Model & Effort Routing

Antigravity YAML frontmatter supports `model: inherit | flash | pro` and does not yet expose a per-subagent `effort` key. Target Gemini 4 models and recommended `/effort` levels are documented below and as YAML comments in each wrapper.

| Agent | Category | Primary Role | Target Gemini 4 Model & Effort | YAML `model` | `mainAgent` | Tool Policy | Source of Truth |
| :--- | :---: | :--- | :--- | :---: | :---: | :--- | :--- |
| *(Main Window)* | Main | Orchestration, contract scoping, primary coding | **Gemini 4 Neon** (`high`–`xhigh`) | *(UI manual)* | — | Full workspace | `AGENTS.md`, `CLAUDE.md` |
| `architect` | **A** | Architecture, data model, ADRs, research | **Gemini 4 Neon** (`high`; `xhigh` for complex design) | `inherit` | `false` | Standard (docs/ADR scope) | `.claude/agents/architect.md` |
| `platform` | **A** | Backend API, Drizzle schema/migrations, `src/lib/calendar` | **Gemini 4 Neon** (`high`; `xhigh` for cross-file/calendar) | `inherit` | `false` | Standard | `.claude/agents/platform.md` |
| `auth` | **A** | PIN auth, sessions, lockout/throttle, central RBAC | **Gemini 4 Neon** (`high`–`xhigh`) | `inherit` | `false` | Standard | `.claude/agents/auth.md` |
| `frontend` | **A** | Next.js UI, forms, responsive layouts, i18n/theme plumbing | **Gemini 4 Neon** (`high`) | `inherit` | `false` | Standard | `.claude/agents/frontend.md` |
| `ux` | **A** | UX flows, light/dark design tokens, brand, TH/EN copy | **Gemini 4 Neon** (`high`) | `inherit` | `false` | Standard | `.claude/agents/ux.md` |
| `ops` | **A** | CI/CD, headers, `next.config.ts`, health API, release docs/scripts | **Gemini 4 Neon** (`high`) | `inherit` | `false` | Standard | `.claude/agents/ops.md` |
| `test` | **B** | Vitest, Playwright E2E, role×action test suites | **Gemini 4 Hydrogen** (`high`) | `flash` | `false` | Test files & test-run only (no prod code edits) | `.claude/agents/test.md` |
| `qa` | **B** | Independent QA + code review, 375/390/768, TH/EN, a11y | **Gemini 4 Hydrogen** (`high`; `medium` for tiny PRs) | `flash` | `false` | Read + test-run (+ `docs/reports/qa-*.md` / assigned small fix) | `.claude/agents/qa.md` |
| `secretary` | **B** | `docs/team/PROGRESS.md`, daily/round reports | **Gemini 4 Hydrogen** (`medium`) | `flash` | `false` | Docs-only (`docs/team/**`, `docs/reports/**`) | `.claude/agents/secretary.md` |
| `security` | **C** | Independent security & privacy audit | **Gemini 4 Carbon** (`medium` routine; `high` high-risk/pen-test) | `pro` | `true` | **STRICT Read-Only** (`view_file`, `grep_search`, `find_by_name`, `list_dir`) | `.claude/agents/security.md` |

## Cross-Model Review Alignment (`AGENTS.md` §6)

- Makers run on **Gemini 4 Neon** (`inherit` from Main Window).
- Independent `qa` runs on **Gemini 4 Hydrogen** (`flash`).
- Independent `security` runs on **Gemini 4 Carbon** (`pro`) and is enabled as `mainAgent: true`, so it can be launched directly via `/agents` on Carbon with `/effort high` for high-risk PRs or pen-test reviews.
- Level B PRs still follow `AGENTS.md` §3 (including Claude Code `security` review before merge unless the repo owner grants an explicit exception).
