# Security review — สแกนประวัติ git ทั้งหมดก่อนเปลี่ยน repo เป็น public

- ผู้ตรวจ: Security (อิสระ) · 2026-11-08 · checkout `main` = `e41f9d2` · ไม่มีโค้ดในงานนี้ ตรวจอย่างเดียว
- ขอบเขต: ทุก ref ในเครื่อง (`git rev-list --all` = **313 commits**; local 19 branches, `origin/*` 24 refs, 6 tags แบบ annotated) + ยืนยันว่า ref ทุกตัวบน GitHub (`git ls-remote origin` 56 refs รวม `refs/pull/1..21/head`) มี commit อยู่ในเครื่องครบ (มีแค่ 6 รายการที่ไม่อยู่ใน rev-list ซึ่งเป็น tag object ของ v0.7.0–v0.9.1 และได้สแกนเนื้อหา tag แยกแล้ว)
- วิธี: แตกทุก blob ที่เคยมีในประวัติ (**1,487 blobs**, 901 paths) ลงไดเรกทอรีชั่วคราว แล้ว grep/สแกน entropy ทั้งหมด + ข้อความ commit ทุกตัว + ข้อความ tag + PR body ทั้ง 21 ตัว (`gh pr list`) + log ของ Actions run ล่าสุด
- เครื่องมือ: ไม่มี gitleaks/trufflehog ในเครื่อง (ไม่ได้ติดตั้งตามที่สั่ง) และไม่มี Python → ใช้ grep + สคริปต์ Node สแกน entropy (Shannon ≥ 4.0, ยาว ≥ 24, ผสมตัวเล็ก/ใหญ่/ตัวเลข หรือ hex ≥ 32)
- รายงานนี้ไม่มีค่าความลับใดๆ (ไม่พบค่าจริงให้ปิดบังอยู่แล้ว)

## สรุป

**เปิด public ได้** — ไม่พบค่าความลับจริง ไฟล์ต้องห้าม หรือข้อมูลผู้ใช้จริงในประวัติ · ควรตั้งค่าใน GitHub/Vercel ตามหัวข้อ "ตั้งค่าเมื่อเป็น public" ก่อนหรือทันทีหลังกดเปิด และให้ boss ตัดสินใจเรื่องอีเมล gmail ใน commit (L1) ก่อนกด

| ระดับ | จำนวน |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 2 |
| Info | 6 |

**ต้อง rotate ค่าไหน:** ไม่มี — ไม่พบค่าจริงของ TURSO_AUTH_TOKEN / PIN_PEPPER_V* / APP_SECRET / CRON_SECRET / token ใดๆ ในประวัติ

## คำสั่งที่รันจริง + ผลจริง

| # | คำสั่ง (ย่อ) | ผลจริง |
|---|---|---|
| 1 | `git rev-list --all --count` | 313 |
| 2 | `git ls-remote origin` แล้วเทียบกับ `git rev-list --all` | 56 refs · commit ทุกตัว (รวม refs/pull/*) อยู่ในเครื่อง · ไม่อยู่ใน rev-list = 6 (tag objects เท่านั้น) |
| 3 | `git rev-list --all --objects` → `git cat-file --batch-check` → แตกทุก blob | 3,421 objects · 1,487 blobs · 901 paths · pack 2.54 MiB |
| 4 | grep `eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}` (JWT/Turso token) | 0 ไฟล์ |
| 5 | grep `gh[pousr]_…{20,}` / `github_pat_…` | 0 / 0 |
| 6 | grep `vercel_…` / `VERCEL_TOKEN`, `AKIA…`, `xox[baprs]-`, `sk-…`, `AIza…` | 0 ทุกแบบ |
| 7 | grep `-----BEGIN` | 4 blobs — ทั้งหมดเป็น regex ในเทสต์สแกนความลับ (`/-----BEGIN [A-Z ]*PRIVATE KEY-----/`) ไม่ใช่กุญแจ |
| 8 | grep `libsql://…` และ `*.turso.io` (uniq) | ทุกค่าเป็น placeholder: `maewmeet-prod-xxxx`, `maewmeet-x`, `example`, `myexample`, `attacker`, `libsql://...turso.io`, `libsql://…` · ไม่มี host จริง |
| 9 | grep `(TURSO_AUTH_TOKEN\|PIN_PEPPER*\|APP_SECRET\|CRON_SECRET\|LINE_*\|VERCEL_*…)\s*[:=]…` | ~110 รูปแบบ — ทั้งหมดว่าง / `randomBytes(...)` / `Buffer.alloc` / `'x'.repeat(n)` / `'tok-'+random` / `'wrong-secret-000000'` / อ้าง `process.env` / `${{ secrets.* }}` · ไม่มีค่าจริง |
| 10 | `.env.example` ทุกเวอร์ชันในประวัติ (4 blobs) — แสดงเฉพาะบรรทัดที่มีค่า | มีค่าเฉพาะ `PIN_PEPPER_CURRENT_VERSION=1`, `PLACE_SEARCH_ENABLED`, URL Nominatim/OSM สาธารณะ, `LOG_LEVEL` · ตัวลับว่างทุกเวอร์ชัน |
| 11 | สแกน entropy (Node) ทุก blob ยกเว้น package-lock.json | 5 สตริง: Windows path `/Users/User/…` ×2 (qa-r6e/r6f), PNG 1×1 base64 ในเทสต์ e2e, ชื่อยาวทดสอบ `Abcd…` 40 ตัว, path ไฟล์ → ไม่มีความลับ |
| 12 | `git log --all --oneline -- 'Pre-start*' '*.env' '.env.local' '*.db' '*.sqlite'` | 0 commits |
| 13 | ค้น paths: `.env*`, `*.db*`, `*.sqlite`, dump/backup/`.bak`, `*.pem/.key/.p12`, `id_rsa`, `.npmrc`, `.vercel`, `settings.local.json` | มีแค่ `.env.example` · ไม่มีไฟล์ต้องห้าม · `.claude/` มีเฉพาะ `agents/*.md` |
| 14 | ค้น paths ไบนารี (`png/jpg/gif/webp/zip/gz/pdf/exe/dll`), `node_modules/`, `test-results/`, `.next/`, `coverage/` | 0 / 0 · ไบนารีมีแค่ฟอนต์ `.woff2` 6 ไฟล์ (มี OFL.txt) · ไฟล์ใหญ่สุด = `docs/design/samples/availability.html` 430 KB, `package-lock.json` 355 KB (ปกติ) |
| 15 | grep อีเมลทุก blob (uniq) | noreply ของ boss, `*@maewmeet.local/.test`, `example.com/.invalid`, โดเมนหลอกในเทสต์ URL (`evil.com`) · ไม่มีอีเมลคนจริง |
| 16 | grep เบอร์ `0[689]\d{8}` | ทุกตัวเป็นเลขทดสอบ `0X00000000` และ `0999999999` · 1 ตัว `0883024619` = เลขทศนิยมในเมทริกซ์สี OKLab (`docs/design/tools/member-palette.mjs`) ไม่ใช่เบอร์ |
| 17 | grep `line id`, คำนำหน้าชื่อ (`นาย/นางสาว/น.ส./คุณ…`) | ไม่มี LINE id · ชื่อที่พบเป็นชื่อสมมติ (alice/bob/carol, "โอ๊ต" ใน mockup ออกแบบ) |
| 18 | `git log --all --format='%an <%ae> \| %cn <%ce>'` + `git cat-file -p <tag>` | ดู L1 — `ieat…@gmail.com` ใน 33 commits (author; 21 ตัว committer = GitHub web merge) + tagger ของทั้ง 6 tags |
| 19 | grep ข้อความ commit + tag ทั้งหมดหา `eyJ\|ghp_\|github_pat_\|gho_\|BEGIN\|turso.io\|TOKEN=\|SECRET=\|PEPPER` | 2 บรรทัด — ข้อความ commit ที่พูดถึง placeholder `example.turso.io` และชื่อตัวแปร `PIN_PEPPER_CURRENT_VERSION` · ไม่มีค่า |
| 20 | `.github/**` ทุกเวอร์ชันในประวัติ (ci.yml 6 เวอร์ชัน, keepalive.yml, scripts 4 ไฟล์) นับ `pull_request_target` / `secrets.` / echo ความลับ / `printenv` / `set -x` / `toJSON(secrets)` / `write` | `pull_request_target` = 0 ทุกเวอร์ชัน · `secrets.` = 2 (เฉพาะ keepalive.yml) · echo/print ความลับ = 0 · permission write = 0 |
| 21 | `gh pr list --state all` (21 PR bodies, 52,759 bytes) grep แบบเดียวกับ #19 + `@gmail` | 0 |
| 22 | `gh api repos/…/maewmeet` · `gh secret list` · artifacts | `private: true` · secrets: `APP_ORIGIN`, `CRON_SECRET` (เก็บใน GitHub Secrets ถูกต้อง) · artifacts ค้าง = 0 |
| 23 | `gh run list` + log ของ keepalive run ล่าสุด | ci: 14 PR + 19 push · keepalive: 41 schedule + 2 manual · log keepalive แสดง `APP_ORIGIN: ***`, `CRON_SECRET: ***` (ถูก mask) + HTTP 200 / อายุ heartbeat เท่านั้น |

## ข้อพบ

| # | ระดับ | เรื่อง | ที่ | รายละเอียด / สิ่งที่ควรทำ |
|---|---|---|---|---|
| L1 | Low (privacy) | อีเมลส่วนตัวของ boss ใน metadata ของ commit/tag | 33 commits (author `ieatbaozi-stack <ieat…@gmail.com>`; เป็น web merge ของ GitHub 21 ตัว + commit/release ของ boss 12 ตัว) + tagger ของ v0.7.0–v0.9.1 | เมื่อ public ใครก็ `git log` เห็นอีเมลนี้ (และ email harvester เก็บได้) · ไม่ใช่ความลับของระบบ ไม่ต้อง rotate อะไร · ทางเลือก: (ก) ยอมรับ (ข) ตั้ง GitHub → Settings → Emails → "Keep my email addresses private" + "Block command line pushes that expose my email" และตั้ง `git config user.email` เป็น noreply สำหรับอนาคต — **ไม่แก้ของเก่า** (ค) เขียนประวัติใหม่ (filter-repo) — ไม่แนะนำ: เปลี่ยน SHA ทุกตัว ทำ tag/PR/Vercel พัง และอีเมลยังอยู่ใน fork/clone เดิม · boss ตัดสินใจก่อนกด public |
| L2 | Low | username ของ super admin ที่น่าจะเป็นค่าจริงอยู่ในเอกสาร | `docs/OPERATIONS.md` (คำสั่ง `UPDATE user SET is_admin = 1 WHERE username = 'boss'`) + เทสต์หลายไฟล์ | ถ้าบัญชี admin บน prod ชื่อ `boss` จริง ผู้โจมตีรู้เป้าหมายสำหรับเดา PIN (มี lockout/throttle อยู่แล้ว จึงไม่ร้ายแรง) และ `/admin` เป็น path ที่รู้กันอยู่แล้วจากโค้ด · ถ้าไม่ใช่ชื่อจริงก็ไม่มีผล · ไม่จำเป็นต้องแก้ก่อนเปิด; ถ้าอยากลด ให้ใช้ PIN ที่ไม่เดาง่ายสำหรับบัญชี admin |
| I1 | Info | URL prod + ชื่อฐาน | `maewmeet.vercel.app` (หลายเอกสาร), `maewmeet-prod` / `maewmeet-preview` ใน OPERATIONS.md | URL แอปเป็นสาธารณะอยู่แล้ว · ชื่อฐาน Turso ใช้ไม่ได้ถ้าไม่มี token · ยอมรับได้ |
| I2 | Info | รายงาน security เก่ามีขั้นตอน repro ละเอียด | `docs/reports/security-r4a.md` M1, `security-r4b.md` M1 ฯลฯ | ตรวจแล้วว่าแก้ในโค้ดปัจจุบัน (availability ส่ง `busy[]` ครั้งเดียว + `blockers` อ้าง index; appointments มี `reserveBucket` limiter) · รายงาน R6C–R8 verdict ผ่าน ไม่มี High/Medium ค้าง · Low ค้างที่เหลือเป็นเรื่อง DoS/ความสะดวก (เช่น ช่องค้นหาสถานที่ 1 req/s, CSP `unsafe-inline`) ไม่ใช่การเข้าถึงข้อมูล |
| I3 | Info | path เครื่องของ boss ในรายงาน | `docs/reports/qa-r6e.md`, `qa-r6f.md` (`C:/Users/User/AppData/Local/Temp/claude/…`) | บอกแค่ว่าใช้ Windows ชื่อผู้ใช้ `User` · ไม่มีข้อมูลระบุตัว |
| I4 | Info | workflow ปลอดภัยสำหรับ public | `.github/workflows/ci.yml`, `keepalive.yml` | ci: trigger `pull_request` (ไม่ใช่ `pull_request_target`), `permissions: contents: read`, `persist-credentials: false`, ไม่ใช้ secret (สุ่มค่าทิ้งต่อรอบ + `::add-mask::`) → fork PR ไม่ได้ secret · keepalive: ใช้ secret เฉพาะ `schedule`/`workflow_dispatch` (fork เรียกไม่ได้), ส่ง CRON_SECRET ผ่าน stdin ไม่ echo · ข้อควรรู้: artifact `playwright-report` (เมื่อเทสต์ล้ม) จะดาวน์โหลดได้โดยคนทั่วไป — มีแต่ข้อมูลทดสอบจาก DB ชั่วคราว |
| I5 | Info | keepalive ถูกปิดอัตโนมัติได้ | comment ใน `keepalive.yml` บรรทัด "repo ต้องเป็น private…" | GitHub ปิด scheduled workflow ของ repo public ที่ไม่มี activity 60 วัน → ถ้าเปิด public นาน ต้องคอยเปิดใหม่ (ตรงกับที่ OPS เตือนไว้) · comment นั้นจะไม่ตรงกับสถานะจริงหลังเปิด public (OPS อัปเดตทีหลังได้) |
| I6 | Info | ชื่อ/ข้อมูลสมมติ | mockup `docs/design/**`, เทสต์ | ชื่อเล่นสมมติ (เช่น "โอ๊ต"), alice/bob/carol, เบอร์ `08x0000000` · ไม่ใช่ข้อมูลผู้ใช้จริง |

## ไม่พบ (ยืนยันแล้ว)
- ไม่มี `.env`, `.env.local`, `*.db`, `*.sqlite`, dump/backup, `Pre-start/**`, `settings.local.json`, node_modules, test-results, screenshots ในประวัติ (0 commits / 0 paths)
- ไม่มี JWT/Turso token, GitHub token, Vercel token, private key, URL Turso จริง, pepper/secret ที่เป็นค่าจริง ใน blob, ข้อความ commit, ข้อความ tag หรือ PR body
- ไม่มีเบอร์/อีเมล/LINE id ของผู้ใช้จริง

## ตั้งค่าเมื่อเป็น public (แนะนำ)
1. **Settings → Actions → General → "Fork pull request workflows from outside collaborators" → "Require approval for all outside collaborators"** (กันคนนอกยิง PR ใช้ runner/ขุดเหรียญ)
2. ห้ามเพิ่ม workflow ที่ใช้ `pull_request_target` หรือ `workflow_run` ที่ checkout โค้ดจาก fork · คง `permissions: contents: read`
3. **Settings → Code security → เปิด Secret scanning + Push protection** (ฟรีสำหรับ public) + Dependabot alerts
4. **Settings → Branches/Rulesets** บน `main`: require PR + require status checks + ห้าม force push (กันคนอื่นเปลี่ยนประวัติ)
5. **Vercel → Project → Settings → Git → "Git Fork Protection" ต้องเปิดอยู่** (ดีฟอลต์เปิด) — ไม่งั้น PR จาก fork จะ build preview พร้อม env ของ Preview (pepper/secret/token ฐาน preview)
6. GitHub → Settings → Emails → "Keep my email addresses private" + "Block command line pushes that expose my email" (เกี่ยวกับ L1)
7. เปิดใช้ private vulnerability reporting (Settings → Security) เพื่อให้คนรายงานช่องโหว่แบบไม่เปิดเผย
8. หลังเปลี่ยนกลับเป็น private: สำเนาที่ถูก clone/fork ระหว่าง public ยังอยู่ — ถือว่าทุกอย่างใน repo ตอนนั้นเปิดเผยไปแล้วถาวร

## สิ่งที่ตรวจไม่ได้
- ไม่มี gitleaks/trufflehog (ไม่ได้ติดตั้งตามคำสั่ง) — ใช้ regex + entropy แทน อาจพลาดความลับรูปแบบแปลกที่ entropy ต่ำ
- log ของ Actions run เก่า: ดูได้แค่ keepalive run ล่าสุด (ไม่มีค่าหลุด); `gh run view --log` ของ ci run ล่าสุดคืนมา 1 บรรทัด (อาจหมดอายุ/ยังรันอยู่) — CI ไม่ใช้ secret จริงอยู่แล้ว ความเสี่ยงต่ำ
- ไม่ได้ตรวจ GitHub Issues/Discussions/Wiki/comment ใน PR (มีแค่ PR body) · ไม่ได้ดูการตั้งค่า Vercel จริง
- ไม่รู้ว่า username admin บน prod เป็น `boss` จริงหรือไม่ (L2)
