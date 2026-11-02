# QA R6D: independent review (branch `feat/r6d-remember-group-going-busy`)

> Reviewer: QA (independent) · 2026-11-02 · contract: R6D_CONTRACT.md (R6D-1..8) · security review: docs/reports/security-r6d.md (leaks/cookie not re-reviewed)
> **[RUN]** = verified by running · **[READ]** = from reading code

## Verdict: pass with notes (0 H / 0 M / 4 L)

## Findings
- **L1 [READ+RUN screenshot]** `messages/th.json` / `en.json` `appointments.goingConfirm.conflictMore` + `src/components/appointments/RsvpConfirm.tsx` (`count: "1+"`): shows "และอีก 1+ รายการ" / "and 1+ more". Server only says "truncated" (5th item cut), not the real count. Acceptable (honest, not a made-up number) but reads clunky; suggest count-less copy ("และอีกหลายรายการ" / "and more") — UX decision, not changed.
- **L2 [READ]** Button label "ไปทั้งสองนัด" / "Going to both" is also used when the clash is only with the user's own busy time (not a plan). Contract §2 prescribes this label, so kept; copy slightly off in that case.
- **L3 [RUN screenshot]** Day view at 375 (`r6d-day-kinds-th-light-mobile-375.png`): the kind-label row (icon + "นัด: <ชื่อ>") is right-aligned with the icon detached from the text, and long titles wrap into a narrow underlined column. No overflow, targets OK; cosmetic only. Legend (`KindLegend`) shows only in month view; day view tells kinds apart by icon + words (not colour only) so acceptable. Month cell dots do not distinguish kinds (legend explains in-day).
- **L4 [RUN screenshot]** 768 plan page (EN): "Can't go" wraps to 2 lines in the RSVP segmented control in the half-width card (`r6d-detail-badge-en-dark-tablet-768.png`); not clipped, button >= 44px. Probably pre-existing layout, now more visible with the new hint under it.

## Team notes assessed
- `home-rsvp-hint` id vs testid: harmless, a11y unaffected (RsvpControl uses `aria-describedby`). Suggest adding testid later (test/frontend).
- ADR 0009 `{groupId}` vs code `{gid}`: doc mismatch only (security Info 4) — architect should fix the ADR.
- Platform edits in `calendar/model.ts` (`toSharedBusy`, `ApiBusyItem`), `CalendarView.tsx`, `appointments/model.ts` (`itemWhen`, `overlapView` kind): tidy, typed, covered by `tests/ui/r6d-model.test.ts`; frontend consumes them (BusyItemLine, DayPanel, FreeDetail). No leftover issues found.
- security L1/L2 already fixed in 814136b / 1541016; e2e R6D-1 step 1b confirms no redundant PUT.

## Criteria
| # | Result | Evidence |
|---|---|---|
| R6D-1 | Pass [RUN] | e2e: groups tab -> home -> calendar tab keeps group; dropdown remembers; new context (cookie kept) remembers; logout then login = not remembered; cookie HttpOnly/Lax/~1y, only gid. |
| R6D-2 | Pass [RUN+READ] | e2e + `chooseCalendarGroup` (left group / random uuid / non-member / non-uuid -> first group, no error, `groupMissing=false`). |
| R6D-3 | Pass [RUN] | e2e scenario A through UI: maybe/not_going -> other group sees free; going -> "ติดนัดกลุ่มอื่น" 12:00-15:00, home group sees "นัด: …"; change/cancel -> free again. |
| R6D-4 | Pass [RUN] | e2e checks DOM + raw responses of other group for canaries; security PoC covers raw JSON. |
| R6D-5 | Pass [RUN] | popup to/from, maybe<->not_going no popup, cancel/Esc = unchanged, initial focus on keep button, focus trap. |
| R6D-5b | Pass [RUN] | conflict popup lists names+times (own plan, other-group plan with group name, own busy), still confirmable, badge on detail/list/home card, edge-touch no clash, not leaked to other members. Second plan overlap shows first plan's name. |
| R6D-6 | Pass [RUN+READ] | `r6d-query-count` in security's run; free-days/overlap count going. |
| R6D-7 | Pass [RUN+screenshots] | 375/390/768 x th-light/en-dark: no overflow, popup sheet inside viewport, buttons >= 44px (sheet buttons `--tap-lg`), long names (40/80 chars) wrap, 3 kinds distinguished by icon (calendar / lock) + wording + dashed/solid shape, not colour alone. EN long button "Going to both" fits. Initial focus on the "keep" button. TH/EN natural. No hard-coded strings spotted; style-literals clean. |
| R6D-8 | Pass locally | commands below; CI not observed. |

## Commands run (real output)
```
npm run typecheck                         -> exit 0
npm run lint                              -> exit 0
check-style-literals.sh src               -> "src: ไม่มีค่าสี hex / px นอก tokens"
npm run contrast                          -> 312 pairs, fail 0, lowest text 4.54:1
npx vitest run tests/ui                   -> 20 files, 398 tests passed
npm run build                             -> success
PW_CHROMIUM_PATH=chrome.exe npx playwright test r6d-going-busy appt-layout appt-story appt-validation calendar-layout free-layout r6b-calendar r6c-appearance groups-responsive r5-layout --workers=2 --retries=0
                                          -> 207 passed, 30 skipped (by-design project skips), 0 failed (9.3m)
```
Screenshots (copied from test-results, scratchpad): `.../scratchpad/shots/r6d-{popup-to-conflict,popup-to,popup-from,detail-badge,list-badge,home-badge,home-popup-from,mine-going,day-kinds,month-legend}-{th-light,en-dark}-{mobile-375,mobile-390,tablet-768}.png`.

## Not verified
CI on the PR; Vitest DB suites on this Windows machine (security ran them); real devices / screen readers; hand-played flow beyond what e2e drives (the e2e spec plays scenario A and G1 through the real UI on a production build).
