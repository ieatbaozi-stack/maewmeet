# qa-r15b — ตรวจอิสระ R15b (ความเร็ว · hardening · CI docs-skip · Next.js 16.4.5)

ผู้ตรวจ: qa · branch `feat/r15b-speed-hardening` (ฐาน `a29ba40`, HEAD ที่ตรวจ `e9eb18f`) · Windows, Node v26 · 2026-11-18
ขอบเขต: R15-6, R15-7, R15-8 (ฝั่ง local) · security ตรวจแยก (`security-r15b.md`)

## Verdict: ผ่าน
ไม่พบบั๊กที่ต้องแก้ · ไม่มีการแก้โค้ดโดย qa · ข้อสังเกตเป็น Low/Info (ท้ายรายงาน)

## คำสั่งที่รัน + ผลจริง
| คำสั่ง | ผล |
|---|---|
| `npx tsc --noEmit` (HEAD e9eb18f) | exit 0 |
| `npm run lint` | exit 0 · 0 warning (warning SkipRes ของ R15a หายแล้ว) |
| `check-style-literals.sh src` · `npm run contrast` · `drizzle-kit check` | ไม่มีค่าสี/px นอก tokens · 338 คู่ ไม่ผ่าน 0 (ต่ำสุด 4.54:1) · "Everything's fine" |
| `npm run build` (16.4.5; ที่ 16.4.2 ล้มด้วย SecurityFatalError) | ผ่าน ทั้งก่อนและหลัง e9eb18f |
| `vitest run` ทั้งชุด (ก่อน e9eb18f, **ไม่ใช้ shim EPERM**) | 5757 ผ่าน / 11 ล้ม / 19 skip · ไม่มี EPERM ไม่มี timeout · 11 ล้มเป็นของเครื่อง: `release.test` 2 (`.bin/tsx` ENOENT) · `pepper-fingerprint-script` 4 + `admin-reset-pin-script` 3 (subprocess tsx) · `health.test` (Node v26 ไม่ใช่ v24) · `free-time` oracle.py (ไม่มี Python) · `config-hygiene` ผ่านแล้ว (แก้ CRLF ในรอบนี้) |
| `vitest run tests/platform tests/line tests/ui tests/ops/ci-docs-skip tests/security` (HEAD e9eb18f) | 78 ไฟล์ / 1524 ผ่าน / 0 ล้ม |
| `playwright test --workers=2` ทั้งชุด (build ก่อน e9eb18f — e9eb18f แตะแค่ข้อความ LINE ฝั่งเซิร์ฟเวอร์ ไม่มีใน e2e) | **1040 ผ่าน / 130 skip / 0 ล้ม / 0 flaky** · 35.5 นาที |

## R15-6 ความเร็ว: golden + จำนวน query
- **golden เป็นของจริง:** สร้าง git worktree ชั่วคราวที่ `origin/main` (a29ba40 โค้ดเดิม) ใส่ `r15b-golden.test.ts` ของ HEAD แล้วรันโหมดบันทึก (`R15B_GOLDEN_RECORD=1`) → ได้ `r15b-golden.json` ใหม่ **`cmp` เท่ากับ fixture ใน HEAD ทุกไบต์** (78,551 ไบต์) · เทสต์ที่ HEAD (โค้ดใหม่) เทียบ fixture ผ่าน · ครอบ RSVP ทุกกรณี (ครั้งแรก/ซ้ำ/เปลี่ยน/ผู้สร้างตอบเอง/ผู้สร้างออก/ถูกระงับ/ออก-กลับเข้า), รายละเอียดนัด x4 นัด x6 ผู้ดู, กระดิ่ง, หน้ากลุ่ม (รวม SA นอกกลุ่ม/คนนอก/กลุ่มคนเดียว) และ getGroupPage เทียบทางเดิมในเทสต์เดียวกัน · (cleanup EPERM ที่โค้ดเดิมเพราะไม่มี helper — ไม่เกี่ยวผล)
- **query จริง** (วัดด้วย r7-baseline ทั้งโค้ดเดิมและใหม่ ค่ามัธยฐาน): `PAGE /groups/[gid]` 11→10 · `PAGE /appointments/[id]` 7→6 · `GET /api/appointments/:id` 5→4 · `PUT rsvp` 10→9 · `PUT rsvp` ทางแจ้งผู้สร้าง 14→11 (ผมเติมแถววัดนี้ในโค้ดเดิมเอง: 14) — ตรงกับที่ contract ระบุและที่ r7-baseline ล็อก (เพดานเท่าค่าจริงทุกแถว)
- **`creatorActive` อ่านก่อน tx — ตรวจแล้วไม่มีผลที่เห็น:** กรณีแข่ง (ผู้สร้างออกกลุ่มระหว่างอ่านกับเขียน) ได้แถว `appointment.rsvp_changed` ของคนที่ไม่ใช่สมาชิก → `visibleToOwner` (notification.ts:92) ซ่อนทุก `appointment.*` ที่ไม่ใช่สมาชิก/สร้างก่อน `joined_at` รอบปัจจุบัน ทั้งรายการและจำนวน unread · rsvp_changed ไม่อยู่ใน `LINE_KINDS` (ไม่เข้า outbox) · ผลข้างเคียงเดียวของ `replaceUnread` คือลบ unread ของผู้ตอบคนเดิมถึงผู้สร้างคนเดียวกัน (ไม่กระทบคนอื่น) · ทิศกลับ (ผู้สร้างไม่ active ตอนอ่านแล้วกลับเข้าก่อนเขียน) = พลาดแจ้ง 1 ครั้ง ภายในหน้าต่างมิลลิวินาที — เล็กน้อย ไม่ใช่ข้อมูลรั่ว
- ชื่อผู้ตอบจาก session (`takeResolvedSessionUser`): golden กระดิ่งผู้สร้างตรงชื่อเดิม · ถ้าไม่มี session cache (เรียกนอก route) ตกไปอ่าน DB เหมือนเดิม

## R15-7 hardening (อ่านโค้ด + เทสต์ `r15b-hardening` 20 ข้อผ่าน)
- busy PATCH: `takeUserSlot` ก่อน `findOwnBusy` (busy.ts:297) → 404 นับ · ถัง `busy:update` 60/10 นาที แยกจาก delete
- routine PATCH: นับก่อน NOT_FOUND (busy-routines.ts:345)
- `?scope=` ซ้ำ → 400 VALIDATION `scope:INVALID` รูปเดียวกับค่าผิด, `getAll('scope').length > 1`
- ออก/เข้ากลุ่ม: ถัง `group:membership` 30/ชม. · leave นับหลังด่านสิทธิ์ (คนนอกได้ 404 ไม่กินโควตา) · redeem จองก่อน, คืนช่องเมื่อ: เป็นสมาชิกอยู่แล้ว / โค้ดผิด / กลุ่มเต็ม / error อื่น (catch + `!joined`) · เต็มแล้วคืนช่อง redeem ด้วย (ไม่นับเป็นการเดาโค้ด) · `refundBucket` ใช้ `MAX(count-1,0)` ไม่ติดลบ · icon: นับเฉพาะครั้งที่ค่าเปลี่ยนและหลังด่านสิทธิ์
- `/api/prefs`: `saveAccountLocale` อัปเดตเฉพาะ user active + ค่าต่างจริง (UPDATE มีเงื่อนไขเดียวกัน) · body เท่าเดิม · ไม่ล็อกอิน = คุกกี้อย่างเดียว
- B7: backend ตั้ง `actorName=''` + `actorSystemAdmin` เมื่อ `actorRole===null` (ไม่ใช่สมาชิก) เท่านั้น · UI ใช้ `common.systemAdmin` ทั้ง TH ("ผู้ดูแลระบบ") และ EN ("System admin") · แถวเก่าไม่มีคีย์ = พฤติกรรมเดิม · ธงออกทาง API เป็น boolean (ไม่เผยตัวตน; `actorId` ยังถูกกรอง) · ไม่ได้เปิดเบราว์เซอร์ดูข้อความในกระดิ่งจริง — อาศัย unit (model) + เทสต์ API
- OA cap: อยู่ใน `UPDATE … WHERE` เดียวกับการจองแถว (ไม่มี check-then-act) · ขอบเดือนใช้ `startOfMonthAt(now,'Asia/Bangkok')` · เทสต์ครอบ 300 เต็ม / 299 / pending จอง 1 + 299 / 30 ก.ย. 23:59 BKK ไม่นับ / 1 ต.ค. 00:00 BKK นับ · log มีแต่ตัวนับ ไม่มี PII
- LINE ลิงก์ (e9eb18f): ทดสอบเอง TH/EN — `https://evil.com/x`→`https:∕∕evil․com/x` · `www.example.com`, `t.me/abc`, `foo@bar.io`, `ไทย.com`, `ตัวอย่าง.ไทย`, `192.168.1.1/login`, `example。com`, ตัวเต็มความกว้าง, `http：//x` ถูกทำให้กดไม่ได้ · ไม่แตะ `3.5` `7.30น.` `v1.2` `Q3.2026` `3.5 ชม.` `ศ.-อา.` · ผลข้างเคียงที่ยอมรับ: `พ.ศ.`→`พ․ศ.`, `e.g.`→`e․g.` (อ่านได้ปกติ) · ลิงก์นัดของเรา (`appOrigin/appointments/<id>?openExternalBrowser=1`) อยู่ในแม่แบบ ไม่ผ่าน `userText` — เทสต์ยืนยันยังอยู่ครบ · สตริง 5,000 ตัวอักษรประมวลผลได้ทันที (ไม่มี regex ค้าง)

## CI docs-skip
- `ci.yml`: job `changes` รัน `changed-code.sh` → `build` และ `e2e` มี `needs: changes` + `if: code == 'true'` · `lint/typecheck/test/contrast` ไม่ผูก `changes` (เทสต์ `ci-docs-skip` ล็อกไว้ ผ่าน) · ไม่ใช้ `paths-ignore`
- `changed-code.sh`: ไม่มี base (push เข้า main / dispatch) / diff ว่าง / diff ล้ม → `code=true` · ไฟล์ใดนอก `docs/` หรือ `*.md` → `code=true` (รวมลบ/ย้ายชื่อด้วย `--no-renames`) · เฉพาะเอกสารล้วนจึง `false` · ทิศความผิดพลาดปลอดภัย (base ค้างเก่า → diff กว้างขึ้น → รันครบ) · `fetch-depth: 0`, `persist-credentials: false` คงกติกา config-hygiene
- ตรวจ workflow จริงบน GitHub ไม่ได้ในเครื่องนี้ (ตรวจได้ตอนเปิด PR: PR นี้แตะโค้ดจึงต้องเห็น build+e2e รัน)

## Next.js 16.4.2 → 16.4.5
- release notes (gh): 16.4.3/16.4.4 = backport bug fix เล็ก ๆ (font URL, proxy, Turbopack, OTel) · 16.4.5 = แพตช์ความปลอดภัย (GHSA-mfr8-8qww-v76h และอีก 6 รายการ: use cache, SVG image, Edge cookie ฯลฯ) · ไม่มี feature/breaking
- `package-lock.json`: เปลี่ยนเฉพาะตระกูล `next` / `@next/*` / `eslint-config-next` 12 บรรทัด resolved ทั้งหมดชี้ `registry.npmjs.org`
- lint/typecheck/vitest/build/e2e เต็มชุดผ่านบน 16.4.5 (ตารางด้านบน)

## EPERM helper (tests/helpers/fs.ts)
กลืนเฉพาะ `process.platform === 'win32'` และ code `EPERM|EBUSY` หลังลองซ้ำ 3 ครั้ง · Linux/error อื่น throw ตามเดิม · มีเทสต์ของตัวช่วยเอง · ผลจริง: ชุดเต็มบนเครื่องนี้ไม่มี EPERM/timeout อีก (เดิม 23 ล้ม) · ไม่ซ่อนความล้มเหลวจริงบน CI

## ข้อพบ (เรียงตามความรุนแรง — ไม่มี Critical/High/Medium)
- **Low 1** `tests/security/config-hygiene.test.ts` (diff แก้การตัด `runBlocks`): ตัดบล็อกที่ `\n\n` แรก — ถ้า step `run: |` มีบรรทัดว่างกลาง แล้ว `${{ }}` อยู่หลังบรรทัดว่าง เทสต์จะมองไม่เห็น (ความเข้มลดลงเล็กน้อย) · ปัจจุบัน ci.yml ไม่มี step แบบนี้ → ไม่พังจริง · ข้อเสนอ: ตัดที่ขึ้น step/job ใหม่แทนบรรทัดว่าง
- **Info 1** ทิศกลับของ `creatorActive` (พลาดแจ้ง 1 ครั้งในหน้าต่างมิลลิวินาที) — ยอมรับตามที่ main รับไว้แล้ว
- **Info 2** B7 ไม่มี e2e เบราว์เซอร์ที่เห็นข้อความ "ผู้ดูแลระบบ/System admin" ในกระดิ่งจริง (มีแค่ unit + API) · แนะนำให้ boss ดูตอนทดสอบเครื่องจริง
- **Info 3** `prefs` เมื่อบัญชีไม่ active/ไม่มี session จะไม่บันทึก user.locale (ตั้งใจ)

## ตรวจไม่ได้
- CI จริงบน GitHub (docs-skip ใน workflow, Vercel) · e2e/vitest บน Linux · ฐาน prod (R15b ไม่มี migration)
- vitest 11 ข้อที่ล้มเป็นของเครื่อง Windows/Node v26/ไม่มี Python (จำแนกด้านบน) — ผลจริงดู CI
