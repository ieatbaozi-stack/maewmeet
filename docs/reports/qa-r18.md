# QA R18 — V2 ถดถอยเต็ม + G2 Lighthouse

> ผู้ตรวจ: qa (อิสระ) · branch `feat/r18-v1` (HEAD เดิม 3c7d8c2 + commit qa นี้) · ตรวจ 2026-11-22

## Verdict: ผ่านแบบมีข้อสังเกต
พบ 1 ข้อที่ทำให้ CI `lint` ล้ม (px ใน share.css) — แก้แล้วใน commit qa · ที่เหลือผ่าน · เหลือรอ CI e2e (H5 ต้อง 2 รอบเขียว — ยังไม่ครบ ไม่ใช่เรื่องที่ qa ทำได้)

## ข้อพบ (เรียงตามความรุนแรง)
1. (กลาง, แก้แล้ว) `src/styles/share.css:74` ใช้ `@media (min-width: 720px)` → `check-style-literals.sh` (ขั้นหนึ่งใน job `lint` ของ CI) ล้ม · `npm run lint` (eslint) ในเครื่องไม่จับ จึงหลุดจากใบรับรองผู้ทำ · แก้เป็น `48em` ตามแบบไฟล์อื่นทั้งหมด (=768px, พฤติกรรมที่ 375/390/768 เท่าเดิม) · รัน `bash .github/scripts/check-style-literals.sh src` ผ่านแล้ว
2. (ต่ำ/ข้อมูล) Vercel preview ของ PR อยู่หลัง Vercel SSO (`/login` → 302 ไป vercel.com/sso-api) → วัด Lighthouse และตรวจ header บน preview ไม่ได้โดยไม่มี bypass token · วัดบน production build ในเครื่องแทน (ด้านล่าง) · ตัวเลขบน preview จริง/CI Linux อาจต่างเล็กน้อย
3. (ข้อมูล) เทสต์ที่ล้มในเครื่อง Windows = ปัญหาเดิม ไม่เกี่ยว R18 (ดูด้านล่าง)

## G2 Lighthouse (มือถือ, Lighthouse 12, Chromium 156 headless, production build `next start` + DB ไฟล์ · ไม่ใช่ preview)
| หน้า | Performance | Accessibility | Best practices | SEO |
|---|---|---|---|---|
| /login (ไม่ login) | 92 (FCP 2.0s · LCP 3.1s · TBT 20ms · CLS 0) | 100 | 100 | 100 |
| / หน้าหลัก (login) | 89 | 100 | 100 | 100 |
| /calendar (login, เดือน) | 87 | 100 | 100 | 100 |
เกณฑ์ PRD §7: Performance ≥ 85, Accessibility ≥ 95 → **ผ่านทั้ง 3 หน้า** (calendar ใกล้เส้น 87 — ถ้าบน preview ต่ำกว่า 85 ให้ frontend ดู) · login รันซ้ำ 3 ครั้งได้ 92 ทุกครั้ง · ผลดิบ JSON ไม่ได้เก็บใน repo

## Header ของ `/i/<token>` (ข้อเพิ่มจาก security 3c7d8c2) — ตรวจบน build ในเครื่อง ไม่ใช่ preview
token จริง (สร้างผ่าน API จากนัดทดสอบ) และ token ปลอม ได้ผลเหมือนกัน:
`Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` (ไม่มี `public`/`s-maxage`) · `X-Robots-Tag: noindex, nofollow` · `<meta name="robots" content="noindex, nofollow, nocache">`
**ยังไม่ได้ตรวจบน Vercel preview** (SSO) — ต้องให้ main/boss เช็กหลัง deploy ด้วย `curl -sI` หรือเปิดการป้องกันให้ข้ามสำหรับ qa

## ตรวจตามข้อ contract (อ่านโค้ด + รันเทสต์เอง)
| ข้อ | ผล | หลักฐาน |
|---|---|---|
| D1 | ผ่าน | `maintenance.ts` `purgeOldInvites` ใช้ `addDaysAt` (lib calendar), `INVITE_RETENTION_DAYS=30`, ผลมี `purgedInvites` · `tests/platform/r18-invite-purge.test.ts` ผ่าน |
| D2/D3 | ผ่าน (เอกสาร/ข้อความ) | ข้อความผ่าน messages · i18n render test ผ่าน · ไม่ได้ไล่อ่านเอกสาร OPERATIONS ทุกบรรทัด |
| H1/H2/H3 | ผ่าน | `r18-read-limit-before-handler`, `auth/redeem-limits` (309 บรรทัด) ผ่าน |
| H4 | ผ่าน | อยู่ในชุด ui/e2e ที่ผ่าน |
| H5 | **ยังไม่ครบ** | `playwright.config.ts` `retries: 0` ✔ · CI e2e (1–4) ยัง pending ตอนตรวจ → ยังไม่มี 2 รอบเขียว |
| H6 | ผ่าน | `tests/i18n/render.test.ts` ผ่านทั้งไฟล์ |
| H7 | ไม่ได้ตรวจ | ไม่ได้รัน `npm audit` (ไม่มีเครือข่ายสั่งซ้ำเชื่อถือได้ในรอบนี้) · ดู security-v1 |
| C1/C2 | ผ่าน | e2e `r18-share` เคส "C1 ยกเลิกคำเชิญตรงต้องผ่าน ConfirmDialog" ผ่านทุก viewport |
| §4 | ผ่าน (เอกสาร) | ตัดสินแล้วไม่ทำ ตาม B3 |
| S1–S7 | ผ่าน | `r18-share.test.ts`, `rbac/share-guests.test.ts`, `rbac matrix` ผ่าน · e2e `r18-share` ผ่านครบ 3 viewport (th/en × light/dark) · `?next=//evil.com` ไม่พาออกนอกแอป · หน้าลิงก์ก่อน login เห็นเฉพาะชื่อนัด/เวลา/สถานที่/ชื่อกลุ่ม/จำนวน ไม่มีชื่อสมาชิก (ดูภาพ) |
| S8 | ผ่าน | `migration-0007.test.ts` ผ่าน · CI `test + migration` ผ่าน |
| S9 | ผ่าน | ภาพ 375/768 × สว่าง/มืด ไม่มีเลื่อนแนวนอน · ไม่พบเป้าแตะ < 44px บน landing/รายละเอียดนัด · TH/EN อ่านธรรมชาติ ("X invited you", "ชวนคนนอก", "0 จาก 10 คน") |
| V1 | ผ่าน | อ่าน `v1-readiness.md` ตรงกับโค้ดที่ตรวจ · ช่องว่าง G1–G5 อยู่ใน §11 |
| V5 | ผ่าน | `r5-layout` e2e (admin/บัญชี/privacy/ชื่อยาว) ผ่านทุก viewport/ภาษา/ธีม · ไม่พบถอยหลังจากภาพที่ดู |
| G1 | ผ่าน (ตรรกะ) | `tests/ui/install-hint.test.ts` ผ่าน (Safari iOS เท่านั้น, standalone ซ่อน, ปิดแล้วจำ, localStorage ใช้ไม่ได้ไม่ error) · **ไม่ได้ลองบน iOS จริง** |
| G2 | ผ่าน (เครื่อง) | ตารางด้านบน · preview ไม่ได้ |
| G3 | ผ่านตามที่เห็น | e2e free-story/appt-story ไม่ได้รันซ้ำเต็ม (ดูด้านล่าง) |
| G4/G5 | เอกสาร | ไม่ได้ตรวจเกินอ่านผ่าน |
| §6/§10 | ผ่านบางส่วน | `tests/ops/docs-sync`, `release` (ส่วนที่รันได้บน Windows) ผ่าน · T1/T2 ไม่ได้ตรวจเชิงลึก |

## คำสั่งที่รันจริง
- `npm run typecheck` ผ่าน · `npm run lint` (eslint) ผ่าน · `bash .github/scripts/check-env-example.sh .env.example` ผ่าน · `check-style-literals.sh src` **ล้มก่อนแก้ → ผ่านหลังแก้**
- `npm run build` สำเร็จ
- `npx vitest run` ชุดที่เกี่ยว (r18-*, migration-0007, rbac, auth/redeem-limits, share-rate-limits, ui, i18n) `--testTimeout=60000` → 55 ไฟล์ / 4103 tests ผ่านทั้งหมด
- `npx vitest run tests` (ไม่รวม e2e) `--testTimeout=60000` → **182 ไฟล์ผ่าน · 5 ไฟล์ล้ม (11 tests)**: `calendar/free-time` (python oracle), `ops/admin-reset-pin-script`, `ops/pepper-fingerprint-script`, `ops/health`, `release` CLI (tsx ENOENT) — ทั้งหมดเป็นปัญหาเดิมของเครื่อง Windows (subprocess/python/tsx) ไม่เกี่ยว R18
- `npx playwright test r18-share r5-layout r17-group-restore --workers=3 --reporter=line` → **45 passed** (3.1 นาที) (3 viewport)
- สคริปต์ส่วนตัว: Playwright ถ่ายภาพ landing `/i/<token>` (EN dark, TH light), login, รายละเอียดนัด (TH) ที่ 375/768 × สว่าง/มืด + วัด overflow/เป้าแตะ → ไม่พบปัญหา

## CI (`gh pr checks 42` ตอนตรวจ, commit dcafebc)
build ✔ · changes ✔ · contrast ✔ · test + migration ✔ · typecheck ✔ · Vercel ✔ · **lint ✘ (สาเหตุ = ข้อพบ 1, แก้แล้วใน commit qa)** · e2e (1)–(4) pending · H5 (2 รอบเขียว retries 0) → ยังไม่ครบ main ต้องสั่งรันซ้ำเอง

## ตรวจไม่ได้ / ไม่ได้ทำ
- Lighthouse และ header บน Vercel preview จริง (ติด SSO) · ไม่ได้ลอง iOS จริง/LINE in-app browser
- ไม่ได้รัน e2e เต็มทั้งชุดในเครื่อง (ใช้เฉพาะ r18-share, r5-layout, r17-group-restore) · ไม่ได้รัน free-story/appt-story EN (G3) · ไม่ได้รัน `npm audit` (H7)
- ไม่ได้ไล่ภาพทุกหน้าครบทุก combo ด้วยตา (อาศัย e2e checkLayout ที่ผ่าน + ภาพสุ่ม)
- เซิร์ฟเวอร์ทดสอบ (พอร์ต 3000, 9222) ที่ qa เปิดค้างไว้ในเครื่อง — ปิดเองไม่ได้ (คำสั่งฆ่า node ถูกปฏิเสธ)
