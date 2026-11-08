# R6C_CONTRACT.md — ตั้งสี/รูปทรงของตัวเองต่อกลุ่ม (F3ก) + เก็บตกจาก QA R6B (L2–L4)

> ผู้เขียน: main · 2026-11-01 · สถานะ: **boss เห็นชอบแล้ว** 2026-11-01 (เลือกสี+รูปทรงแยกกัน)
> อ้างอิง: [docs/NEXT_PHASE.md](docs/NEXT_PHASE.md) F3(ก) · boss ตัดสิน 2026-11-01: **ตั้งแยกต่อกลุ่ม · ซ้ำกันได้** (แทน "กันสีซ้ำ" ใน NEXT_PHASE) · [R6B_CONTRACT](R6B_CONTRACT.md) errata · [docs/reports/qa-r6b.md](docs/reports/qa-r6b.md)
> ข้อเสนอเลขเวอร์ชัน: **v0.8.0** (MINOR — schema + API ใหม่ + ความสามารถใหม่ที่ผู้ใช้เห็น)

## 1. ขอบเขต
**ทำ**
1. **F3ก ตั้งหน้าตาของฉันในกลุ่มนี้** — สมาชิกเลือก **สี 1 ใน 10** และ **รูปทรง 1 ใน 10** ของตัวเอง แยกอิสระกัน (100 แบบ) · ซ้ำกับคนอื่นได้ · มีปุ่ม "ใช้แบบอัตโนมัติ" กลับไปค่าเดิม
   - ไม่ตั้ง = หน้าตาเดิมทุกอย่าง (hash เดิม `memberColorIndex`) → **ผู้ใช้เดิมไม่มีใครเปลี่ยนหน้าตาหลัง deploy**
   - ตั้งได้เฉพาะ **ของตัวเอง** (admin/moderator ตั้งให้คนอื่นไม่ได้) · ตรวจที่เซิร์ฟเวอร์ (กฎ 6)
   - ที่อยู่ UI: หน้าตั้งค่ากลุ่ม (`/groups/[gid]/settings` — สมาชิกทุกคนเปิดได้อยู่แล้ว) หัวข้อใหม่ "หน้าตาของฉันในกลุ่มนี้" · ตัวเลือกแสดงตัวอย่างอวาตาร์จริง · ใช้ได้ด้วยคีย์บอร์ด/screen reader (radio group 2 ชุด มีชื่อสี/ชื่อรูปทรงเป็นข้อความ TH/EN)
   - เห็นผลทันทีทุกที่ที่แสดงสมาชิก: ปฏิทินเดือน/วัน, legend, รายชื่อสมาชิก, RSVP ในนัด, หน้าวันว่าง
2. **แยก "สี" กับ "รูปทรง" ออกจากกัน** ใน API และ CSS: วันนี้ `colorIndex` เดียวคุมทั้งสองอย่าง (`data-slot`) → เพิ่ม `shapeIndex` · CSS ใช้ `data-color` + `data-shape` (คง `data-slot` ไว้ไม่ได้ — ลบทิ้งทั้งหมดในรอบนี้เพื่อไม่ให้มีสองระบบ)
3. **เก็บตก QA R6B**
   - L2: ปุ่มบนแถบบนจอกว้าง (`appt-add-top`, `busy-add-top`) ซ่อนตอนกลุ่ม gone/error/loading เหมือนปุ่มลอยบนมือถือ
   - L3: เทสต์ R6B-1 (แท็บว่างตรงกันเด่น) ตรวจธีมมืดด้วย
   - L4: ภาพหน้าจอ R6B ถ่ายหลังเลื่อนลงสุด

**ไม่ทำ**: อัปโหลดรูป/อีโมจิเป็นอวาตาร์ · สี/รูปทรงใหม่นอก 10+10 เดิม · ตั้งหน้าตาครั้งเดียวใช้ทุกกลุ่ม · admin ตั้งให้คนอื่น · F1/F2/F5/F6

## 2. ข้อมูลและ API
- **migration ใหม่** (`drizzle/0002_*`): `group_member` เพิ่ม `color_slot INTEGER NULL`, `shape_slot INTEGER NULL` + CHECK `between 1 and 10` (หรือ NULL) · ไม่ backfill · ย้อนกลับได้ (คอลัมน์ nullable, โค้ดเดิมไม่อ่าน)
- **ค่าที่ใช้แสดง** (ฟังก์ชันกลางใน `src/lib/shared/member-color.ts`): `color = color_slot ?? hash`, `shape = shape_slot ?? hash` (hash เดิม ไม่เปลี่ยนสูตร) · ทุก serializer/service ที่ใช้ `memberColorIndex` (appointments, groups, calendar, availability, appointment page) เปลี่ยนมาใช้ฟังก์ชันนี้ และส่ง `colorIndex` + `shapeIndex`
- **API ใหม่**: `PATCH /api/groups/[gid]/members/me/appearance` body `{ color: 1–10 | null, shape: 1–10 | null }` → 200 พร้อมค่าที่ใช้แสดง
  - RBAC action ใหม่ `member.setOwnAppearance` = สมาชิกของกลุ่มนั้นเท่านั้น (super admin ที่ไม่ใช่สมาชิก → 403) · ผ่าน must_change_pin guard, CSRF, rate limit ของ mutation เดิม
  - ค่านอกช่วง/ชนิดผิด → 400 · กลุ่มถูกลบ/ไม่ใช่สมาชิก → 404/403 ตามแบบเดิมของรีโป
- ไม่ต้องลง audit log (ค่าแสดงผลส่วนตัว ไม่ใช่การเปลี่ยนสิทธิ์) — security ตรวจยืนยัน

## 3. ไฟล์ (บทบาท)
| บทบาท | ไฟล์ |
|---|---|
| platform | `src/db/schema.ts`, `drizzle/0002_*` + meta, `src/lib/shared/member-color.ts`, `src/lib/data/**` (serializers/services ที่ใช้สี), `src/app/api/groups/[gid]/members/me/appearance/route.ts` (ใหม่), `src/app/(app)/appointments/[id]/page.tsx` (บรรทัดส่ง colorIndex — ได้รับมอบในรอบนี้) |
| auth | `src/lib/rbac/**` (action `member.setOwnAppearance`) |
| ux | ชื่อสี 10 + ชื่อรูปทรง 10 + ข้อความหัวข้อ TH/EN ใน `messages/*.json` · ตรวจหน้าตา picker, contrast ทั้งสองธีม |
| frontend | `src/styles/members.css` (`data-color`/`data-shape`), `src/components/groups/**` (MemberAvatar, helpers, picker ใหม่), `src/components/calendar/**` (MonthGrid, DayPanel, ปุ่มแถบบน L2), `src/app/(app)/groups/[gid]/settings/page.tsx` |
| test | `tests/**` (ยกเว้น `tests/calendar/**`): unit ฟังก์ชันสี, API (สิทธิ์ × ค่า), migration check, e2e picker + เห็นผลในปฏิทิน, L3, L4 |
| ops | `CHANGELOG.md` (Unreleased) |
| qa · security | ตรวจอิสระ (security: แตะ schema/API/rbac) |
| secretary | `PROGRESS.md` หลังจบรอบ |

## 4. เกณฑ์ผ่าน
| # | เกณฑ์ | วิธีตรวจ |
|---|---|---|
| R6C-1 | สมาชิกที่ไม่ได้ตั้ง → `colorIndex`/`shapeIndex` เท่ากับของเดิมทุกที่ (ไม่มีใครเปลี่ยนหน้าตาหลัง deploy) | Vitest เทียบกับ hash เดิม + ตรวจทุก serializer |
| R6C-2 | ตั้งสี/รูปทรงแยกกันได้ · ซ้ำกับคนอื่นได้ · "ใช้แบบอัตโนมัติ" กลับค่าเดิม · ค่าในกลุ่ม A ไม่กระทบกลุ่ม B | Vitest service + e2e |
| R6C-3 | ตั้งของคนอื่นไม่ได้ / ไม่ใช่สมาชิก / super admin ที่ไม่ใช่สมาชิก / must_change_pin / ไม่มี CSRF → ถูกปฏิเสธที่เซิร์ฟเวอร์ · ค่านอก 1–10 → 400 | Vitest API + เมทริกซ์ role×action |
| R6C-4 | migration ขึ้นได้บนฐานที่มีข้อมูลเดิม · CHECK กันค่านอกช่วง · ไม่ backfill | migration check (CI test+migration) |
| R6C-5 | picker: 375/390/768 × th/en × สว่าง/มืด ไม่ล้น · ปุ่ม ≥ 44px · ใช้คีย์บอร์ดได้ · ชื่อสี/รูปทรงอ่านได้ด้วย screen reader · ไม่มี hex/px นอก tokens | e2e `checkLayout` + `check-style-literals.sh` |
| R6C-6 | ตั้งแล้วเห็นผลในปฏิทินเดือน/วัน, รายชื่อสมาชิก, RSVP ในนัด | e2e |
| R6C-7 | L2: ปุ่มแถบบนจอกว้างซ่อนตอน gone/error/loading · L3: R6B-1 ผ่านธีมมืด · L4: ภาพหลังเลื่อนลงสุด | e2e |
| R6C-8 | ไม่ถอยหลัง | CI ของ PR เขียวครบ + Vercel preview เขียว |

## 5. ลำดับงาน
platform + auth (schema/API/rbac) → ux (ชื่อ + ทิศทาง picker) → frontend → test → ops → **qa + security** (ตรวจอิสระ) → secretary → main เปิด PR

## 6. ความเสี่ยง
- เปลี่ยน `data-slot` → `data-color`/`data-shape` แตะหลายคอมโพเนนต์ → test ต้องครอบ e2e เดิมที่อ้าง `data-slot`
- ผู้ใช้เลือกสี+รูปทรงเหมือนคนอื่นทุกอย่าง → แยกกันด้วยตัวอักษรย่อในอวาตาร์ (มีอยู่แล้ว) · จุดเล็กในปฏิทินจะดูเหมือนกัน — ยอมรับตามที่ boss เลือก "ซ้ำกันได้"
- migration บนฐานจริง (Turso): คอลัมน์ nullable เพิ่มอย่างเดียว ความเสี่ยงต่ำ · boss รัน migration ตามขั้นตอนใน docs/OPERATIONS.md
