# R7_CONTRACT.md — F2 ความเร็ว (วัดก่อน-หลัง) + ค่าเริ่มต้น "ว่างอย่างน้อย 4 ชม." ของกลุ่มใหม่

> ผู้เขียน: main · 2026-11-03 · สถานะ: **boss เห็นชอบทิศทางแล้ว** 2026-11-03 ("ทำต่อได้เลย" ต่อข้อเสนอ F2 + พ่วง G1) · รายการแก้ของเฟส B main เลือกจากผลวัดเฟส A แล้วรายงาน boss ก่อนลงมือ
> ที่มา: NEXT_PHASE F2 (ตั้ง region ญี่ปุ่นแล้วเร็วขึ้นแค่เล็กน้อย — ที่เหลือต้องแก้ที่โค้ด, วัดก่อน-หลังเสมอ) · feedback boss 2026-11-03 (G1)
> branch: `perf/r7-speed` · ข้อเสนอเลขเวอร์ชัน: **v0.9.1** ถ้าไม่มีพฤติกรรมใหม่ที่ผู้ใช้เห็นนอกจากเร็วขึ้น (G1 เปลี่ยนแค่ค่าเริ่มต้น) · **ไม่มี migration · ไม่เปลี่ยนรูป API ที่มีอยู่**

## 1. G1 — กลุ่มใหม่ "ว่างอย่างน้อย" = 4 ชม.
- สร้างกลุ่มใหม่ → `minFreeMinutes = 240` (ช่วงเวลาว่าง 08:00–22:00 เท่าเดิม) · ค่าคงที่กลางใน `src/lib/shared/limits.ts` (เช่น `GROUP_DEFAULT_MIN_FREE_MINUTES = 240`) ส่งตอน insert ที่ service/repo
- **ไม่แก้ DB default** (`schema.ts` ยัง `default(120)`) — SQLite เปลี่ยน default ต้อง rebuild ตาราง (ความเสี่ยงแบบ 0002) · เขียนคอมเมนต์ใน schema ว่าค่าที่ใช้จริงตอนสร้างมาจาก service
- กลุ่มที่มีอยู่ไม่เปลี่ยน · ถ้า client ส่ง `minFreeMinutes` มาตอนสร้าง (ถ้ารองรับ) ใช้ค่านั้นตามเดิม
- ux ตรวจข้อความที่อ้าง "2 ชม." เป็นค่าเริ่มต้น (ถ้ามี) ให้ตรง

## 2. เฟส A — วัด baseline (ห้ามแก้ความเร็วในเฟสนี้)
- **ตัวนับ/จับเวลาต่อ request** (ฝั่งเซิร์ฟเวอร์): นับจำนวน query DB + เวลารวม DB + เวลารวมของ request · แสดงเป็น header `Server-Timing` (`db;dur=…;desc="N queries"`, `total;dur=…`) บนหน้า (RSC) และ API · **ไม่มีข้อมูลผู้ใช้/SQL/ค่าพารามิเตอร์ใน header หรือ log** · ปิดได้ด้วย env (ค่าเริ่มต้นเปิดบน preview, ตัดสินบน prod ในเฟส B)
- **ตาราง baseline** `docs/reports/perf-r7-baseline.md`: ต่อหน้า/endpoint หลัก — `/` (home), `/calendar` (เดือน/วัน/ว่างตรงกัน/ของฉัน), `/groups`, `/groups/[gid]`, `/appointments/[id]`, `/me`, และ API ที่หน้าเหล่านี้เรียก + RSVP, เพิ่ม/ลบ busy · คอลัมน์: จำนวน query, ลำดับ query (ชื่อขั้น ไม่ใช่ SQL ดิบ), เวลา DB/รวม ในเครื่อง (libSQL ไฟล์) · ถ้า boss ช่วยได้: เปิดหน้า preview แล้วอ่าน Server-Timing ใน DevTools (main จะให้ขั้นตอน) เพื่อได้เวลาจริงกับ Turso ญี่ปุ่น
- **เทสต์นับ query** (Vitest) ต่อเส้นทางหลัก บันทึกค่าปัจจุบันเป็นเพดาน → เฟส B ลดแล้วปรับเพดานลง (กันถอยหลังภายหลัง)
- ระบุจุดซ้ำ: session โหลดกี่ครั้งต่อ request, `authorize`/`loadGroupCtx` ซ้ำไหม, N+1, query ที่ทำตามลำดับแต่ทำขนานได้, waterfall ฝั่ง client (fetch หลัง hydrate)

## 3. เฟส B — แก้ (main เลือกจากผลเฟส A แล้วแจ้ง boss) — ตัวเลือกที่คาดไว้
- ลด query ต่อ request: แคช session/actor ต่อ request (`React.cache`), รวม `authorize` + โหลดข้อมูล, ตัด N+1, ทำขนาน (`Promise.all`) เมื่ออิสระกัน — **ห้ามข้ามการตรวจสิทธิ์ที่เซิร์ฟเวอร์ (กฎ 6)**
- ฝั่ง client: prefetch ลิงก์แถบล่าง, ลด fetch ซ้ำหลัง hydrate (ส่งข้อมูลแรกจาก server), optimistic update ตอน RSVP / เพิ่ม busy (ย้อนกลับเมื่อเซิร์ฟเวอร์ปฏิเสธ + แจ้ง)
- index ที่ขาด → ต้องเป็น migration (ถ้าจำเป็นจริง main ขอ boss ก่อน เพราะต้องรันบน Turso)
- **เกณฑ์ตัดสินว่าคุ้ม**: เส้นทางหลัก (home, calendar เดือน, ว่างตรงกัน, RSVP) จำนวน query ลด ≥ 30% หรือเวลารวม (ในเครื่อง) ลด ≥ 30% · วัดซ้ำด้วยเครื่องมือเดียวกับเฟส A → `docs/reports/perf-r7-after.md` (ตารางก่อน/หลัง)

## 4. ไม่ทำ
เปลี่ยน stack/host/region (ตั้งแล้ว) · แคชข้ามผู้ใช้/CDN ของข้อมูลส่วนตัว (`Cache-Control: private, no-store` คงเดิม) · เปลี่ยนรูป API · Vercel Pro

## 5. ไฟล์ (บทบาท)
| บทบาท | งาน |
|---|---|
| platform | G1 (`limits.ts`, service/repo groups, คอมเมนต์ schema) · ตัวนับ query/เวลา (ชั้น DB client ใน `src/db/**` หรือ `src/lib/data/**`) + header `Server-Timing` (route wrapper `src/app/api/_lib/route.ts` + จุดที่หน้า RSC ตอบ ถ้าทำได้) + env flag ใน `src/lib/shared/env*` และ `.env.example` (ไม่มีค่าลับ) — เป็นชั้นเดียวกัน ทำคนเดียวกันไม่ให้ชน · เฟส B ฝั่ง data/service · เทสต์นับ query |
| ops | `docs/OPERATIONS.md` (วิธีอ่าน Server-Timing + env flag) · CHANGELOG |
| auth | เฟส B ถ้าแตะ session/actor caching (`src/lib/auth/**`) |
| frontend | เฟส B ฝั่ง client (prefetch, optimistic, ลด fetch ซ้ำ) |
| ux | G1 ข้อความ (ถ้ามี) · ข้อความแจ้งเมื่อ optimistic ถูกย้อนกลับ |
| test | e2e ไม่ถอยหลังหลังเฟส B · ช่วย harness นับ query ถ้า platform ต้องการ |
| qa · security | ตรวจอิสระ (security: Server-Timing ไม่รั่วข้อมูล, caching ไม่ข้ามผู้ใช้, สิทธิ์ยังตรวจทุก request) |
| secretary | PROGRESS (v0.9.0 ออกแล้ว + R7) · รายงานวัน |

## 6. เกณฑ์ผ่าน
| # | เกณฑ์ | วิธีตรวจ |
|---|---|---|
| R7-1 | สร้างกลุ่มใหม่ได้ minFree 240 · window 08:00–22:00 · กลุ่มเดิมไม่เปลี่ยน · ไม่มี migration ใหม่ | Vitest API + `git diff -- drizzle` ว่าง |
| R7-2 | มี baseline ครบทุกเส้นทางใน §2 พร้อมจำนวน query + เวลา | รายงาน |
| R7-3 | `Server-Timing` ไม่มี SQL/พารามิเตอร์/ข้อมูลผู้ใช้ · ปิดได้ด้วย env | Vitest + security |
| R7-4 | เส้นทางหลักดีขึ้นตามเกณฑ์ §3 · ตารางก่อน/หลังจากเครื่องมือเดียวกัน | รายงาน + เทสต์นับ query |
| R7-5 | สิทธิ์ยังตรวจที่เซิร์ฟเวอร์ทุก request · caching ต่อ request เท่านั้น ไม่ข้ามผู้ใช้ | Vitest + security |
| R7-6 | optimistic (ถ้าทำ) ย้อนกลับถูกต้องเมื่อเซิร์ฟเวอร์ปฏิเสธ + แจ้งผู้ใช้ TH/EN | e2e |
| R7-7 | ไม่ถอยหลัง: CI เขียว + Vercel preview เขียว | CI |

## 7. ลำดับงาน
secretary + platform (G1 + ตัวนับ) + ops (Server-Timing) → platform baseline → **main สรุปผลวัด + เลือกเฟส B → แจ้ง boss** → ผู้ทำเฟส B → วัดหลัง → ops CHANGELOG → **qa + security** → secretary → main เปิด PR

## 8. ความเสี่ยง
- ตัวนับเพิ่ม overhead/รั่วข้อมูล → นับแค่จำนวน/เวลา ไม่เก็บ SQL · security ตรวจ
- แคชต่อ request ผิดขอบเขต → ข้อมูลข้ามผู้ใช้ (ร้ายแรง) → ใช้ `React.cache` (ผูก request) เท่านั้น ห้าม module-level cache ของข้อมูลผู้ใช้
- ผลในเครื่อง (libSQL ไฟล์) ≠ Turso จริง (เครือข่าย) → จำนวน query เป็นตัวชี้วัดหลัก เพราะแต่ละ query บน Turso = 1 round trip
