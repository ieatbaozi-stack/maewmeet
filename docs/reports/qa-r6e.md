# QA R6E: independent review (branch `chore/r6e-cleanup`, HEAD 1bf6ec5)

> Reviewer: QA (independent) · 2026-11-02 · contract: R6E_CONTRACT.md (R6E-1..10) · design: docs/design/R6E_POLISH.md
> **[RUN]** = verified by running · **[READ]** = from reading code · security review (E5 mutation) is in security-r6e.md, not repeated here

## Verdict: pass with notes (0 H / 0 M / 4 L)

## Findings
- **L1 [READ]** R6E_POLISH §3.3 says a skeleton should be delayed 150 ms and, once shown, stay >= 250 ms. `LoadingState.tsx` / `loading.tsx` paint immediately with no min-duration. Contract only enforces R6E-10 (nav bar delay, not skeleton), so accepted; frontend disclosed it.
- **L2 [READ]** `NavProgress.tsx` listens to link clicks only; programmatic `router.push` (e.g. after save) shows no bar. Disclosed by frontend; acceptable (buttons show their own spinner).
- **L3 [READ]** R6E-10 "fast nav does not flicker" is tested by raising `--loading-delay` to 5000 ms (`r6e-loading.spec.ts`), so it proves the "no active before the delay" logic, not the real 150 ms on real timing. Logic is simple (timer cleared in `finish()`), OK.
- **L4** No layout-shift (CLS) measurement; only button width/height constant during busy (RUN, <=1px) and skeleton sized by CSS (READ). Disclosed by frontend.
- Env note: `npm run lint` at the main checkout root reports 26 errors, all inside the nested `.claude/worktrees/agent-a9b1c46957dc239b8` (R6F worktree). `eslint . --ignore-pattern ".claude/**"` = 0 problems. Not a branch problem.
- `settleAnimations()` (fixtures.ts) only awaits finite animations, then measures; it does not hide real issues. Button >=44px is still measured after animations finish and passed.

## Criteria
| # | Result | Evidence |
|---|---|---|
| R6E-1 | Pass [RUN] | e2e r6e-layout (th/en x light/dark x 375/390/768): popup with >4 conflicts shows "และนัดอื่นอีก" / "and more"; `RsvpConfirm` no longer passes `count`; unit tests |
| R6E-2 | Pass [RUN+READ] | `goingConfirmKey` (model.ts): none=toConfirm, only own busy=conflictConfirmBusy ("ไปนัดนี้"/"Go anyway"), any appointment or truncated=conflictConfirm; tests/ui/r6e-rsvp-model; e2e checks buttons |
| R6E-3 | Pass [RUN+screenshot] | day view 375 th-light: icon sits next to "นัด:", long title wraps full width, no overflow; `checkLayout` green 12 combos. Shot: shots/r6e-day-long-appt-th-light-mobile-375.png |
| R6E-4 | Pass [RUN+screenshot] | RSVP 3 buttons single line, >=44px, 375/390/768 x th/en x light/dark (r6e-layout); shot rsvp-detail-en-dark-tablet-768 shows "Can't go" on one line |
| R6E-5 | See security-r6e | E5 not re-run here (security owns mutation check) |
| R6E-6 | Pass [RUN] | `vitest run tests/security/authorize-first.test.ts` 135/135 on Windows (fails on main); 53 route.ts files scanned, assertion >=20 |
| R6E-7 | Pass [RUN] | `grep -rn data-slot docs/design/samples` = 0 hits; ADR 0009 only mentions groupId in the `appointment` item type, no current-group body (`{ gid }`) |
| R6E-9 | Pass [RUN+READ+screenshot] | r6e-busy-overlap: overlap/no-overlap/edge-touch/edit self/Esc/check-fail all pass (375 skipped for the long flow by spec design, 390 + 768 ran; layout tests ran at all 3). Dialog initial focus on "Back to edit", Esc = back (Sheet). Shot overlap-popup-long-en-dark-mobile-375 inside viewport, buttons visible |
| R6E-10 | Pass [RUN+READ] | r6e-loading (390): slow nav -> data-phase active within 900 ms with role=status + sr-only text then idle; busy button aria-busy, disabled, 1 spinner, size unchanged, POST count 1; reduced-motion: animation none, opacity 0.6, full width, --dur-fast 0; sheet animation <=200 ms. Not measured: CLS (L4) |
| R6E-8 | Pass locally | commands below; CI/Vercel not observed |
| a11y | Pass [READ+RUN] | popup focus trap + Esc (Sheet, r6e-busy-overlap + r6d popups), `role=status` on nav bar and loading note, `aria-busy` on submit/RSVP, `aria-disabled` on RSVP while saving, reduced-motion rules in globals.css:463-469, contrast 324 pairs fail 0 |

## Full vitest vs main (does the 907 claim hold?)
Both runs on this Windows machine (main in a temporary worktree 37271af, removed afterward):
```
branch : 4644 tests, 907 failed, 3719 passed, 71 failed files / 125
main   : 4567 tests, 908 failed, 3630 passed, 72 failed files / 123
only fail on branch: none (tests/auth/ip-ratelimit.test.ts 12 vs 11 counted failures: file untouched, all its tests fail from the DB EPERM env issue on both; rerun alone = 12/12 fail)
only fail on main : tests/security/authorize-first.test.ts (fixed by this branch)
```
Conclusion: the 907 failures are pre-existing environment (EPERM temp DB / Python / CRLF), no regression.

## Commands run (real output)
```
npm run typecheck                                  -> exit 0
npx eslint . --ignore-pattern ".claude/**"         -> 0 problems (plain npm run lint = 26 errors, all in the nested R6F worktree)
npm run contrast                                   -> 324 pairs, fail 0, lowest text 4.54:1
npx vitest run tests/ui tests/i18n tests/lint      -> 26 files, 641 passed
npx vitest run tests/security/authorize-first.test.ts -> 135 passed
npm run build                                      -> success
E2E_PORT=3111 PW_CHROMIUM_PATH=chrome.exe npx playwright test r6e- --workers=2 --retries=0
                                                   -> 23 passed, 10 skipped (by-design project skips), 0 failed (1.8m)
npx playwright test appt- calendar- r6d- r6b- r5-layout shell theme groups- free- busy-api r6c- --workers=2 --retries=0
                                                   -> 331 passed, 68 skipped, 0 failed (12.2m)
```
Screenshots (67 r6e-*.png, copied from test-results): `C:/Users/User/AppData/Local/Temp/claude/C--Users-User--claude-spares-spare-y9u590/e1069c2f-e504-4b51-bad0-e620b14caf9b/scratchpad/shots/` (r6e-{day-long-appt,day-long-appt-viewer,popup-many,rsvp-detail,rsvp-home,overlap-popup}-{th,en}-{light,dark}-{mobile-375,mobile-390,tablet-768}.png). I looked at 4: day 375 th-light, plan 768 en-dark, popup-many 375 th-light, overlap popup long 375 en-dark: no overflow, no clipped text, TH/EN natural.

## Not verified
CI + Vercel preview; real devices / screen readers; progress bar and spinner seen only through e2e assertions and static reading (not on a live video); CLS; the other ~60 screenshots not individually viewed (covered by the `checkLayout` assertions).
