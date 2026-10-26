# QA R5: independent review (branch `r5`, 0a6d5c0..efaefef)

> Reviewer: QA (independent, did not write this code) · 2026-10-27 · contract: R5_CONTRACT.md including §8 Errata
> Method: I read the whole diff (backend, RBAC, UI, messages, /privacy), then ran the behaviour through the real route handlers on a scratch libSQL DB using my own throwaway vitest probes (scratchpad, outside the repo). I also ran the R5 e2e specs plus my own Playwright probe against `next start` on a separate port and DB. No file under `src/` was changed.
> **[RUN]** = verified by running · **[READ]** = from reading the code only

## Summary

| Severity | Count | Items |
|---|---|---|
| H | 0 | none |
| M | 1 | M1 a live user can appear as "Deleted account" (display-name spoof via the `deleted-` prefix) |
| L | 7 | L1–L4 /privacy text and the delete Sheet do not match real behaviour · L5 "Created by" overflows at 375 px (pre-existing) · L6 EN wording "Admin" is ambiguous · L7 config-hygiene test times out under full-suite load |

The backend for R5-1..R5-7 passed every edge case I tried. Details are in the "Verified OK" section.

---

## Findings

### M1: A live user can make themselves show as "Deleted account" (spoof) [RUN]
- `src/components/account/model.ts` `shownName()` treats a name as "deleted" when it is empty **or starts with `deleted-`**.
- Display names may legally start with `deleted-`: `checkVisibleName` allows it, and so does PATCH /api/me (I tested this).
- The function is used for display names in `AppointmentDetail` (RSVP list, creator, canceller) and `AdminGroupDetail` (member list and the transfer dropdown).
- Reproduction (Playwright, 375 px, both th and en):
  1. User *Spoof* sets their display name to `deleted-totally-real`.
  2. They join a group and RSVP "going".
- Result: on the appointment page, the "Who's coming" list shows **"Deleted account" / "บัญชีที่ถูกลบ"**, while the group page shows the raw name `deleted-totally-real` (`spoofShownAsDeleted: true`, `groupPageSpoofRaw: true`).
- Impact:
  - A live member can pass as a deleted account in RSVPs and the creator line, and the same person looks inconsistent across pages.
  - In the admin group detail, the SA sees "Deleted account (username)" for a live user, which could lead to mistakes during admin transfer.
- Suggestion: for `displayName`, decide using `''` only (the server already clears it to `''`). Keep the `deleted-` prefix check only for `username` in audit. Usernames cannot contain `-`, according to the comment in repos/account.ts.

### L1: /privacy and the delete Sheet say the creator shows as "Deleted account", but the real text says something else [RUN]
- `privacy.delete.kept` and `account.delete.keep.appointments` both say the creator "shows as 'Deleted account'".
- In reality the API returns `createdBy: null` (Errata §8.2), and the UI shows `appointments.detail.createdByGone`: "Created by a former member or deleted account" / "สร้างโดยอดีตสมาชิกหรือบัญชีที่ถูกลบ".
- Verified in my probe: `detailCreatedBy: null`. `cancelledBy` is `null` too.
- Contract R5-9 requires the text to match real behaviour. Please align the two texts.

### L2: /privacy says pending PIN reset requests and invites are "removed or cleared", but the rows stay [RUN]
- `privacy.delete.removed` lists "pending PIN reset requests" and "invites you created".
- In reality:
  - `pin_reset_request` is only set to `status='cancelled'`. The row stays, with `requester_ua`, `requester_country` and `requested_at`.
  - `group_invite` is set to `revoked` / `declined`, and `created_by` / `invitee_user_id` still hold the id.
  - The DB dump after deletion shows those rows.
- The `privacy.retention.security` section does say reset requests are kept for security. But the delete section and its "kept" list contradict that.
- Suggestion: say they are "cancelled" and add them to the "kept" list.

### L3: /privacy says a deleted group is "hidden from everyone", but the SA still sees it [RUN]
- `privacy.retention.groups` says: "A deleted group is hidden from everyone".
- In reality `GET /api/admin/groups?status=deleted|all` and `GET /api/admin/groups/:gid` return the deleted group's name and **its member list (username + display name)**. The UI also has the "Deleted" filter.
- Suggestion: say it is hidden from members, but an admin can still see the name and member list.

### L4: /privacy `see.superAdmin` names only the calendar, but SA can open much more of any group [RUN]
- The text says the SA "can open a group's calendar the same way a member can".
- In reality, a non-member SA:
  - calls `GET /api/groups/:gid/appointments` → 200, which includes the **plan title and place** (`saAppts: {title:true, place:true}`);
  - can also open the group, its invites and its availability;
  - can edit or cancel plans, remove members, transfer admin and delete the group (ADR 0003).
- All of these are audited (`group.calendar.view`, `appointment.view` with `asSuperAdmin:true`; verified).
- So the text is not false, but it is incomplete. Suggestion: add "plans (title/place)" and "management actions".
- Verified good: SA does not see `note` or the title of entries set to "Details hidden" (`saCal: {note:false, hidden:false}`).

### L5: "Created by <name>" overflows the screen at 375 px when the name has no spaces [RUN]
- On `/appointments/:id`, a creator with a 40-character name with no spaces (`W`×40) makes `scrollWidth` 518 > 375 (both th and en). The line runs past the right edge (screenshot in my scratch dir).
- `.appt-created` in `src/styles/appointments.css:135` has no `overflow-wrap:anywhere`.
- This is **pre-existing since R4B** (that CSS is not in the R5 diff), but R5-8 requires "375 doesn't break". Every R5 page I measured passed, even with 40-character names, the deleted `deleted-<uuid>` username in audit, and 40-character group names: /admin/users, /admin/groups, /admin/groups/[gid], /admin/audit, /me, /groups/[gid].
- Record for R6, or add one line of CSS.

### L6: EN wording: "Admin" is used for both the super admin and the group admin [READ]
- `adminUsers.superAdmin` = "Admin" sits on the same card as the group-role texts. `privacy.see.superAdmin` / `contact.body` say "Admins see…" / "Reach the admin through one of your groups", and `account.delete.superAdmin` says "Admins can't delete their own account…".
- Thai separates ผู้ดูแลระบบ (system admin) and ผู้ดูแลกลุ่ม (group admin), but English mixes them. Suggestion: "app admin" / "site admin" for the SA.
- Smaller wording issues: `adminAudit.actions.pinReset_decide` "Decided a PIN reset request" → "Approved or rejected a PIN reset". `group_availability_view` "Opened group free days" → "Viewed the group's free days".
- TH/EN keys are complete: 1009 = 1009, no difference.

### L7: `tests/security/config-hygiene.test.ts` times out (5 s) in the full run [RUN]
- Full vitest run with CI env: **4374 passed, 2 failed, 1 skipped**. Both failures are timeouts in `config-hygiene` ("git log -p --all", during the 550 s run).
- Running the file on its own passes 12/12 (832 ms). It is flaky under load, not a regression in logic.
- Suggestion: give that test a longer timeout so the gate is stable.

---

## Verified OK (by running unless marked otherwise)

### R5-1 Rename
- Validation matches signup:
  - '' and '   ' → TOO_SHORT
  - bidi U+202E, zero-width U+200B, control U+0007, newline, and a combining mark with no base → INVALID
  - 41 characters → TOO_LONG; 40 characters → 200
  - emoji ZWJ → 200
  - NFD `Café` → stored as NFC
  - extra key → VALIDATION; anonymous → 401
- Quota is 10/day counting only real changes: 3 + 7 succeeded, the 11th → 429 with Retry-After. A same-name call does not use quota (it ran before the limit).
- The new name shows immediately in group members, appointment detail and session.

### R5-2 Delete account
- Moderator who created plans, cancelled someone else's plan, sat in 3 groups, created a code and a direct invite, received a direct invite and had busy entries:
  - after deletion, b's id is absent from group view, calendar, availability and the plan list;
  - RSVP shows going 0;
  - the plan stays with `createdBy: null`, and `cancelledBy: null`;
  - the invite notification b sent to dave has `inviterName: ''`, and dave's /me/invites is empty;
  - the admin group detail does not list b.
- A dump of every table finds no `"bob"`, `ชื่อ bob` or `u:bob`.
- Audit of the deleted user shows the actor as `deleted-<uuid>`.
- Login as the deleted user returns exactly the same bytes as an unknown username. Old session → 401, deleting again → 401, login with `deleted-<id>` → INVALID_CREDENTIALS.
- PIN reset for `deleted-<id>` creates no row (the service only accepts `active` accounts) [READ + RUN].
- The username can be re-registered (201). The new account sees no old groups, notifications or invites.
- SA → 403 FORBIDDEN, even with a wrong PIN, and the attempt is not counted.
- 5 wrong PINs → LOGIN_LOCKED (429), and the session is unaffected.
- Triple submit at once → one 200 and two 401; only 1 `user.delete` audit row.
- Race 1: transfer of admin to b while b deletes (Promise.all, and transfer landing during argon2 verify) → delete gets 409 with the group list, b stays active and admin; no group is left without an admin.
- Race 2: redeeming a code while deleting → membership is 0 at the end, and a later redeem → 401.

### R5-3 / R5-4 Admin permissions, suspend and unlock
- Suspend:
  - → session deleted at once (old session 401 AUTH_REQUIRED) → login with the correct PIN gets `ACCOUNT_SUSPENDED` (401, Errata §8.1); a wrong PIN gets INVALID_CREDENTIALS.
  - suspending self or another SA → 403; suspending again → `{changed:false}` with no audit; unknown uuid → 404; non-uuid → 400; deleted user → 404 for both suspend and unlock.
  - member → 403; SA suspended via SQL → 401 ACCOUNT_SUSPENDED.
- Unsuspend → login works again.
- Unlock → `wasLocked:true`, and the user can log in immediately.
- Audit rows are correct: `state` / `wasLocked`, `asSuperAdmin:true`.
- The 60 writes / 10 min limit works (429 at the 60th including earlier writes).
- A suspended group admin can still be handled by an SA: transfer and group deletion both work and both are audited with the SA as actor.
- Note for the contract: a suspended user can still request a PIN reset, and the system answers 202 but creates no row (only active accounts). That is correct.

### R5-5 Admin privacy
- `/api/admin/groups/:gid` holds only id, name, tz, counts and members (userId, username, displayName, role, joinedAt).
- Every open writes `admin.group.view`: 2 opens = 2 rows.
- `Cache-Control: private, no-store`.

### R5-6 Audit
- 120 rows with equal `created_at`, paged with limit 50: 3 pages, 121 rows, 121 unique (no duplicates, nothing missing).
- Meta whitelist: rows with `title` / `note` in meta get those keys removed.
- `admin.audit.view`: 1 row per 10 minutes even across page loads.
- `limit` values 0, 101, -1, abc, 1.5 and '' → VALIDATION.
- Filters for action / targetType / actor / targetId work; unknown keys → VALIDATION.

### R5-7 Search and paging
- 70 users with equal `createdAt`: 3 pages, 71 unique.
- `q='%'` matches only names that contain %; `'_'` → no false matches; `'\'` → literal match.
- Fullwidth `ＵＰ` → NFKC prefix match; ASCII case is ignored.
- 41 characters → VALIDATION; zero-width → VALIDATION.
- Bad cursor → VALIDATION.

### R5-8 UI
- I ran 4 R5 e2e specs (account, admin, privacy, r5-layout) on 3 viewports: **42 passed, 24 skipped** by design; the story tests run only on mobile-375.
- My own probe: every R5 page at 375 px, th and en, with 40-character names, has no horizontal scroll (except L5, which is not an R5 page).
- Destructive actions have a confirmation Sheet. The delete Sheet puts initial focus on "Cancel" [READ + e2e].

### R5-9 /privacy, checked claim by claim against the code
- Correct:
  - PIN is stored as an argon2 hash;
  - IP counters are HMAC hashes (`login:ip:<hmac>`);
  - reset requests store UA summary and country;
  - sessions use a sliding 60-day expiry (`SESSION_TTL_MS`);
  - busy entries ended more than 90 days ago and notifications older than 90 days are purged by cron (`maintenance.ts`);
  - place cache keeps 30 days and has no account link (`query_normalized` primary key);
  - Nominatim is called from the server with only user-agent and accept-language headers, and the client IP is not forwarded [READ];
  - notes are seen only by the owner, and hidden entries show only that the person is busy [RUN];
  - SA cannot delete their own account.
- Wrong or incomplete: L1–L4 above.

### R5-10 No regression
- `tsc --noEmit` passes; `eslint .` is clean; contrast: 312 pairs, 0 failures, lowest 4.54:1.
- vitest full suite: see L7 (2 load timeouts; the file passes on its own).
- I did not run the full e2e suite of R0–R4B. Lead should run it at the gate.

## Notes for Lead (not defects)
- A suspended account that is a group admin blocks that group until an SA transfers admin. The contract already notes this (§7.2), and the SA transfer works.
- `admin.group.view` writes a row on every open. If the UI refetches after a transfer, the audit gets more rows. This is accepted by the contract.
- The scratchpad is shared with other agents. I put my probes in their own folder.
