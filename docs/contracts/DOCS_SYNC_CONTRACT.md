# DOCS_SYNC — contract ถาวร: เอกสารต้องตรงกับของจริงทุกรอบ

> สถานะ: ใช้ทุกรอบ ตั้งแต่ 2026-11-18 (boss สั่ง: "มีอัพเดทอะไร มันควรอัพเดทตามระบบให้ครบ")
> contract นี้ใช้ควบคู่กับ contract ของทุกรอบ (`R*_CONTRACT.md`) ไม่ต้องเขียนซ้ำในแต่ละรอบ

## 1. กติกา
1. **รอบยังไม่ปิด ถ้าเอกสารยังไม่ตรง** — PR ทุกอันที่มีโค้ด ต้องแก้เอกสารที่เกี่ยวข้อง (ตาราง §2) **ใน PR เดียวกัน** ไม่เลื่อนไปทีหลัง
2. **ออกรุ่นแล้วต้องตามแก้ทันที** — หลัง boss ออกรุ่น main ส่ง secretary + ops แก้รายการใน §3 ในรอบปิดงาน (PR เอกสาร) ก่อนเริ่มรอบใหม่
3. **PR ทุกอันต้องมีหัวข้อ "เอกสาร"** ในคำอธิบาย: ติ๊กทุกแถวใน §2 ว่า "แก้แล้ว (ไฟล์)" หรือ "ไม่เกี่ยว" — ห้ามเว้นว่าง
4. **qa ตรวจเรื่องนี้ด้วย** ในทุกรอบที่มีโค้ด: เปิดเอกสารเทียบกับของที่ส่งจริง ถ้าไม่ตรง = ตีกลับ
5. **มีเครื่องตรวจอัตโนมัติ** (§4) — CI จะล้มถ้าเลขเวอร์ชันหรือสถานะในเอกสารหลักไม่ตรงกัน
6. เจ้าของไฟล์เป็นคนแก้ (กฎข้อ 2) main ไม่แก้แทน ยกเว้น contract และ PRD

## 2. เปลี่ยนอะไร → ต้องแก้เอกสารไหน

| สิ่งที่เปลี่ยน | เอกสารที่ต้องแก้ | เจ้าของ |
|---|---|---|
| ฟีเจอร์ที่ผู้ใช้เห็น (เพิ่ม/เปลี่ยน/เอาออก) | `README.md`, `docs/guides/quickstart-th.html`, `CHANGELOG.md` (Unreleased), `docs/design/UX.md` หรือไฟล์ดีไซน์ของรอบ, `docs/design/samples/*` ที่แสดงหน้านั้น | secretary (README, quickstart) · ops (CHANGELOG) · ux (design, samples) |
| schema / migration | `docs/design/ARCHITECTURE.md` (ส่วน schema), ADR ที่เกี่ยวข้อง, `docs/OPERATIONS.md` (ขั้นตอนรัน migration) | architect · ops |
| API route ใหม่/เปลี่ยน | `docs/design/ARCHITECTURE.md` (ส่วน routes) ให้ตรงกับ ROUTE_MANIFEST | architect |
| env / secret / cron / rate limit / เพดาน | `.env.example`, `docs/OPERATIONS.md`, `docs/design/ARCHITECTURE.md` (env, cron) | ops · architect |
| ตัดสินใจเชิงออกแบบ | ADR ใหม่ หรืออัปเดตสถานะ ADR เดิม (ร่าง → Accepted / Superseded) | architect |
| CI / ขั้นตอนทีม / กติกา | `docs/OPERATIONS.md`, `docs/team/PROCESS.md`, `docs/team/SECRETARY.md`, `docs/VERSIONING.md` | ops · secretary |
| ข้อความ UI | `messages/th.json`, `messages/en.json` (ทั้งสองภาษา) | ux |
| จบขั้นตอนสำคัญ / จบวัน | `docs/team/PROGRESS.md`, `docs/reports/YYYY-MM-DD.md` | secretary |
| สถานะงาน/แผน | `docs/NEXT_PHASE.md`, `docs/prd/PRD.md` (ติ๊กที่ส่งแล้ว), สถานะใน `R*_CONTRACT.md` | secretary · main |

## 3. หลังออกรุ่น (ทุกครั้ง) — ต้องตรงกันทุกไฟล์
- [ ] `CHANGELOG.md` มีหัวข้อรุ่นนั้นครบทุกรายการที่ส่งจริง (ops)
- [ ] `docs/guides/quickstart-th.html` ท้ายหน้าเป็นเลขรุ่นล่าสุด (secretary)
- [ ] `docs/team/PROGRESS.md` หัวข้อ "เหลือ" ไม่มีของที่ทำเสร็จแล้ว + บรรทัดรุ่นล่าสุด (secretary)
- [ ] `docs/NEXT_PHASE.md` สถานะของรอบนั้น = เสร็จ/ออกรุ่นแล้ว (secretary)
- [ ] `docs/prd/PRD.md` หมายเหตุรุ่นปัจจุบัน + ติ๊กของที่ส่งแล้ว (main)
- [ ] `R*_CONTRACT.md` ของรอบ มีบรรทัดสถานะ "ปิดรอบ + ออกรุ่น vX.Y.Z" (main)
- [ ] `docs/reports/YYYY-MM-DD.md` ของวันที่ออกรุ่น (secretary)
- [ ] `docs/design/ARCHITECTURE.md` ตรงกับ schema/routes/env ของรุ่นนั้น (architect)

## 4. เครื่องตรวจอัตโนมัติ (ops ทำ รอบถัดไป)
เทสต์ `tests/ops/docs-sync.test.ts` รันใน CI (`test + migration`) ตรวจอย่างน้อย:
- เลขรุ่นใน `package.json` = หัวข้อรุ่นล่าสุดใน `CHANGELOG.md` = ท้าย `quickstart-th.html` = หมายเหตุรุ่นใน `PRD.md` = บรรทัดรุ่นใน `PROGRESS.md`
- ทุก route ใน ROUTE_MANIFEST มีชื่อใน `ARCHITECTURE.md`
- ทุก migration ใน `drizzle/` มีชื่อตารางที่สร้างอยู่ใน `ARCHITECTURE.md`
- ทุกตัวแปรใน `.env.example` มีใน `docs/OPERATIONS.md`
- ADR ไม่มีสถานะ "ร่าง/Draft" ค้าง ถ้ารอบนั้นปิดแล้ว

ถ้าเทสต์ล้ม = merge ไม่ได้ ไม่ต้องรอใครเตือน

## 5. งานค้างที่ต้องเคลียร์ก่อนใช้ §4 (ตรวจพบ 2026-11-18)
- secretary: PROGRESS (ของที่แก้แล้วยังค้างใน "เหลือ", บรรทัดรุ่น), NEXT_PHASE (ยังเขียนว่า R15 กำลังทำ), quickstart ท้ายหน้า v0.11.0 → v0.13.0, SECRETARY.md, PROCESS.md, TEAM.md (หมายเหตุบรรทัดเดียว), รายงาน `docs/reports/2026-11-18.md` (สรุป 11–18 พ.ย.), README (LINE: ลิงก์กดไม่ได้, เพดาน 300/เดือน)
- ops: CHANGELOG [0.13.0] เพิ่มรายการ R15b, "R0–R7" → "R*" ใน CHANGELOG/VERSIONING, OPERATIONS (repo public + keepalive 60 วัน, bucket rate limit R15b, เพดาน OA, env), comment Leaflet ใน `next.config.ts`, แก้ `tests/ops/ci-artifacts.test.ts` ให้ตรง ci.yml ใหม่, ทำ §4
- architect: ARCHITECTURE (สถานะ, schema ตาราง R10–R15, routes, env, cron, repo public), ADR 0001–0009 สถานะ → Accepted
- ux: `docs/design/R14_BUSY_ROUTINE.md:152`, `docs/design/samples/create.html` และ `docs/design/tools/templates/create.html` ยังแสดงค้นหาสถานที่ (เอาออกแล้วใน R15a)
- ~~main: บรรทัดสถานะ R14/R15 contract~~ เสร็จ 2026-11-18
- qa: ตรวจทั้งชุดเทียบ §2–§3 แล้วเขียน `docs/reports/qa-docs-sync.md`

## 6. รอบเคลียร์งานค้าง `docs/sync-r15` (boss: "อยากเคลียร์ให้หมด" 2026-11-18)
- ทำ §5 ทั้งหมด + §4 (ops) ใน PR เดียว จาก `main` `8af88ee`
- ops เพิ่ม: Dependabot 3 รายการบน main (high picomatch GHSA-fc5q-39xc-vjpf ยังไม่มีรุ่นแก้ · medium minimatch GHSA-g3hv-75wg-m249 แก้ใน 11.0.1 · medium esbuild GHSA-67mh-4wv8-2f99 แก้ใน 0.25.0 — ทั้งหมดเป็น transitive) → อัปเดตเฉพาะที่มีรุ่นแก้ผ่าน `overrides`/lockfile ถ้าไม่ทำให้ build/test พัง · ตัวที่ยังไม่มีรุ่นแก้ให้ประเมินว่าถึงโค้ดที่รันจริงไหม แล้วจดใน OPERATIONS
- ผู้ตรวจอิสระ: qa (เอกสาร + เทสต์ docs-sync) · security (dependency)

## 7. รอบหลังออกรุ่น v0.14.0 `docs/release-0.14.0` (2026-11-19)
- ปัญหาที่เจอ: CI บน main แดงหลังออกรุ่นทุกครั้ง (`7eaff23` · `test + migration` ล้มที่ docs-sync) เพราะ `release.ts` ขยับ `package.json` แต่ quickstart / PRD / PROGRESS ยังเป็นรุ่นเก่า จนกว่า PR หลังออกรุ่นจะ merge
- ทำ §3 ครบทุกข้อ (secretary · ops · architect · main) ใน PR เดียว จาก `main` `7eaff23`
- **ops แก้ต้นเหตุ:** `scripts/release.ts` เปลี่ยนเลขรุ่นใน 3 บรรทัดนั้นให้ด้วยใน commit ออกรุ่นเดียวกัน (แทนที่เฉพาะเลข `vX.Y.Z` ในบรรทัดที่ docs-sync test อ่าน ไม่แตะข้อความอื่น) + เทสต์ · ตรวจด้วยการรัน release แบบ dry-run/บน temp copy ว่าหลังออกรุ่น docs-sync test ผ่านทันที · เนื้อหาอื่นตาม §3 ยังเป็นงานของเจ้าของไฟล์เหมือนเดิม
- ผู้ตรวจอิสระ: qa (เอกสารตรงของจริง + เทสต์ release/docs-sync)
