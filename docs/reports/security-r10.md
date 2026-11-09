# Security review — R10 (เตือนก่อนนัดทาง LINE OA + กระดิ่ง · เชื่อมบัญชี LINE · webhook · `/api/cron/reminders`)

- ผู้ตรวจ: Security (อิสระ ไม่ได้เขียนโค้ดนี้) · 2026-11-09 · branch `feat/r10-line-reminders` ตรวจครั้งแรก HEAD `c696f19` · **ตรวจซ้ำหลังแก้ HEAD `73d85ac`** · ช่วง `main...HEAD` · เทียบ R10_CONTRACT §1.4, §1.5, §2, §4, R10-6/R10-7 + ADR 0011 + กฎเหล็ก CLAUDE.md ข้อ 6–8
- วิธี: อ่านโค้ดจริงทุกไฟล์ที่เกี่ยว + รันเทสต์ของทีมเอง + เขียนเทสต์ทดลองไว้นอก repo เพื่อยืนยันข้อพบ · ไม่แก้ `src/`/`tests/`/config
- repo เป็น public: ข้อที่ยังไม่แก้เขียนเฉพาะผลกระทบและทิศทางแก้ ขั้นตอนละเอียดส่งให้ main ในแชทแล้ว
- เครื่อง: Windows (checkout CRLF) · สัญลักษณ์: ✅ = ยืนยันด้วยการรันจริง · 📖 = ยืนยันจากการอ่านโค้ด

## สรุป
| ระดับ | จำนวน |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 (M1 แก้แล้ว เหลือความเสี่ยงระดับ Low 3) |
| Low | 2 (Low 1 รับเป็น backlog · Low 3 ใหม่) · Low 2 แก้แล้ว |
| Info | 7 ที่ยังเปิด · Info 6 แก้แล้ว |

**Verdict (ตรวจซ้ำ `73d85ac`): ผ่านแบบมีข้อสังเกต** — ไม่พบช่องที่อ่านข้อมูลข้ามกลุ่ม ยึดบัญชี หรือปลอม webhook · R10-6/R10-7 ผ่าน · เพดาน LINE อะตอมมิกและทำงานจริง ลดความเสี่ยงโควตาจาก Medium เหลือ Low · ข้อที่เหลือไม่บล็อกการ merge

## Verdict ต่อเกต
| เกต | ผล | หลักฐาน |
|---|---|---|
| **1. ลายเซ็น webhook** | **PASS** | 📖 `webhook.ts:106-107` อ่าน raw body แล้วตรวจก่อน parse · `signature.ts:12` HMAC-SHA256 + `timingSafeEqual` บน digest (ไม่รั่วความยาว) · ไม่มี env = 401 แบบเดียวกับลายเซ็นผิด ไม่รั่วว่าตั้งค่าหรือยัง · ✅ `tests/line/webhook.test.ts` |
| **2. payload ผิดรูป / ขนาด** | **PASS** | 📖 body จำกัด 256 KB ทั้ง header และ stream (`webhook.ts:35-55`) · JSON/รูปผิดหลังลายเซ็นผ่าน = 400 · event ผิดรูปข้ามทีละตัว · รับเฉพาะ `source.type='user'` + รูป userId ถูก (`:99`) · ตัดความยาวก่อน normalize (`link-code.ts:17`) ไม่มี ReDoS · body เกินตอบ 400 ก่อนตรวจลายเซ็น ไม่เปิดเผยอะไร |
| **3. ผลต่อ handler อื่น** | **PASS** | 📖 CSRF บังคับเฉพาะ `auth='actor'` (`route.ts:252`) webhook เป็น `public` + action null จึงไม่ติด CSRF และไม่แนบ Server-Timing · แยก `readRawBody` ของตัวเอง ไม่แตะ `readJsonBody`/เพดาน 64 KB เดิม · ไม่มี middleware ที่ root |
| **4. โค้ดเชื่อม** | **PASS** | 📖 CSPRNG + rejection sampling (`id.ts:22`) 8 ตัวจาก 31 ตัว ≈ 39.6 บิต · เก็บ HMAC ด้วยคีย์ HKDF แยก info (`link-code.ts:33`) · อายุ 10 นาที · UPDATE เดียว (ยังไม่ใช้ + ยังไม่หมดอายุ) ใน transaction เดียวกับการผูก (`repos/line.ts:29`, `webhook.ts:70`) · ✅ เทสต์ใช้ซ้ำ/หมดอายุ/เดา |
| **5. rate limit** | **PASS** | 📖 สร้าง 10/ชม./ผู้ใช้ · ลอง 10/10 นาที/บัญชี LINE นับก่อนตรวจโค้ด คีย์เป็น HMAC ไม่เก็บ LINE id ดิบ (`webhook.ts:84`) · เกินเพดานตอบข้อความเดียวกับโค้ดผิด · ✅ เทสต์ · ปริภูมิโค้ด ~8.5×10¹¹ เทียบกับ 1,440 ครั้ง/วัน/บัญชี = เดาไม่ได้จริง |
| **6. แย่งผูก / 1:1** | **PASS** | 📖 ผูกเมื่อบัญชี active ยังไม่ผูก และ LINE นี้ไม่ถูกผูกกับใคร ในคำสั่งเดียว + unique index เป็นด่านสุดท้าย (`repos/line.ts:39`, `schema.ts:29`) · ชนกัน = ปฏิเสธ ไม่เขียนทับ · ✅ เทสต์ |
| **7. ลบบัญชี / unfollow / ยกเลิก** | **PASS (Info 8)** | 📖 ลบบัญชี: `line_user_id = NULL` (`repos/account.ts:66`) + ลบ outbox + โค้ด (`:112-113`) · unfollow/ยกเลิก: ล้างการผูก + คิว pending · ✅ ทดลองลบบัญชี: `line_user_id` เป็น null, outbox 0, status `deleted` · OPERATIONS I3 ครบ |
| **8. `/api/me/line`** | **PASS** | ✅ ไม่ล็อกอิน 401 · Origin ผิด 403 `CSRF_REJECTED` · ระงับ = `ACCOUNT_SUSPENDED` · ต้องเปลี่ยน PIN = `PIN_CHANGE_REQUIRED` · userId มาจาก session เท่านั้น · 📖 ตอบ `private, no-store` · ไม่ส่ง LINE id ออก API |
| **9. `self.read`/`self.update`** | **PASS** | 📖 เป็นข้อมูลของตัวเองเสมอ ไม่รับ id จากผู้เรียก · ไม่อยู่ใน `PIN_CHANGE_ALLOWED` จึงถูกกันช่วงต้องเปลี่ยน PIN (`actions.ts:96`) · ใช้กับ `PATCH /api/me` อยู่แล้ว ไม่ต้องเพิ่ม action ใหม่ |
| **10. `/api/cron/reminders`** | **PASS** | 📖 Bearer ก่อนทุกอย่าง (`route.ts:245-248`) เทียบ constant-time (`cron-auth.ts`) `auth='cron'` ทั้ง GET/POST · ตอบแค่ตัวเลข · ✅ เทสต์ไม่มี/ผิด Bearer = 401, รันซ้ำ/พร้อมกันไม่ส่งซ้ำ (PK + จองแถว outbox + retry key) |
| **11. ข้อมูลออก LINE (§1.4)** | **PASS (Low 1)** | 📖 `messages.ts:28-33` ส่งแค่ชื่อนัด วันเวลา ชื่อกลุ่ม ลิงก์ · ลิงก์เปิดข้อมูลไม่ได้เองต้องมี session + สมาชิก · `/privacy` บอกครบ TH/EN · ✅ เทสต์เนื้อหาข้อความ |
| **12. ผู้รับ / ไม่รั่วข้ามกลุ่ม** | **PASS** | 📖 ผู้รับอ่านจาก `group_member` + `status='active'` + กติกา `updated_at >= joined_at` · ตรวจซ้ำตอนส่ง: นัด active, startAt ตรง, กลุ่มยังอยู่, ผู้รับ active + ยังผูก + ยังตอบ going (`dispatch.ts:70-77`) · ✅ เทสต์ ออกกลุ่ม/ยกเลิก/เลื่อน/เปลี่ยนใจ = ไม่ส่ง |
| **13. `rsvp_nudge`** | **PASS** | 📖 กันสองชั้น: `LINE_KINDS` ใน `notify` และ `parsePayload` ของ dispatcher · ✅ เทสต์ไม่เข้า outbox |
| **14. retention** | **PASS (Info 5)** | 📖 `sent`/`dead` เกิน 90 วันลบ · โค้ดเชื่อมลบหลัง 1 วัน · `runDailyMaintenance` รันทุก statement อัตโนมัติ · ✅ เทสต์ |
| **15. ความลับ (R10-7)** | **PASS** | ✅ grep diff หา token/LINE id/อีเมล: พบเฉพาะค่าทดสอบ · `.env.example` ค่าว่าง · `.env*` ถูก ignore · 📖 log มีแค่ชื่อชนิด error และจำนวน · `last_error` เป็นรหัสล้วน (ไม่เก็บ body จาก LINE) · reply/push ไม่ log · ลิงก์เพิ่มเพื่อนเป็นค่าสาธารณะตาม contract |
| **16. `/me` ฝั่ง client** | **PASS** | 📖 โค้ดอยู่ใน state เท่านั้น ไม่ลง URL/storage/log · `addFriendUrl` ค่าคงที่ฝั่ง server + client รับเฉพาะ `https://` + `rel="noopener noreferrer"` |
| **17. migration `0004`** | **PASS** | 📖 เพิ่มอย่างเดียว ไม่ลบ/เปลี่ยนคอลัมน์เดิม · default 0 ให้โค้ดรุ่นเก่าเขียนได้ · ไม่มี PII ใหม่ (`appointment_reminder` ไม่มี user id · `line_link_code` มีแค่ hash) · FK cascade · ✅ `tests/platform/migration-0004.test.ts` |
| **18. เพดาน LINE (§1.4 ใหม่)** | **PASS (Low 3)** | 📖 นับและจองในคำสั่ง UPDATE เดียว (`repos/line.ts:121`) รวมแถวที่จองแล้วแต่ยังไม่จบ จึงไม่มีช่องว่างระหว่างนับกับจอง · ตัวนับอิงแถว `sent` ซึ่งการยกเลิก/unfollow ไม่ลบ · เกินเพดาน = `dead` รหัส `LINE_CAP` ไม่ push กระดิ่งปกติ · ✅ ทดลองซ้ำ: เลื่อนนัดซ้ำได้ไม่เกินเพดานต่อนัด · สร้างนัดใหม่ และยกเลิก/ผูก LINE ใหม่บนบัญชีเดิม ไม่เกินเพดานต่อคน · รันพร้อมกัน 3 ชุดไม่เกินเพดาน |
| **19. เดือนโควตา** | **PASS** | 📖 `markOutboxMonthlyLimit` บันทึกเวลาที่ชนจริง (`repos/line.ts:166`) · ✅ ทดลองชน 429 นาทีสุดท้ายของเดือน: เดือนถัดไปส่งได้ |

## Findings

### Medium 1 — แก้แล้วใน `73d85ac` (เดิม: ไม่มีเพดานจำนวนข้อความ LINE ต่อผู้ใช้/ต่อนัด)
- สถานะ: **ปิด** · contract §1.4 เพิ่มเพดานต่อนัด+ชนิด+ผู้รับ และต่อผู้รับใน 24 ชม. (`src/lib/shared/limits.ts:155`) · ✅ ทดลองซ้ำแล้ว ดูเกต 18 · ความเสี่ยงที่เหลือดู Low 3

### Low 1 — ชื่อนัด/ชื่อกลุ่มเป็นข้อความอิสระที่ส่งออกจาก OA ทางการ (รับเป็น backlog)
- ที่: 📖 `src/lib/integrations/line/messages.ts:28-33`
- ควบคุมตัวอักษรแล้ว (`sanitizeDisplayText` ตัดอักขระควบคุม ขึ้นบรรทัดใหม่ไม่ได้) แต่ LINE ทำลิงก์ใน URL ที่พิมพ์ในชื่อให้กดได้ · ผู้รับต้องอยู่กลุ่มเดียวกันและตอบ "ไป" แล้ว จึงเป็น Low · เสนอกรองหรือตัดรูป URL เฉพาะข้อความที่ออก LINE

### Low 2 — แก้แล้วใน `73d85ac` (เดิม: `unfollow` เกินเพดาน event ถูกทิ้ง)
- สถานะ: **ปิด** · `unfollow` ไม่นับเพดาน event และคงลำดับเดิม (`src/lib/integrations/line/webhook.ts:111-124`) · ✅ ทดลองซ้ำ: unfollow หลัง event เกินเพดานถูกยกเลิกการผูกครบ · ส่วนที่เหลือดู Info 8

### Low 3 — เพดานเป็นต่อบัญชีผู้รับ ยังไม่มีเพดานรวมของ OA
- ที่: 📖 `src/lib/data/repos/line.ts:121` · ✅ ทดลองแล้ว
- การใช้โควตาในทางมิชอบต้องใช้หลายบัญชีและเวลานานกว่าเดิมมาก (เดิมบัญชีเดียวทำได้ภายในไม่กี่ชั่วโมง) แต่ยังเพิ่มได้ตามจำนวนบัญชี · LINE บัญชีเดียวสลับผูกหลายบัญชีได้ เพดานจึงไม่จำกัดต่อ LINE · เมื่อโควตาหมดผู้ใช้ยังไม่รู้ตัวตามเดิม
- ทิศทางแก้ (backlog): เพดานรวมต่อวันของ OA หรือต่อผู้สร้าง/กลุ่ม · แจ้ง boss เมื่อใช้โควตาถึงเกณฑ์

### Info
1. **ไม่กันซ้ำด้วย `webhookEventId`** — ลายเซ็นไม่มีเวลาในตัว แต่การเล่นซ้ำต้องได้ body จริงจาก TLS · โค้ดใช้ครั้งเดียวและ reply token หมดอายุเอง · เหลือผลเฉพาะ `unfollow` ที่ซ้ำ (ไม่ผูกใหม่เอง) · ถ้าเปิด redelivery ใน OA ควรเพิ่ม
2. **ผู้ใช้อาจถูกหลอกให้ส่งโค้ดของคนอื่นเข้า OA** — ผลคือ LINE นั้นผูกกับบัญชีอื่น ได้เตือนของเจ้าของโค้ด ไม่มีข้อมูลของเหยื่อรั่ว · แก้เองได้ด้วยการบล็อก OA (unfollow) · ข้อความสำเร็จไม่แสดงชื่อบัญชี
3. **`alreadyLinked` ใช้กับบัญชีปลายทางไม่ active ด้วย และโค้ดถูกใช้ไปแล้ว** — ไม่ใช่ oracle เพราะต้องมีโค้ดที่ใช้ได้จริงก่อน · ข้อความอาจคลาดเคลื่อนเล็กน้อย
4. **ไม่มีแถว audit ตอนเชื่อม/ยกเลิก** — contract ไม่ได้กำหนด · ถ้าต้องสืบกรณีผูกผิดในภายหลังจะไม่มีประวัติ
5. **แถว outbox `pending` ไม่ถูกลบตาม retention** — ถ้าเอา env LINE ออกหลังเข้าคิว แถวค้าง (มีชื่อนัด/ชื่อกลุ่ม) จนกว่าจะเปิดใหม่หรือเจ้าของลบบัญชี · กรณีเกิดยาก
6. **การตรวจ "เดือนนี้ชนโควตาแล้ว"** — **แก้แล้วใน `73d85ac`** ดูเกต 19
7. **เพดานต่อผู้รับใช้ร่วมกันทุกกลุ่ม** — สมาชิกกลุ่มที่ตั้งใจสร้างนัดจำนวนมากอาจใช้เพดานของผู้รับที่ตอบ "ไป" จนการเตือนอื่นของวันนั้นไม่ออก LINE · ผู้รับต้องตอบ "ไป" เอง · กระดิ่งยังทำงาน
8. **event ที่ล้มกลางทางตอบ 200 ไม่ลองใหม่** — รวม `unfollow` (`webhook.ts:120`) · เกิดเมื่อ DB ขัดข้องเท่านั้น · LINE id ค้างและ push ไป LINE ที่บล็อกแล้วล้มเป็น 4xx · ควรพิจารณาถ้าเปิด redelivery

## คำสั่งที่รัน + ผลจริง
```
ตรวจซ้ำที่ 73d85ac:
รันชุด tests/line tests/security tests/rbac tests/platform/migration-0004.test.ts tests/platform/cron.test.ts โดยกลืน EPERM ของ rmSync ตอน cleanup (config/setup อยู่นอก repo):
  → total 2727 · passed 2724 · failed 2 · skipped/อื่น ๆ 1
  → tests/line 83/83 · tests/platform 15/15 · tests/rbac 2296/2296 · tests/security 330/332
  → ที่ล้ม 2 ข้อคือ config-hygiene permissions ของ ci.yml/keepalive.yml (ปัญหา CRLF เดิม)
npx vitest run tests/line/caps.test.ts (ไม่กลืน EPERM) → 14 ข้อ ล้มเพราะ EPERM ตอน cleanup ทั้ง 14 · ไม่มี assertion ล้ม · ชุดกลืน EPERM ผ่านครบ
เทสต์ทดลองนอก repo: PoC เดิมยืนยันว่า M1 และ Low 2 แก้แล้ว · ทดลองทางอ้อม 6 กรณีให้ผลตามเกต 18–19 และ Low 3
ตรวจบรรทัด log/รหัสที่เพิ่ม: log เฉพาะจำนวน · last_error เป็นรหัสล้วน

ตรวจครั้งแรกที่ c696f19:
npx vitest run tests/line tests/security tests/rbac tests/platform/migration-0004.test.ts tests/platform/cron.test.ts
  → total 2713 · passed 2546 · failed 166 · แยกแล้ว: 164 ข้อล้มเพราะ EPERM ตอน cleanup เท่านั้น (ไม่มี assertion ล้ม) + 2 ข้อ config-hygiene (CRLF)

รันชุดเดียวกันซ้ำโดยกลืน EPERM ของ rmSync ตอน cleanup (config/setup อยู่นอก repo):
  → tests/line 69/69 · tests/platform 15/15 · tests/rbac 2296/2296 · tests/security 330/332 · ที่ล้ม 2 ข้อคือ config-hygiene permissions ของ ci.yml/keepalive.yml (ปัญหา CRLF เดิม)

เทสต์ทดลองนอก repo: 3/3 ยืนยันผล Medium 1, Low 2 และการล้างข้อมูลตอนลบบัญชี
git diff main...HEAD | grep (token/LINE id/อีเมล) → พบเฉพาะค่าทดสอบ · git grep รูปแบบ LINE user id → ไม่พบ
git check-ignore .env .env.local → ถูก ignore ทั้งคู่
```

## สิ่งที่ตรวจไม่ได้ในรอบนี้
- e2e (`tests/e2e/r10-reminders.spec.ts`) ไม่ได้รันบนเครื่องนี้ · ผลจริงดูจาก CI
- LINE จริง (R10-11) และ Vercel Schedules ส่ง `CRON_SECRET` จริงหรือไม่ · ตรวจได้หลัง deploy เท่านั้น (ops/boss ตาม §8)
- migration บนฐานจริง · ตรวจจากเทสต์บน DB ว่างและ DB มีข้อมูลเท่านั้น
