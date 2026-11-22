# V1 readiness — ตรวจ PRD v1 ทีละข้อ (R18 §5 V1)

> ผู้เขียน: architect · 2026-11-22 · branch `feat/r18-v1` ที่ `9a3ce92` (โค้ดล่าสุด `091a2d4`) · ผู้ตรวจอิสระ: qa (ยังไม่ได้ตรวจ)
> วิธีตรวจ: อ่าน [PRD](../prd/PRD.md) §2–§9 + [R18_CONTRACT](../contracts/R18_CONTRACT.md) แล้วชี้ไฟล์โค้ด + ไฟล์เทสต์ที่มีอยู่จริง (`ls`/`grep` ใน worktree) · **"ส่งแล้ว" = มีโค้ดและมีเทสต์ที่ครอบ ไม่ได้แปลว่ารันเทสต์ทุกไฟล์ในรายงานนี้** — ที่รันจริงดูหัวข้อ "ผลรันจริง" ท้ายไฟล์
> สถานะ: ✅ ส่งแล้ว · ⏸ เลื่อน/ตัด (มีคำตัดสิน) · ⚠ **ช่องว่าง — ยังไม่มีทั้งของจริงและคำตัดสิน (main ต้องตัดสิน)** · 👤 ต้องให้ boss ทำบนเครื่องจริง

## สรุปช่องว่าง (ให้ main)
| # | ข้อ PRD | เรื่อง | ข้อเสนอ |
|---|---|---|---|
| G1 | §6 "PWA manifest (… + แบนเนอร์สอน iOS)" | มี manifest + ไอคอน (R15a) แต่ **ไม่มีแบนเนอร์สอนติดตั้งในแอป** — มีแค่ขั้นตอนใน `docs/guides/quickstart-th.html` (หัวข้อ "เพิ่มไปยังหน้าจอโฮม") · ไม่พบคำตัดสินตัดออก | (ก) ตัดสิน "ใช้คู่มือแทนแบนเนอร์" แล้วติ๊กใน PRD (แนะนำ — boss ติดตั้งได้แล้ว R15 T3) หรือ (ข) ทำแบนเนอร์ (ux + frontend, เกิน B5 เล็กน้อย) |
| G2 | §7 "Lighthouse มือถือ Performance ≥ 85, Accessibility ≥ 95 บน preview" | **ไม่พบผลวัดในเอกสาร/รายงานใด** (`grep -i lighthouse docs/reports` ว่าง) · R0_CONTRACT บอกว่าจะปิดหลัง deploy แต่ไม่มีบันทึก | ให้ qa วัดบน preview ใน V2 แล้วจดผล หรือ main ตัดสินว่าใช้ผล e2e a11y/perf (`tests/perf/r7-baseline.test.ts`) แทน |
| G3 | §8 ข้อ 4.1 "E2E flow ข้อ 1 รันผ่านทั้งไทยและอังกฤษ" | flow ข้อ 1 แตกเป็นหลาย spec: `groups-story`, `calendar-story`, `signup` รันทั้ง TH/EN · แต่ **`free-story.spec.ts` และ `appt-story.spec.ts` ล็อก `locale = 'th'`** (และ `appt-story` สมัคร/เข้ากลุ่มผ่าน API helper ไม่ใช่ UI) | qa ยืนยันใน V2 ว่ายอมรับแบบแยก spec ได้ หรือเพิ่มรอบ EN ของ 2 spec นี้ (test) |
| G4 | §6 "v1.x: นำเข้า ICS" | ทำเป็น**ส่งออก** .ics แล้ว (R12) · PRD หมายเหตุ 2026-11-18 บอกแค่ว่า "นำเข้ายังไม่ทำ" ไม่มีคำตัดสิน | เป็นขอบเขต v1.x ไม่บล็อก 1.0 · main ติ๊ก "ตัดสินแล้ว ไม่ทำใน 1.0" ใน PRD |
| G5 | §9 R6 hardening backlog (deny list, opt-out, confusable, guard 200) | ตัดสินแล้วใน R18_CONTRACT §4 (B3 = ไม่ทำ · guard 200 = R16 H5) แต่ **checkbox ใน PRD ยังไม่ติ๊ก** | main ติ๊กตาม §6 ของ contract (งานของ main อยู่แล้ว) |

ข้อ 👤 (ไม่ใช่ช่องว่างของโค้ด): PRD §8 ข้อ 5 boss ลองบนมือถือ 1 เครื่อง + iPad 1 เครื่อง → V4 (secretary) · ยังไม่มีบันทึกผล iPad

## 1. การตัดสินใจของ boss (PRD §2)
| ข้อ | สถานะ | โค้ด | เทสต์ / คำตัดสิน |
|---|---|---|---|
| D1 สมัครเสรี + rate limit | ✅ | `src/lib/auth/services/*` (signup), ถัง `signup:ip` | `tests/auth/signup.test.ts`, `tests/auth/ip-ratelimit.test.ts` |
| D2 username ไม่สนตัวพิมพ์ | ✅ | `src/lib/auth/pin-rules.ts` (`normalizeUsername`), `user.username_normalized` | `tests/auth/signup.test.ts`, `tests/e2e/signup.spec.ts` |
| D3 `123456` 24 ชม. + บังคับเปลี่ยน | ✅ | `src/lib/auth/services/*` (reset), ADR 0002 §5–6 | `tests/auth/pin-reset-login.test.ts`, `tests/auth/must-change-pin.test.ts`, `tests/e2e/pin-reset.spec.ts` |
| D4 สร้าง/แก้นัด | ✅ | `src/lib/rbac/can.ts`, `src/lib/data/services/appointments.ts` | `tests/rbac/appointments.test.ts` |
| D5 busy ข้ามกลุ่ม + ซ่อนรายละเอียด | ✅ | `src/lib/data/serializers/*` (ADR 0006) | `tests/busy/calendar-visibility.test.ts`, `tests/security/busy-note-isolation.test.ts` |
| D6 โค้ดเชิญ 7 วัน เพิกถอนได้ | ✅ | `src/lib/data/services/invites.ts`, `src/lib/data/invite-code.ts` | `tests/groups/invite-code.test.ts`, `tests/groups/no-code-leak.test.ts` |
| D7 mod ลบได้เฉพาะ member | ✅ | `can.ts` (`member.remove`) | `tests/groups/members.test.ts`, `tests/e2e/groups-story.spec.ts` |
| D8 admin ต้องโอนก่อนออก | ✅ | `src/lib/data/services/groups.ts` | `tests/groups/members.test.ts` |
| D9 หน้าต่างวันว่าง 08–22 / 2 ชม. ปรับได้ | ✅ | `groups` defaults, `src/lib/calendar/free-time.ts` | `tests/calendar/free-time.test.ts`, `tests/groups/r7-default-min-free.test.ts` |
| D10 แสดง พ.ศ. เก็บ ค.ศ. | ✅ | `src/lib/calendar/format.ts` | `tests/calendar/format.test.ts` |
| D11 ลิงก์แผนที่ + ปุ่ม Google/Apple Maps | ✅ | `src/components/places/*` (R13) | `tests/places/location-parse.test.ts`, `tests/e2e/r13-location.spec.ts` · ค้นหาสถานที่ตัดออก: ADR 0013 |
| D12 Vercel Hobby + Turso | ✅ | `vercel.json`, `src/db/client.ts` | ADR 0001 · `tests/ops/health.test.ts` |
| D13 LINE (v1.x) | ✅ | `src/lib/integrations/line/*` (R10) | `tests/line/*.test.ts` · ไม่มี LINE Login: ADR 0011 (ตัดสินแล้ว) |
| D14 TH/EN | ✅ | `messages/th.json`, `messages/en.json`, `src/i18n/request.ts` | `tests/i18n/*.test.ts` |
| D15 ธีมสว่าง/มืด/ตามระบบ | ✅ | `src/styles/tokens.css`, root layout | `tests/e2e/theme.spec.ts` |

## 2. เมทริกซ์สิทธิ์ (PRD §3) + เกณฑ์ §8 ข้อ 2
| ข้อ | สถานะ | โค้ด | เทสต์ |
|---|---|---|---|
| ทุกแถว §3 × 6 บทบาท + `must_change_pin` | ✅ | `src/lib/rbac/actions.ts`, `can.ts` · manifest `src/app/api/_lib/manifest.ts` (81 route) | `tests/rbac/matrix.fixture.ts`, `tests/rbac/matrix.test.ts`, `tests/auth/must-change-pin.test.ts`, `tests/platform/manifest.test.ts`, `tests/security/authorize-first.test.ts`, `tests/security/rbac-invariants.test.ts` |
| audit ทุกการกระทำของ SA | ✅ | `src/lib/data/audit.ts`, `ALLOW_AUDITED` | `tests/admin/audit.test.ts`, `tests/admin/sa-target.test.ts` |
| SA นอกกลุ่มไม่นับวันว่าง/ไม่ RSVP | ✅ | `can.ts` (`appointmentRsvp`) | `tests/rbac/appointments.test.ts`, `tests/availability/availability-api.test.ts` |

## 3. User stories (PRD §4)
| ข้อ | สถานะ | โค้ด (หลัก) | เทสต์ |
|---|---|---|---|
| U1 สมัคร/ล็อกอิน, PIN ต้องห้าม, lockout, session 60 วัน, ออกทุกเครื่อง | ✅ | `src/lib/auth/pin.ts`, `pin-rules.ts`, `throttle.ts`, `session.ts` · `src/app/(public)/login`, `signup` | `tests/auth/pin.test.ts`, `lockout.test.ts`, `login-enumeration.test.ts`, `session.test.ts`, `signup.test.ts` · `tests/e2e/login.spec.ts`, `signup.spec.ts` |
| U2 ลืม PIN → SA อนุมัติ | ✅ | `src/app/(public)/forgot`, `src/app/(app)/admin/pin-resets` | `tests/auth/pin-reset-request.test.ts`, `pin-reset-admin.test.ts`, `pin-reset-login.test.ts` · `tests/e2e/pin-reset.spec.ts` |
| U3 บังคับตั้ง PIN ใหม่ | ✅ | `src/app/(public)/set-pin`, `PIN_CHANGE_ALLOWED` | `tests/auth/must-change-pin.test.ts`, `pin-change.test.ts` |
| U4 สร้างกลุ่ม | ✅ | `src/lib/data/services/groups.ts` | `tests/groups/create-group.test.ts` |
| U5 ชวนตรง + โค้ดเชิญ | ✅ | `src/lib/data/services/invites.ts` | `tests/groups/direct-invite.test.ts`, `invite-code.test.ts`, `r16-direct-invite-race.test.ts`, `tests/auth/redeem-limits.test.ts` · `tests/e2e/groups-story.spec.ts` |
| U6 จัดการสมาชิก/บทบาท/โอน/ลบกลุ่ม (soft) | ✅ | `services/groups.ts`, `src/app/(app)/groups/[gid]/settings` | `tests/groups/members.test.ts`, `idor-and-list.test.ts`, `tests/platform/r17-group-retention.test.ts` |
| U7 ลง busy 3 แบบ + ซ่อน (+ ชุดรายวัน R6F, routine R14, เว้นบางวัน R15) | ✅ | `services/busy.ts`, `busy-routines.ts`, `src/lib/calendar/busy.ts`, `routine.ts` | `tests/busy/busy-api.test.ts`, `tests/calendar/adr-0004.test.ts`, `routine.test.ts`, `tests/platform/r14-busy-routine.test.ts`, `r15-routine-skips.test.ts` · `tests/e2e/calendar-story.spec.ts` |
| U8 ปฏิทินกลุ่ม เดือน/วัน เฉพาะสมาชิก | ✅ | `services/calendar.ts`, `src/app/(app)/groups/[gid]` | `tests/busy/calendar-visibility.test.ts`, `tests/rbac/busy-calendar.test.ts` |
| U9 วันว่างร่วม (ตรงตัวอย่าง RESEARCH ข้อ 5) | ✅ | `src/lib/calendar/free-time.ts`, `services/availability.ts` | `tests/calendar/free-time.test.ts`, `free-time.properties.test.ts`, `tests/availability/availability-api.test.ts` |
| U9.1 "ว่าง X/Y" + ใครติด | ✅ | 〃 | `tests/availability/availability-api.test.ts`, `tests/e2e/free-story.spec.ts` |
| U10 สร้างนัด + สถานที่/ลิงก์แผนที่ | ✅ | `services/appointments.ts`, `src/components/appointments/*` | `tests/appointments/appointments.test.ts`, `tests/e2e/appt-validation.spec.ts`, `r13-location.spec.ts` |
| U10.1 RSVP + เตือนนัดทับ busy | ✅ | 〃 | `tests/appointments/overlap-and-races.test.ts`, `tests/ui/home-rsvp.test.ts` |
| U10.2 แก้/ยกเลิก ยังเห็นสถานะ | ✅ | 〃 | `tests/appointments/r4b-hardening.test.ts`, `tests/e2e/appt-story.spec.ts` |
| U11 หน้าหลักนัดถัดไป + หน้าว่างแมว | ✅ | `services/home.ts`, `src/app/(app)/page.tsx` | `tests/ui/home-model.test.ts`, `tests/e2e/appt-story.spec.ts` |
| U12 หน้า super admin | ✅ | `src/app/(app)/admin/**`, `services/admin-*.ts` | `tests/admin/*.test.ts`, `tests/security/r5-admin-surface.test.ts`, `tests/e2e/admin.spec.ts` |
| U13 บัญชีของฉัน (ชื่อ, PIN, ออกทุกเครื่อง, ลบบัญชี + privacy) | ✅ | `services/account.ts`, `src/app/(app)/me`, `src/app/privacy` | `tests/account/*.test.ts`, `tests/auth/pin-change.test.ts`, `tests/e2e/account.spec.ts`, `privacy.spec.ts` |
| U14 ภาษา TH/EN (ไม่ hard-code, คีย์ครบ, render จริง) | ✅ | `messages/*`, `src/i18n/request.ts` | `tests/i18n/messages.test.ts`, `no-hardcoded-text.test.ts`, `errors.test.ts`, `render.test.ts` (H6) |
| U15 ธีม ไม่กระพริบ คอนทราสต์ ≥ 4.5 | ✅ | `src/styles/tokens.css` · ตารางคำนวณ `docs/design/CONTRAST.md` | `tests/e2e/theme.spec.ts` |

## 4. ขอบเขต v1 อื่น (PRD §6) และข้อกำหนดไม่ใช่ฟีเจอร์ (§7)
| ข้อ | สถานะ | หลักฐาน |
|---|---|---|
| มือถือก่อน 375 + iPad สองคอลัมน์ | ✅ | `@media (min-width: 48em)` ใน CSS · Playwright projects `mobile-375`/`mobile-390`/`tablet-768` (`playwright.config.ts`) · `tests/e2e/responsive.spec.ts`, `*-layout.spec.ts` |
| PWA manifest ติดตั้งหน้าจอหลักได้ | ✅ | `src/app/manifest.ts`, `public/brand/app/*` · `tests/e2e/r15a-feedback.spec.ts` · boss ทดสอบ iPhone ผ่าน (R15) |
| แบนเนอร์สอน iOS | ⚠ G1 | ไม่มีในโค้ด · มีในคู่มือเท่านั้น |
| แจ้งเตือนในแอป (คำเชิญตรง, นัดใหม่, reset อนุมัติ) | ✅ | `src/lib/data/notifications/notify.ts` (`group.invite.received`, `appointment.created`, `pin_reset.approved`) · `tests/notifications/notifications.test.ts` |
| v1.x LINE + เตือนก่อนนัด | ✅ (R10) | `src/lib/data/services/reminders.ts`, `tests/line/*`, `tests/calendar/reminders.test.ts` |
| v1.x นำเข้า ICS | ⚠ G4 | ทำเฉพาะส่งออก (`src/lib/calendar/ics.ts`, `tests/calendar/ics*.test.ts`) |
| ไม่ทำ: แชท ชำระเงิน native ออฟไลน์ ตำแหน่ง | ⏸ | PRD §6 "ไม่ทำ" · ไม่มี service worker (ARCHITECTURE ข้อ 10) |
| UI_DIRECTION + Anti-slop 4 ชุด | ⏳ | V5 (`docs/design/V1_UI_AUDIT.md` — ux) + V2 (qa) ยังไม่ปิด · e2e ถ่ายภาพ 4 ชุดหลายหน้า (`*-layout.spec.ts`) |
| ปุ่ม ≥ 44px / แป้น PIN ≥ 56px / ไม่ scroll แนวนอน | ✅ | `tests/ui/pinpad.test.ts`, `tests/e2e/*-layout.spec.ts` (checkLayout) |
| Lighthouse ≥ 85 / ≥ 95 | ⚠ G2 | ไม่พบผลวัด |
| สิทธิ์ที่เซิร์ฟเวอร์ / ความลับใน env / ไม่ log PIN/token | ✅ | `tests/security/*.test.ts`, `tests/auth/secrets-exposure.test.ts`, `tests/security/config-hygiene.test.ts` · V3 security-v1 ยังไม่ปิด |
| ต้นทุน ≈ $0 | ✅ | Vercel Hobby + Turso + LINE OA เพดาน 300/เดือน (`LINE_SEND_CAPS`, `tests/line/caps.test.ts`) |

## 5. เกณฑ์รับระดับโปรเจกต์ (PRD §8)
| ข้อ | สถานะ | หลักฐาน |
|---|---|---|
| 1 E2E 375: สมัคร → กลุ่ม → โค้ด → busy → วันว่าง → นัด → RSVP → หน้าหลัก | ✅ (แยก spec) | `tests/e2e/signup.spec.ts` → `groups-story.spec.ts` → `calendar-story.spec.ts` → `free-story.spec.ts` → `appt-story.spec.ts` |
| 2 เมทริกซ์สิทธิ์ครบ | ✅ | ดูหัวข้อ 2 |
| 3 E2E reset PIN + เกิน 24 ชม. | ✅ | `tests/e2e/pin-reset.spec.ts` (TH/EN), `tests/auth/pin-reset-login.test.ts` |
| 4 เกต PROCESS + Anti-slop | ⏳ | V2/V3/V5 ของ R18 |
| 4.1 flow ข้อ 1 ทั้ง TH/EN · ภาพ 3 หน้าหลัก 4 ชุด · เทสต์คีย์ | ⚠ G3 (ส่วน flow) | คีย์: `tests/i18n/messages.test.ts` ✅ · ภาพ 4 ชุด: `appt-layout`/`calendar-layout`/`groups-responsive` ✅ |
| 5 boss ลองมือถือ + iPad | 👤 | V4 (secretary) |

## 6. งานรอบ R18
| ข้อ | สถานะ | โค้ด | เทสต์ / เอกสาร |
|---|---|---|---|
| D1 ลบคำเชิญเก่า 30 วัน + `purgedInvites` | ✅ | `src/lib/data/services/maintenance.ts` (`purgeOldInvites`), `repos/invite-purge.ts` | `tests/platform/r18-invite-purge.test.ts` · ARCHITECTURE ข้อ 8 งาน 6 |
| D2 หมายเหตุกู้คืน (OPERATIONS + กล่องกู้คืน TH/EN) | ✅ | `src/components/admin/RestoreGroupDialog.tsx` | `docs/OPERATIONS.md` K4 · `tests/ui/r17-restore-delete-model.test.ts` (ไม่ได้ตรวจว่าครอบบรรทัดใหม่) |
| D3 ไม่แก้ security-r17 Info 3–4, r16 Info 4 | ⏸ | — | `docs/OPERATIONS.md` K4 · ADR 0015 §4 ส่วนเติม R18 |
| H1 `api:read` 429 ก่อน handler | ✅ | `src/app/api/_lib/route.ts` ขั้น 3½, `src/lib/data/read-limit.ts` | `tests/platform/r18-read-limit-before-handler.test.ts` |
| H2 pre-check ก่อนคิว | ✅ | `src/lib/auth/throttle.ts` (`precheckRates`), `src/lib/data/rate-slots.ts` | `tests/auth/redeem-limits.test.ts` · ADR 0002 §3 |
| H3 `redeem:all` 300/15 นาที | ✅ | `src/lib/data/services/invites.ts` | `tests/auth/redeem-limits.test.ts` · ADR 0002 §3, §8 |
| H4 ปฏิทินแสดง 429 ของ `/api/me/busy` | ✅ | `src/components/calendar/CalendarView.tsx` (`calendar.busyRateLimited`) | `tests/ui/share-render.test.ts` (มีกรณี `busyRateLimited`) |
| H5 e2e `retries: 0` + CI 2 รอบติด | ✅ (config) / ⏳ (CI) | `playwright.config.ts` `retries: 0` | ผล CI 2 รอบยังไม่มี — ดูบน PR |
| H6 render test i18n | ✅ | — | `tests/i18n/render.test.ts` (มีเคสพิสูจน์ว่าจับคีย์ผิด/namespace ผิดได้) |
| H7 picomatch | ⏸ ยอมรับความเสี่ยง | — | `docs/OPERATIONS.md` ภาคผนวก Dependabot (ตรวจซ้ำ 2026-11-20 ไม่มีรุ่นแก้) |
| C1 ยืนยัน "ลบวันนี้" busy/routine + ถอนคำเชิญตรง | ✅ | `BusyFormSheet.tsx`, `RoutineScopeSheet.tsx`, `InviteSection.tsx` | `tests/e2e/r6f-daily-busy.spec.ts`, `r14b-busy-routine.spec.ts`, `r18-share.spec.ts` |
| C2 ทุกปุ่มลบผ่าน | ✅ | — | `docs/design/R17_DELETE_CONFIRM.md` §8.2 (16 แถว "ผ่าน" · แถว 16 ปฏิเสธคำเชิญ = ตัดสินคงเดิม, ux เสนอ main ยกระดับได้) |
| §4 B3 ข้อเสนอที่ไม่มีใครขอ | ⏸ | — | R18_CONTRACT §4 + §9 B3 = (ก) · OPERATIONS K4 (r16 Info 2–3) · ⚠ G5 PRD ยังไม่ติ๊ก |
| S1 สร้างลิงก์ (ของใครของมัน, ซ้ำได้ลิงก์เดิม, hash) | ✅ | `src/lib/data/services/share.ts`, `share-token.ts`, `repos/share-link.ts` | `tests/platform/r18-share.test.ts` (S1), `tests/rbac/share-guests.test.ts`, `tests/auth/share-rate-limits.test.ts` |
| S2 หมดอายุ/ยกเลิก/ผู้สร้างออก | ✅ | 〃 + `services/groups.ts` (`revokeActiveShareLinksCreatedBy`) | `r18-share.test.ts` (S2/S6, S7) |
| S3 หน้า `/i/[token]` (ไม่มีชื่อสมาชิก, noindex, safeNext) | ✅ | `src/app/i/[token]/page.tsx`, `src/components/share/ShareLanding.tsx`, `src/lib/shared/safe-next.ts`, `next.config.ts` (`X-Robots-Tag`) | `r18-share.test.ts` (S3), `tests/ops/headers.test.ts`, `tests/ui/share-render.test.ts`, `tests/e2e/r18-share.spec.ts` |
| S4 เป็นแขก (RSVP, แจ้งเตือน, ออกเอง, ไม่เห็นข้อมูลกลุ่ม) | ✅ | `services/share.ts`, `share-views.ts`, `GuestAppointmentView.tsx` | `r18-share.test.ts` (S4) |
| S5 เพดาน 10 กันแข่ง | ✅ | `repos/share-link.ts` (`insertGuestIfAllowed`) | `r18-share.test.ts` "เพดาน 10: แข่งกัน 2 คน" |
| S6 รายชื่อแขกฝั่งสมาชิก + ลบแขก + audit | ✅ | `GuestsSection.tsx`, `services/share.ts` | `r18-share.test.ts` (S2/S6), `tests/rbac/share-guests.test.ts` |
| S7 วงจรข้อมูล (ลบบัญชี, ลบ/กู้/purge กลุ่ม, ลิงก์ 30 วัน) | ✅ | `repos/account.ts`, `repos/group-purge.ts`, `purgeOldShareLinks` | `r18-share.test.ts` (S7) · ADR 0015 ส่วนเติม R18 |
| S8 migration 0007 เพิ่มอย่างเดียว + rollback | ✅ (โค้ด) / 👤 (รันกับ boss) | `drizzle/0007_r18_appointment_share.sql`, `src/db/schema.ts` | `tests/platform/migration-0007.test.ts` · ADR 0016 §9 · รัน preview/prod กับ boss ยังไม่ได้บันทึก |
| S9 UX TH/EN, /privacy แขก | ✅ (โค้ด) / ⏳ (V2/V5) | `docs/design/R18_SHARE_FLOW.md`, `src/app/privacy/page.tsx` | `tests/e2e/r18-share.spec.ts` (375/390/768 × TH/EN × สว่าง/มืด) |
| V1–V5, §6 เอกสาร | ⏳ | ไฟล์นี้ = V1 · ARCHITECTURE/ADR 0002/0015 อัปเดตแล้ว (architect §6) | qa/security/ux/secretary/ops ยังไม่ปิด |

## ผลรันจริง (2026-11-22, Windows ของ boss)
- `npx vitest run tests/platform/r18-share.test.ts tests/platform/r18-invite-purge.test.ts tests/platform/r18-read-limit-before-handler.test.ts tests/platform/migration-0007.test.ts tests/rbac/share-guests.test.ts tests/rbac/matrix.test.ts tests/auth/redeem-limits.test.ts tests/auth/share-rate-limits.test.ts tests/i18n tests/ui/share-render.test.ts tests/ui/share-model.test.ts tests/platform/manifest.test.ts` → `Test Files 15 passed (15) · Tests 2717 passed (2717)`
- `npx vitest run tests/ops/docs-sync.test.ts` → 8 passed (หลังแก้ ARCHITECTURE)
- ไม่ได้รัน: e2e ทั้งหมด, `npm test` ทั้งชุด (เครื่องนี้มี EPERM/timeout เดิม — ดูผล CI)
