# NEXT_PHASE — เอกสารส่งต่อให้ Claude Code (อัปเดต 2026-10-31)

อ่านไฟล์นี้ก่อนเริ่มงาน แล้วอ่าน `CLAUDE.md`, `PROCESS.md`, `TEAM.md`, `docs/OPERATIONS.md`, `docs/VERSIONING.md` ตามต้องการ
เจ้าของ: boss (Jimmy) · สื่อสารภาษาไทย · แอปอยู่ที่ v0.7.0 ใช้งานจริง ~10 คน

## สถานะระบบ
- Stack: Next.js 16.4 App Router, TS, Tailwind 4, Drizzle + Turso (libSQL), next-intl (th/en), Vitest, Playwright, Node 24
- Deploy: Vercel Hobby + Turso (prod/preview แยกกัน) ; keepalive = GitHub Actions ; cron รายวัน `/api/cron/daily`
- `/api/health` ใช้ตรวจสุขภาพ (ok, version, db, pepper, heartbeat)
- repo: GitHub `ieatbaozi-stack/maewmeet` · เครื่อง boss: `C:\Users\User\Downloads\Claude-cowork\maewmeet-git`
- ห้ามใส่ความลับ (TURSO_AUTH_TOKEN, PIN_PEPPER_V1, APP_SECRET, CRON_SECRET) ในแชท/repo — เก็บใน Bitwarden
- PowerShell: ให้คำสั่งทีละบรรทัด ; บอกตรงๆ เมื่อขั้น UI ยังไม่ได้ยืนยันกับหน้าจอจริง

## กฎที่ต้องตกลงใหม่เมื่อทำใน Claude Code
- ✅ ตัดสินแล้ว (2026-11-01, PR #10): `CLAUDE.md` ข้อ 10 ใหม่ — agent ทำบน branch, push เฉพาะ branch, เปิด PR แล้วหยุด · ห้าม push `main` / merge เอง / ออกรุ่นเอง · boss ตรวจและกด Merge เอง
- ข้ออื่นยังใช้: ไม่มีโค้ดโดยไม่มีเทสต์, สิทธิ์ตรวจที่เซิร์ฟเวอร์, schema เปลี่ยนด้วย migration เท่านั้น, วันที่ใช้ lib กลาง (Asia/Bangkok)
- ออกรุ่น: boss รัน `npx tsx scripts/release.ts <เลข>` เอง แล้ว push main + tag

## งานตั้งค่าที่ boss ทำเอง (ไม่ใช่โค้ด)
- ✅ ทำแล้ว (2026-11-01): ฐาน Turso อยู่ญี่ปุ่น และ boss ตั้ง Vercel Function Region เป็นญี่ปุ่น (hnd1) แล้ว Redeploy → เร็วขึ้น "เล็กน้อย" (ยังไม่มีตัวเลขวัดก่อน-หลัง) ความช้าที่เหลือต้องแก้ที่โค้ด ดู F2
- ✅ ตรวจแล้ว (2026-11-01): tag v0.7.0 อยู่บน GitHub ; preview build ของ Vercel ผ่าน (PR #9 Ready, ci 11 checks เขียว) → ตัวแปร Preview ใช้ได้
- 🔄 PR #10 (2026-11-01) — **CI-1**: run เขียวไม่อัปโหลด artifact · ล้ม = `playwright-report/` 2 วัน · ภาพครบชุดเฉพาะรันมือ `screenshots=true` 1 วัน · เกต R0-12 แก้ตาม (boss เห็นชอบ) · หลัง merge boss ตรวจ Billing → Actions · ต้นเรื่องเดิม: Actions storage ฟรี 0.5 GB เต็ม เพราะ artifact Playwright 4 shard ต่อ run รวม ~600 MB (80.8/135/164/232 MB) boss ลบ run เก่าแล้วแต่ PR #9 สร้างใหม่อีก → แก้ `ci.yml`: อัปโหลดเฉพาะตอนเทสต์ล้ม (`if: failure()`), `retention-days: 1–3`, ลดขนาดรายงาน (ไม่เก็บ trace/video ทุกเทสต์), ตรวจโควตา compute ด้วย (ใช้ $7.76/$12 ของเดือน ต.ค. ; e2e 4 shard ต่อ run ใช้นาทีมาก) ; ตรวจผลที่หน้า GitHub Settings → Billing → Actions

## รายการงาน (ยังไม่มี contract — ทำ contract/สรุปขอบเขตให้ boss เห็นชอบก่อนลงมือ ตามกฎข้อ 1)

### Bug
- **B1 (home)**: สรุป RSVP ไม่แสดงจำนวน "ไม่ไป" — `src/components/home/HomeView.tsx` แสดงแค่ going/maybe/noResponse ทั้งที่ `counts.not_going` มีแล้ว → เพิ่มแสดง + i18n `appointments.rsvp.summary.not_going` (TH/EN) + เทสต์ ; ตรวจหน้ารายละเอียดนัดให้สอดคล้อง

### Feedback / Change
- **F1 onboarding**: ผู้ใช้ไม่เข้าใจลำดับใช้งาน — สร้าง/เข้ากลุ่ม → ทุกคนลงวัน busy → เช็ควันว่างของทั้งกลุ่ม → สร้างนัด ; แนวคิด: แถบขั้นตอน 1-2-3-4 บนหน้ากลุ่ม, บอกว่าใครยังไม่ลง busy, หน้าแนะนำครั้งแรก, empty state บอกขั้นถัดไป
- **F2 ช้า**: ตั้ง region ตรงกันแล้ว (ญี่ปุ่นทั้งคู่) ได้ผลแค่เล็กน้อย → งานที่เหลือคือโค้ด: เริ่มจากวัดว่าหน้าไหนยิง query กี่ครั้ง/ใช้เวลาเท่าไร (Vercel Logs) แล้ว: ลดจำนวน query ต่อ request (session + authorize + data), optimistic update ตอน RSVP/เพิ่ม busy, prefetch ลิงก์แถบล่าง, skeleton ; วัดก่อน-หลังเสมอ
- **F3 calendar เดือน**: (ก) ให้ผู้ใช้ตั้ง ไอคอน/สี ของตัวเองได้ (คอลัมน์ใหม่ + migration; กันสีซ้ำในกลุ่ม; ใช้รูปทรง+สี) (ข) แท็บ "Free days" ให้เด่นกว่าแท็บอื่น (ค) ปุ่มลอยเพิ่ม "+ เพิ่มนัด" ข้างปุ่ม "+ Add busy time" (ระวังบังข้อความ "Each dot is one member…")
- **F4 home**: นับถอยหลังต่อท้ายชื่อนัดในรายการ "นัดถัดๆ ไป" เช่น "หมูกระทะ · อีก 2 วัน" (วันนี้/พรุ่งนี้/กำลังเกิดขึ้น, TH/EN, เขตเวลา Asia/Bangkok)
- **F5 หน้า /privacy**: เปลี่ยนข้อความเตือนเป็น "ร่างโดยผู้พัฒนาจากการทำงานจริงของแอป ไม่ใช่คำปรึกษาทางกฎหมาย ต้องอ่านและรับรองก่อนใช้งาน" (TH+EN) หรือลบเมื่อ boss รับรองแล้ว
- **F6 แจ้งเตือนก่อนนัด** (เตือน 1 วันก่อน + 1 ชม. ก่อนเริ่ม): ผล research —
  - LINE Notify เลิกแล้ว (2025-03-31) ; ทดแทนคือ LINE Messaging API ต้องมี Official Account, push นับโควตาต่อผู้รับ, โควตาฟรีของไทยยังไม่ยืนยัน ; ผู้ใช้ต้องผูกบัญชี
  - Web Push (PWA): ฟรี ; iOS ต้อง 16.4+ และเพิ่มแอปไว้หน้าจอโฮมก่อนขอสิทธิ์
  - Vercel Hobby cron รันได้วันละครั้ง ±59 นาที → ต้องมีตัวตั้งเวลานอก (GitHub Actions schedule แบบ best-effort / cron-job.org / Vercel Pro) เรียก endpoint ป้องกันด้วย CRON_SECRET ส่งผ่านตาราง `notification_outbox` แบบกันส่งซ้ำ
  - ข้อเสนอ: แจ้งเตือนในแอป + Web Push + ตัวตั้งเวลานอกก่อน, LINE OA ทีหลัง — **boss ยังไม่ตัดสินใจ**
  - แหล่งอ้างอิง: developers.line.biz/en/docs/messaging-api/pricing, webkit.org/blog/13878, vercel.com/docs/cron-jobs/usage-and-pricing

### backlog R6 hardening
rate limit แบบ global/อ่าน, retention กลุ่ม/คำเชิญที่ลบ, e2e retries ซ่อน flake, guard stream HTTP 200, CSP unsafe-inline, DST day strip, ข้อสังเกตจาก `docs/reports/qa-r5.md` / `security-r5.md`, แจ้งเตือน appointment.cancelled, กู้กลุ่ม/บัญชีที่ลบ

## ลำดับที่แนะนำ
1) boss ตั้ง region (F2 ส่วนตั้งค่า) → 2) B1 + F4 (เล็ก) → 3) F3 → 4) F1 → 5) F6 (ต้องตัดสินใจช่องทางก่อน) ; รอ feedback เพิ่มจากผู้ใช้แล้วค่อยจัดเป็นรอบเดียวตามที่ boss ต้องการ

## วิธีเริ่มใน Claude Code
เปิดโฟลเดอร์ `maewmeet-git` → ให้อ่าน `docs/NEXT_PHASE.md` และ `CLAUDE.md` → ขอให้เสนอ contract ของรอบแรกก่อนแก้โค้ด
