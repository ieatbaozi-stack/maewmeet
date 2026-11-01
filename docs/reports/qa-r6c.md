# QA R6C: independent review (branch `feat/r6c-member-appearance`)

> Reviewer: QA (independent) · 2026-11-01 · contract: R6C_CONTRACT.md (R6C-1..8) · security review: docs/reports/security-r6c.md (permissions/migration not re-reviewed here)
> **[RUN]** = verified by running · **[READ]** = from reading code

## Verdict: pass with notes (0 H / 0 M / 3 L)

## Findings
- **L1 [READ]** `src/components/calendar/CalendarView.tsx:350,489-490`: L2 uses `showFab`, so on wide screens (>=768) both top buttons also disappear when the "mine" tab is empty and when the group is solo on the free tab. On "mine" empty, `MineList` has its own add-busy CTA (`onAdd`), but "Create plan" has no replacement on that screen (reachable via the month tab). Solo free tab: only the "invite" CTA; creating a plan alone is not meaningful. Not a regression of blocking size; mobile already behaved this way. Suggest main decides: keep (consistent with mobile) or limit hiding to gone/error/loading.
- **L2 [READ]** `docs/design/samples/*.html` still use `data-slot` (static design samples, not shipped code). `grep data-slot src tests` finds only the comment in `members.css`. Optional cleanup.
- **L3 [RUN]** fullPage screenshots show the fixed bottom tab bar in the middle of the page (screenshot artefact, same as R6B-L4); not a real overlap.

## Criteria
| # | Result | Evidence |
|---|---|---|
| R6C-1 | Pass [READ+RUN] | `memberAppearance()` (`src/lib/shared/member-color.ts`): unset slot -> `hash` for both color and shape = old `data-slot` result; hash formula unchanged. Every consumer goes through it (appointments/groups/availability/calendar serializers+services, appointment page). CSS: `data-color=n` gives fill/line n, `data-shape=n` gives clip n = old `data-slot=n` (compared line by line). Every `colorIndex` in `src/components` has `shapeIndex` next to it (MemberAvatar, MonthGrid x2, DayPanel x3, FreeDetail, OverlapNotice, AppointmentDetail, MemberList). e2e compares API values before/after auto. |
| R6C-2 | Pass [RUN] | e2e: color and shape set separately, other member sees it, same value for 2 members allowed (200), "use automatic" restores, other group unchanged. |
| R6C-3/4 | Not re-run | Security covers it. Vitest `tests/groups/appearance.test.ts` and `migration-0002` fail here only with Windows EPERM on temp dir cleanup (known machine issue); `member-color.test.ts` passes. CI is the real source. |
| R6C-5 | Pass [RUN+screenshots] | 375/390/768 x th/light + en/dark: no overflow, cells 44px (label and cell), Tab enters each radiogroup at one point, arrows change value, Home/End work, names (10 colour + 10 shape) unique and set as accessible names, preview `role=img` with name. Selected = ring + check badge (not colour only); focus ring via `--focus-ring`. 375: 5x2 grid, 768: 10 in a row. TH/EN names natural (e.g. "แดงปะการัง", "Teal · Pentagon"). `check-style-literals` clean. |
| R6C-6 | Pass [RUN] | e2e checks data-color/shape in month cell dot, legend, day strip, day person list, member list, RSVP, and for member B. (Free-days/OverlapNotice use the same MemberAvatar with both props, verified by grep, no dedicated e2e.) |
| R6C-7 | Pass [RUN] | L2 e2e at 768 (top buttons gone when group gone); L3/L4 included in r6b spec, passing. |
| R6C-8 | Pass locally | see commands; CI of the PR not observed. |

`measureLayout` change (`tests/e2e/support/fixtures.ts`): substitution happens only for radio/checkbox with width and height <= 2px (sr-only) **and** an enclosing `<label>`; the label (the real touch area) is then measured and still fails if < 44px. Other tiny inputs without label are still measured themselves. Does not hide real small targets.

## Commands run (real output)
```
npm run typecheck                     -> exit 0
npm run lint                          -> exit 0
check-style-literals.sh src           -> "src: ไม่มีค่าสี hex / px นอก tokens"
npm run contrast                      -> 312 pairs, fail 0, lowest text 4.54:1
npx vitest run tests/ui               -> 19 files, 360 tests passed
PW_CHROMIUM_PATH=chrome.exe npx playwright test r6c-appearance r6b-calendar groups-responsive calendar-layout appt-layout free-layout --workers=2 --retries=0
                                      -> 173 passed, 4 skipped (7.5m), exit 0
npx vitest run tests/platform/member-color.test.ts tests/groups/appearance.test.ts tests/platform/migration-0002.test.ts
                                      -> 2 files failed (EPERM temp cleanup, Windows), member-color passed (not a code finding)
```
Screenshots: scratchpad `r6c-settings-{th-light,en-dark}-{mobile-375,mobile-390,tablet-768}.png`.

## Not verified
CI on the PR; Vitest DB tests on this machine (EPERM); real devices / screen reader beyond accessible names; no dedicated e2e for free-days and OverlapNotice appearance.
