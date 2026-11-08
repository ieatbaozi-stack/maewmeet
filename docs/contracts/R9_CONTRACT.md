# R9_CONTRACT.md — README มาตรฐาน + จัด root ของ repo ให้สะอาด

> ผู้เขียน: main · 2026-11-09 · สถานะ: **boss เห็นชอบแล้ว** 2026-11-09 ("เห็นชอบ ไม่ใส่ License")
> ที่มา: repo เปิด public แล้ว · README เดิมเขียนสำหรับ agent และล้าสมัย ("มีแค่เอกสาร", "private", สถานะค้างที่ R0)
> branch: `docs/r9-readme` · **ไม่แตะโค้ดแอป · ไม่มี migration · ไม่ออกรุ่น**

## 1. README.md ใหม่ (ผู้ทำ: `secretary` — รอบนี้เขียนได้ทั้งไฟล์)
เขียนสำหรับคนนอก เป็นภาษาไทย มีประโยคแนะนำภาษาอังกฤษสั้นๆ ใต้ชื่อ · ใส่เฉพาะสิ่งที่มีจริงและตรวจกับโค้ด/CHANGELOG แล้ว

| ลำดับ | ส่วน | เนื้อหา |
|---|---|---|
| 1 | หัว | โลโก้จาก `public/brand/` · ชื่อ · คำอธิบาย 1–2 ประโยค · badge CI (ของจริงจาก workflow) · ลิงก์ `https://maewmeet.vercel.app` |
| 2 | ภาพหน้าจอ | 2 รูปจาก §3 |
| 3 | วิธีใช้ 6 ขั้น | ย่อจาก quickguide เป็นรายการสั้น แล้วลิงก์ไปไฟล์เต็ม §4 |
| 4 | Features | เฉพาะที่ใช้งานได้แล้ว · ไม่ใส่ LINE หรือของที่ยังไม่ทำ |
| 5 | Tech Stack | Next.js, TypeScript, Tailwind, Drizzle + Turso (libSQL), next-intl, Vitest, Playwright, Vercel |
| 6 | Getting Started | คำสั่งที่รันได้จริงบน clone ใหม่ ต้องรวมการตั้ง `file:` DB, สร้างค่าสุ่มของ `PIN_PEPPER_V1` / `APP_SECRET` / `CRON_SECRET` และ `npx drizzle-kit migrate` |
| 7 | Environment Variables | ตารางเฉพาะตัวแปรที่จำเป็น ไม่มีค่าจริง แล้วลิงก์ `.env.example` |
| 8 | สคริปต์ | `dev`, `build`, `test`, `test:e2e`, `lint`, `typecheck` |
| 9 | Project Structure | ระดับบนไม่เกินประมาณ 10 บรรทัด |
| 10 | Docs | ลิงก์ PRD, Architecture, ADR, Operations, Changelog |
| 11 | ทำงานยังไง | 1–2 บรรทัดว่าสร้างด้วยทีม AI agent แบบมี contract + ผู้ตรวจอิสระ พร้อมลิงก์ `docs/team/` |
| 12 | License | ใส่เมื่อ boss เลือกเท่านั้น (§5) |

ข้อห้าม:
- ห้ามเขียนว่า "Live Demo" เพราะลิงก์คือเว็บจริงของผู้ใช้จริง ไม่มีบัญชีทดลอง ให้เขียนว่า "เว็บที่ใช้งานจริง"
- ห้ามใส่ตัวเลขที่เก่าเร็ว (จำนวนเทสต์, เลขเวอร์ชัน) ในเนื้อความ
- ห้ามใส่ชื่อจริงของ boss อีเมล หรือ path ในเครื่อง

## 2. จัด root (ผู้ทำ: `ops`)
ย้ายด้วย `git mv` เพื่อเก็บประวัติ ไม่แก้เนื้อหา:

| จาก | ไป |
|---|---|
| `R*_CONTRACT.md` ทั้งหมด (รวมไฟล์นี้) | `docs/contracts/` |
| `TEAM.md`, `PROCESS.md`, `SECRETARY.md`, `PROGRESS.md` | `docs/team/` |

- คงไว้ที่ root: `README.md`, `CHANGELOG.md`, `CLAUDE.md` (Claude Code ต้องอ่านจาก root) และไฟล์ config
- อัปเดต path ใน `CLAUDE.md` และ `.claude/agents/*.md` (รวม scope ของ secretary) และระบุใน `CLAUDE.md` ว่า contract รอบถัดไปอยู่ที่ `docs/contracts/`
- ไม่แก้ `docs/reports/**` และ contract เก่า เพราะเป็นบันทึกประวัติ · คอมเมนต์ในโค้ด/CI ที่อ้างชื่อไฟล์เฉยๆ ไม่ต้องแก้

## 2.1 แก้ตามผล qa รอบแรก (`docs/reports/qa-r9.md`)
- M1 (`ux`): สร้าง `docs/images/logo-light.svg` และ `logo-dark.svg` สำหรับ README โดยใช้สีตายตัว ไม่แตะโลโก้ใน `public/brand/` ที่แอปใช้
- `secretary`: ใช้โลโก้สองไฟล์ผ่าน `<picture>` · แก้ตาราง `APP_ORIGIN` ให้ตรง `src/lib/shared/env.ts` · ตัดขั้นตอนลบบรรทัด `TURSO_AUTH_TOKEN=` ถ้าคงบรรทัดว่างแล้ว migrate และ dev ผ่าน

## 3. ภาพหน้าจอ (ผู้ทำ: `test`)
- 2 รูปมือถือ (หน้าหลัก และปฏิทินแท็บว่างตรงกัน) ที่ `docs/images/`
- ถ่ายจากแอปในเครื่อง บน DB ใหม่ที่ใส่ข้อมูลสมมติเท่านั้น · **ห้ามถ่ายจาก production**

## 4. Quickguide (ผู้ทำ: `secretary`)
- คัดลอก `maewmeet_quickstart_th.html` ไปที่ `docs/guides/quickstart-th.html` ไฟล์เดียว ไม่แก้เนื้อหา
- ลิงก์จาก README โดยบอกว่าต้องดาวน์โหลดไปเปิด เพราะ GitHub แสดง HTML เป็นซอร์สโค้ด

## 5. License
ค่าเริ่มต้น: **ไม่ใส่** · ถ้า boss เลือก MIT ให้ `ops` เพิ่ม `LICENSE` และ `secretary` เพิ่มส่วน License ใน README

## 6. นอกขอบเขต
- ไม่ลบ `docs/design/samples`, `docs/design/tools`, `docs/reports` และไม่เขียนประวัติ git ใหม่
- ไม่เอา quickguide ขึ้นเว็บแอป (มีเฉพาะภาษาไทย ขัดกติกา 2 ภาษา ถ้าจะทำให้เปิด contract แยก)
- ไม่ลบ branch เก่าบน GitHub และไม่แก้ About ของ repo เว้นแต่ boss สั่ง

## 7. เกณฑ์รับงาน (ผู้ตรวจ: `qa` — คนละตัวกับผู้ทำ)
1. clone ใหม่ แล้วทำตาม Getting Started ทีละบรรทัดจนเปิดหน้าแอปได้ · แนบคำสั่งและผลจริง
2. ลิงก์และรูปใน README, `CLAUDE.md`, `docs/team/*`, `.claude/agents/*` ไม่เสียทุกอัน
3. ทุก feature ใน README มีอยู่จริงในโค้ด
4. ไม่พบความลับหรือข้อมูลคนจริงใน README, ภาพหน้าจอ และ quickguide
5. `npm run lint`, `npm run typecheck`, `npm test` ผ่าน · CI ไม่พังจากการย้ายไฟล์
6. root เหลือตาม §2

จบงาน: `secretary` อัปเดต `PROGRESS.md` · main เปิด PR เข้า `main` แล้วหยุด · boss เป็นคนกด Merge
