# QA R7: independent review (branch `perf/r7-speed`, HEAD cb15b59)

> Reviewer: QA (independent) · 2026-11-08 · contract: R7_CONTRACT.md (R7-1..7, §3.1) · **[RUN]** = ran · **[READ]** = read code · security review is separate

## Verdict: pass with notes (0 H / 0 M / 3 L). R7-4 passes for home/calendar month/free-together and does NOT pass for RSVP (as the maker states)

## Findings
- **L1 [RUN]** R7-4 RSVP `PUT /api/appointments/:id/rsvp`: 10 -> 9 queries (-10%), 5.7 -> 4.8 ms (-16%): below the 30% bar. Confirmed by my own run. Remaining 9 are intentional (authz gate, rate limit, BEGIN/upsert/COMMIT, session, DTO). Criterion R7-4 is met for the other three main paths. Needs a boss decision (accept, or schedule the redesign: rate limit into tx / slim DTO from PUT).
- **L2 [READ]** `/groups/[gid]` still passes the group gate twice (`getGroup` + `listGroupAppointments`), about -1 query. Disclosed by the maker (after.md section 5); not in scope.
- **L3 [RUN]** Full e2e run on this Windows machine had 15 failures out of 798 at `--workers=3`: 14 are `ENOENT` writing trace/video artifacts under a long `--output` path and 1 is `ERR_CONNECTION_REFUSED` (server died in the middle of the run). None is an assertion failure. Re-running the 7 spec files they came from with a short output path and `--workers=2`: 329 passed, 28 skipped, 0 failed. So env, not code. Not a flake in R7 code.
- Note [READ]: `?v=mine` for a group the viewer is not a member of is unreachable (group is chosen from `listMyGroups`), so skipping `load()` there does not drop any super-admin audit (`group.view` is no longer written by the calendar page; `group.calendar.view` is written whenever `load` runs).

## Criteria
| # | Result | Evidence |
|---|---|---|
| R7-1 | Pass [RUN+READ] | `tests/groups/r7-default-min-free.test.ts` passes (new group = 240, window 480-1320, old group stays 120, POST with minFreeMinutes -> 400, repo default 240 / explicit 90, DB default still 120). `git diff main -- drizzle` = 0 lines. e2e `r7-default-min-free` passes |
| R7-2 | Pass [READ] | `perf-r7-baseline.md` covers all paths in section 2 (not re-measured; phase A tool unchanged except added B-2 service rows) |
| R7-3 | Not mine | Server-Timing leak check is security's (`security-r7.md`); unit test `r7-server-timing` passes in the full Vitest run |
| R7-4 | Partial [RUN] | numbers below match the maker's table exactly (queries and waves identical; ms within about 1 ms of the stated medians). Home 13->9 (-31%), month/free 15->8 (-47%) pass. RSVP 10->9 fails (L1) |
| R7-5 | Pass [READ+RUN] | `loadGroupCtx` now returns the group row from the same gate query; `groupRowOf()` is only called after `authorize()`; `getGroupCalendar/getGroupAvailability` still `loadGroupCtx` + `authorize` on every call; `openGroup*` handles are per-request closures; session cache is `React.cache` (per request) and a `WeakMap<Request>`; no module-level user cache. `tests/auth/page-session`, `r7-phase-b`, rbac tests pass |
| R7-6 | Skipped by contract | optimistic not done; B-5 patches from the POST result only, falls back to reload on truncation or mismatch. `tests/ui/r7-busy-patch` pass |
| R7-7 | Not observed | CI + Vercel preview not seen by me |

## No-regression review (R7 changes every loader)
| Area | Result |
|---|---|
| Home (no group / group / error) | [READ] `getHomeFeed`: no group -> `no-group`, appointment failure ignored (same as before when it was not called); groups fail or appointments fail with a group -> throws -> `error`. Unhandled rejection guarded. e2e home/appt specs pass |
| Calendar 4 tabs | [READ+RUN] month/free/day use `openGroupCalendar/Availability` (NOT_FOUND -> `gone`, same payload shape); `mine` fetches busy + going on the server (`allSettled`: going fails -> `going:null`, busy fails -> `error`) like the two old client calls. r6d/r6f/calendar e2e pass |
| Add busy | [READ+RUN] E11 overlap GET still runs; POST result is merged into month/day/mine by `addCreatedBusy` (shared view shape: no note/seriesId, title omitted when hidden or empty, sorted like the server, range clamped by group tz, id de-dup, truncated -> reload). Free-together always reloads (key has version). Unit test covers hidden title, border ranges, truncation. r6f-daily-busy e2e passes |
| RSVP + R6D conflict popup | [RUN] home RSVP still GET detail then PUT (documented). r6d-going-busy e2e (incl. popup) passes |
| Groups / appointment / me / admin / bell | [READ+RUN] loaders only swap to `getRequestSession`; `getPageUser` takes the user from the same JOIN (still requires status active; suspended -> null). e2e groups, appt, account, admin, shell pass |
| Session | [READ] 1 read per page, touchSession at most once per request; sessions that expire/revoke become anonymous on the next request |

## Commands run (real output)
```
npm run typecheck                                              -> exit 0
npx eslint src tests --ignore-pattern ".claude/**"             -> 0 problems (no output)
npm run build                                                  -> success
git diff main -- drizzle | wc -l                               -> 0
vitest (temp config) tests/perf/r7-baseline.test.ts (x3 runs) -> 1 passed each (query ceilings hold)
```
R7 baseline, my run (median of 7) vs the maker's table (queries / waves identical on every row):
| path | q | waves | total ms (mine / maker) |
|---|---|---|---|
| PAGE / | 9 | 3 | 2.7 / 2.7 |
| calendar v=month / free / day | 8 | 4 | 2.8 / 3.5 / 2.7 (maker 2.9 / 3.7 / 2.7) |
| calendar v=mine | 11 | 5 | 3.1 / 3.1 |
| /groups, /groups/[gid], /appointments/[id], /me | 5, 11, 7, 3 | 3, 6, 4, 3 | 1.3, 2.8, 1.8, 0.7 |
| PUT rsvp | 9 | 7 | 4.6 / 4.8 |
| POST busy / DELETE busy | 5 / 5 | 5 / 5 | 3.3 / 3.2 |
The tool is the same harness as phase A (`git diff b721a22 HEAD` on it only adds the 2 B-2 SVC rows, lowers `CEILINGS`, and mocks `React.cache` per sample).
```
vitest (temp config) whole suite   -> 136 files: 129 passed, 7 failed; 4772 tests passed, 17 failed, 18 skipped
  failures: calendar/free-time (Python missing), ops/admin-reset-pin-script, ops/manual-delete-sql, ops/pepper-fingerprint-script,
            release/release (tsx .bin ENOENT), security/config-hygiene (CRLF), ops/health (Node v26 vs expected v24)
  none touch files changed by R7 (git diff main shows no change in tests/ops, scripts, tests/release)
E2E_PORT=3151 playwright test --workers=3 --retries=0 (all projects)
                                    -> 657 passed, 126 skipped (by-design project skips), 15 failed (L3, env artifact paths / one server drop)
E2E_PORT=3151 playwright test appt-layout groups-responsive responsive shell account pin-reset signup --workers=2 --retries=0 --output=<short path>
                                    -> 329 passed, 28 skipped, 0 failed
```
I did not run the failing Vitest files on `main` (no branch switch allowed); the causes are environmental and the files are untouched by the branch.

## Not verified
CI + Vercel preview (R7-7); real Turso timings (local libSQL only); browser-level prefetch / waterfall (read from code and the frontend report); no new screenshots (R7 changes no layout; layout e2e `checkLayout` specs at 375/390/768 th/en light/dark pass); screen readers.
