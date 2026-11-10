# Security review — R11 (แจ้งเตือนเหตุการณ์นัด/สมาชิก · LINE ยกเลิกนัด)

- ผู้ตรวจ: Security (อิสระ ไม่ได้เขียนโค้ดนี้) · 2026-11-10 · branch `feat/r11-notification-events` ตรวจครั้งแรก HEAD `01c8b7f` · **ตรวจซ้ำ M1/L1 ที่ `0e0861c`** · ช่วง `origin/main...HEAD` · เทียบ R11_CONTRACT §1, §2, §6, §7 + กฎเหล็ก CLAUDE.md ข้อ 6–8
- วิธี: อ่านโค้ดจริงทุกจุดเรียก `notify` + รันเทสต์ของทีม + เขียนเทสต์ทดลองไว้นอก repo เพื่อยืนยันข้อพบ · ไม่แก้ `src/`/`tests/`/config
- repo เป็น public: ข้อที่ยังไม่แก้เขียนเฉพาะผลกระทบและทิศทางแก้ ขั้นตอนละเอียดส่งให้ main ในแชท
- เครื่อง: Windows (checkout CRLF) · สัญลักษณ์: ✅ = ยืนยันด้วยการรันจริง · 📖 = ยืนยันจากการอ่านโค้ด

## สรุป
| ระดับ | จำนวน |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 (M1 แก้แล้ว) |
| Low | 3 ที่ยังเปิด เข้า backlog ตามที่ main ตัดสิน (Low 2, Low 3, Low 4) · Low 1 แก้แล้ว |
| Info | 7 |

**Verdict (ตรวจซ้ำ `0e0861c`): ผ่านแบบมีข้อสังเกต** — M1 และ L1 ปิดแล้ว เพดานทำงานจริงและการกลับเข้ากลุ่มของผู้ก่อเหตุไม่ทำให้เพดานรีเซ็ต · ไม่พบการรั่วข้ามกลุ่ม ผู้รับถูกต้องทุกจุด ชื่อคนถูกล้างตอนลบบัญชี ไม่มีความลับใน log/params/repo และเพดาน LINE ใช้ร่วมกันทุกเส้นทาง · ข้อที่เหลือไม่บล็อกการ merge

## ผลต่อเกต
| เกต | ผล | หลักฐาน |
|---|---|---|
| **1. ผู้รับ + ไม่แจ้งผู้กระทำ** (R11-1) | **PASS** | 📖 ทุกจุดกรอง `me.id`: `appointments.ts:595,631,668` · `groups.ts:195,229,267-268,301` · `invites.ts:246,320` · ผู้รับมาจาก `group_member` + `status='active'` ในธุรกรรมเดียวกัน (`group-member.ts` `listActiveMemberIds`, `reminder.ts` `listReminderAudience`) ไม่รับรายชื่อจาก client · ✅ `tests/notifications/r11-events.test.ts` |
| **2. คนนอกกลุ่มไม่ได้แถว / `visibleToOwner`** | **PASS** | 📖 `notification.ts:92-95` ซ่อน `appointment.*` และ `group.member.joined/left/role_changed` เมื่อไม่เป็นสมาชิก กลุ่มถูกลบ หรือเกิดก่อน `joined_at` ปัจจุบัน · `removed` เห็นเสมอตามเจตนา · ✅ เทสต์ออกกลุ่ม/ถูกนำออก/กลุ่มถูกลบ/กลับเข้ากลุ่ม |
| **3. params: ตัดคีย์ภายในจาก API** | **PASS** | 📖 ทางออกเดียวคือ `toDto` → `publicParams` (`services/notifications.ts:53`) · `listNotificationsOfUser` ไม่มีผู้เรียก · ✅ ทดลองอ่าน API จริง: params ไม่มี `actorId` · เทสต์ `responderId`/`memberId` |
| **4. เทสต์ NEVER/ALLOW** | **PASS** | ✅ diff เพิ่มเฉพาะแถว ALLOW ของ 7 ชนิดใหม่ · regex `NEVER` ไม่เปลี่ยน |
| **5. `removed` ไม่บอกผู้นำออก** | **PASS** | 📖 params มีแค่ `groupId, groupName` (`groups.ts:195-200`) · ข้อความ TH/EN ไม่มีชื่อ |
| **6. ล้างชื่อตอนลบบัญชี** (R11-7) | **PASS** | 📖 `account.ts:108-119` ล้าง `actorName/responderName/memberName` และลบ id ภายใน ผูกด้วย id จึงครอบชื่อเก่าก่อนเปลี่ยนชื่อ · ทางลบบัญชีมีทางเดียว (`services/account.ts:103-104`) · payload outbox ไม่มีชื่อคน · ✅ เทสต์ R11-7 |
| **7. แทนที่รายการที่ยังไม่อ่าน** | **PASS (Info 4)** | 📖 `notification.ts:72-85` ลบเฉพาะ `user_id` ในรายชื่อผู้รับ + `kind` + `appointmentId` (+ `responderId`) ค่าทั้งหมดมาจากแถวฝั่ง server · ชนิดที่แทนที่ไม่มีแถว outbox · กระทบแถวของคนอื่นหรือกลุ่มอื่นไม่ได้ · ✅ เทสต์ R11-3 |
| **8. ผู้รับ LINE ยกเลิกนัด** (R11-4) | **PASS** | 📖 `lineUserIds` = ตอบ going ไม่รวมผู้กระทำ (`appointments.ts:628-630`) ∩ ผ่านเพดานกระดิ่ง ∩ active + เชื่อม LINE (`notify.ts:165-178`) · บังคับระบุทั้งชนิดข้อมูลและตอนรัน · ✅ เทสต์ |
| **9. ตรวจซ้ำก่อนส่ง** (R11-5) | **PASS** | 📖 `dispatch.ts:81-92` นัด cancelled · startAt ตรง · startAt > now · กลุ่มอยู่ · ผู้รับ active + เชื่อม + ยังตอบ going ผ่านเงื่อนไขสมาชิกปัจจุบัน · reminder คงเกณฑ์เดิม · ✅ เทสต์ STALE ครบทุกเงื่อนไข |
| **10. เนื้อหา LINE** | **PASS (Low 4)** | 📖 `messages.ts` + `line.message.cancelled` มีแค่ชื่อนัด เวลา กลุ่ม ลิงก์ · `LINE_PAYLOAD_OMIT` ตัด `actorName/actorId` ก่อนเข้า outbox · ✅ เทสต์เนื้อความ/payload · `/privacy` TH/EN ตรง |
| **11. เพดาน/โควตา + เส้นทาง `after()`** | **PASS (Low 3)** | 📖 `after()` เรียก `dispatchLineOutbox` ตัวเดียวกับ cron จึงผ่าน `claimOutboxRow` + เช็กโควตาเดือนเดียวกัน · จองแถวและ retry key กันส่งซ้ำ · ✅ ทดลองวนสร้าง→ตอบไป→ยกเลิก 14 รอบ: push 6 ครั้ง · `LINE_CAP` 8 แถว |
| **12. `dispatch-after` ถูกเรียกเองไม่ได้** | **PASS** | 📖 จุดเรียกเดียวหลัง commit (`appointments.ts:646`) ต้องยกเลิกสำเร็จจริง (`cancelAppointmentGuarded` รับเฉพาะ `status='active'` ยกเลิกซ้ำ = error) · scope เฉพาะนัด+ชนิดนี้ |
| **13. log / ความล้มเหลว `after()`** | **PASS** | 📖 ลงทะเบียนและ callback ถูกครอบ try/catch · log แค่ชื่อชนิด error และจำนวน (`dispatch-after.ts:25`, `dispatch.ts:116,144`) · ✅ เทสต์ after ล้มไม่กระทบ API |
| **14. Transaction** (R11-6) | **PASS** | 📖 ทุก `notify` อยู่ใน `inTx` เดียวกับการกระทำ · `after` หลัง commit เท่านั้น · ✅ เทสต์ล้มกลางทาง = ไม่มีสถานะครึ่งทางครบทุก action |
| **15. กันกระดิ่งรก** | **PASS (ตรวจซ้ำ `0e0861c` · Info 6, 7)** | ✅ `updated`/`rsvp_changed` แทนที่จริง · `cancelled`, `joined`, `left`, `role_changed` มีเพดาน unread ต่อผู้รับต่อกลุ่มต่อชนิด (`notify.ts:130`, `notification.ts:141`) · ดูผลทดลองในหัวข้อตรวจซ้ำ |
| **16. ความลับ** (R11-9) | **PASS** | ✅ grep diff และ `git log -p` ช่วงนี้หา token/LINE id/อีเมลส่วนตัว: ไม่พบ · `FORBIDDEN_PARAM_KEY` ยังบังคับ · ไม่มี migration · `.env*` ถูก ignore |
| **17. สิทธิ์ที่เซิร์ฟเวอร์** | **PASS** | 📖 ทุก action ยังผ่าน `authorize` เดิมก่อน `notify` · RSVP/ยกเลิกไม่เพิ่มช่องทางใหม่ |

## Findings

### Medium 1 — แก้แล้วใน `0e0861c` (เดิม: แจ้งเตือนเข้า/ออกกลุ่มไม่มีเพดานหรือ limiter ทำกระดิ่ง admin/moderator ท่วมได้)
- สถานะ: **ปิด** · `joined`/`left` ใช้เพดาน unread ต่อผู้รับต่อกลุ่มต่อชนิด 20 แถว · ✅ ตรวจซ้ำแล้ว ดูหัวข้อตรวจซ้ำ · ส่วนที่เหลือดู Info 6, 7
- ที่ (ตอนตรวจครั้งแรก): 📖 `src/lib/data/services/invites.ts:50` (redeem นับเฉพาะครั้งที่ผิด) · `:246` · `src/lib/data/services/groups.ts:301` (ออกกลุ่มไม่มี limiter) · `src/lib/data/notifications/notify.ts:130` (เพดานครอบแค่ `created`/`cancelled`)
- ผล: ผู้ถือโค้ดเชิญที่ยังใช้ได้ทำให้เกิดแถว unread ไม่จำกัดในกระดิ่งของ admin และ moderator ทุกคนของกลุ่ม ✅ ทดลองแล้วได้แถวเพิ่มตามจำนวนครั้งโดยไม่ถูกจำกัด (40 รอบ = 80 แถว) · บังการแจ้งเตือนจริงและเพิ่มแถวในฐาน (เก็บ 90 วัน) · admin หยุดได้ด้วยการเพิกถอนโค้ด แต่ต้องรู้ตัวก่อน
- ไม่ผิด contract เพราะ §1 กำหนดว่าชนิดอื่นไม่รวมรายการ ต้องให้ main ตัดสินแก้ contract
- ทิศทางแก้: เพดาน unread ต่อกลุ่มต่อชนิดแบบเดียวกับ `cancelled` หรือรวมรายการต่อ `memberId` และ/หรือ limiter ต่อผู้ใช้ที่นับการเข้า/ออกที่สำเร็จ

### Low 1 — แก้แล้วใน `0e0861c` (เดิม: `role_changed` ไม่มีเพดานหรือ limiter)
- สถานะ: **ปิด** · ใช้เพดานเดียวกับ Medium 1 · ✅ ตรวจซ้ำแล้ว
- ที่ (ตอนตรวจครั้งแรก): 📖 `src/lib/data/services/groups.ts:229` · ✅ สลับ role 40 ครั้ง = unread 40 แถว
- ทำได้เฉพาะ admin ของกลุ่มหรือ super admin และเป้าหมายออกจากกลุ่มได้ จึงเป็น Low · แก้พร้อม Medium 1 ได้

### Low 2 — ชื่อของ super admin ที่ไม่ได้เป็นสมาชิกถูกแสดงในกระดิ่งของกลุ่ม (เข้า backlog ตามที่ main ตัดสิน)
- ที่: 📖 `src/lib/data/services/appointments.ts:452,600,637` · ✅ super admin ยกเลิกนัด: `cancelledBy` ใน API เป็น `null` แต่กระดิ่งของสมาชิกมี `actorName` เป็นชื่อ super admin
- API นัดตั้งใจไม่เปิดชื่อคนนอกกลุ่ม กระดิ่งจึงไม่สอดคล้อง · contract ไม่ได้ระบุ เสนอใช้ `actorName` ว่างหรือข้อความกลางเมื่อผู้กระทำไม่ใช่สมาชิก

### Low 3 (ยกมาจาก R10) — ยังไม่มีเพดานรวมของ OA (เข้า backlog ตามที่ main ตัดสิน)
- ที่: 📖 `claimOutboxRow` `src/lib/data/repos/line.ts:127` (เงื่อนไขนับเพดานเริ่มที่ `:134`) · `LINE_SEND_CAPS.perUser = 6` · **แก้การอ้างอิง:** รายงานครั้งแรกอ้าง `line.ts:121` ซึ่งเป็นเลขบรรทัดของโค้ดตอน R10
- R11 **ไม่ได้เพิ่มเพดานสูงสุด** ข้อความยกเลิกนับในเพดานเดิมของผู้รับ และผู้รับต้องตอบ "ไป" และเชื่อม LINE เอง · สิ่งที่เปลี่ยนคือส่งทันที จึงใช้เวลาน้อยลงเพราะไม่ต้องรอหน้าต่างเตือนนัด · คงระดับ Low · กลุ่ม 50 คนที่เชื่อม LINE ครบใช้ได้สูงสุดราว 294 ข้อความต่อวันตามทฤษฎี เทียบโควตา 300 ต่อเดือน · ทิศทางแก้ยังเป็น backlog เดิม: เพดานรวมต่อวันของ OA และแจ้ง boss เมื่อใกล้โควตา

### Low 4 (ยกมาจาก R10 Low 1) — ชื่อนัด/ชื่อกลุ่มเป็นข้อความอิสระที่ออกจาก OA (เข้า backlog ตามที่ main ตัดสิน)
- ข้อความยกเลิกนัดใช้ค่าเดียวกัน ผู้รับเป็นคนในกลุ่มที่ตอบ "ไป" แล้ว · ไม่เปลี่ยนระดับ

### Info
1. **เพดาน unread ของ `cancelled` ทำให้การแจ้งจริงถูกข้ามได้** — ตรงตาม contract · ถ้ามี unread ครบ 20 คนนั้นไม่ได้ทั้งกระดิ่งและ LINE · จำกัดด้วยเพดานสร้าง 30 นัด/กลุ่ม/วัน
2. **เพดาน `perUser` ใช้ร่วมกับ reminder** — ต่อจาก R10 Info 7 · ข้อความยกเลิกนับรวมด้วย
3. **คอมเมนต์เก่าในเทสต์** — `tests/notifications/notifications.test.ts:155` ที่ `0e0861c` ยังบอกว่า `group.member.*` ไม่ผูกการซ่อนตามกลุ่ม ซึ่งไม่จริงหลัง `01c8b7f` · ตอนตรวจซ้ำมีการแก้คอมเมนต์นี้ค้างใน working tree (ยังไม่ commit ไม่ใช่งานของ security) · การซ่อนจริงมีเทสต์ใน `r11-events.test.ts`
4. **แถวที่ซ่อนจากสมาชิกภาพรอบก่อนถูกนำมารวม `changes`** — ผู้ที่กลับเข้ากลุ่มเห็น `both` จากเหตุการณ์ก่อนเข้าใหม่ได้ · เป็นแถวของตัวเอง ไม่รั่วข้ามคน ผลน้อยมาก
5. **`after()` ใช้ budget 20 วินาที** — ถ้า function ถูกหยุดกลางทาง แถวยัง pending ให้ cron ลองต่อด้วย retry key เดิม · ไม่พบ `maxDuration` ที่ตั้งเฉพาะ · ตรวจระยะเวลาจริงได้หลัง deploy
6. **เพดานบังเหตุการณ์จริงได้** — เมื่อ unread ของชนิดนั้นครบ 20 แถว การเข้า/ออก/เปลี่ยน role ครั้งถัดไปไม่ขึ้นกระดิ่งจนกว่าผู้รับจะอ่าน · การกระทำยังสำเร็จและดูสมาชิกได้จากหน้ากลุ่ม · เป็นผลที่ยอมรับได้ของการมีเพดาน
7. **เพดานจำกัดแถวแจ้งเตือน ไม่ได้จำกัดการกระทำ** — การเข้า/ออกกลุ่มซ้ำยังไม่มี limiter และยังเขียน audit ทุกครั้ง (มีมาก่อน R11) · ผู้รับที่ออกแล้วกลับเข้ากลุ่มเองได้เพดานใหม่ตามเจตนา แถวรอบก่อนถูกซ่อนและเก็บไม่เกิน 90 วัน · คอมเมนต์เหนือ `usersUnderUnreadCap` ยังอ้างว่า limiter ช่วยจำกัดการแข่งกัน ซึ่งไม่ตรงกับชนิดสมาชิก · 📖 เส้นทางเข้า/ออกกลุ่มเขียนแถวสมาชิกก่อนนับเพดานในธุรกรรมเดียวกัน · ไม่ได้ทดสอบแข่งข้าม instance จริง

## ตรวจซ้ำ M1/L1 ที่ `0e0861c`
| ประเด็น | ผล | หลักฐาน |
|---|---|---|
| เพดาน `joined`/`left` | **PASS** | ✅ 40 รอบ คำขอสำเร็จ 80 ครั้ง · admin และ moderator ได้ `joined` 20 + `left` 20 (เดิม 80) |
| เพดาน `role_changed` | **PASS** | ✅ สลับ 40 ครั้งสำเร็จ · เป้าหมาย unread 20 (เดิม 40) |
| ผู้ก่อเหตุกลับเข้ากลุ่มซ้ำ | **PASS** | ✅ เพดานนับที่ผู้รับ ไม่ได้นับที่ผู้กระทำ การกลับเข้าซ้ำจึงไม่รีเซ็ต · ใช้ 2 บัญชีสลับกัน 30 รอบ: admin ยังได้ 20 + 20 |
| ผู้รับกลับเข้ากลุ่ม | **PASS (Info 7)** | ✅ moderator ออกแล้วกลับเข้า เวลาใหม่กว่า: แถวรอบก่อนถูกซ่อนและไม่นับ · หลังวนต่อเห็น `joined` 20 + `left` 20 + `role_changed` 1 = 41 · ในฐานมี 40 + 40 + 1 · admin ที่ไม่ได้ออกยังอยู่ที่ 20 + 20 · ผู้ก่อเหตุทำให้ผู้รับกลับเข้ากลุ่มเองไม่ได้ |
| กลับเข้ากลุ่มในเวลาเดียวกัน | **PASS** | ✅ `created_at >= joined_at` ทำให้แถวยังนับ · ไม่ได้เพดานใหม่ · `joined` 20 + `left` 20 |
| อ่านแล้วคืนที่ว่าง | **PASS** | ✅ admin อ่านทั้งหมดแล้ววนต่อ: unread กลับมา 20 + 20 · moderator ที่ไม่ได้อ่านไม่ได้เพิ่ม |
| ขอบเขตการแก้ | **PASS** | 📖 แก้เฉพาะชุดชนิดที่มีเพดาน · `removed` ไม่มีเพดานตามเดิม เพราะต้องกลับเข้ากลุ่มก่อนจึงถูกนำออกซ้ำได้ · ไม่แตะ params ผู้รับ และ LINE |

## คำสั่งที่รัน + ผลจริง
```
ตรวจซ้ำที่ 0e0861c:
npx vitest run (ชุดเดียวกับตรวจครั้งแรก · config/setup นอก repo)
  → Test Files 1 failed | 24 passed (25) · Tests 2 failed | 2904 passed | 1 skipped (2907)
  → ที่ล้ม 2 ข้อคือ config-hygiene permissions ของ ci.yml/keepalive.yml (ปัญหา CRLF เดิม)
  → working tree มีการแก้คอมเมนต์ค้าง 1 บรรทัดใน tests/notifications/notifications.test.ts (ไม่กระทบผลเทสต์)
เทสต์ทดลองนอก repo: 10/10 รันจบ
  → เข้า/ออกกลุ่ม 40 รอบ: 200 ทั้ง 80 คำขอ · admin unread 40 (joined 20 + left 20)
  → สลับ role 40 ครั้ง: 200 ทั้ง 40 · เป้าหมาย unread 20
  → 2 บัญชีสลับกัน 30 รอบ: admin unread 40
  → moderator กลับเข้ากลุ่ม (เวลาใหม่กว่า): ก่อน 40 · หลังกลับเข้า 1 · หลังวนต่อ 41 · ในฐาน joined 40 + left 40 + role_changed 1 · admin unread 40
  → moderator กลับเข้ากลุ่ม (เวลาเดียวกัน): unread 41 · joined 20 + left 20 + role_changed 1
  → admin อ่านทั้งหมดแล้ววนต่อ: unread 40 · ในฐาน joined 40 + left 40 · moderator unread 40
  → ซ้ำเทสต์เดิม: super admin actorName ยังแสดง (Low 2) · LINE 14 รอบ push 6 · LINE_CAP 8

ตรวจครั้งแรกที่ 01c8b7f:
npx vitest run tests/notifications tests/line tests/security tests/rbac tests/appointments/r4b-hardening.test.ts
  tests/ui/notifications-model-r11.test.ts tests/ui/notifications-model.test.ts tests/auth/display-name-rules.test.ts
  (config/setup นอก repo: กลืน EPERM ของ rmSync ตอน cleanup)
  → Test Files 1 failed | 24 passed (25) · Tests 2 failed | 2894 passed | 1 skipped (2897)
  → ที่ล้ม 2 ข้อคือ config-hygiene permissions ของ ci.yml/keepalive.yml (ปัญหา CRLF เดิม)

เทสต์ทดลองนอก repo: 4/4 รันจบ
  → เข้า/ออกกลุ่ม 40 รอบ: ตอบ 200 ทั้ง 80 คำขอ · admin unread 80 (joined 40 + left 40)
  → สลับ role 40 ครั้ง: 200 ทั้ง 40 · เป้าหมาย unread 40
  → super admin ยกเลิกนัด: cancelledBy = null · params ใน API มี actorName = ชื่อ super admin · ไม่มี actorId
  → สร้าง→ตอบไป→ยกเลิก 14 รอบ: ยกเลิกสำเร็จ 14 · push 6 · sent 6 · dead LINE_CAP 8

git diff / git log -p origin/main..HEAD | grep (token/LINE id/อีเมลส่วนตัว) → ไม่พบ
git grep รูปแบบอีเมลส่วนตัวและ LINE user id ใน src docs messages → ไม่พบ
git check-ignore .env .env.local → ถูก ignore ทั้งคู่
```

## สิ่งที่ตรวจไม่ได้ในรอบนี้
- e2e (`tests/e2e/r11-notifications.spec.ts`) ไม่ได้รันบนเครื่องนี้ · ผลจริงดูจาก CI
- LINE จริงและ `after()` บน Vercel (R11-12) · ตรวจได้หลัง deploy เท่านั้น
- `npm test` ทั้งชุดบน Windows ไม่ได้รัน (ปัญหา EPERM/timeout เดิม)
