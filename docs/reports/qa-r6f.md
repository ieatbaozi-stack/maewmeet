# QA R6F: independent review (branch `feat/r6f-daily-busy`, HEAD 8391d79)

> Reviewer: QA (independent) · 2026-11-03 · contract: R6F_CONTRACT.md (R6F-1..8 + Errata) · **[RUN]** = ran · **[READ]** = read code · security review is separate

## Verdict: pass with notes (0 H / 0 M / 3 L)

## Findings
- **L1 [READ]** `src/components/calendar/MineList.tsx:99` series tag is a `<span aria-label=...>` with no role. aria-label on a generic element is ignored by most screen readers (and not allowed by ARIA), so `tagAria` is probably never read; the visible text "In a series"/"อยู่ในชุด" is still read. Not fixed (copy decision for ux/frontend: drop the aria-label or put the long text in sr-only).
- **L2 [RUN+screenshot]** segmented "Certain hours" wraps to 2 lines at 375 EN (form-daily-en-light-mobile-375). No overflow, the control is taller than 44px; cosmetic only.
- **L3 [READ]** `editNote` sits at the bottom of the edit form (not the footer); in the 375 shot it is reached by scrolling. Accepted (disclosed).
- Note [READ]: create/delete rate limits (30/10min, 60/10min) now also apply to single timed/all_day creates and scope=one deletes (per Errata). Existing e2e does not hit them (regression run green).

## Criteria
| # | Result | Evidence |
|---|---|---|
| R6F-1 | Pass [RUN+READ] | busy-api / calendar-visibility tests pass with only the allowed `seriesId:null` additive key; others' view has no key (BUSY_SHARED_FIELDS unchanged, repo share path does not SELECT series_id); e2e all-day flow in r6f-daily-busy passes |
| R6F-2 | Pass [RUN] | r6f-daily-busy (platform) + tests/calendar/daily-busy: 3-30 Nov 17:00-20:00 = 28 rows, UTC + local date |
| R6F-3 | Pass [RUN] | platform availability test + e2e (390) "free together" shows rest of day free |
| R6F-4 | Pass [RUN] | 63 days / >300 / backdate >7 / end<=start -> 4xx existing codes, no rows; e2e 300 cap shows daily.count message, form keeps values |
| R6F-5 | Pass [RUN+READ] | rollback on partial insert; single `INSERT..SELECT ... WHERE count+N<=cap` as first statement in tx (no check-then-act); concurrent test passes |
| R6F-6 | Pass [RUN+READ] | delete scope=series: user_id bound on both layers (other user -> 404); delete one leaves others; PATCH sets series_id NULL; migration-0003 7/7 |
| R6F-7 | Pass [RUN+READ] | serializer/rbac busy-series tests; shared read never selects series_id |
| R6F-8 | Pass [RUN+screenshot] | r6f-layout 12/12 (375/390/768 x th/en x light/dark, checkLayout: no overflow, buttons >=44px); I viewed 4 shots (form-daily en-light 375, mine th-light 375, series-dialog th-dark 375, series-confirm en-dark 375): no overflow, long title wraps, 3-button dialog readable, TH/EN natural. CI/Vercel not observed |
| a11y | Pass with L1 | series dialog = 3 stacked buttons (one-day / whole series / cancel) full width, destructive visually distinct, confirm is a separate alertdialog (role asserted in e2e); contrast gate unchanged |

## Commands run (real output)
```
npm run typecheck                                  -> exit 0
npx eslint src tests --ignore-pattern ".claude/**" -> 0 problems
vitest (temp config) tests/platform/r6f-daily-busy tests/platform/migration-0003 tests/rbac/busy-series tests/calendar tests/busy
                                                   -> 13 files: 335 passed, 1 failed (free-time oracle.py: Python not found, env)
vitest (temp config) tests/ui i18n lint rbac platform security busy free appointments
                                                   -> 69 files: 3788 passed, 2 failed (config-hygiene CRLF permissions, env, same on main), 1 skipped
npm run build                                      -> success
E2E_PORT=3121 playwright test r6f- --workers=2 --retries=0   -> 14 passed, 4 skipped (by-design project skips), 0 failed
E2E_PORT=3121 playwright test appt- calendar- r6d- r6b- r6e- shell theme groups- free- busy-api r5-layout --workers=2 --retries=0
                                                   -> 340 passed, 74 skipped, 0 failed (13.8m)
```
Failures are the known env ones (CRLF, Python); not compared against main one by one since none touch R6F files.
Screenshots: `C:/Users/User/AppData/Local/Temp/claude/C--Users-User-Downloads-Claude-cowork-maewmeet-git/e1069c2f-e504-4b51-bad0-e620b14caf9b/scratchpad/shots/` (72 r6f-*.png).

## Not verified
CI + Vercel; real devices / screen readers (L1 is from ARIA rules, not heard); the other ~68 screenshots not individually viewed (covered by checkLayout); live migration against a production DB (only the migration test).
