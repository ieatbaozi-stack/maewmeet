# R16_CONTRACT.md — เก็บงานค้างทั้งหมด (hardening เล็ก, UI เล็ก, เทสต์/CI, เอกสาร)

> ผู้เขียน: main · 2026-11-18 · สถานะ: **boss เห็นชอบแล้ว** 2026-11-18 ("มาทำที่เหลือให้จบครับ" + เลือกค่าแนะนำ B1–B4)
> **ปิดรอบ + ออกรุ่น v0.14.0 (2026-11-19)** · PR #38 merge แล้ว · tag `v0.14.0` → `7eaff23` · production `/api/health` = 0.14.0
> branch: `feat/r16-cleanup` จาก `main` `9db2c08` (PR #37 merge แล้ว) · **ไม่มี migration** · ใช้คู่กับ [DOCS_SYNC_CONTRACT.md](DOCS_SYNC_CONTRACT.md)
> ที่มา: `docs/team/PROGRESS.md` หัวข้อ "เหลือ" ข้อ 1–2 (2026-11-18) · R15 §2 · รายงาน qa/security R15a, R15b

## 0. ขอบเขต
ทำทุกข้อใน PROGRESS "เหลือ" ข้อ 2 ที่ไม่ต้องใช้ migration · ข้อ 1 (CSP, retention/กู้คืน) ให้ boss ตัดสินใน §5 ก่อน · ข้อที่ไม่ทำ บันทึกเหตุผลใน §6

## 1. hardening (platform · auth ถ้าแตะ src/lib/rbac)
| # | งาน | เกณฑ์รับ |
|---|---|---|
| H1 | rate limit `PATCH /api/groups/:gid` (bucket ใหม่ `group:settings` 30/10 นาที ต่อผู้ใช้) | เกินแล้ว 429 · นับก่อน NOT_FOUND เหมือน R15b · เทสต์ |
| H2 | rate limit `PUT /api/prefs` (`prefs:update` 60/10 นาที) | เกินแล้ว 429 แต่ cookie ภาษา/ธีมฝั่ง client ยังทำงาน · เทสต์ |
| H3 | rate limit ฝั่งอ่านแบบ global ต่อผู้ใช้ (ดู B1) ใน `src/app/api/_lib/route.ts` สำหรับ GET ที่ต้อง login | ผู้ใช้ปกติ (e2e ทั้งชุด) ไม่โดน 429 · เกินแล้ว 429 + `Retry-After` · cron/health/public ไม่นับ |
| H4 | คำเชิญที่ super admin นอกกลุ่มเป็นคนเชิญ แสดง "ผู้ดูแลระบบ" แทนชื่อ (แบบเดียวกับ R15b B7 `actorSystemAdmin`) | แถวใหม่เท่านั้น · เทสต์ TH/EN |
| H4b | `GET /api/me/invites` (รายการคำเชิญค้าง) แสดง "ผู้ดูแลระบบ" แทนชื่อ SA นอกกลุ่ม ให้สอดคล้องกับ H4 (platform serializer + frontend GroupsView) | เทสต์ |
| H4c | `GET /api/groups/:gid/invites` ช่อง `creatorName` (รายการคำเชิญของกลุ่ม "สร้างโดย …") แสดง "ผู้ดูแลระบบ" เมื่อผู้สร้างเป็น SA ที่ไม่ใช่สมาชิก แบบเดียวกับ H4b (security-r16 Low 1) | เทสต์ API + UI TH/EN |
| H7 | คำเชิญตรง (`insertDirectInvite`) ต้องไม่สร้างให้ผู้รับที่บัญชีถูกลบ/ระงับระหว่างทาง — เงื่อนไขสถานะผู้รับใน statement เดียวกัน (security-r5 Info 1) | เทสต์แข่งกับลบบัญชี |
| H5 | หน้า auth (login/signup/forgot/set-pin) ที่ redirect หรือ error ระหว่าง stream ต้องได้ status ที่ถูก (3xx/4xx) ไม่ใช่ 200 — ตรวจก่อนว่าเกิดจริงไหม ถ้าแก้ต้องไม่ทำให้หน้าช้าลง ถ้าแก้ไม่ได้โดยไม่เสี่ยง ให้บันทึกเหตุผลแล้วไม่แก้ | เทสต์ status จริง หรือบันทึกใน §6 |
| H6 | Server-Timing บนหน้า RSC (เปิดเมื่อ `SERVER_TIMING_ENABLED` เท่านั้น เหมือน API) | ปิดอยู่ = ไม่มี header · ไม่เปลี่ยน output |

## 2. UI (frontend · ux ตัดสินถ้อยคำ/สี)
| # | งาน |
|---|---|
| U1 | ปุ่ม "Take another look" ที่ 375 ขึ้นบรรทัดใหม่แล้วเยื้องตามชื่อขั้น (qa R15a ข้อ 2) — ตรวจก่อนว่า `f612b0b` แก้แล้วหรือยัง |
| U2 | legend แท็บ "เอากลับ": ช่อง "วันของชุดนี้" กับวันที่ล็อก ใช้สีให้ตรงกับในปฏิทิน (qa R15a ข้อ 3) |
| U3 | NavProgress ขึ้นตอนออกจากระบบและลบบัญชี (`AccountActions`/`AccountSection` เรียก `signalNavStart`) |
| U4 | skeleton ขั้นต่ำ 250 ms ครอบ `src/app/loading.tsx` ด้วย (ไม่ให้กะพริบ) |
เกณฑ์รับ: 375/390/768 · TH/EN · สว่าง/มืด · contrast ผ่าน · e2e ไม่ถอย

## 3. เทสต์/CI (test · ops)
| # | งาน |
|---|---|
| T1 | e2e `retries` 2 → ค่าตาม B2 · ถ้ามีเทสต์ flaky ให้แก้ต้นเหตุ ไม่ใช่ปิดเทสต์ |
| T2 | `tests/security/config-hygiene.test.ts` `runBlocks` ไม่ตัดที่บรรทัดว่างแรก (qa R15b Low 1) + เทสต์ที่จับกรณีบรรทัดว่างกลาง `run: \|` |

## 4. เอกสาร (secretary · ตาม DOCS_SYNC §2)
- `docs/NEXT_PHASE.md` หัวข้อ "backlog R6 hardening": ติดป้ายประวัติ + บอกทีละข้อว่าเสร็จแล้ว (แจ้งเตือนยกเลิกนัด) / ทำใน R16 / ย้ายไป PROGRESS / ไม่ทำ (ตัวช่วยอื่นอ่านแล้วเข้าใจว่าค้าง)
- `docs/team/PROGRESS.md`: ข้อ 0 → PR #37 merge แล้ว · ข้อ required check ที่ถูกข้าม → ยืนยันแล้วจาก PR #36 (e2e 1–4 รายงานและ merge ได้) ตัดออก · อัปเดตตามผล R16
- ops: CHANGELOG Unreleased · OPERATIONS (bucket ใหม่ H1–H3, Server-Timing RSC)
- architect: ARCHITECTURE ถ้า route/ขอบเขต rate limit เปลี่ยน (docs-sync test ต้องผ่าน)

## 5. boss ตัดสิน (ค่าแนะนำ = ตัวแรก)
- **B1 rate limit อ่าน global:** (ก) 600 คำขอ/10 นาที ต่อผู้ใช้ — สูงกว่าการใช้งานปกติมาก กันแค่สคริปต์ยิงรัว ✅ แนะนำ · (ข) ไม่ทำ
- **B2 e2e retries:** (ก) 1 + CI รายงานรายชื่อเทสต์ที่ผ่านในรอบสอง (flaky) ✅ แนะนำ · (ข) 0 — CI แดงบ่อยขึ้นจากเน็ต/เครื่อง GitHub ช้า
- **B3 CSP nonce:** (ก) **ไม่ทำ** ยอมรับความเสี่ยงต่อ — nonce บังคับให้ทุกหน้า render ใหม่ทุกครั้ง (ไม่มี static/cache) ทำให้ช้าลง ขัดกับ F2 ความเร็ว · แอปไม่มี HTML จากผู้ใช้ (React escape ทั้งหมด) จดใน OPERATIONS ✅ แนะนำ · (ข) ทำในรอบแยก (เสี่ยงหน้าพัง + ช้าลง)
- **B4 retention + กู้คืน (PDPA):** (ก) แยกเป็น R17 หลังเลือกนโยบาย: กลุ่ม/บัญชีที่ลบเก็บ 30 วัน super admin กู้ได้ แล้วลบถาวรอัตโนมัติ (ต้องมี migration) ✅ แนะนำ · (ข) ลบถาวรทันที ไม่มีกู้ · (ค) คงแบบปัจจุบัน (soft delete ไม่มีกำหนดลบ)

**ผลตัดสิน (boss 2026-11-18):** B1 = (ก) 600/10 นาที · B2 = (ก) retries 1 + รายงาน flaky · B3 = (ก) ไม่ทำ CSP nonce ยอมรับความเสี่ยง → ops บันทึกเหตุผลใน OPERATIONS · B4 = (ก) เก็บ 30 วัน กู้ได้ แล้วลบถาวร → **R17 แยก** (มี migration) เริ่มหลัง R16 merge

## 6. ไม่ทำ (บันทึกเหตุผล)
- เพดาน LINE OA แบ่งต่อกลุ่ม — B6 ใน R15 ตัดสินแล้ว (รวมทั้งระบบ)
- แถวแจ้งเตือนเก่าก่อน R15b ที่ยังแสดงชื่อ SA — ต้องเขียนข้อมูลจริงย้อนหลัง ไม่คุ้ม (security R15b Info 1 ยอมรับได้)
- วันที่เคยแยกแก้ + เอาวันของชุดกลับ = สองรายการ — ออกแบบไว้และแจ้งผู้ใช้แล้ว (`restoreNote`)
- DST day strip — แอปใช้ Asia/Bangkok อย่างเดียว
- **H5 (ตรวจแล้ว ไม่แก้):** status 200 + meta refresh เกิดจาก root `loading.tsx` (streaming) ครอบทุกหน้า ไม่ใช่แค่หน้า auth · ฝั่ง client redirect ทันทีจาก RSC payload และไม่มีข้อมูลหลุด (redirect ถูกโยนก่อน render) · แก้ได้ด้วย `proxy.ts` (ขัด ADR 0001) หรือเอา loading boundary ออก (หน้าช้าลง ขัด F2) → ไม่แก้ (platform 2026-11-18, curl บน `next start`)
- **H6 (ทำไม่ได้):** Next 16 `headers()` ใน Server Component อ่านอย่างเดียว และหน้า streaming ส่ง header ก่อน query จบ · ใช้ `tests/perf/r7-baseline.test.ts` วัดหน้าแทน
- **H2:** endpoint จริงคือ `POST /api/prefs` · 429 ไม่ตั้ง cookie ใหม่ แต่ cookie เดิมยังอยู่ · ผู้ที่ยังไม่ login ไม่ถูกนับ
- picomatch — ยังไม่มีรุ่นแก้ ติดตามต่อ (ops)
- boss ลองเครื่องจริง / เครื่อง boss (PROGRESS ข้อ 3–4) — ไม่ใช่งานโค้ด

## 7. ผู้ทำ / ผู้ตรวจ
platform (H1–H6) · auth (ถ้าแตะ rbac) · frontend (U1–U4) · ux (ถ้อยคำ/สี U2, H4) · test (T1, T2) · ops (CI, CHANGELOG, OPERATIONS) · architect (ARCHITECTURE) · secretary (§4) · **qa** และ **security** ตรวจอิสระ (แตะ api/rate limit)
PR เดียว · เลขรุ่นที่เสนอ: v0.14.0 (boss ออกรุ่นเอง)
