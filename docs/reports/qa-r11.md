# QA R11 — ตรวจอิสระ (แจ้งเตือนเหตุการณ์นัดและสมาชิก + LINE ยกเลิกนัด)

branch `feat/r11-notification-events` · ผู้ตรวจ: qa · ไม่เชื่อใบรับรองผู้ทำ รันซ้ำเองทั้งหมด

## Verdict: ผ่านแบบมีข้อสังเกต
พบ e2e เดิม 2 ข้อที่ล้มจริง (สมมติฐานเก่า "ผู้สร้างนัดไม่มีแจ้งเตือน" ซึ่ง R11 เปลี่ยนโดยตั้งใจ) — แก้แล้วในคอมมิต `qa:` และรันผ่าน · โค้ดตาม contract ครบ ไม่พบบั๊กในโค้ดผลิตภัณฑ์

## เกณฑ์
| # | ผล | หลักฐาน |
|---|---|---|
| R11-1 ผู้รับ | ผ่าน | อ่านโค้ด services (appointments/groups/invites) + `listActiveMemberIds` (สมาชิกปัจจุบัน + บัญชี active) · r11-events.test.ts ผ่าน |
| R11-2 ไม่แจ้ง | ผ่าน | หลัง startAt, แก้ชื่อ/รายละเอียด, ตอบซ้ำ, ผู้สร้างตอบเอง, ผู้สร้างออก/ไม่ active, เข้าซ้ำ — มีเทสต์ทุกข้อ · `appointmentChanges` เทียบแถวทั้งก่อน/หลังแก้ (placeName/lat/lng/mapUrl ตัวไหนเปลี่ยนก็นับ, เวลาเทียบ start/end) |
| R11-3 แทนที่ unread | ผ่าน | `deleteUnreadEventRows` + `mergeChanges` (time+place=both) · อ่านแล้ว=แถวใหม่ · cancelled นับเพดานแยกจาก created |
| R11-4 LINE ยกเลิก | ผ่าน | `notify` บังคับ `lineUserIds` (เฉพาะตอบ "ไป") · `after()` scope เฉพาะนัด+ชนิด · claim แถว+retry key เดิม · เทสต์ after+cron ไม่ซ้ำ/ลองต่อ |
| R11-5 ตรวจซ้ำ+reminder | ผ่าน | `stillSendable`: reminder คงเกณฑ์เดิม (active + minLead) · cancelled: status cancelled + startAt>now · เทสต์ STALE ครบ + reminder regression |
| R11-6 transaction | ผ่าน | เรียก notify ใน inTx ทุกจุด · เทสต์ rollback |
| R11-7 ลบบัญชี | ผ่าน | `purgeDeletedUserFootprint` ล้างชื่อ+ลบ id ภายใน · `publicParams` ตัดคีย์ภายในก่อนออก API · payload LINE ตัด actorName/actorId |
| R11-8 กระดิ่ง | ผ่าน | e2e r11-notifications 375/390/768 × th/en × สว่าง/มืด ผ่านทั้งหมด · ดูภาพจริง 375 สว่าง, 768 มืด: ไอคอนชุดเดียวกัน ไม่มีไล่สี/อีโมจิ คอนทราสต์พอ ไม่ล้นแนวนอน ชื่อยาวสุดถูกตัด `…` ที่ 3 บรรทัด (ยอมรับได้) |
| ซ่อนกิจกรรมหลังออก/ลบกลุ่ม | ผ่าน | `visibleToOwner` ซ่อน joined/left/role_changed · removed เห็นเสมอ · มีเทสต์ |
| R11-10 เอกสาร | ผ่าน | README, quickstart, messages (hint/privacy/empty) ตรงกับพฤติกรรม: ยกเลิก=ไป/อาจไป/ยังไม่ตอบ · LINE เฉพาะ "ไป" · เลื่อนไม่ส่ง LINE · ผลคำเชิญ/รีเซ็ต PIN ครบ (grep, ไม่อ่าน base64) |
| R11-11 CI | ตรวจในเครื่องไม่ได้ | ดูจาก CI |

## ข้อพบ (เรียงความรุนแรง)
1. **กลาง — e2e เดิม 2 ข้อล้ม (CI จะแดง)**: `tests/e2e/appt-story.spec.ts:98` และ `tests/e2e/appt-validation.spec.ts:185` คาดว่ากระดิ่งผู้สร้างนัด = 0 แต่ตอนนี้ผู้สร้าง/admin ได้ "คนเข้ากลุ่ม" (+ "ตอบนัด") ตาม R11 · ผู้ทำ R11 ไม่ได้อัปเดต · **แก้แล้ว**: story คาด 2 รายการ (B,C เข้ากลุ่ม) และไม่มีรายการของนัด · smoke คาด 2 (เข้ากลุ่ม 1 + ตอบ 1 — ตอบ 2 ครั้งแทนที่เดิม จึงยืนยัน replace-unread ด้วย) · รันซ้ำ mobile-390 ผ่าน 2/2, tsc/eslint ผ่าน
2. ต่ำ — ข้อความชื่อ/ชื่อนัดยาวสุดที่ไม่มีช่องว่างถูกตัดก่อนถึงเวลา/ชื่อกลุ่มในแถวแจ้งเตือน (จำกัด 3 บรรทัดตามดีไซน์เดิม) ไม่ใช่บั๊ก
3. หมายเหตุเครื่องมือ: `vt.cjs` นับเทสต์ที่ skip เป็น REAL FAIL (เจอ 1 รายการ: appointment-input-isolation "สำรอง…" ซึ่ง skipIf โดยตั้งใจ)

## คำสั่งที่รันจริง
- `npx tsc --noEmit` → exit 0 · `npx eslint src tests --ignore-pattern ".claude/**"` → exit 0 · `npm run build` → สำเร็จ
- Vitest ทั้งชุด (vt.cjs): pass 3916 · EPERM-only 1095 · "real" 58 แยกเป็น: ~30 timeout 5s/10s (เครื่องโหลดเพราะรัน build พร้อมกัน) · machine-only: Python ไม่มี (oracle), `.bin/tsx` ENOENT (release), keepalive.sh/admin-reset-pin/pepper-fingerprint/manual-delete-sql (subprocess/shell ของเครื่อง), health Node v26 ไม่ใช่ v24, config-hygiene CRLF ×2 · 1 skip ที่นับผิด
- รันซ้ำเฉพาะส่วนที่เกี่ยว R11 แบบ `--no-file-parallelism` (tests/notifications, line, ui, appointments, groups, account + ไฟล์ที่ diff แตะ): pass 560 · EPERM-only 460 · assertion fail 0 · timeout 0
- Playwright เต็มชุด `--workers=4 --output=C:/pw/oqa11` (รอบแรก 10 workers ทำเครื่องล้นจึงยกเลิก): 796 passed · 126 skipped · 2 failed (ข้อพบ 1) · หลังแก้รันซ้ำ 2 ข้อนั้นผ่าน

## ตรวจไม่ได้
CI/Vercel preview · e2e บน Linux · Vitest timeout ที่ไม่เกี่ยว R11 (admin/auth/ops ฯลฯ) ไม่ได้รันแยกซ้ำทีละไฟล์ · ส่ง LINE จริง (R11-12 ให้ boss) · `after()` ใน request scope จริงตรวจจากโค้ด/เทสต์เท่านั้น
