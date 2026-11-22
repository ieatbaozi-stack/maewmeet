# V1 UI audit (R18 V5) — ก่อนออก v1.0

> เจ้าของ: UX & Brand · branch `feat/r18-v1` · วันที่ 2026-11-22 · boss ตัดสิน **B5 = (ก)**: ขัดเกลาในทิศทางเดิม (UI_DIRECTION, แมวเส้นเรียบ, tokens เดิม) — ไม่จัดโครงหน้าใหม่ ไม่เปลี่ยนโลกภาพ ไม่แทน DESIGN.md
> เครื่องมือ: skill **impeccable** v4.10 (โหมด **Operate**: แอปจัดตารางกลุ่มบนมือถือ) · ใช้ `audit` + `critique` (ประเมินเอง ไม่แยก sub-agent — ดู "ข้อจำกัด") + `polish`/`operate`/`craft-floor` เป็นเกณฑ์
> ผู้แก้ต่อ: copy = ux (แก้แล้วในรอบนี้) · โค้ด/CSS = **frontend** ตามรายการด้านล่าง

## 0. วิธีตรวจและสิ่งที่ครอบคลุม (ตามจริง)

| รายการ | ผล |
|---|---|
| `impeccable context` (ที่ root worktree) | รันได้ · รายงาน `NO_PRODUCT_MD`, `CONTEXT_STALE: hook-not-installed` — **ไม่รัน init/document/hooks/doctor** ตามคำสั่ง boss (ไม่มี PRODUCT.md/DESIGN.md ของ impeccable — ถือโค้ด + `UI_DIRECTION.md` เป็นต้นฉบับ) |
| `impeccable detect --json src/app src/components` | `[]` (ไม่มี finding) — เครื่องมือไม่ตัดสินเลย์เอาต์ จึงไม่ใช่หลักฐานว่า "สะอาด" |
| `impeccable shot` | **ไม่ได้ใช้** (ไม่รันกับ server ที่มี login/ข้อมูลฉาก) — ใช้ Playwright แทน: สคริปต์ชั่วคราว `tests/e2e/zz-v5-audit.spec.ts` (ไม่ commit) บน `next start` (build สดจาก branch นี้) ฉากสร้างผ่าน helper ใน `tests/e2e/support` (บัญชีสุ่ม · localhost · DB ชั่วคราว) |
| ภาพหน้าจอ | `C:\Users\User\AppData\Local\Temp\claude\1d0dca38be1beda5\fd1fc175-7570-4576-aa30-2927db11a886\scratchpad\v5\<project>\<lang>-<theme>\*.png` (นอก repo · ~60 ภาพต่อชุด) |
| ขนาด × ภาษา × ธีม ที่ถ่ายจริง | **ครบ 12 ชุด** (375/390/768 × th/en × light/dark) ชุดละ ~59 ภาพ · **ดูด้วยตา** เฉพาะบางหน้าต่อชุด (หลักๆ 375 ทั้ง 4 ชุด, 768 th-light + en-light + ปฏิทิน/แชร์, 390 ไม่ได้เปิดดูภาพ นอกจากตัววัด) |
| ตรวจเชิงวัด (ทุกภาพที่ถ่าย) | ไม่มี horizontal scroll · ปุ่ม/ลิงก์/อินพุตที่มองเห็นทุกตัว ≥ 44×44 · `<h1>` หนึ่งตัวต่อหน้า — **ผ่านทุกหน้าที่ถ่าย** (ซ้ำกับเกต e2e `checkLayout` เดิม) |
| คอนทราสต์ | `npm run contrast` → **338 คู่ ไม่ผ่าน 0 · ต่ำสุด 4.54:1** (ทั้งสองธีม รวมคู่บน aurora). ตัววัดคอนทราสต์จากหน้าจริงที่เขียนเองในสคริปต์ **ใช้ไม่ได้** (คำนวณพื้นหลังผิดบนสีแบบ color-mix) จึง **ไม่ใช้เป็นหลักฐาน** — การตัดสินคอนทราสต์อิงตาราง tokens + ตาดูภาพ |
| หน้าที่ถ่าย | login · signup (ปกติ/ไม่ผ่านตรวจ) · forgot (+ส่งแล้ว) · set-pin · login หลังขอ reset · privacy · 404 · `/i/<token>` (ไม่ถูกต้อง / ยังไม่ login / login แล้ว) · home (มีนัด/ว่าง/การ์ดแนะนำ) · groups (ว่าง/มี) · group + settings (admin/member) · รายการนัดกลุ่ม · calendar เดือน/ของฉัน/ว่างตรงกัน/วัน · sheet: busy (3 แบบ+ประกาศแรก) / routine / สร้างนัด (+error) / แก้นัด / แชร์ / สลับกลุ่ม / free-detail · นัด (สมาชิก/ยกเลิก/มีแขก) · หน้าแขก + home ของแขก · notifications (ว่าง/มี) · me · admin (hub/users/groups/group/resets/audit) · non-admin เข้า /admin |
| ที่ **ไม่ได้ถ่าย** | สถานะ loading/error ของแต่ละหน้า (ตรวจจากโค้ด `loading.tsx`/`ErrorState` เท่านั้น) · sheet add-to-calendar และ invite-code (สคริปต์หาปุ่มไม่เจอใน 2 ขั้นนี้ — ปัญหาของสคริปต์ ไม่ใช่ของแอป) · การดูภาพ 768 × dark และ 390 (ดู §0.1) · `/i/<token>` สถานะ "หมดอายุ/rate" (ไม่มีทางสร้างด้วย helper) |

### 0.1 ข้อจำกัด
- `critique` ปกติต้องแยก sub-agent สองตัว (A ประเมินออกแบบ / B detector) — ตัวนี้ทำเป็น agent ย่อยเดี่ยว จึงเป็น **single-context** (ไม่ใช่ dual-agent) · detector รันแยกหลังประเมินแล้ว (ผล `[]`)
- ตัววัดอัตโนมัติ (overflow / target 44 / h1) รันครบทั้ง 12 ชุดและสะอาด แต่ **การดูภาพด้วยตาไม่ครบทุกหน้า × ทุกชุด** (ดูตัวแทน) — finding ที่ระบุขนาด/ภาษา/ธีมคือที่เห็นจริง ส่วนชุดอื่นคาดว่าเหมือนกันเพราะใช้คอมโพเนนต์เดียว · แนะนำให้ QA ดูซ้ำชุดที่ไม่ได้เปิด
- เกณฑ์ "ภาพเต็มหน้า (fullPage)" ทำให้ bottom nav/ปุ่มลอย (fixed) ไปปรากฏกลางภาพ — **เป็นเรื่องของเครื่องมือ ไม่นับเป็นปัญหา**

## 1. คะแนนสุขภาพ (รูปแบบ impeccable audit)

| # | มิติ | คะแนน | ประเด็นหลัก |
|---|---|---|---|
| 1 | Accessibility | 3 | tokens ผ่าน AA ทั้งชุด · target ≥ 44 ทุกจุดที่วัด · h1 ครบ · ติดเรื่อง alert ดันแป้น PIN, bar ซ้ายของ unread |
| 2 | Performance | 3 | ไม่ได้วัด (ไม่ใช่ขอบเขตรอบนี้) — ไม่พบแอนิเมชันหนัก/ภาพใหญ่จากการดู |
| 3 | Theming | 4 | สองธีมคู่กันจริง โครง/ลำดับเหมือนกัน ไม่เห็นสีที่ผิดธีมในภาพที่ดู (ไม่ได้ grep หา hard-code ในโค้ด) |
| 4 | Responsive | 3 | 375/390 สะอาด · 768 หัวหน้าไม่ตรงคอลัมน์เนื้อหา |
| 5 | Implementation integrity | 3 | ระบบ component สม่ำเสมอ (ปุ่ม/การ์ด/sheet/tag/segmented ตัวเดียวกันทุกหน้า) · มี drift เล็กน้อยใน §3 |
| | **รวม** | **16/20** | Good — แก้ P2 ด้านล่างก่อนปล่อย v1.0 ได้ภายในรอบเดียว |

**Implementation Integrity verdict: ผ่าน** — เป็นระบบเฉพาะของแอปนี้ (แมวเส้นเรียบเป็นไอคอน/ภาพว่าง, พาสเทล+หมึกเข้ม, segmented/sheet/ปุ่มคู่) ไม่สลับสลับกับสินค้าอื่น · ไม่มี gradient ตัวอักษร/glass/เงาแข็ง · aurora ใช้ตามกติกา §3.5 เท่านั้น

## 2. สรุปจำนวน

| ระดับ | จำนวน | หมายเหตุ |
|---|---|---|
| **P0** (พัง) | **0** | ไม่พบงานที่ทำไม่ได้ |
| **P1** (กระทบการใช้) | **0** | ไม่พบ — ข้อที่เสี่ยงที่สุดคือ F01 (แป้น PIN ถูกดันลงตอนพิมพ์) ตัดสินเป็น P2 เพราะเกิดตอนล็อก/ผิดเท่านั้น |
| **P2** (ขัดเกลา) | **14** | F01–F13, F19 |
| **P3** (เล็กน้อย) | **6** | F14–F18, F20 |
| copy ที่แก้แล้ว | 3 คีย์ + 1 คีย์ใหม่ + 1 ชุดใหม่ (G1) | ดู §4 |

> **ไม่มี P0/P1 → ไม่ต้องรอการแก้ก่อน merge** แต่ F01, F02, F03, F07 เห็นชัดที่สุด แนะนำให้ frontend ทำก่อน

## 3. Findings

รูปแบบ: **ID · หน้า · ขนาด/ภาษา/ธีม · ปัญหา · ความรุนแรง · วิธีแก้ (token/คลาส/copy) · ผู้รับผิดชอบ** · ภาพอยู่ใน scratch `v5/…` (ชื่อไฟล์ในวงเล็บ)

### P2
**F01 · Login (และทุกหน้าที่ใช้ PinPad) · 375 th-light (เห็นที่ 375 th-light · คาดว่าเหมือนกันทุกชุดเพราะใช้คอมโพเนนต์เดียว แต่ไม่ได้เปิดดูทุกชุด) · alert "ล็อกไว้ชั่วคราว/PIN ผิด" แทรกระหว่างจุด PIN กับแป้น ดันแป้นลง ~350 px กลางจังหวะกดเลข** (`mobile-375/th-light/pub-login-error.png`) — นิ้วที่กำลังกดเลขเสียตำแหน่ง · วิธีแก้: ย้ายกล่อง alert ไปเหนือช่อง "ชื่อผู้ใช้" (หรือใต้ชื่อผู้ใช้) ที่ `min-height` คงที่/ไม่ดันแป้น; คงเป็น `role="alert"` เดิม · owner: **frontend** (`src/components/auth/AuthScreen`/`PinPad`, CSS ของ login)

**F02 · `/i/<token>` (ShareLanding) · 375 en-light (th ด้วย) · บรรทัดสถานที่ถูกจัดกึ่งกลางไม่ตรงกับบรรทัดวันที่/กลุ่ม (ข้อความเริ่มที่ x≈183 แต่ชื่อร้านลอยอยู่กลาง)** (`en-light/share-landing-loggedout.png`) · แก้: `.share-card [data-testid="share-place"]` (หรือ `li` ในรายการ) ให้ `text-align:start` + โครง flex เดียวกับแถวอื่น; ปุ่ม "ค้นใน Google Maps" ให้ย่อหน้าตรงกับข้อความ (ทำอยู่แล้ว) · owner: **frontend** (`src/components/share/ShareLanding.tsx` + CSS)

**F03 · `/i/<token>` · 375 en · ช่วงเวลาถูกตัดกลางตัวเลข "18:30–" / "21:00"** · แก้: ห่อช่วงเวลาด้วย `white-space:nowrap` (เช่นใช้ `.num` + `nowrap`) และให้ตัวคั่น " · " เป็นจุดตัดบรรทัดแทน · owner: **frontend** (ShareLanding; ตรวจ `GuestAppointmentView` และแถวนัดที่มีช่วงเวลาด้วย)

**F04 · หน้านัดของแขก · 375 en-light · ใช้ "In {group}" / "กลุ่ม {group}" ทำให้ดูเหมือนแขกเป็นสมาชิก (ต่างจาก landing ที่ใช้ "From …")** (`en-light/guest-appt.png`) · แก้: ใช้คีย์ใหม่ **`guest.fromGroup`** ("จากกลุ่ม {group}" / "From {group}") แทน `appointments.detail.inGroup` ใน `GuestAppointmentView.tsx` บรรทัด `appt-group-text` · copy ทำแล้ว · owner: **frontend** (ผูกคีย์)

**F05 · Share sheet · 375 th-light · เนื้อหา 6 ก้อน (lead, เห็น, ไม่เห็น, ของคุณ, จำกัด, ใช้ได้ถึง) + "ปิดลิงก์ของฉัน" ชนกับแถบปุ่ม "เสร็จแล้ว" ที่ติดล่าง (ลิงก์สีแดงโดนตัดครึ่ง/ชิดขอบ)** (`th-light/sheet-share.png`) · แก้: (1) เพิ่ม `padding-bottom` ของส่วนเลื่อนใน sheet ≥ ความสูงแถบล่าง + 16 px (2) รวม "จำกัด N คน" และ "ใช้ได้ถึงนัดจบ" เป็นบรรทัดเดียว (copy: ให้ frontend ต่อ `share.sheet.limit` + `share.sheet.valid` ด้วย " · ") · owner: **frontend** (`ShareSheet.tsx`, `Sheet.tsx` css)

**F06 · Notifications · 375 th/en ทั้งสองธีม · มี "แถบสีด้านซ้ายยาวเต็มความสูง" ของแถวที่ยังไม่อ่าน (ซ้ำกับจุดสีที่ขวา) — เป็นรูปแบบ one-sided bar ที่ craft-floor ห้าม** (`en-dark/own-notifications.png`) · แก้: ลบแถบ (`border-inline-start`/pseudo) ใช้ tint พื้น `--accent-soft` + จุดเดิม + ตัวหนาเดิม · owner: **frontend** (CSS ของ `.notif-*`)

**F07 · Notifications · 375 en-dark · ข้อความถูกตัดที่ 3 บรรทัดด้วย "…" ตัดชื่อกลุ่ม/เวลาที่สำคัญทิ้ง ("…is now Wed 25 Nov 08:35 in…")** · แก้: เพิ่ม line-clamp เป็น 4 หรือยกชื่อกลุ่มไปเป็นบรรทัดรอง (`.notif-sub`) · owner: **frontend** (`NotificationRow`)

**F08 · ปฏิทินมุมมองวัน · 375 en-dark · แถวของ "ฉัน" ใช้เลย์เอาต์ต่างจากสมาชิกอื่น (เวลาชิดขวาบน + ชื่อแตกเป็น "แมวส้ม / Own You" สามบรรทัดพร้อมแถวปุ่ม) ขณะที่แถวคนอื่นวางเวลาใต้ชื่อ** (`en-dark/own-cal-day.png`) · แก้: ใช้แม่แบบแถวเดียวกัน (ชื่อ+ป้าย "คุณ" บรรทัดเดียว truncate, เวลาใต้ชื่อ, ปุ่มแก้/ลบอยู่ปลายขวาของแถวเดียวกัน) · owner: **frontend** (`DayPanel`/`BusyItemLine`)

**F09 · แอปทั้งหมด · 768 th-light · แถบหัวหน้า (โลโก้/ชื่อหน้า) ชิดซ้าย ~32 px แต่คอลัมน์เนื้อหาเริ่ม ~128 px (home, groups, group settings)** (`tablet-768/th-light/own-home.png`, `empty-groups.png`) · แก้: ให้ `TopBar` inner ใช้ `max-width`/`margin-inline:auto` ตัวเดียวกับ `.main` · owner: **frontend** (`TopBar`/`globals.css`)

**F10 · Admin hub · 375 en-light · eyebrow "System admin" ซ้ำกับหัวข้อ "System admin console" และ eyebrow เป็นรูปแบบที่ craft-floor ห้าม** · copy แก้แล้ว (หัวข้อ → "Admin console" / "แผงจัดการระบบ") · แก้โค้ด: ลบ `<p className="eyebrow">` ใน `admin/page.tsx` และ `admin/pin-resets/page.tsx` (หัวข้ออยู่ได้ด้วยตัวเอง) · owner: **frontend**

**F11 · Admin hub · 375 en-light · การ์ด "PIN reset requests" หัวข้อแตกสองบรรทัด เพราะป้าย "3 waiting" กินความกว้าง** (`en-light/admin-hub.png`) · แก้: ย้ายป้ายลงบรรทัดคำอธิบาย (หรือบนขวาเหนือหัวข้อ) · owner: **frontend** (`admin/page.tsx` card)

**F12 · Busy sheet · 375 en · แท็บ "Several days" ขึ้นสองบรรทัด สูงไม่เท่าแท็บอื่น** (`en-light/sheet-busy.png`) · copy **แก้แล้ว**: `busy.form.type.multi` EN → "Multi-day" · owner: ux (เสร็จ)

**F13 · รายละเอียดนัด (สมาชิก เห็นแขก) · 375 en-light · หัวข้อ "Guests · 1" น้ำหนักบางกว่าหัวข้อการ์ดอื่น ("Who's coming", "Manage this plan" ตัวหนา) และปุ่ม "นำออก/Remove" ไอคอนซ้อนอยู่เหนือข้อความ พร้อมขีดเส้นใต้สีแดง ต่างจากปุ่มทำลายอื่น (กรอบแดง)** (`en-light/own-appt-with-guest.png`) · แก้: หัวข้อใช้คลาสเดียวกับ `.appt-section h3`; `.guest-remove` `flex-direction:row` ไอคอนซ้ายข้อความ แบบ `btn-text` สีอันตรายตัวเดียวกับ "Leave this plan" · owner: **frontend** (`GuestsSection.tsx` + CSS)

**F19 · ปฏิทินมุมมองวัน (กราฟ "วันของทุกคน") · 768 en-light · ป้าย "Now" ชนกับเลขแกน "06" จนอ่านเป็น "06Now"** (`tablet-768/en-light/own-cal-month.png`) · แก้: ซ่อนเลขแกนที่อยู่ห่างเส้น "ตอนนี้" น้อยกว่า ~28 px หรือยกป้าย "Now" ขึ้นเหนือแถวเลขแกน · owner: **frontend** (`DayPanel` timeline)

### P3
**F14 · ฟอร์มข้อความ (busy/สร้างนัด/สถานที่) · ทุกขนาด · "Up to 80 characters" ซ้ำกับตัวนับ "0/80" ในช่อง** · แก้: ตัดข้อความช่วยออก (หรือตัดตัวนับ) · owner: ux+frontend (ลบการใช้คีย์ `…hint` ที่ซ้ำ; ux ไม่ลบคีย์เพื่อไม่ให้เทสต์พัง)
**F15 · Share sheet · 375 th · ข้อความ "…ป้าย "มากับ แมวส้ม Own"" ตัดบรรทัดกลางชื่อไทย ("แมว/ส้ม")** · แก้: ห่อชื่อด้วย `<bdi>` + `white-space:nowrap` ถ้าสั้นกว่า 24 ตัวอักษร · owner: **frontend** (`Name` component)
**F16 · Group settings · 768 · หน้าเดียว ~3,200 px (11 ส่วน) ช่องกรอก/select ยืดเต็มความกว้าง ไม่มีทางลัด** · แก้ในกรอบ B5: จำกัด `max-width` ของส่วนฟอร์มที่ ~560 px · owner: **frontend** (ห้ามจัดโครงใหม่)
**F17 · Routine sheet · 375 en · ข้อความ "Pick at least one day" ขึ้นทันทีตอนเปิดฟอร์มด้วยไอคอนเตือน ทั้งที่ยังไม่ได้กด** · แก้: ตอนยังไม่ submit ใช้สไตล์ข้อความช่วย (muted ไม่มีไอคอนเตือน) เปลี่ยนเป็น error หลังกดบันทึก · owner: **frontend**
**F18 · หน้าแขก · 375 · ข้อความ "ตอบ "ไป" = ช่วงนี้ไม่ว่างในทุกกลุ่ม" แสดงให้แขกซึ่งไม่ได้อยู่กลุ่มนี้** · ผลของ "ไป" ของแขกถูกนับเป็น busy ในกลุ่มเจ้าของนัดจริง (`listGuestGoingBusyInGroup`) ข้อความจึงไม่ผิด แต่คลุมเครือ · เสนอคีย์ `guest.goingHint` ภายหลัง (ไม่แก้ตอนนี้ เพื่อไม่ขยายขอบเขต) · owner: ux (รอบถัดไป)
**F20 · ปฏิทินเดือน · 768 · มีปุ่ม "วันนี้/Today" สองปุ่มเคียงกัน (ของเดือนกับของแผงวัน)** · แก้: เหลือปุ่มเดียวที่เลื่อนทั้งสองส่วน หรือใส่ aria-label ต่างกัน · owner: **frontend**

## 4. Copy ที่แก้แล้วในรอบนี้ (`messages/*.json`)
| คีย์ | ก่อน → หลัง | เหตุผล |
|---|---|---|
| `busy.form.type.multi` (EN) | "Several days" → "Multi-day" | แท็บ segmented ขึ้นสองบรรทัดที่ 375 (F12) |
| `admin.title` | EN "System admin console" → "Admin console" · TH "ดูแลระบบ" → "แผงจัดการระบบ" | ไม่ซ้ำ eyebrow "System admin/ผู้ดูแลระบบ" (F10) |
| `guest.fromGroup` (ใหม่) | EN "From {group}" · TH "จากกลุ่ม {group}" | ให้ frontend ใช้ในหน้าแขกแทน `inGroup` (F04) |
| `installHint.*` (ใหม่) | ดู G1 | แบนเนอร์ติดตั้งบน iPhone |
ผลเทสต์หลังแก้: `npx vitest run tests/i18n` → **4 files · 292 tests ผ่าน** (รันแล้ว)

## 5. สิ่งที่ทำได้ดี (รักษาไว้)
- สองธีมเป็น "แบรนด์เดียวกันตอนกลางคืน" จริง: โครง ระยะ น้ำหนัก ไอคอนเหมือนกันทุกหน้า มีแค่ค่าสีเปลี่ยน (ดูจากภาพ th-light, th-dark, en-light, en-dark ที่ 375 — ไม่ได้เทียบทุกหน้าทีละคู่)
- ใช้ไอคอนเส้นชุดเดียว + แมวเส้นเรียบเป็นภาพสถานะว่างที่มี "บทบาท" (ถือแผนที่/นั่งจิบชา/มองจากขอบ) ไม่ใช่ตกแต่ง
- สถานะต้องไม่พึ่งสีอย่างเดียว: จุดสมาชิกในเดือนใช้ทั้งสีและ "รูปทรง" (โค้ง/วงกลม/หกเหลี่ยม…), RSVP ไปไหม ใช้ไอคอนเส้นต่างกัน, ช่องว่างตรงกันมีตัวเลข+ลายเส้น
- ข้อความเตือนก่อนทำสิ่งที่ลบไม่ได้/มีคนอื่นเห็น (sheet แชร์ "จะเห็น / ไม่เห็น", ยืนยันนำแขกออก, ปิดลิงก์) ชัดและเป็นภาษาคนทั้งไทยและอังกฤษ ไม่แปลตรงตัว
- ข้อความ error บนฟอร์มบอกปัญหา+ทางแก้ ("ตั้งชื่อนัดก่อน", "Pick a day first.") และขอบสีแดงมีไอคอนกำกับ
- ปุ่มหลักหนึ่งปุ่มต่อหน้า (สร้างนัด/บันทึก/คัดลอกลิงก์) ใช้สี `--accent` เท่านั้น — ไม่มีสีสดบนปุ่มที่ไม่ได้ใช้

## 6. G1 — แบนเนอร์ "ติดตั้งบน iPhone" (boss อนุมัติ · §11 G1)

**เป้าหมาย:** แนะนำให้คนที่เปิดแอปใน Safari บน iPhone/iPad เพิ่มแอปไว้หน้าจอโฮม — บอกวิธี "แชร์ → เพิ่มไปยังหน้าจอโฮม" · ปิดแล้วไม่แสดงอีกบนเครื่องนี้

**เมื่อไหร่แสดง (เงื่อนไขทั้งหมดต้องจริง):**
1. UA เป็น iPhone/iPad Safari (iPadOS ที่ UA เป็น Mac: `navigator.maxTouchPoints > 1` + `/Macintosh/`) และ **ไม่ใช่** เบราว์เซอร์ใน in-app/ทางเลือก (CriOS, FxiOS, EdgiOS, Line/FB in-app: ไม่มี "Safari/" หรือมี `FBAN|FBAV|Line`) — เพราะเพิ่มไปหน้าจอโฮมทำได้ใน Safari เท่านั้น
2. ไม่ได้อยู่ในโหมด standalone: `!window.navigator.standalone` และ `!matchMedia('(display-mode: standalone)').matches`
3. ยังไม่เคยปิด: `localStorage["mm_install_hint_dismissed"] !== "1"` (key ใหม่ ห้ามชนกับ `mm_intro_seen`)
4. ผู้ใช้ล็อกอินแล้วและอยู่ในหน้าใน `(app)` เท่านั้น — **ไม่แสดงบน** `/login`, `/signup`, `/forgot`, `/set-pin`, `/i/<token>`, `/privacy` และ sheet/dialog (แสดงเมื่อหน้าอื่นไม่มี sheet เปิดอยู่)
5. ลำดับกับการ์ดแนะนำ (`home-intro`): ถ้า `home-intro` ยังเปิดอยู่ **ไม่แสดงแบนเนอร์นี้** (รอจนปิดการ์ดนั้น) — กันสองการ์ดซ้อนกัน

**ที่วาง (ไม่บล็อก ไม่บังแถบล่าง):**
- เป็นแถบ **ในกระแสเนื้อหา** (ไม่ใช่ `position:fixed`) ที่ **ด้านบนของ `<main>`** ในหน้า `/` (home) และ `/calendar` เท่านั้น — เลื่อนหายไปพร้อมหน้า · ไม่ทับ `TabBar` และไม่ชนปุ่มลอย "สร้างนัด/ลงวันไม่ว่าง"
- กว้างเท่าคอลัมน์เนื้อหา (`max-width` เดียวกับการ์ด) · ไม่แสดงที่ ≥ 768 px เมื่อไม่ใช่ iOS (เงื่อนไข 1 กันอยู่แล้ว)
- ใช้ `section.panel` (คลาสการ์ดเดิม) พื้น `--surface` เส้นขอบ `--line` มุม `--radius` ตามการ์ดแนะนำเดิม — **ไม่มีสีใหม่ ไม่มีเงา** · ไอคอนแมวเส้นหรือไอคอน "แชร์" ของชุด lucide เดิม ขนาด 24 px `aria-hidden`
- `role="region"` + `aria-label={t("installHint.region")}` · ไม่ใช้ `role="alert"` (ไม่ขัดจังหวะผู้ใช้ SR)

**โครง (บน → ล่าง):**
```
[ไอคอนแชร์]  <h2> installHint.title </h2>
             <p>  installHint.body </p>
             <ol>  1. installHint.step1   2. installHint.step2 </ol>
                                   [ปุ่ม btn-secondary: installHint.dismiss ]
```
- ปุ่มเดียว "เข้าใจแล้ว ไม่ต้องแสดงอีก" = เขียน `mm_install_hint_dismissed=1` แล้วถอดแบนเนอร์ (ไม่มีปุ่ม X แยก — หนึ่งทางปิด ชัดว่า "ไม่แสดงอีก") · ปุ่มสูง ≥ 44 px · focus ring ตาม token เดิม
- ไม่มีแอนิเมชันเข้า/ออก (Operate: ไม่ใช้ motion ตกแต่ง) · ถ้า localStorage เขียนไม่ได้ ให้ซ่อนในเซสชันนี้ (state ใน memory) แล้วไม่ error
- ธีม: ใช้ token ที่มี (ทั้งสองธีมผ่านคอนทราสต์อยู่แล้วเพราะเป็นพื้น `--surface` + ตัวอักษร `--ink` / `--ink-muted`) — **ไม่ต้องเพิ่ม token**

**คีย์ข้อความ (เพิ่มแล้วใน `messages/th.json` และ `en.json` ใต้ `installHint`):**
| คีย์ | TH | EN |
|---|---|---|
| `installHint.region` | คำแนะนำติดตั้งบน iPhone | Install tip for iPhone |
| `installHint.title` | เพิ่มแมวเจอกันไว้ที่หน้าจอโฮม | Add maewmeet to your Home Screen |
| `installHint.body` | แตะเปิดได้ทันทีเหมือนแอปทั่วไป ไม่ต้องหาลิงก์ | Open it in one tap, like any other app. |
| `installHint.step1` | แตะปุ่มแชร์ใน Safari (สี่เหลี่ยมที่มีลูกศรชี้ขึ้น) | Tap the Share button in Safari (the square with an arrow pointing up). |
| `installHint.step2` | เลื่อนลงแล้วแตะ “เพิ่มไปยังหน้าจอโฮม” | Scroll down and tap “Add to Home Screen”. |
| `installHint.dismiss` | เข้าใจแล้ว ไม่ต้องแสดงอีก | Got it, don’t show again |

หมายเหตุให้ frontend: (ก) ไม่ได้อ้างเรื่องแจ้งเตือน/push (แอปแจ้งเตือนผ่าน LINE OA) (ข) ชื่อเมนูใน iOS ไทยคือ "เพิ่มไปยังหน้าจอโฮม" — ถ้าทดสอบบนเครื่องจริงแล้วชื่อต่างจากนี้ ให้แจ้ง ux แก้คีย์ `step2` (ยังไม่ได้ตรวจบนอุปกรณ์จริง) (ค) เทสต์: unit ของฟังก์ชันตรวจ UA/standalone (ตารางกรณี Safari iPhone / Chrome iOS / iPadOS-Mac UA / standalone / dismissed) + e2e ว่าไม่โผล่บน Chromium Desktop และไม่โผล่ใน `/login`

## 7. ลำดับแนะนำให้ frontend (impeccable)
1. `/impeccable polish` รอบเดียวตาม F01 → F13 (ชิ้นเล็ก CSS/คลาส ส่วนมากไม่แตะ logic) — F01, F02, F03, F06, F07 ก่อน
2. `/impeccable layout` เฉพาะ F08, F09 (แม่แบบแถว + แถบหัวหน้า)
3. G1 ตามสเปกใน §6 (รวมเทสต์)
4. ให้ QA รันสคริปต์ถ่ายภาพ 768 × en/dark ซ้ำ + ตรวจ F-list ซ้ำหลังแก้ (ผู้ตรวจอิสระ กฎ 5)
