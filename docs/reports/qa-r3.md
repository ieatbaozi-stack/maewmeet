# QA review R3 (calendar + busy) — branch `r3` @ 1e11bc4 (diff 18b7841..HEAD)

Reviewer: QA (independent). Not trusting Handoff Certificates: every gate re-run. E2E ran on a clean copy (`git archive HEAD`, own build, own DB/port) with `--retries=0 --workers=2`.

## Verdict
**CONDITIONAL PASS: fix H1 (busy cap bypass, unbounded rows/response) before merge.** No Critical findings. No privacy leak found (note/title canaries pass; hidden title never leaves SQL). Everything else is Low.

## Gates (re-run)
| Gate | Result | Evidence |
|---|---|---|
| lint / typecheck / db:check / contrast / check-style-literals | PASS | all exit 0; contrast 262 pairs, 0 fail, min text 4.54:1 |
| build | PASS | `next build` exit 0, twice (repo + clean copy) |
| vitest full | PASS | 79 files / 3215 tests, 1 run (192 s). Not repeated 3x (shared 2-core box) |
| e2e calendar-story/layout/errors/busy-api | PASS x2 | 14 passed + 16 skipped by design, both runs, retries=0, no flake |
| R3-1 lib | PASS | ADR 0004 cases + my probes: gap -> INVALID_LOCAL_TIME, fold -> earlier, 23h/25h day windows, leap day, year cross, end==start, 12:15, "24:00", backdate/366/62d edges all correct |
| R3-2 formats/limits | PARTIAL | formats/limits correct, but count cap bypassable (H1) |
| R3-3 owner only | PASS | PATCH/DELETE scoped by user_id, strict schemas |
| R3-4 visibility | PASS | shared SQL has no `note`; hidden title cut in SQL + serializer; no-store header; canary e2e green |
| R3-5 calendar | PASS (see H1) | 62-day cap enforced |
| R3-6 RBAC | PASS (not re-audited beyond vitest; Security covers) |
| R3-7 mobile | PASS | layout spec 375/390/768 x th/en x light/dark; FAB does not cover last content (scrolled bottom, FAB y 676 > last text 643) |
| R3-8 dates | PASS | Buddhist year th, Mon start, today uses group tz, overnight shows on both days |
| R3-9 i18n | PASS | 506/506 keys, no hard-coded text in components, no console/hydration problems in th+en month/day/mine (prod build) |
| R3-10 story | PASS | calendar-story th+en |
| R3-11 | PARTIAL | CI/shard time not verifiable here; Medium+ finding open (H1) |

## Findings

### High
**H1. Busy count cap counts only un-ended rows -> unlimited rows, unbounded calendar response**
- `src/lib/data/repos/busy.ts:42` (`activeCount` = `end_at > now`), used at `:59` (insert) and `:99` (update). Shared query `:140-161` has no LIMIT.
- Repro (`scratchpad/qa-probe.spec.ts` P1): signed-up user POSTs `all_day` for today-3 (allowed by the 7-day backdate rule); 400 of 400 requests returned 201 (no cap, no rate limit). `GET /api/groups/:gid/calendar` for that single day then returned 400 rows / 99 KB. PATCH of an active row to a past date also succeeds, freeing the cap. Contract R3-2 says the count cap is a limit; R3 risk list names DoS. Any member can bloat every groupmate's calendar response and DB.
- Fix: cap total rows per user (or rows with `end_at >= now - 7d`), and `LIMIT` the shared query / bound rows per member.

### Low
- **L1. Boundary months 2000-01 and 2100-12 show the error state.** `monthGrid` reaches 1999-12-27 / 2101-01-02, API rejects out-of-range years (400). Repro: `/calendar?d=2000-01-15` -> `cal-error` (P2). `model.ts:94` `shiftMonth` only guards the month, not the grid. Fix: clamp grid or allow range ±1 week in `parseDateRange`.
- **L2. Foreign/stale `?g=` silently falls back to your own first group** (`load.ts:45`). Judged Low: no data exposure and no existence oracle (a user with no groups gets the no-group state; API returns 404). It is a UX gap: a removed member's bookmark shows another group's calendar with no notice, and URL `g` is rewritten. Suggest a one-line notice when `search.g` was given but not matched, or keep as is and document.
- **L3. Items whose tz differs from the group tz can be missing at range edges.** Shared query filters on item-local dates (`repos/busy.ts:140`), UI places them by group tz. Repro (P3): Honolulu item 20:00-23:00 on day X = 10:00-13:00 Bangkok day X+1; calendar query for day X+1 returns 0 rows. Only reachable via API today (no tz UI; groups all Asia/Bangkok) but will bite when tz UI/group tz arrives. Fix: widen SQL range by 1 day each side and filter by instants.
- **L4. Switching type multi -> timed silently keeps the multi-day range** (P2: "20 Oct 09:00 - 21 Nov 10:00", 769 hr). Tag and total are shown, so it is visible, but saving publishes a 33-day continuous busy. `BusyFormSheet.tsx:100`. Suggest resetting `pickEnd` on switching to timed.
- **L5. Contract text vs implementation:** R3 contract says single range <= 366 days; timed is capped at 62 (ADR 0004, UX 7.4). Code and message `busySpan` are consistent with ADR; update the contract wording.
- **L6. Latent tz assumptions:** `openForm` computes form "today" with `DEFAULT_TZ`, not group tz (`CalendarView.tsx:185`); `timedMinutes` uses `DEFAULT_TZ` even when editing a non-Bangkok item (`form-model.ts:61`); day strip scales 0..1440 wall minutes, so DST days (23/25 h) would be off by one hour at the tail (`model.ts:132,209`). All unreachable in v1 (Bangkok only).
- **L7. a11y nits:** after "I understand" on the first-time notice the focused button unmounts and focus drops to body (`BusyFormSheet.tsx:214`); month grid has 35-42 tab stops (no roving tabindex; allowed by UX 7.5); group switch drops `d` from URL.
- **L8. Version bump after save/retry swaps the whole grid for a skeleton** (flash) instead of keeping stale data while refetching.

## Checked, no bug found
Fast month nav with a slow first response (P4: final month/dots correct, `live` flag works); edit keeps tz (Tokyo item PATCH payload has `tz`, instants unchanged); unchanged edit round-trips for overnight and ends-at-midnight items; overnight bars on both days (22:00 -> 91.67%/8.33% cutEnd; next day 0/25% cutStart); stale save after delete -> "no longer exists" toast; focus trap wraps, Esc returns focus to opener; /calendar `Cache-Control: private, no-cache, no-store`; SSR vs client text equal (no hydration warnings in prod); th/en tone reads natural.

## Repros
`/tmp/claude-0/-home-claude/dd92bedd-a845-5dfe-8e80-ceeeb2718b23/scratchpad/qa-probe.spec.ts`, `qa-probe2.spec.ts` (Playwright, drop into `tests/e2e`, run on mobile-375; src untouched).
