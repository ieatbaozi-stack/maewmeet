# R6E_CONTRACT.md — เก็บงานค้างหลัง v0.8.0 (backlog R6C/R6D + F5)

> ผู้เขียน: main · 2026-11-02 · สถานะ: **ร่าง รอ boss เห็นชอบ**
> ที่มา: PROGRESS.md "เหลือ" · `docs/reports/qa-r6d.md` L1–L4 · `security-r6d.md` L1 · `security-r6c.md` L2 · `qa-r6c.md` L2 · NEXT_PHASE F5
> branch: `chore/r6e-cleanup` · ข้อเสนอเลขเวอร์ชัน: **v0.8.1** (PATCH — แก้ข้อความ/เลย์เอาต์/เทสต์/เอกสาร ไม่มีพฤติกรรมใหม่) · **ไม่มี migration · ไม่แตะ API/schema/RBAC**

## 1. งาน
| # | เรื่อง | ทำ | ไม่ทำ |
|---|---|---|---|
| E1 | qa-r6d L1 — "และอีก 1+ รายการ" | เปลี่ยน `appointments.goingConfirm.conflictMore` เป็นข้อความไม่มีตัวเลข (ux เลือกคำ เช่น "และนัดอื่นอีก" / "and more") · `RsvpConfirm.tsx` เลิกส่ง `count: "1+"` | ไม่เปลี่ยน API ให้ส่งจำนวนจริง |
| E2 | qa-r6d L2 — ปุ่ม "ไปทั้งสองนัด" ตอนชนกับ busy ที่ลงเอง | ชนเฉพาะ busy ที่ลงเอง (ไม่มีนัดอื่น) → ใช้ชื่อปุ่มอีกแบบ (ux เลือกคำ เช่น "ไปนัดนี้" / "Go anyway") · ชนกับนัด (มีหรือไม่มี busy ร่วม) → "ไปทั้งสองนัด" เหมือนเดิม | ไม่เปลี่ยนกติกาเตือน/ไม่บล็อก |
| E3 | qa-r6d L3 — มุมมองวัน 375 ชื่อนัดยาวถูกบีบ | แถวป้ายชนิด (ไอคอน + "นัด: <ชื่อ>") ชิดซ้าย ไอคอนติดข้อความ ชื่อยาวขึ้นบรรทัดใหม่เต็มความกว้าง ไม่เป็นคอลัมน์แคบ | ไม่เปลี่ยนมุมมองเดือน |
| E4 | qa-r6d L4 — "Can't go" ตัด 2 บรรทัดที่ 768 EN | ปุ่ม RSVP ทั้ง 3 ปุ่มอยู่บรรทัดเดียวที่ 375/390/768 ทั้ง TH/EN (ปรับเลย์เอาต์ก่อน ถ้าไม่พอ ux ปรับคำ) · ปุ่ม ≥ 44px | — |
| E5 | security-r6d L1 — assertion e2e ผ่อนเกิน | `tests/e2e/appt-story.spec.ts:130-131` ใช้รูปแบบในรายงาน: ลบเฉพาะรูป `myConflicts` ที่อนุญาตก่อน แล้วห้าม `CT` ในทุก response ของ B · ตรวจว่า `1541016` ทำไปแล้วแค่ไหน ไม่ทำซ้ำ | — |
| E6 | security-r6c L2 — `authorize-first.test.ts:154` ล้มบน Windows | normalize path ด้วย `rel(f)` (มีอยู่แล้วบรรทัด 31) ก่อนเทียบ `/route.ts` และ `/_lib/` · ต้องผ่านทั้ง Windows และ CI | ไม่แก้ปัญหา EPERM/CRLF อื่นบน Windows (นอกขอบเขต — จดไว้เหมือนเดิม) |
| E7 | `home-rsvp-hint` เป็น id ไม่ใช่ testid | เพิ่ม `data-testid="home-rsvp-hint"` ใน `HomeView.tsx` (คง id ไว้ เพราะ `aria-describedby` ใช้) | — |
| E8 | qa-r6c L2 — ไฟล์ตัวอย่างดีไซน์ยังใช้ `data-slot` | `docs/design/samples/*.html` (11 ไฟล์) เปลี่ยนเป็น `data-color` / `data-shape` ให้ตรงโค้ดจริง | — |
| E9 | ADR 0009 ไม่ตรงโค้ด | §5 body เป็น `{ gid }` · ลบ/ปิดหมายเหตุ "ให้ main ยืนยัน" เรื่องเลข 0008→0009 (main ยืนยันแล้ว: ใช้ **0009**) · ไม่แก้ contract/commit เก่า | — |
| E10 | F5 หน้า /privacy | **รอ boss เลือก (§4)** · ข้อความเตือนตอนนี้ (`privacy.draft`) ตรงกับคำใน NEXT_PHASE แล้ว | ไม่แก้เนื้อหานโยบาย |

**ไม่อยู่ในรอบนี้:** security-r6d Info 5 (`myConflict` เพดาน 500 ไม่มีธง truncated — ผลแค่ UI, เก็บไว้ hardening) · R6 hardening อื่น · F1/F2/F6

## 2. ไฟล์ (บทบาท)
| บทบาท | ไฟล์ | งาน |
|---|---|---|
| ux | `messages/th.json`, `messages/en.json` (+ `privacy.*` ถ้า E10 ต้องแก้) | E1, E2 (คำ), E4 (ถ้าต้องปรับคำ), E10 |
| frontend | `src/components/appointments/RsvpConfirm.tsx`, `RsvpControl.tsx`, ไฟล์มุมมองวันใน `src/components/calendar/**` (DayPanel/BusyItemLine), `src/components/home/HomeView.tsx`, `src/app/privacy/page.tsx` (ถ้า E10 = ลบป้าย) + เทสต์ ui ที่เกี่ยว | E1, E2 (ตรรกะเลือกคำ), E3, E4, E7, E10 · e2e/screenshot ของ E3/E4 |
| test | `tests/e2e/appt-story.spec.ts`, `tests/security/authorize-first.test.ts` | E5, E6 |
| architect | `docs/adr/0009-going-counts-as-busy.md`, `docs/design/samples/*.html` | E8, E9 |
| ops | `CHANGELOG.md` (ส่วน `[Unreleased]`) | สรุปรอบ |
| qa | ตรวจอิสระ → `docs/reports/qa-r6e.md` | ทุกข้อ |
| security | ตรวจอิสระ → `docs/reports/security-r6e.md` | E5 (ยืนยันว่า assertion จับการรั่วได้จริง) + ตรวจซ้ำ R6D L1/L2 หลัง `814136b`/`1541016` · ยืนยันว่ารอบนี้ไม่แตะ api/auth/schema |
| secretary | `PROGRESS.md` | แก้สถานะให้ตรงว่า v0.8.0 ออกแล้ว (ตอนเริ่ม) · ปิดรอบ (ตอนจบ) |

ถ้าต้องแก้ไฟล์นอกตารางนี้ → หยุดแล้วเสนอ main

## 3. เกณฑ์ผ่าน
| # | เกณฑ์ | วิธีตรวจ |
|---|---|---|
| R6E-1 | popup ยืนยัน "ไป" ที่ชนเกิน 4 รายการ แสดงข้อความต่อท้ายแบบไม่มีตัวเลข ทั้ง TH/EN | Vitest ui + e2e |
| R6E-2 | ชนเฉพาะ busy ที่ลงเอง → ปุ่มใช้คำใหม่ · ชนกับนัด → "ไปทั้งสองนัด" / "Going to both" | Vitest ui (ฟังก์ชันเลือกคำ) |
| R6E-3 | มุมมองวัน 375 ชื่อนัดยาว (และชื่อยาวไม่มีช่องว่าง) ไอคอนติดข้อความ ไม่เป็นคอลัมน์แคบ ไม่ล้น | e2e `checkLayout` + screenshot แนบรายงาน qa |
| R6E-4 | ปุ่ม RSVP 3 ปุ่มบรรทัดเดียว (วัดความสูงข้อความ = 1 บรรทัด) ที่ 375/390/768 × th/en × สว่าง/มืด · ≥ 44px | e2e |
| R6E-5 | assertion ใหม่ใน `appt-story.spec.ts` ผ่าน และ**ล้ม**เมื่อจำลองให้ `CT` หลุดไปทางอื่น (security/test ลองแก้ชั่วคราวแล้วรันให้เห็นว่าล้ม แล้วคืนค่า) | e2e + รายงาน security |
| R6E-6 | `npx vitest run tests/security/authorize-first.test.ts` ผ่านบนเครื่อง Windows และใน CI · จำนวน route ที่สแกน ≥ 20 | รันจริง (แนบผล) |
| R6E-7 | `grep -rn data-slot docs/design/samples` ว่าง · ADR 0009 ไม่มี `groupId` ใน body ของ current-group | รันจริง |
| R6E-8 | ไม่ถอยหลัง: lint · typecheck · `npm test` · e2e · CI เขียว · Vercel preview เขียว | CI + รันจริง |

## 4. ต้องให้ boss ตัดสิน (ก่อนเริ่ม)
- **E10 / F5 หน้า /privacy** — ข้อความตอนนี้: "ร่างโดยทีมผู้พัฒนาจากการทำงานจริงของแอป ไม่ใช่คำปรึกษาทางกฎหมาย เจ้าของแอปต้องอ่านและรับรองก่อนเปิดให้คนทั่วไปใช้"
  - (ก) **คงไว้ตามเดิม** — ถือว่า F5 เสร็จ ไม่แก้อะไร (main เสนอ ถ้า boss ยังไม่ได้อ่านนโยบายทั้งหน้า)
  - (ข) boss อ่านและรับรองแล้ว → ลบป้ายเตือน + เปลี่ยน "ร่างล่าสุด" เป็น "ปรับปรุงล่าสุด <วันที่ boss กำหนด>"
- ยืนยันเลขเวอร์ชัน **v0.8.1**

## 5. ลำดับงาน
secretary (แก้ PROGRESS ให้ตรง) → **ux** (คำ E1/E2/E4/E10) → **frontend** (E1–E4, E7, E10) ขนานกับ **test** (E5, E6) และ **architect** (E8, E9) → ops (CHANGELOG) → **qa + security** (อิสระ) → secretary (ปิดรอบ) → main เปิด PR เข้า `main` แล้วหยุด

ทุกบทบาทแนบ Handoff Certificate ที่มีผลคำสั่งจริง · commit ใช้ชื่อบทบาท + อีเมล noreply ของ boss

## 6. ความเสี่ยง
- E4 ปรับเลย์เอาต์ปุ่ม RSVP กระทบหน้าหลัก/หน้านัด/การ์ด → qa ตรวจทุกที่ที่ใช้ `RsvpControl`
- E5 ถ้า assertion แม่นเกิน อาจ flake เมื่อรูป payload เปลี่ยน → ผูกกับลำดับคีย์ของ `toMyConflictDto` และเขียนข้อความ error ให้ชี้ที่มา
- E8 ไฟล์ตัวอย่างไม่มีเทสต์ → ตรวจด้วย grep + เปิดดูด้วยตาอย่างน้อย 2 ไฟล์
