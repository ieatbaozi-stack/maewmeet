# กระบวนการทำงาน Full Loop (software engineering ไม่ใช่ vibe code)

หลักการ: **เขียนข้อตกลงก่อนโค้ด · ทุกงานมีเกณฑ์ผ่านที่ตรวจได้ · คนทำกับคนตรวจเป็นคนละ agent · คนทำต้องตรวจตัวเองและยืนยันด้วยหลักฐานก่อนส่ง · ไม่มีอะไรเข้าโดยไม่ผ่านเกต**
ทีม: [TEAM.md](TEAM.md) · เลขา: [SECRETARY.md](SECRETARY.md)

## เฟสของโปรเจกต์

```
เฟส 0  Discovery     วิจัย LINE/stack/ข้อจำกัด → docs/research/RESEARCH_REPORT.md   (เสร็จ)
   ▼
เฟส 1  Requirements  boss ตัดสินใจตารางข้อ 9 → Lead สรุปลง PRD            (อนุมัติแล้ว 2026-10-15)
                     (docs/prd/PRD.md: user stories, ขอบเขต v1/v1.x/ไม่ทำ, เกณฑ์รับงาน) → boss อนุมัติ
   ▼
เฟส 2  Design        Architect: ADR + data model | UX: flow/wireframe มือถือ + design tokens + ชุดภาพแมว
                     → boss ดู wireframe + หน้าตัวอย่าง 3 หน้า (หน้าหลัก/ปฏิทิน/สร้างนัด) และอนุมัติก่อนเขียนโค้ด
   ▼
เฟส 3  Foundation    โครงโปรเจกต์, CI, migration, release system, tokens/ธีม, RBAC skeleton
                     (ต้องเขียวทั้ง lint/typecheck/test/build ก่อนแตกงานขนาน)
   ▼
เฟส 4  Build (ขนาน)  ตาม CONTRACT รอบนั้น — แต่ละบทบาทแตะเฉพาะไฟล์ของตน
                     ทุกบทบาทจบด้วย **ตรวจตัวเอง + Handoff Certificate**
   ▼
เฟส 5  Review        QA + Security&Privacy (คนละ agent กับคนทำ) รันซ้ำเอง → commit "qa: … fixes"
   ▼
เฟส 6  Integrate     Lead รวม ทดสอบซ้ำบน viewport มือถือจริง/emulator → เสนอเลขเวอร์ชัน → boss รัน release และ push
   ▼
เฟส 7  Report        เลขาเขียน docs/reports/YYYY-MM-DD.md
```
หลังเปิดใช้: การเพิ่ม/เปลี่ยนความต้องการวนเฟส 1→7 ในขนาดเล็กลง (change request สั้นๆ → contract รอบใหม่)

## กติกาที่ทำให้ไม่ใช่ vibe code

1. **ไม่มี contract ไม่มีโค้ด** — `*_CONTRACT.md` ระบุ: เป้าหมาย, user story, API/ชนิดข้อมูล, ใครดูแลไฟล์ไหน, เกณฑ์ผ่าน (ตรวจได้ด้วยคำสั่ง/เทสต์)
2. **เทสต์มาพร้อมโค้ด** — ทุกบทบาทที่เขียนโค้ดเขียนเทสต์ของตัวเองในงานเดียวกัน
3. **ขอบเขตไฟล์** — ห้ามแก้นอกขอบเขต ถ้าต้องแก้ให้เสนอผ่าน Lead (ยกเว้นผู้ตรวจอิสระ)
4. **ตัดสินใจสำคัญต้องมี ADR** (`docs/adr/NNNN-*.md`) เช่น วิธีเก็บ/ตรวจ PIN, โมเดลสิทธิ์ (RBAC), การเก็บเวลา/timezone, อัลกอริทึมวันว่างร่วม, ขอบเขตการมองเห็นของ busy ข้ามกลุ่ม
5. **Schema เปลี่ยนด้วย migration แบบมีเวอร์ชันเท่านั้น** (Drizzle) — CI ต้องรันทุก migration บน DB ว่างได้ ห้าม migration ที่ย้อนข้อมูลไม่ได้โดยไม่ผ่าน Lead
6. **สิทธิ์ตรวจที่เซิร์ฟเวอร์** — ทุก API เรียก policy กลางใน `src/lib/rbac/**` (ห้ามเช็ก role กระจายเป็น if ในแต่ละ route) และมีเทสต์เมทริกซ์ role × action ครอบทุกช่อง รวมกรณี "ไม่ใช่สมาชิกกลุ่มนั้น"
7. **SemVer ตั้งแต่ v0.1.0** + CHANGELOG (`[Unreleased]`) · agent เสนอเลข boss รันสคริปต์ release และ push · ชื่อรอบงานไม่ใช่เลขเวอร์ชัน
8. **ความลับ** (DB token, session secret, LINE channel secret/token) อยู่ใน env เท่านั้น มี `.env.example` ห้ามคอมมิตค่า
9. **ข้อมูลคนเป็นส่วนตัวโดยปริยาย** — ตารางว่าง/ไม่ว่างของใครมองเห็นได้เฉพาะคนในกลุ่มเดียวกัน; มีเทสต์ยืนยันว่าคนนอกกลุ่มเห็นไม่ได้
10. **เวลาเป็นจุดเสี่ยงอันดับต้น** — ใช้ไลบรารีกลาง `src/lib/calendar/**` เท่านั้น เทสต์ขอบเขต: ข้ามเที่ยงคืน, ข้ามเดือน/ปี, ช่วงหลายวัน, ทั้งวัน, เริ่ม=จบ, ปีอธิกสุรทิน
11. **ผู้ตรวจอิสระ** ตรวจจากเกณฑ์ใน contract + ใช้งานจริงบน viewport มือถือ (375/390/768px) ไม่ใช่แค่อ่านโค้ด

## ตรวจตัวเองก่อนส่ง และ Handoff Certificate (บังคับ)

ทุก agent ที่ส่งงาน ต้องทำตามนี้ **ก่อน** บอกว่าเสร็จ:

1. อ่าน "เกณฑ์ผ่าน" ใน contract รอบนั้นทีละข้อ
2. **รันคำสั่งตรวจจริง** (lint, typecheck, test ที่เกี่ยวข้อง, build) และเปิดดูผลงานจริง (หน้าจอ/เอกสาร/ผล API) ไม่ใช่อ่านโค้ดตัวเองแล้วเชื่อว่าถูก
3. ไล่ตรวจกับ **เช็กลิสต์เฉพาะบทบาท** (ด้านล่าง)
4. ถ้าพบปัญหา แก้แล้วรันซ้ำ จนผ่านจริง — ไม่ผ่านให้รายงานตรงๆ ว่าไม่ผ่านพร้อมเหตุผล ห้ามปิดเงียบ
5. แนบใบรับรองนี้ท้ายงาน (ใน PR/ข้อความส่งงานถึง Lead) — ใบรับรองที่ไม่มีผลคำสั่งจริงถือว่าไม่ได้ตรวจ

```markdown
## Handoff Certificate — <บทบาท> · <contract/รอบ> · <วันที่-เวลา>
### เกณฑ์ผ่านใน contract
| # | เกณฑ์ | ผล (ผ่าน/ไม่ผ่าน) | หลักฐาน (คำสั่ง + ผลจริง / ไฟล์ / ภาพหน้าจอ) |
### คำสั่งที่รันจริง
- `npm run lint` → <ผลจริง>
- `npm run typecheck` → <ผลจริง>
- `npm test -- <ขอบเขต>` → <ผ่าน X / ทั้งหมด Y>
### เช็กลิสต์เฉพาะบทบาท  [x] ผ่านแล้ว  [ ] ไม่ผ่าน (ระบุ)
### ไฟล์ที่แก้ (ทั้งหมดอยู่ในขอบเขตของบทบาทหรือไม่)
### สิ่งที่ไม่ได้ทำ / ข้อจำกัด / ความเสี่ยงที่รู้
### ยืนยัน: ข้าพเจ้าตรวจงานนี้ด้วยตนเองตามข้างต้น และผลทั้งหมดเป็นผลจริงจากการรัน
```

### เช็กลิสต์เฉพาะบทบาท (ขั้นต่ำ)
- **Platform / Auth & Access**: ทุก endpoint ผ่าน policy กลาง · เทสต์ role×action ครบ · ไม่มี PIN/hash/token ใน log และ response · lockout/throttle มีเทสต์ · migration รันบน DB ว่างผ่าน
- **Calendar & Time**: เทสต์ขอบเขตเวลาครบตามข้อ 10 · ผลว่างร่วมตรงกับตัวอย่างที่คำนวณมือใน contract · ไม่มีการคำนวณวันนอกไลบรารีกลาง
- **Front-end**: ตรวจครบ 4 ชุด (TH/EN × สว่าง/มืด) · ไม่มีข้อความ hard-code · คีย์ TH/EN ครบ · ใช้ได้มือเดียวบน 375px · ปุ่มแตะ ≥ 44px · ไม่มี horizontal scroll · มีสถานะ loading/ว่าง/error ครบ · ข้อความไทยทุกหน้าตรวจแล้ว · ไม่มีค่าสี/ระยะที่ไม่ได้มาจาก tokens · **ผ่าน Anti-slop checklist ใน UI_DIRECTION**
- **UX & Brand**: wireframe/ตัวอย่างครบทุกสถานะ · tokens ผ่านคอนทราสต์ (ตัวอักษร ≥ 4.5:1) · มีภาพหน้าจอ 375/390/768 แนบ
- **Integrations (LINE)**: ตรวจ `X-Line-Signature` ทุก webhook · ไม่ส่ง PIN ผ่านแชท · จัดการ 429/โควตาเต็ม + ผู้ใช้บล็อกบัญชี · outbox retry มีเทสต์
- **OPS / TEST / Release**: CI เขียวจริงบน branch สะอาด · เอกสารคำสั่งใช้งานตามนั้นแล้วรันได้

## เกต (Definition of Done) — ทุกรอบต้องผ่านก่อนส่งงาน

| เกต | คำสั่ง/วิธีตรวจ |
|---|---|
| Lint + Typecheck | `npm run lint` · `npm run typecheck` |
| Unit/Integration | `npm test` (Vitest, DB ชั่วคราวรัน migration จริง) |
| เมทริกซ์สิทธิ์ | เทสต์ role × action ครบ (super admin / group admin / moderator / member / ไม่ใช่สมาชิก / ไม่ได้ล็อกอิน) |
| เวลา/ปฏิทิน | เทสต์ขอบเขตเวลา + ตัวอย่างวันว่างร่วมที่คำนวณมือ |
| E2E มือถือ | `npm run test:e2e` (Playwright viewport 375 และ 768) ครอบ flow: สมัคร→เข้ากลุ่ม→ลง busy→เห็นวันว่าง→สร้างนัด |
| Build | `npm run build` |
| Migration | `drizzle-kit check` + apply ทุก migration บน DB ว่าง |
| A11y/UX | ปุ่มแตะ ≥ 44px, คอนทราสต์ตามข้างต้น, ใช้มือเดียวได้ในหน้าหลักและหน้าลง busy |
| UI Anti-slop | QA reviewer ตรวจตาม checklist ใน UI_DIRECTION พร้อมภาพหน้าจอ |
| Security | lockout/throttle, session, invite code, privilege escalation, ข้อมูลข้ามกลุ่มไม่รั่ว |
| ประสิทธิภาพ | Lighthouse มือถือบน preview: Performance/Accessibility ≥ เกณฑ์ที่ contract กำหนด |

## ธรรมเนียม git
- `user.name` = ชื่อบทบาท · commit แบบ conventional · 1 contract = 1 branch · Lead รวม · เอกสารล้วนไม่ต้องออกรุ่น

## รูปแบบ CONTRACT (แม่แบบ)
```markdown
# <ชื่อรอบ>_CONTRACT.md
## เป้าหมาย / user stories ที่ครอบคลุม
## ขอบเขต (ทำ / ไม่ทำ)
## API & ชนิดข้อมูล
## ความรับผิดชอบไฟล์ (บทบาท → ไฟล์)
## ลำดับ/ความขึ้นต่อกัน (อะไรขนานได้)
## เกณฑ์ผ่าน (คำสั่ง + ผลที่คาดหวัง ทีละข้อ มีเลขข้อ ให้ Handoff Certificate อ้างได้)
## ความเสี่ยง / สิ่งที่ boss ต้องตัดสินใจ
```

## แผนรอบงานเริ่มต้น (ข้อเสนอ ปรับได้หลัง boss ตัดสินใจ)

| รอบ | เนื้อหา | บทบาทหลัก |
|---|---|---|
| R0 | Foundation: โครงโปรเจกต์ + CI + migration + release + design tokens/ธีมพาสเทล + RBAC skeleton | Lead, Full-stack, OPS, Release, TEST, UX |
| R1 | บัญชี: สมัคร/เข้าสู่ระบบด้วย PIN 6 หลัก, lockout, session, ขอ reset PIN → admin approve → ตั้งเป็น 123456 + บังคับเปลี่ยน, isadmin flag, shell หน้า super admin เฉพาะ approve reset | Auth & Access, Platform, Front-end, Security&Privacy |
| R2 | กลุ่ม: สร้าง/แก้ชื่อ/ลบกลุ่ม, สมาชิก, บทบาท (admin/moderator/member), ชวนตรง + invite code (สร้างจากสมาชิก, แชร์ได้, ใช้เข้ากลุ่ม), ออก/เตะ | Platform, Auth & Access, Front-end, Security&Privacy |
| R3 | **Core: ปฏิทินกลุ่ม + ลง busy (ช่วงหลายวัน/ทั้งวัน/ช่วงชั่วโมง + บอกว่าทำอะไร)** มุมมองเดือน/วัน | Calendar & Time, Platform, Front-end, TEST |
| R4 | **วันว่างร่วม + สร้างนัด** (สถานที่, pin, เวลา, RSVP) + **หน้าหลักโชว์ upcoming เด่น** | Calendar & Time, Platform, Front-end |
| R5 | หน้า super admin เต็ม (จัดการกลุ่ม/ผู้ใช้/reset), audit log, จัดการสมาชิกในกลุ่มครบ | Full-stack, Security&Privacy |
| R6 | Hardening + ขัด UI/UX + ทดสอบบนอุปกรณ์จริง (มือถือ/iPad) + ความพร้อมเปิดใช้ | QA, OPS, UX, Lead |
| R7 (v1.x) | LINE: ผูกบัญชี/Login, push แจ้งเตือน reset PIN approve และนัดใหม่/เตือนก่อนนัด | Integrations (LINE), Security&Privacy |
