# QA R6B: independent review (branch `feat/r6b-calendar-free-tab-fab`, main..d359cca)

> Reviewer: QA (independent, did not write this code) · 2026-11-01 · contract: R6B_CONTRACT.md
> Commits reviewed: `b53c344` lead (contract) · `eafbb1f` frontend · `1401b75` test · `d359cca` release
> Method: read the whole diff (`git diff main...HEAD`), traced the props of the new button back to the page loader and the RBAC/route, re-ran every gate myself, ran the e2e specs on a fresh `next start` (production build), repeated the R6B spec 3x for flakiness, and ran my own throwaway Playwright probe (scroll-to-bottom measurement + viewport screenshots; probe deleted afterwards, nothing left in the repo). No file under `src/` or `tests/` was changed.
> **[RUN]** = verified by running · **[READ]** = from reading the code only

## Summary

| Severity | Count | Items |
|---|---|---|
| H | 0 | none |
| M | 0 | none |
| L | 4 | L1 contract text drift (label + version) · L2 wide-screen "Create plan" stays visible in gone/error/loading states · L3 R6B-1 checks colours only in th/light · L4 checkLayout screenshots are taken before scrolling and can mislead a visual review |

Verdict: **pass with notes**. R6B-1..R6B-4 pass; R6B-5 passes for everything I could run locally (CI on the PR not observed).

---

## Findings

### L1: Contract wording drift: button label and version number [READ]
- Contract §1.2 names the button "+ เพิ่มนัด". The code uses the existing key `appointments.create` = "สร้างนัด" / "Create plan".
- This matches UI_DIRECTION (`docs/design/UI_DIRECTION.md:114` "สร้างนัด", `:121` "Create plan"), and UX approved it. The code is right; the contract text is out of date.
- The contract header proposes **v0.7.2**, while release proposes **v0.7.1** (v0.7.1 has not been released; the last tag is `v0.7.0`). Release is right.
- Suggestion: Lead adds a short Errata to R6B_CONTRACT.md for both points, so the record matches what shipped.

### L2: At ≥768px, "Create plan" (`appt-add-top`) is shown even when the calendar is gone, errored or loading [READ]
- `src/components/calendar/CalendarView.tsx:488` renders the top button whenever `group` exists. It does not depend on `showFab`.
- The mobile FAB row (`:526`) does depend on `showFab`, so mobile hides it in those states.
- Scenario: a tablet user has the calendar open, and the group is deleted or they are removed. They switch month, and the view shows `cal-gone`. "Create plan" is still on the top bar. Tapping it opens the form, and submitting returns NOT_FOUND. The form handles this with the `appointments.form.error.gone` banner (`AppointmentFormSheet.tsx:171-173`), so nothing breaks and no data leaks. It is only an inconsistency.
- This copies the existing behaviour of `busy-add-top` (`:489`), which was also never gated. The contract says "show when `showFab` and the group is loaded", so strictly the top button should follow the same rule. Low priority; can go to R6C.

### L3: R6B-1 checks the emphasis colours only in th/light [READ]
- `tests/e2e/r6b-calendar.spec.ts:72-76` builds a single scene with `theme: 'light'`.
- The dark theme is covered by `npm run contrast` (`--free-ink` on `--free` in dark = 8.27:1) and by the R6B-3 en/dark screenshots, which I checked by eye: green "Free days" with an icon, distinct from "Month" (selected) and "Day"/"Mine".
- There is no automated assertion that, in dark, the idle tab differs from the plain tab and a selected free tab matches the selected style. Suggestion: loop R6B-1 over COMBOS. The cost is small.

### L4: checkLayout screenshots do not show the scrolled-to-bottom state [RUN]
- `checkLayout` takes a `fullPage` screenshot before `scrollToBottom`. In `test-results/.../r6b-month-en-dark-mobile-375.png`, the fixed FAB row is drawn where it sits at scroll-top, a few px under the hint. That looks like an overlap, but it is a screenshot artefact.
- The hint check in the test itself runs after scrolling, measures bounding boxes, and passes.
- I confirmed with my own probe (viewport screenshot after scrolling to the bottom, 375 en/dark): the hint "Each dot is one member who's busy that day. Tap a day for the times." ends **48px above** the FAB row.
- Suggestion for TEST: also save a viewport screenshot after `scrollToBottom`, so the visual reviewer sees the real state.

---

## Criteria

| # | Result | Evidence |
|---|---|---|
| R6B-1 | Pass [RUN+READ] | `data-emphasis="true"` + `circle-check` icon only on free; CSS `:not([aria-pressed="true"])`, so the selected state falls back to the shared `.segmented` style; order, text and `aria-pressed` are unchanged. e2e R6B-1 passed in 375/390/768. Screenshots th/light + en/dark checked. |
| R6B-2 | Pass [RUN+READ] | `CreateAppointmentButton` gets `group.id/name/memberCount` from `groups` (loader `listMyGroups` → real data), `tz` = `groupTz` (calendar DTO tz, otherwise the server `getGroup().tz`), and `userId` = `requireUser().id`. e2e creates a real plan, checks the detail page and API `groupId`, and a second member sees it. The form is not tied to the other group of the same user. |
| R6B-3 | Pass [RUN] | e2e 375/390/768 × th/light + en/dark × month/free/day/mine: no horizontal scroll, buttons ≥ 44px, the two FABs do not overlap and sit in one row, labels are not ellipsised, and at the bottom of the scroll no content is under the FABs. 360px: the secondary button becomes icon-only with an accessible name. Own probe gap between the last content and the FAB row after scrolling to the bottom: month 48px, free ≈117px, day ≥91px, mine ≥320px (375 and 390, th and en). |
| R6B-4 | Pass [RUN] | `npm run contrast`: 312 pairs, 0 fail; free-ink on free: light 6.46:1, dark 8.27:1. `check-style-literals.sh src`: no hex/px outside tokens (the new CSS uses only tokens; `23.4em` breakpoint is em). |
| R6B-5 | Pass locally [RUN] | typecheck, lint, UI vitest, build, and the calendar/free/R6B e2e all green. CI on the PR not observed (see "not verified"). |

## Other checks

- **Permissions** [READ]: `appointment.create: anyMember()` (`src/lib/rbac/can.ts:191`). `createAppointment` calls `authorize(actor, 'appointment.create', …)` first (`src/lib/data/services/appointments.ts:384`). The route `POST /api/groups/:gid/appointments` is unchanged. R6B does not touch the API, the schema or the RBAC.
- **must_change_pin** [READ]: the `/calendar` page calls `requireUser()`, which redirects to `/set-pin` (`src/app/_lib/session.ts:62`). The API also denies with `PIN_CHANGE_REQUIRED` (`can.ts:235`). The button cannot be reached.
- **States that hide the FAB** [READ]: loading (mine, day, month, free), error, gone, solo (free) and an empty "mine" all set `showFab = false`. The page with no groups returns its own empty state (`page.tsx`), so CalendarView never renders. A deleted group at load time → `initial: gone` → FAB hidden (mobile). See L2 for wide screens.
- **Hydration** [READ]: `group` is derived from props (`groups.find`). Nothing reads `window` or the clock; mobile and wide visibility is pure CSS. No new hydration warnings in the e2e console checks.
- **Hard-coded text** [READ]: none. The label uses `appointments.create`, and the tab text and the busy button are unchanged keys. The icons `circle-check` and `calendar-plus` exist in `src/components/icons/lucide.ts`.
- **Messages**: no new keys (the planned `aria-label` fallback was not needed; at 360px the visible text stays as the accessible name, clipped in the same way as sr-only).
- **Test quality** [RUN]: assertions are specific (computed colours, bounding boxes, accessible names, a real API round trip). `--repeat-each=3` gave 39/39 passed, 6 skipped (the 360 test runs only in mobile-375 by design). One `waitForTimeout(100)` after the scroll is acceptable, because no smooth scroll is used. Weak spots: see L3 and L4.

## Version (VERSIONING.md §3)

- R6B alone: no migration, no env change, no API change. It adds an entry point to an existing ability (creating a plan) plus styling. That fits **PATCH**.
- `[Unreleased]` also holds R6A (countdown badge = new information the user sees, listed under "Added"). Under the strict wording of §3 ("new ability the user sees" → MINOR), someone could argue for 0.8.0.
- My opinion: **v0.7.1 is acceptable.** Neither round adds a new ability; both only show or reach existing data and actions in a new way. Also, R6C (with a migration) will move to 0.8.0 anyway.
- Lead should state this reasoning in the round report, so that the "Added" headings are not read as a MINOR trigger. Final call: boss.

---

## Commands run (real output)

```
npx tsc --noEmit                      → exit 0
npx eslint .                          → exit 0 (no output)
bash .github/scripts/check-style-literals.sh src → "src: ไม่มีค่าสี hex / px นอก tokens" exit 0
npm run contrast                      → 312 pairs, fail 0, lowest text pair 4.54:1, exit 0
                                        light --free-ink #25573B on --free #CFE8D8 6.46:1 · dark --free-ink #A9DCBC on --free #1D3829 8.27:1
npx vitest run tests/ui               → Test Files 19 passed (19) · Tests 360 passed (360)
npm run build                         → exit 0
PW_CHROMIUM_PATH=…chrome.exe npx playwright test tests/e2e/r6b-calendar.spec.ts tests/e2e/calendar-layout.spec.ts tests/e2e/free-layout.spec.ts --workers=2 --retries=0
                                      → 25 passed, 2 skipped (1.4m), exit 0
                                        mobile-375: 9/9 passed · mobile-390: 8 passed + 1 skipped (360 test) · tablet-768: 8 passed + 1 skipped
npx playwright test tests/e2e/r6b-calendar.spec.ts --workers=2 --retries=0 --repeat-each=3
                                      → 39 passed, 6 skipped (1.8m)
own probe (deleted afterwards), 375/390 × en·dark/th·light, scrolled to the bottom: gap content→FAB row: month 48px · free ≈117px · day ≥91px · mine ≥320px
```

## Not verified

- CI of the PR (R6B-5 "CI green"). I did not run the full `npm test` or the full e2e suite. Only UI vitest and the three calendar-related specs were run. The diff touches only CalendarView and its CSS.
- e2e runs on this Windows machine with system Chrome (`PW_CHROMIUM_PATH`), not Playwright's Chromium on Linux as in CI.
- Real devices (iOS safe-area inset, the on-screen keyboard), and screen-reader output beyond the accessible name.
