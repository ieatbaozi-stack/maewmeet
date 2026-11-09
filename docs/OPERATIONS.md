# OPERATIONS — ตั้งค่า ดูแล และกู้ระบบ maewmeet

> เจ้าของ: OPS (#10) · R0_CONTRACT R0-18 · อ้างอิง ADR 0001 §3/§3.1 (Vercel/Turso/keep-alive), ADR 0002 §7 (pepper), ARCHITECTURE §7 (env) §8 (cron)
> เขียนให้ boss ทำตามบน **Windows** ทีละข้อ · คำสั่งทั้งหมดเป็น **PowerShell** ยกเว้นที่เขียนว่า "ใน WSL"
> ทุกข้อมี ☐ ให้ติ๊ก · ถ้าผลไม่ตรงกับ "ควรเห็น" ให้หยุดแล้วดูส่วน G ก่อนทำต่อ

## ลำดับที่ต้องทำครั้งแรก
| ส่วน | ทำอะไร | เวลาโดยประมาณ |
|---|---|---|
| [A](#a-เตรียมเครื่องและบัญชี) | เตรียมเครื่อง/บัญชี | 15 นาที |
| [B](#b-turso--สร้างฐานข้อมูล--รัน-migration-ครั้งแรก) | สร้างฐาน Turso 2 ตัว + รัน migration | 15 นาที |
| [C](#c-สร้างความลับ-pepper-app_secret-cron_secret) | สร้างความลับ (pepper ฯลฯ) + เก็บสำรอง | 15 นาที |
| [D](#d-vercel--import-repo-ตั้ง-node-24-ใส่-env-deploy) | Vercel: import repo, ใส่ env, deploy | 20 นาที |
| [E](#e-github--secrets-ของ-keepalive--แจ้งเตือนทางอีเมล) | GitHub Secrets + เปิดแจ้งเตือนอีเมล | 5 นาที |
| [F](#f-ตรวจหลัง-deploy-ทำทุกครั้งที่-deploy-production) | ตรวจหลัง deploy | 5 นาที |
| [G](#g-runbook--เมื่อมีอะไรผิดปกติ) | Runbook เมื่อมีปัญหา (อ่านเมื่อต้องใช้) | — |
| [H](#h-super-admin-คนแรก--ซ้อมกู้-pepper-ตั้งแต่-r1) | ตั้ง super admin คนแรก + ซ้อมกู้ pepper (หลัง deploy R1) | 20 นาที |

## กติกาความลับ (อ่านก่อนเริ่ม)
- ความลับมี 4 ชนิด: `TURSO_AUTH_TOKEN`, `PIN_PEPPER_V1`, `APP_SECRET`, `CRON_SECRET` — **ห้าม**ส่งในแชทใด ๆ (LINE, Discord, รวมถึงแชทกับ AI agent ของทีมเรา), อีเมล, issue/PR, ภาพหน้าจอ, ไฟล์ในโฟลเดอร์ repo
- ที่เก็บที่ใช้ได้: **ตัวจัดการรหัสผ่าน** (1Password / Bitwarden ฯลฯ) และใส่ลง Vercel / GitHub Secrets โดยตรงเท่านั้น (pepper ต้องมีสำเนาออฟไลน์เพิ่มตามส่วน C)
- ตอนวางความลับใน PowerShell ใช้ `Read-Host -AsSecureString` ตามตัวอย่างในเอกสารนี้ — ค่าไม่ขึ้นจอและไม่ถูกบันทึกในประวัติคำสั่ง
- Windows: แนะนำปิด **Settings → System → Clipboard → Clipboard history** (หรืออย่างน้อยปิด "Sync across devices") เพราะเราจะคัดลอกความลับผ่านคลิปบอร์ด

---

## A. เตรียมเครื่องและบัญชี
☐ **A1** ติดตั้ง **Node.js 24** (ปุ่ม LTS ที่ <https://nodejs.org> ต้องเป็นเลข 24.x) แล้วเปิด PowerShell ใหม่:
```powershell
node -v
```
ควรเห็น `v24.` ตามด้วยเลขใด ๆ (ต้อง ≥ 24.7 — แอปใช้ `crypto.argon2`)

☐ **A2** ติดตั้ง Git for Windows (<https://git-scm.com>) แล้ว clone repo:
```powershell
cd $HOME
git clone https://github.com/ieatbaozi-stack/maewmeet.git
cd maewmeet
npm ci
```
ควรเห็นบรรทัดท้ายประมาณ `added ... packages` และไม่มี `ERR!`

☐ **A3** บัญชีที่ต้องมี: GitHub (เจ้าของ repo **private** — ต้องเป็นบัญชีส่วนตัว ไม่ใช่ Organization เพราะ Vercel Hobby ต่อ repo ของ Organization ไม่ได้), Vercel (สมัครด้วย GitHub), Turso (<https://turso.tech> สมัครด้วย GitHub ได้)

☐ **A4** ตัวจัดการรหัสผ่านพร้อมใช้ และเตรียมที่เก็บออฟไลน์ 1 ที่สำหรับ pepper (กระดาษในที่ปลอดภัย หรือ USB ที่ไม่ซิงก์คลาวด์ — ส่วน C)

☐ **A5** (ใช้เฉพาะตอนกู้ Turso ในส่วน G — ทำไว้ก่อนได้) Turso CLI บน Windows **ต้องใช้ WSL**:
```powershell
wsl --install          # ครั้งแรกเท่านั้น แล้วรีสตาร์ตเครื่อง
wsl                    # เข้า Ubuntu
```
ใน WSL:
```bash
curl -sSfL https://get.tur.so/install.sh | bash
exit
```
เปิด `wsl` ใหม่ แล้ว `turso auth login` (ถ้าเปิดเบราว์เซอร์ไม่ได้ ใช้ `turso auth login --headless`) → `turso db list` ควรเห็นรายชื่อฐาน (ทำหลังส่วน B)

---

## B. Turso — สร้างฐานข้อมูล + รัน migration ครั้งแรก
ใช้ **2 ฐานแยกกัน**: `maewmeet-prod` (ของจริง) และ `maewmeet-preview` (ทดสอบบน preview — ข้อมูลทิ้งได้) ตาม ADR 0002 §7.4

☐ **B1** เข้า <https://app.turso.tech> → **Create Database** → ชื่อ `maewmeet-prod` → เลือก location ที่ใกล้ไทยที่สุดในรายการ → Create
☐ **B2** ทำซ้ำสร้าง `maewmeet-preview`
☐ **B3** เปิดฐาน `maewmeet-prod` → คัดลอก **URL** (ขึ้นต้น `libsql://...turso.io`) เก็บในตัวจัดการรหัสผ่านรายการ `maewmeet TURSO prod` (URL ไม่ใช่ความลับ แต่เก็บคู่กันจะหาเจอง่าย)
☐ **B4** ในหน้าฐานเดียวกัน → **Create Token** (สิทธิ์ read & write, วันหมดอายุ: **Never** — ถ้าตั้งวันหมดอายุ แอปจะล่มเมื่อถึงวันนั้น) → คัดลอกลงรายการเดิมในตัวจัดการรหัสผ่าน (หน้าเว็บแสดง token ครั้งเดียว)
☐ **B5** ทำ B3–B4 กับ `maewmeet-preview` (รายการ `maewmeet TURSO preview`)

☐ **B6** รัน migration ครั้งแรกกับฐาน **prod** — PowerShell ในโฟลเดอร์ `maewmeet` (จาก A2):
```powershell
$env:TURSO_DATABASE_URL = "libsql://maewmeet-prod-xxxx.turso.io"     # แทนด้วย URL จริงจาก B3
$env:TURSO_AUTH_TOKEN = [System.Net.NetworkCredential]::new('', (Read-Host -AsSecureString 'วาง TURSO_AUTH_TOKEN ของ prod')).Password
npx drizzle-kit migrate
```
ควรเห็นบรรทัดท้าย `[✓] migrations applied successfully!`
- รันซ้ำได้ปลอดภัย (migration ที่ลงแล้วจะข้าม) — CI รันคำสั่งเดียวกันนี้ 2 รอบบนฐานว่างทุก PR
- ถ้าเห็น `Please provide required params for 'turso' dialect` = token ว่าง → รันบรรทัด `$env:TURSO_AUTH_TOKEN = ...` ใหม่

☐ **B7** ทำ B6 ซ้ำกับฐาน **preview** (เปลี่ยน URL + วาง token ของ preview) แล้วล้างค่าออกจาก PowerShell:
```powershell
Remove-Item Env:TURSO_AUTH_TOKEN, Env:TURSO_DATABASE_URL
```

> **รอบต่อ ๆ ไป**: เมื่อ release ใดมี migration ใหม่ (ไฟล์ใหม่ใน `drizzle/`) Lead จะแจ้งในรายงาน → boss รัน B6 (prod) + B7 (preview) **ก่อน** merge/push เข้า main

> **หมายเหตุ R6C (migration `0002`)**: รอบนี้มีไฟล์ใหม่ `drizzle/0002_*.sql` — ใช้ขั้นตอน B6 (prod) + B7 (preview) ข้างบนตามเดิม ก่อน merge
> - migration นี้เพิ่มคอลัมน์ `group_member.color_slot` / `shape_slot` แบบ nullable เท่านั้น ไม่ลบ/แก้ข้อมูลเดิม และโค้ดรุ่นเดิมไม่อ่านคอลัมน์เหล่านี้ → รัน migrate **ก่อน** deploy ปลอดภัย (รุ่นเก่าที่ยังรันอยู่ไม่พัง)
> - `0002` เป็น SQL ที่เขียนมือ เพราะ drizzle-kit 0.31.11 generate SQL แบบสร้างตารางใหม่แล้ว `INSERT ... SELECT` คอลัมน์ที่ตารางเดิมยังไม่มี (ดูคอมเมนต์ในหัวไฟล์ `drizzle/0002_*.sql`) · ผลเท่ากับ schema ใน `schema.ts`

> **หมายเหตุ R6F (migration `0003`)**: รอบนี้มีไฟล์ใหม่ `drizzle/0003_r6f_busy_series.sql` — boss ต้องรัน migration บน Turso ตามลำดับ **preview ก่อน push/เปิด PR** (Vercel preview ของ PR ใช้ฐาน preview — ถ้าไม่รันก่อน หน้า busy บน preview จะพัง) แล้ว **prod ก่อน merge** (merge แล้ว prod deploy ทันที) โดยใช้คำสั่งเดียวกับ `0002` (B6 prod + B7 preview):
> ```powershell
> $env:TURSO_DATABASE_URL = "libsql://maewmeet-prod-xxxx.turso.io"     # URL จริงจาก B3 (รอบ preview ใช้ URL ของ preview)
> $env:TURSO_AUTH_TOKEN = [System.Net.NetworkCredential]::new('', (Read-Host -AsSecureString 'วาง TURSO_AUTH_TOKEN')).Password
> npx drizzle-kit migrate
> ```
> ทำทีละฐานตามลำดับข้างบน (preview → เปิด PR → prod → merge) · ควรเห็น `[✓] migrations applied successfully!` · เสร็จแล้วล้างค่า: `Remove-Item Env:TURSO_AUTH_TOKEN, Env:TURSO_DATABASE_URL`
> - migration นี้ทำ 2 อย่างเท่านั้น: `ALTER TABLE busy_block ADD series_id text` (nullable ไม่ backfill) และสร้าง partial index `busy_user_series_idx` — ไม่ลบ/แก้ข้อมูลเดิม แถวเดิมทุกแถวได้ `series_id = NULL` = รายการเดี่ยว · โค้ดรุ่นเดิมไม่อ่านคอลัมน์นี้ → รัน migrate **ก่อน** deploy ปลอดภัย
> - **ตรวจหลังรัน** (ต่อฐานละครั้ง ด้วย `turso db shell maewmeet-prod "..."` / `maewmeet-preview` หรือหน้า SQL บน app.turso.tech):
>   1. `SELECT name FROM pragma_table_info('busy_block') WHERE name = 'series_id';` → ต้องได้ 1 แถว (`series_id`)
>   2. `SELECT name FROM pragma_index_list('busy_block') WHERE name = 'busy_user_series_idx';` → ต้องได้ 1 แถว
>   3. `SELECT count(*) FROM busy_block WHERE series_id IS NOT NULL;` → ต้องเป็น `0` ทันทีหลังรัน (แถวเดิมไม่ถูกจัดเป็นชุด)
>
>   ถ้าข้อ 1 หรือ 2 ไม่ขึ้น = migration ยังไม่ลง → หยุด อย่า merge แล้วแจ้ง main
> - **Rollback** (ADR 0010 §4): (1) ย้อนแอปอย่างเดียว (Vercel Instant Rollback) **พอ** — รุ่นเดิมทำงานกับฐานที่มีคอลัมน์ใหม่ได้ · ชุดที่สร้างไปแล้วยังเป็น busy ปกติ ลบทีละวันได้ (2) ถอดคอลัมน์จริง **ไม่แนะนำ ทำเมื่อ boss สั่งเท่านั้น**: `DROP INDEX IF EXISTS busy_user_series_idx;` แล้ว `ALTER TABLE busy_block DROP COLUMN series_id;` (ลบ index ก่อน ไม่งั้น DROP COLUMN ล้ม · ต้อง SQLite >= 3.35 ซึ่งยังไม่ได้ยืนยันกับฐานจริง) · แถวบันทึก migration ใน `__drizzle_migrations` ยังไม่ได้ตรวจกับฐานจริง — แจ้ง main ก่อนแตะ · ผล: เสียแค่การจัดกลุ่มเป็นชุด busy ทุกแถวยังอยู่

---

## C. สร้างความลับ (pepper, APP_SECRET, CRON_SECRET)
ทุกค่าสร้าง **บนเครื่อง boss** ด้วยตัวสุ่มของระบบ — agent/CI ไม่สร้างแทน (ADR 0002 §7.4)
คำสั่งสร้างค่าสุ่ม 32 ไบต์ (base64) ใช้ได้ทั้ง Windows PowerShell 5.1 และ PowerShell 7:
```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
```
ผลเป็นข้อความยาว 44 ตัวอักษร ลงท้ายด้วย `=` · ถ้าไม่อยากให้ค่าขึ้นจอ เปลี่ยนท้ายคำสั่งเป็น `[Convert]::ToBase64String($b) | Set-Clipboard` (ค่าจะอยู่ในคลิปบอร์ด วางต่อได้เลย)

### C1–C4 pepper ของ production (`PIN_PEPPER_V1`) — สำคัญที่สุด
pepper คือกุญแจที่ผสมตอนแปลง PIN เป็น hash · ถ้าหายทุกที่ ผู้ใช้ทุกคนต้อง reset PIN · ถ้ารั่วพร้อมฐาน คนร้ายเดา PIN ได้ (ADR 0002 §7 สรุปสำหรับ boss)

☐ **C1** รันคำสั่งข้างบน 1 ครั้ง → ได้ค่า pepper
☐ **C2** เก็บในตัวจัดการรหัสผ่าน: รายการชื่อ **`maewmeet PIN_PEPPER_V1 (production)`** · ช่องรหัสผ่าน = ค่า pepper · ช่องโน้ต: วันที่สร้าง + fingerprint 8 ตัวแรก (ได้จากส่วน H2 หลัง deploy R1 — กลับมาเติมทีหลังได้)
☐ **C3** สำเนาออฟไลน์ (ต้องไม่ผูกกับบัญชีเดียวกับ C2) — เลือกอย่างใดอย่างหนึ่ง:
  - เขียนลงกระดาษ **ตัวต่อตัว** (ระวัง `0/O`, `1/l/I`, `+`, `/`) เก็บที่ปลอดภัยในบ้าน หรือ
  - ไฟล์ `.txt` ใน **USB ที่เข้ารหัส** (เช่น BitLocker To Go) ที่ไม่ซิงก์ OneDrive/Google Drive
☐ **C4** ตรวจว่า **ไม่มี** pepper ใน: โฟลเดอร์ repo, ไฟล์ `.env*` ใด ๆ, แชท, อีเมล, OneDrive/Google Drive/Notion/Notes ที่ไม่เข้ารหัส, ภาพหน้าจอ

> pepper ของ **preview** สร้างแยก (คนละค่ากับ production) **ไม่ต้องสำรอง** — หายก็แค่สร้างใหม่ (ข้อมูล preview ทิ้งได้)

### C5–C7 ความลับอื่น (สร้างแยกกันทุกค่า และ production กับ preview ใช้คนละค่า)
☐ **C5** `APP_SECRET` (production) — รันคำสั่งสุ่ม → เก็บในตัวจัดการรหัสผ่าน `maewmeet APP_SECRET (production)`
☐ **C6** `CRON_SECRET` (production) — รันคำสั่งสุ่ม → เก็บ `maewmeet CRON_SECRET (production)` · **ต้องเก็บ** เพราะใช้อีกที่ GitHub (ส่วน E) และตอนสั่ง cron ด้วยมือ (ส่วน F) และ Vercel จะไม่ให้อ่านค่ากลับ
☐ **C7** ชุดของ preview: `PIN_PEPPER_V1`, `APP_SECRET`, `CRON_SECRET` อย่างละ 1 ค่าใหม่ (ใช้ครั้งเดียวตอนใส่ Vercel ไม่ต้องเก็บ)

### C8 ซ้อมกู้ pepper (ADR 0002 §7.4 — ทำ 1 ครั้งตอนจบ R0 และหลังหมุนทุกครั้ง)
**ตอนนี้ (R0)**: ยืนยันว่าสำเนาทั้ง 2 ที่ตรงกันตัวต่อตัว โดยไม่ต้องให้ค่าขึ้นจอ —
คัดลอกค่าจาก**ตัวจัดการรหัสผ่าน** แล้วรัน:
```powershell
$v = (Get-Clipboard | Out-String).Trim(); $h = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($v)); ([BitConverter]::ToString($h) -replace '-','').Substring(0,8); Remove-Variable v; Set-Clipboard -Value ' '
```
จดตัวอักษร 8 ตัวที่ได้ → พิมพ์ค่าจาก**สำเนาออฟไลน์**ลงคลิปบอร์ด (เช่น พิมพ์ใน Notepad แล้ว Ctrl+A, Ctrl+C แล้วปิดโดยไม่บันทึก) → รันคำสั่งเดิม → 8 ตัวต้อง**ตรงกัน**
(ตัวเลข 8 ตัวนี้ใช้เทียบสองสำเนากันเองเท่านั้น — ไม่ใช่ fingerprint ที่หน้า super admin)

**ตั้งแต่ R1**: สคริปต์ `scripts/pepper-fingerprint.ts` คำนวณ fingerprint แบบเดียวกับที่แอปเก็บในฐาน (HMAC-SHA256) ให้เทียบกับ 8 ตัวแรกในหน้า super admin — ขั้นตอนเต็มอยู่ที่ **ส่วน H2**:
```powershell
Get-Clipboard | npx tsx scripts/pepper-fingerprint.ts
```
สคริปต์รับค่าทาง stdin เท่านั้น **ห้าม**พิมพ์ pepper ต่อท้ายคำสั่งเป็น argument · พิมพ์ออกมาแค่ 8 ตัวอักษร ไม่พิมพ์ pepper

### C9 หมุน pepper (เมื่อสงสัยว่ารั่ว — ทำได้ตั้งแต่ R1) — สรุปจาก ADR 0002 §7.3
สร้าง `PIN_PEPPER_V2` (C1–C4 ชื่อ `...V2`) → เพิ่มใน Vercel → เปลี่ยน `PIN_PEPPER_CURRENT_VERSION` เป็น `2` → Redeploy → รอหน้า super admin แสดงผู้ใช้ v1 = 0 → **จึง**ลบ `PIN_PEPPER_V1` ใน Vercel (ห้ามลบก่อน) → ซ้อมกู้ C8 กับ V2

---

## D. Vercel — import repo, ตั้ง Node 24, ใส่ env, deploy
☐ **D1** <https://vercel.com/new> → **Import Git Repository** → เลือก `maewmeet` (ถ้าไม่เห็น กด "Adjust GitHub App Permissions" แล้วอนุญาต repo นี้) · ต้อง import ใต้บัญชี **ส่วนตัว** (Hobby)
☐ **D2** หน้า Configure Project: Project Name `maewmeet` · Framework Preset = **Next.js** (ตรวจเจอเอง) · Build/Install Command ปล่อยค่าเดิม
☐ **D3** เปิด **Environment Variables** ในหน้าเดียวกัน (หรือหลัง import: Project → Settings → Environment Variables) แล้วใส่ตามตารางข้างล่าง
  - **Type**: เลือก **Secret** สำหรับแถวที่ระบุ (บันทึกแล้วอ่านค่ากลับไม่ได้อีก — เป็นเหตุผลที่ต้องเก็บสำเนาในส่วน C) · ที่เหลือเลือก **Config**
  - **Environments**: ติ๊กตามคอลัมน์ · แถวที่ production กับ preview ใช้คนละค่า ให้เพิ่ม **2 ครั้ง** (ครั้งแรกติ๊ก Production อย่างเดียว ครั้งที่สองติ๊ก Preview อย่างเดียว) · ไม่ต้องติ๊ก Development

| ตัวแปร | Type | Production | Preview | ค่า |
|---|---|---|---|---|
| `TURSO_DATABASE_URL` | Config | ✔ | ✔ (คนละค่า) | URL จาก B3 ของแต่ละฐาน |
| `TURSO_AUTH_TOKEN` | **Secret** | ✔ | ✔ (คนละค่า) | token จาก B4 / B5 |
| `PIN_PEPPER_CURRENT_VERSION` | Config | ✔ | ✔ | `1` |
| `PIN_PEPPER_V1` | **Secret** | ✔ (ค่าจาก C1) | ✔ (ค่าจาก C7 — คนละค่า) | ห้ามใช้ค่าเดียวกัน |
| `APP_SECRET` | **Secret** | ✔ (C5) | ✔ (C7) | |
| `CRON_SECRET` | **Secret** | ✔ (C6) | ✔ (C7) | preview ต้องมีด้วย ไม่งั้นแอปบน preview ไม่เริ่ม (ทุก URL ตอบ 500 — G1) |
| `APP_ORIGIN` | Config | ✔ | ✘ (เว้นว่าง — ใช้ URL ของ preview เอง) | `https://maewmeet.vercel.app` (ดู D6) |
| `NOMINATIM_CONTACT` | Config | ✔ | ✔ | อีเมลติดต่อของ boss (ส่งใน User-Agent ถึง OpenStreetMap) |
| `PLACE_SEARCH_ENABLED` | Config | ✔ | ✔ | `true` (ตั้ง `false` = ปิดค้นหาสถานที่ทันทีโดยไม่ต้อง deploy โค้ดใหม่ แค่ Redeploy) |
| `LOG_LEVEL` | Config | ✔ | ✔ | `info` |
| `LINE_MESSAGING_ACCESS_TOKEN` | **Secret** | ✔ (ส่วน J) | ✘ (เว้นว่าง) | Channel access token ของ OA (R10) |
| `LINE_MESSAGING_CHANNEL_SECRET` | **Secret** | ✔ (ส่วน J) | ✘ (เว้นว่าง) | Channel secret ของ OA (R10) |

  ตัวแปรที่ไม่ต้องใส่ (มีค่าเริ่มต้นในโค้ดแล้ว): `NOMINATIM_BASE_URL`, `NEXT_PUBLIC_MAP_TILE_URL`, `NEXT_PUBLIC_MAP_ATTRIBUTION` · `VERCEL_URL`/`VERCEL_ENV` Vercel ใส่ให้เอง · ตัวแปร `LINE_MESSAGING_*` ใส่เฉพาะ Production ตามส่วน J (R10) · Preview เว้นว่าง
  ถ้าค่าใดใน `.env.example` เปลี่ยนในรอบหน้า Lead จะแจ้งในรายงาน

☐ **D4** กด **Deploy** → รอจน Status = Ready
☐ **D5** Project → **Settings → Build and Deployment → Node.js Version** = **24.x** (ปกติตรงอยู่แล้วเพราะ `package.json` ระบุ `"engines": {"node": "24.x"}` — ถ้าไม่ตรงให้แก้แล้ว Redeploy)
☐ **D6** Project → **Settings → Domains** ดูโดเมน production (ปกติ `https://maewmeet.vercel.app` ถ้าชื่อว่าง) — ถ้า**ไม่ตรง**กับ `APP_ORIGIN` ที่ใส่ใน D3 ให้แก้ `APP_ORIGIN` เป็นค่าจริง (ขึ้นต้น `https://` ไม่มี `/` ท้าย ไม่มี path) แล้ว **Deployments → … → Redeploy**
☐ **D7** Project → **Settings → Cron Jobs** ควรเห็น `/api/cron/daily` ตาราง `0 19 * * *` (= ตี 2 เวลาไทย คลาดได้ถึง 59 นาที) · cron ทำงานเฉพาะ production deployment · ตั้งแต่ R10 มี Schedule `reminders` อีกตัว ดูส่วน J

> **IP ของผู้เรียก (rate limit — ADR 0002 §3):** แอปเชื่อ header `x-vercel-forwarded-for` / `x-real-ip` / `x-forwarded-for` **เฉพาะเมื่อมี env `VERCEL`** (Vercel ใส่ให้เอง — บน Vercel ไม่ต้องทำอะไร) หรือ **`TRUST_PROXY_HEADERS=1`** (ตั้งเองเฉพาะเมื่อ self-host หลัง reverse proxy ที่เขียนทับ header เหล่านี้เอง) · ถ้าไม่เข้าเงื่อนไขใด ๆ (เช่น `next start` ตรง ๆ บนเครื่อง dev) แอป**ไม่เชื่อ header** และทุกคำขอรวมอยู่ใน **ถัง `unknown` ถังเดียว** — เพดานต่อ IP ของถังนี้คูณ **50** (login 1,000 / signup 250 / reset 150 ต่อหน้าต่าง) เพื่อไม่ให้ทุกคนล็อกกันเองเมื่อไม่รู้ IP · ชั้นที่กัน brute-force จริงคือ lockout ต่อ username (ไม่ขึ้นกับ IP) · **อย่าตั้ง `TRUST_PROXY_HEADERS=1` ถ้าแอปเปิดรับคำขอจากอินเทอร์เน็ตโดยตรงโดยไม่มี proxy** (ผู้โจมตีปลอม IP หลบเพดานได้)

> **ทุกครั้งที่แก้ env ใน Vercel ต้อง Redeploy** ค่าใหม่จึงมีผล (Deployments → … → Redeploy)
> **Function region (แนะนำ)**: Settings → Functions → เลือก region ที่ใกล้ location ของฐาน Turso ใน B1 ที่สุด (ระยะทาง app↔ฐานมีผลกับความเร็วทุก request)

---

## E. GitHub — Secrets ของ keepalive + แจ้งเตือนทางอีเมล
workflow `keepalive` ยิงแอปทุก 12 ชม. (นาที 17 ของ 00:xx และ 12:xx UTC = 07:17 และ 19:17 เวลาไทย โดยประมาณ — GitHub อาจหน่วง) เพื่อกัน Turso หลับ และ **ส่งอีเมลเตือน** เมื่อระบบผิดปกติ (ADR 0001 §3.1)

☐ **E1** repo บน GitHub → **Settings → Secrets and variables → Actions → New repository secret**
  - `CRON_SECRET` = ค่าเดียวกับ Vercel **Production** (C6)
  - `APP_ORIGIN` = ค่าเดียวกับ Vercel (D6) เช่น `https://maewmeet.vercel.app`
  (ไม่ต้องใส่ `TURSO_AUTH_TOKEN` ใน GitHub — keepalive ไม่ต่อฐานตรง)
☐ **E2** เปิดแจ้งเตือน: <https://github.com/settings/notifications> → หัวข้อ **System → Actions** → เลือก **Email** และติ๊ก **Send notifications for failed workflows only** (บางหน้าจอใช้คำว่า "Only notify for failed workflows")
☐ **E3** ตรวจว่าอีเมลปลายทาง (Settings → Notifications → Default notifications email) เป็นอีเมลที่ boss อ่านจริง
☐ **E4** repo → **Actions** → ถ้าเห็นปุ่มเปิดใช้ workflow ให้กดเปิด · ต้องเห็น `ci` และ `keepalive` ในรายการ

> **เงื่อนไขของ GitHub ที่ต้องรู้** (ตรวจแล้วจากเอกสาร GitHub):
> - อีเมลของ workflow แบบตั้งเวลาส่งถึง **คนที่สร้าง workflow** (หรือคนล่าสุดที่แก้บรรทัด `cron` / คนที่เปิดใช้ใหม่) → ไฟล์ต้องเข้า `main` ด้วยบัญชีของ boss (ตามกฎ 10: agent push branch ด้วย credential ของ boss บนเครื่อง boss แล้ว boss กด Merge PR เอง) · ถ้าวันหนึ่ง agent/คนอื่นใช้บัญชีอื่น push branch ที่แก้บรรทัด `cron` ของ `keepalive.yml` ผู้รับอีเมลอาจเปลี่ยน → ตรวจ E2–E3 ใหม่ · ถ้าเคยกด Disable แล้วเปิดใหม่ คนที่กดเปิดจะเป็นผู้รับ
> - repo ต้องเป็น **private** — repo สาธารณะที่ไม่มีความเคลื่อนไหว 60 วัน GitHub จะปิด workflow ตั้งเวลาเอง
> - ก่อนตั้ง E1 workflow จะ "ข้าม" พร้อมคำเตือนสีเหลือง (ไม่ล้ม ไม่ส่งอีเมล)

---

## F. ตรวจหลัง deploy (ทำทุกครั้งที่ deploy production)
☐ **F1** เปิดในเบราว์เซอร์ `https://<โดเมนจาก D6>/api/health` ควรเห็น (เลขเวอร์ชัน/ชั่วโมงต่างได้):
```json
{"ok":true,"version":"0.2.0","node":"v24.x.x","argon2":true,"db":true,"pepper":{"ok":true,"currentVersion":1,"usersByVersion":{}},"heartbeatAgeHours":{"vercelCron":null,"githubActions":null}}
```
  - `ok:true` + `db:true` = แอปต่อฐานได้ และ env ครบ
  - `pepper.ok:true` = pepper ใน Vercel ครบ ถูกรูป และตรงกับ fingerprint ที่แอปจำไว้ในฐาน · `currentVersion` = เวอร์ชันที่ใช้ hash PIN ใหม่ · `usersByVersion` = จำนวนผู้ใช้ที่ PIN ถูก hash ด้วยแต่ละเวอร์ชัน (ว่าง `{}` ได้ตอนยังไม่มีใครสมัคร) — หน้านี้**ไม่แสดงค่า pepper หรือ fingerprint**
  - `pepper.ok:false` = health ตอบ **503** (`ok:false` ทั้งก้อน) และ login/สมัครถูกปิดชั่วคราว → G7
  - `argon2:true` = runtime เป็น Node 24 ที่ hash PIN ได้ (ถ้า `false` → D5)
  - `vercelCron: null` ปกติสำหรับ deploy แรก (cron ยังไม่เคยรัน) — ทำ F2
  - หน้าแสดง HTTP 503 / `ok:false` หรือขึ้นแค่ `Internal Server Error` (500) → ส่วน G1

☐ **F2** (deploy แรก หรือเมื่อ `vercelCron` เป็น `null`) สั่ง cron รายวันรอบแรกด้วยมือ — **วิธี 1**: Settings → Cron Jobs → ปุ่ม **Run** ข้าง `/api/cron/daily` (ถ้ามี) · **วิธี 2** PowerShell:
```powershell
$s = [System.Net.NetworkCredential]::new('', (Read-Host -AsSecureString 'วาง CRON_SECRET ของ production')).Password
Invoke-RestMethod -Uri "https://maewmeet.vercel.app/api/cron/daily" -Headers @{ Authorization = "Bearer $s" }
Remove-Variable s
```
  ควรได้ผลที่มีคำว่า `data` (ไม่ใช่ error) → เปิด F1 ใหม่: `vercelCron` ต้องเป็นตัวเลขเล็ก ๆ (เช่น `0`)
  ถ้าได้ `401` = CRON_SECRET ไม่ตรงกับ Vercel → G3

☐ **F3** GitHub → **Actions → keepalive → Run workflow** (branch `main`) → รอ ~1 นาที → ต้องเป็น ✅ สีเขียว
  - เปิด run นั้น → หน้า Summary ควรมี `✅ keepalive ผ่าน — heartbeat ส่งแล้ว · health HTTP 200 · vercelCron … ชม.`
  - เปิด F1 อีกครั้ง: `githubActions` ต้องเป็นตัวเลขแล้ว
  - ถ้า ❌ แดง อ่านข้อความสีแดงใน log แล้วไปส่วน G ตามข้อความ (ควรได้อีเมลแจ้งด้วย — ถ้าไม่ได้ ตรวจ E2/E3)

☐ **F4** (ตรวจ security headers — ไม่บังคับ) PowerShell:
```powershell
(Invoke-WebRequest -Uri "https://maewmeet.vercel.app/" -Method Head -UseBasicParsing).Headers['Content-Security-Policy']
```
  ควรเห็นข้อความยาวขึ้นต้น `default-src 'self'` และมี `frame-ancestors 'none'`

☐ **F5** รอบแรกหลังตั้งค่าเสร็จ: ทำ C8 (ซ้อมกู้ pepper) แล้วแจ้ง Lead ว่า F1–F3 ผ่าน + ลิงก์ preview/production

---

## G. Runbook — เมื่อมีอะไรผิดปกติ
ดูอาการจาก **อีเมลแจ้ง keepalive ล้ม** (เปิด run ใน Actions อ่านบรรทัดสีแดง) หรือจาก `/api/health`

### G1 `/api/health` ตอบ 503 (`ok:false`) หรือ **ทุกหน้าตอบ 500 `Internal Server Error`**
health ไม่บอกสาเหตุต่อสาธารณะ (ตั้งใจ) — ดูใน Vercel:
1. Vercel → Project → **Logs** (เก็บแค่ 1 ชม. บน Hobby — เปิด `/api/health` อีกครั้งแล้วดู log สด) ค้นคำว่า `Invalid environment configuration`
   - env "ต้องมี" หาย/ผิดรูป → แอป**ไม่ยอมเริ่ม** (R0-5): ทุก URL รวม `/api/health` ตอบ **500** ข้อความ `Internal Server Error` (ไม่ใช่ JSON) และ log มีบรรทัด `An error occurred while loading instrumentation hook: Invalid environment configuration — missing: X` / `invalid: X (...)` → แก้ env ชื่อ X ตามส่วน D3 → Redeploy (log บอกแค่**ชื่อ**ตัวแปร ไม่มีค่า)
   - ไม่มีบรรทัดนั้น แต่ health ตอบ JSON `db:false` → ฐานต่อไม่ได้ → G2
2. ตรวจ Turso status ที่ <https://status.turso.tech> และ Vercel ที่ <https://www.vercel-status.com>

### G2 ฐาน Turso หลับ/ถูก archive (กู้ภายในไม่กี่นาที)
แผนฟรีของ Turso archive/sleep ฐานที่ไม่มีการใช้งาน 10 วัน — ปกติ keepalive กันไว้ แต่ถ้าหลุด:
1. เปิด <https://app.turso.tech> ดูสถานะฐาน `maewmeet-prod` (ถ้าหน้าเว็บมีปุ่มปลุก/unarchive กดได้เลย)
2. หรือใน WSL (A5):
```bash
turso db list                      # ดูชื่อฐาน
turso db show maewmeet-prod        # ดูสถานะ / group
turso db wakeup maewmeet-prod      # ปลุกฐานที่หลับ
turso group list                   # ถ้าฐานยังใช้ไม่ได้ ดูว่า group ถูก archive หรือไม่
turso group unarchive default      # แทน default ด้วยชื่อ group จาก turso group list / db show
```
3. เปิด `/api/health` → ต้อง `db:true` → ทำ F2 + F3 ให้ heartbeat สดอีกครั้ง
4. ถ้าเกิดซ้ำบ่อย: พิจารณาแผน Turso Developer ($5.99/เดือน — กติกา 10 วันใช้กับแผนฟรี · ADR 0001 §3.1) แจ้ง Lead
5. ถ้า token หมดอายุ/ถูกเพิกถอน (`db:false` แต่ฐานตื่นอยู่): สร้าง token ใหม่ (B4) → แก้ `TURSO_AUTH_TOKEN` ใน Vercel → Redeploy

### G3 keepalive: `POST /api/cron/heartbeat ตอบ HTTP 401`
`CRON_SECRET` ใน GitHub (E1) ไม่ตรงกับ Vercel Production → เอาค่าจากตัวจัดการรหัสผ่าน (C6) ใส่ทั้งสองที่ใหม่ (GitHub: Update secret · Vercel: Edit → Redeploy) → F3
ถ้าค่าในตัวจัดการรหัสผ่านหาย: สร้างใหม่ (C6) แล้วใส่ทั้งสองที่

### G4 keepalive: `HTTP 000` หรือ `5xx` ที่ heartbeat
`000` = ต่อแอปไม่ได้เลย: ตรวจ `APP_ORIGIN` ใน GitHub (E1) สะกดถูก, เปิดโดเมนในเบราว์เซอร์ได้ไหม, Vercel status · `5xx` = ดู G1

### G5 keepalive: `heartbeat ของ Vercel cron เก่า … ชม.` หรือ `vercelCron = null`
cron รายวันของ Vercel ไม่ทำงาน (Turso ยังไม่หลับเพราะ keepalive ยังเขียน heartbeat ให้ — แต่ชั้นหลักหาย):
1. Vercel → Settings → **Cron Jobs**: ถูก Disable ไหม → เปิดใหม่ · กด **View Logs** ดูผลรอบล่าสุด
2. deployment ล่าสุดที่เป็น Production ต้องมี `vercel.json` ที่มี cron (ถ้าเพิ่ง Instant Rollback ไปรุ่นเก่า cron จะเป็นของรุ่นนั้น)
3. สั่งด้วยมือ (F2) แล้ว F3 → ต้องเขียว
4. ยังล้ม: แจ้ง Lead พร้อมภาพหน้าจอ Cron Jobs + log (อย่าให้มีความลับในภาพ)

### G6 keepalive: `อ่าน heartbeatAgeHours.vercelCron จาก /api/health ไม่ได้`
`/api/health` ไม่ได้ตอบ JSON ตามสัญญา — มักเป็นเพราะ `APP_ORIGIN` ชี้ผิดที่ (เช่น โดเมนที่ redirect ไปหน้าอื่น หรือหน้า login ของ Vercel Deployment Protection) → ตั้ง `APP_ORIGIN` เป็นโดเมน **production** (D6) ไม่ใช่ลิงก์ preview

### G7 pepper (ตั้งแต่ R1)
อาการ: `/api/health` ตอบ **503** และมี `"pepper":{"ok":false,...}` · ผู้ใช้เห็น "ระบบเข้าสู่ระบบปิดปรับปรุงชั่วคราว ข้อมูลของคุณปลอดภัย" · ไม่มีใครถูกนับว่า PIN ผิด ไม่มีใครถูกล็อก (ตั้งใจ) · คนที่ล็อกอินค้างอยู่ใช้งานส่วนอื่นได้ตามปกติ

**ข้อ 1 (ทำก่อนเสมอ) — เอาค่าเดิมคืน ห้ามสร้าง pepper ใหม่ทับ**
1. เปิดตัวจัดการรหัสผ่าน → รายการ `maewmeet PIN_PEPPER_V1 (production)` (C2)
2. Vercel → Project → **Settings → Environment Variables** → ตรวจ `PIN_PEPPER_CURRENT_VERSION` และ `PIN_PEPPER_V1` (ตั้งเป็น Secret แล้วอ่านค่ากลับไม่ได้ — ใส่ค่าที่ถูกทับลงไปใหม่ได้เลย) → ใส่ค่าจากข้อ 1 ให้ครบ Production → **Redeploy** (ทุกครั้งที่แก้ env ต้อง Redeploy — ส่วน D)
3. เปิด `/api/health` (F1) → ต้อง `pepper.ok:true` และ HTTP 200
4. ทำ H2 เทียบ fingerprint เพื่อให้แน่ใจว่าได้ค่าที่ถูกต้อง
ถ้าตัวจัดการรหัสผ่านไม่มี → ใช้สำเนาออฟไลน์ (C3) พิมพ์ลงตัวต่อตัว แล้วทำ H2 เทียบก่อนใส่ Vercel

**ข้อ 2 (ทางสุดท้าย — pepper หายครบทุกสำเนาจริง ๆ เท่านั้น)** → ใช้สคริปต์กู้ฉุกเฉิน `scripts/admin-reset-pin.ts` ตาม **ส่วน H4** · แจ้ง Lead ก่อนเริ่มทุกครั้ง · เหตุผลที่ต้องมี: ถ้า pepper หาย super admin เองก็ล็อกอินไม่ได้ จึงอนุมัติ reset ให้ใครไม่ได้

---

## H. super admin คนแรก + ซ้อมกู้ pepper (ตั้งแต่ R1)
> ข้อความที่ติดป้าย **(ตรวจกับหน้าจอจริง)** = เขียนจากความจำเกี่ยวกับหน้าตาของเว็บ Turso / Chrome / Vercel ซึ่งเปลี่ยนได้ ยังไม่เคยกดตามจริงบนเครื่อง boss — ถ้าหน้าจอไม่ตรง ให้หยุดและถาม Lead อย่าเดา
> คำสั่ง `turso` ทั้งหมดรันใน WSL (A5) · คำสั่ง `npx tsx ...` รันใน PowerShell ในโฟลเดอร์ `maewmeet` (A2)

### H1 ตั้ง super admin คนแรก (ทำครั้งเดียวหลัง deploy R1 ผ่าน F1)
หลักการ: **ไม่มีสคริปต์และไม่มีหน้าเว็บใดสร้าง super admin ได้** (ตั้งใจ — กันคนอื่นยกตัวเองเป็นแอดมิน) วิธีเดียวคือ boss แก้ฐานข้อมูลเองด้วยคำสั่ง SQL 1 บรรทัดหลังสมัครบัญชีธรรมดาก่อน

☐ **H1.1** เปิดเว็บ production (โดเมนจาก D6) → **สมัครบัญชีของ boss ตามปกติ** (username + ชื่อที่แสดง + PIN 6 หลัก) แล้วจด username ให้ตรงตัวอักษร (ตัวพิมพ์เล็กใหญ่ตามที่พิมพ์ตอนสมัคร)
☐ **H1.2** ตั้งสิทธิ์ — **วิธีที่ 1 (แนะนำ ใช้คำสั่ง)** ใน WSL (แทน `boss` ด้วย username จริง):
```bash
turso db shell maewmeet-prod "UPDATE user SET is_admin = 1 WHERE username = 'boss';"
```
รูปแบบทั่วไปของคำสั่ง SQL: `UPDATE user SET is_admin = 1 WHERE username = '<name>';` (แทน `<name>` ด้วย username จริง) · ถ้า username มีเครื่องหมาย `'` ให้ใช้วิธีที่ 2 · ผลที่ควรเห็น: คำสั่งจบเงียบ ๆ ไม่มี error (ถ้าเห็น `no such table` = ชี้ผิดฐาน/ยังไม่ migrate → B6)

☐ **H1.2 (วิธีที่ 2 — ผ่านเว็บ Turso)** <https://app.turso.tech> → ฐาน `maewmeet-prod` → เมนูที่เป็นช่องพิมพ์ SQL (ชื่อเมนูอาจเป็น **Edit Data / SQL Console / Shell**) → วางคำสั่งเดียวกับด้านบน แล้วกด **Run** **(ตรวจกับหน้าจอจริง)**
☐ **H1.3** ตรวจผล — ใน WSL:
```bash
turso db shell maewmeet-prod "SELECT username,is_admin FROM user WHERE is_admin=1;"
```
ควรเห็นตารางที่มี **เฉพาะชื่อของ boss** และ `is_admin` = `1` · ถ้ามีชื่อที่ boss ไม่รู้จัก **หยุดทันที** แจ้ง Lead (อาจมีคนแก้ฐานด้วยสิทธิ์ที่รั่ว → ไปเปลี่ยน TURSO_AUTH_TOKEN ตาม B4)
☐ **H1.4** ในเว็บ ไม่ต้อง login ใหม่ — โหลดหน้าใหม่ แล้วเปิด `/admin/pin-resets` ต้องเห็นหน้ารายการคำขอ reset (ว่างได้) · ถ้าขึ้น "ไม่มีสิทธิ์" ให้ล็อกเอาต์/ล็อกอินใหม่ แล้วย้อนไป H1.3 **(ตรวจกับหน้าจอจริง — ชื่อเมนู/ลิงก์ไปหน้านี้)**

ถอนสิทธิ์ (ถ้าตั้งผิดคน): `turso db shell maewmeet-prod "UPDATE user SET is_admin = 0 WHERE username = 'ชื่อ';"` แล้วทำ H1.3 ซ้ำ

### H2 ซ้อมกู้ pepper — เทียบ fingerprint กับหน้า super admin (ADR 0002 §7.4)
ทำ 1 ครั้งหลัง deploy R1 ครั้งแรก, หลังหมุน pepper ทุกครั้ง (C9) และถ้าอยากมั่นใจเมื่อไรก็ได้ — **ไม่กระทบผู้ใช้**
☐ **H2.1** เปิดหน้า super admin (login ด้วยบัญชี H1) → หาส่วนที่แสดง **pepper / fingerprint** ของแต่ละเวอร์ชัน → จด **8 ตัวอักษร** ของ `V1` **(ตรวจกับหน้าจอจริง — ตำแหน่ง/ชื่อหัวข้อ)** · หน้านี้แสดงจำนวนผู้ใช้ต่อเวอร์ชันด้วย
☐ **H2.2** สำเนาที่ 1 — ตัวจัดการรหัสผ่าน: คัดลอกค่าในรายการ `maewmeet PIN_PEPPER_V1 (production)` (กดปุ่มคัดลอก อย่าให้ค่าขึ้นจอ) แล้วใน PowerShell:
```powershell
cd $HOME\maewmeet
Get-Clipboard | npx tsx scripts/pepper-fingerprint.ts
Set-Clipboard -Value ' '
```
ควรได้ **8 ตัวอักษร** (ตัวเลข 0-9 และ a-f) บรรทัดเดียว · บรรทัดสุดท้ายล้างคลิปบอร์ด
☐ **H2.3** สำเนาที่ 2 — ออฟไลน์ (กระดาษ/USB เข้ารหัส): พิมพ์ลง Notepad → Ctrl+A, Ctrl+C → ปิด Notepad โดย**ไม่บันทึก** → รันคำสั่ง H2.2 ซ้ำ
☐ **H2.4** ผลที่ถูก: H2.1, H2.2, H2.3 เป็น **8 ตัวอักษรเดียวกันทั้งสามที่** → จดลงช่องโน้ตของรายการในตัวจัดการรหัสผ่าน (C2) พร้อมวันที่ซ้อม
  - ได้ข้อความ `ค่าที่ได้รับผิดรูปแบบ` = คัดลอกไม่ครบ/มีช่องว่างปน/ผิดตัวอักษร (สำเนากระดาษมักผิด `0/O`, `1/l/I`) → แก้สำเนานั้นแล้วทำใหม่ **ก่อนจะเชื่อสำเนานั้น**
  - ได้ 8 ตัวแต่**ไม่ตรง**กับหน้า super admin = ค่านี้ไม่ใช่ pepper ที่แอปใช้ (หรือสำเนาผิดหนึ่งตัวอักษร) → อย่าเอาไปใส่ Vercel → แจ้ง Lead
  - สคริปต์ไม่พิมพ์ pepper และรับค่าทาง stdin เท่านั้น — ถ้าเผลอพิมพ์ pepper ต่อท้ายคำสั่ง สคริปต์จะปฏิเสธ (แต่ค่าอาจค้างใน history ของ PowerShell → รัน `Clear-History` แล้วถือว่า pepper นั้นเสี่ยง ปรึกษา Lead เรื่องหมุน C9)

### H3 ซ้อมจริง "เมื่อ Vercel ลบ pepper ไปโดยไม่ได้ตั้งใจ" (ทำบน **preview** เท่านั้น — ไม่ทำบน production)
☐ **H3.1** Vercel → Settings → Environment Variables → ตัวแปร `PIN_PEPPER_V1` ของ **Preview** → ลบ (หรือแก้ค่าเป็นอย่างอื่น) → Redeploy preview
☐ **H3.2** เปิด `<url preview>/api/health` → ควรเห็น HTTP 503 และ `"pepper":{"ok":false,...}` · ลอง login บน preview → ข้อความ "ปิดปรับปรุงชั่วคราว" (ไม่ใช่ "PIN ผิด")
☐ **H3.3** ใส่ค่าเดิมกลับ → Redeploy → `/api/health` กลับเป็น 200 และ `pepper.ok:true` → login ได้ตามปกติ (ไม่มีใครถูกล็อก)
☐ **H3.4** (ไม่บังคับ) ซ้ำ H3.1 แต่ใส่ pepper **ค่าใหม่ที่ไม่ใช่ของเดิม** → health ต้องยังเป็น 503 (แอปจำ fingerprint ของค่าเดิมไว้ จึงไม่ยอมใช้ค่าผิด) → ใส่ค่าเดิมกลับ
หมายเหตุ: แอปจำ fingerprint ตอนมีการเรียกที่ต้องใช้ pepper ครั้งแรกหลัง deploy (เปิด `/api/health` ก็นับ) — ก่อนเปิด health บน preview อย่างน้อย 1 ครั้ง H3.4 จะผ่านเป็น 200 ได้ (ไม่ใช่ความผิดปกติ)

### H4 กู้ฉุกเฉิน — pepper หายครบทุกสำเนา (ใช้ `scripts/admin-reset-pin.ts` — ใช้ครั้งสุดท้ายเท่านั้น)
**ก่อนเริ่ม ต้องครบทุกข้อ:** ☐ ค้นตัวจัดการรหัสผ่านแล้วไม่มี ☐ ค้นสำเนาออฟไลน์แล้วไม่มี ☐ ลองใส่ค่าเดิมใน Vercel ตาม G7 ข้อ 1 ไม่สำเร็จ ☐ แจ้ง Lead แล้ว
สิ่งที่ต้องยอมรับ: ผู้ใช้ทุกคนที่ PIN ถูก hash ด้วย pepper เดิมจะ**ล็อกอินด้วย PIN เดิมไม่ได้อีก** ต้องใช้ flow "ลืม PIN" ที่ super admin อนุมัติ (ADR 0002 §5) · ข้อมูลอื่น (กลุ่ม ปฏิทิน) ไม่หาย

☐ **H4.1** สร้าง pepper **ค่าใหม่** เป็นเวอร์ชันถัดไป (C1–C4 แต่ตั้งชื่อ `PIN_PEPPER_V2`) · ใน Vercel (Production): เพิ่ม `PIN_PEPPER_V2` = ค่าใหม่, ตั้ง `PIN_PEPPER_CURRENT_VERSION` = `2`, **ลบ** `PIN_PEPPER_V1` (ค่าเดิมใช้ไม่ได้อยู่แล้ว ถ้าปล่อยไว้ผิดค่าแอปจะ fail closed) → Redeploy → `/api/health`: `pepper.currentVersion` = 2 · `pepper.ok` จะยัง **false** จนกว่าผู้ใช้เวอร์ชัน 1 จะ reset ครบ (เห็นได้ที่ `usersByVersion`) — ปกติในสถานการณ์นี้
☐ **H4.2** รันสคริปต์ใน PowerShell ในโฟลเดอร์ `maewmeet` (ค่าเชื่อมฐานอยู่ใน environment ของ PowerShell เท่านั้น — **ไม่ใส่เป็น argument** และ**ไม่ตั้ง** `PIN_PEPPER_*` ในหน้าต่างนี้):
```powershell
$env:TURSO_DATABASE_URL = "libsql://maewmeet-prod-xxxx.turso.io"     # URL จาก B3
$env:TURSO_AUTH_TOKEN = [System.Net.NetworkCredential]::new('', (Read-Host -AsSecureString 'วาง TURSO_AUTH_TOKEN ของ prod')).Password
npx tsx scripts/admin-reset-pin.ts --username boss --confirm-username boss --confirm-pepper-lost
Remove-Item Env:TURSO_AUTH_TOKEN, Env:TURSO_DATABASE_URL
```
(แทน `boss` ทั้งสองที่ด้วย username ของ super admin · ต้องพิมพ์ซ้ำสองที่ให้ตรงกัน และต้องมี `--confirm-pepper-lost` มิฉะนั้นสคริปต์**ไม่ทำอะไร**)
ผลที่ควรเห็น: บรรทัด `เปิดคำขอ reset แบบอนุมัติแล้วสำหรับบัญชี: ...`, เวลาหมดอายุ (24 ชม.), `ชื่อ cookie : __Host-mm_reset`, `ค่า cookie  : <ตัวอักษร a-z 2-7 ยาว ~52 ตัว>`
  - `ไม่ทำงาน: ... ไม่พบบัญชี super admin ...` = username ผิด หรือบัญชีนั้นยังไม่ได้ตั้ง `is_admin` (H1)
  - `ไม่ทำงาน: pepper ใน env ของเครื่องนี้ยังตรง ...` = ในหน้าต่าง PowerShell นี้มี `PIN_PEPPER_*` ค้างอยู่และยังตรงกับฐาน = pepper ไม่ได้หาย → กลับ G7 ข้อ 1
  - สคริปต์**ไม่พิมพ์ PIN ไม่พิมพ์ pepper ไม่พิมพ์ TURSO_AUTH_TOKEN** · ค่า cookie ใช้ได้ **ครั้งเดียว ภายใน 24 ชม. กับเบราว์เซอร์ที่ใส่ค่านี้เท่านั้น** — อย่าส่งให้ใคร ปิดหน้าต่าง PowerShell เมื่อเสร็จ
☐ **H4.3** ใส่ cookie ในเบราว์เซอร์ (Chrome) ที่จะใช้ login: เปิดเว็บ production → กด **F12** → แท็บ **Console** → พิมพ์ (ใส่ค่าที่ได้จริงแทน `ค่า_cookie`):
```js
document.cookie = "__Host-mm_reset=ค่า_cookie; path=/; Secure"
```
(ถ้า Chrome ไม่ยอมให้วางข้อความ ให้พิมพ์ `allow pasting` กด Enter ก่อน) **(ตรวจกับหน้าจอจริง)** · ตรวจ: F12 → **Application → Storage → Cookies →** โดเมนของเรา ต้องเห็นแถวชื่อ `__Host-mm_reset` ที่ Path = `/` และ Secure ติ๊กอยู่ **(ตรวจกับหน้าจอจริง)**
☐ **H4.4** ในเบราว์เซอร์เดียวกันนี้ ไปหน้า login → username ของ boss + **PIN ชั่วคราวของ flow "ลืม PIN"** (PIN `123456` ตาม ADR 0002 §5 — ใช้ได้เฉพาะเครื่องที่มี cookie จาก H4.3 เท่านั้น) → ระบบพาไปหน้า **ตั้ง PIN ใหม่** → ตั้ง PIN ใหม่ที่ไม่ใช่ `123456` · PIN ใหม่ถูก hash ด้วย pepper V2
☐ **H4.5** เข้า `/admin/pin-resets` → ผู้ใช้อื่นกด "ลืม PIN" ตามปกติ แล้ว boss อนุมัติทีละคน (ผู้ใช้ที่ยังไม่ขอ จะเห็นข้อความปิดปรับปรุงจนกว่าจะขอ reset) → `usersByVersion` ใน `/api/health` ของเวอร์ชัน 1 ค่อย ๆ เหลือ 0 → `pepper.ok` กลับเป็น `true`
☐ **H4.6** ทำ C2–C4 กับ `PIN_PEPPER_V2` (ตัวจัดการรหัสผ่าน + สำเนาออฟไลน์) **ก่อนปิดงาน** แล้วทำ H2 ซ้ำกับ V2
ถ้าผลไม่ตรงข้อใดข้างบน: หยุด อย่าลองซ้ำหลายรอบ (การรันสคริปต์ซ้ำจะออก cookie ใหม่และยกเลิกอันเก่า ไม่เป็นอันตรายแต่สับสน) แจ้ง Lead พร้อมข้อความที่เห็น (ไม่ต้องแนบค่า cookie)

---

## I. super admin และบัญชีผู้ใช้ (ตั้งแต่ R5)
> คำสั่ง `turso` รันใน WSL (A5) · แทน `maewmeet-prod` ด้วยชื่อฐานจริง · ข้อความที่ติด **(ตรวจกับหน้าจอจริง)** ยังไม่เคยกดตามจริงบนเครื่อง boss — ถ้าไม่ตรงให้หยุดถาม Lead
> R5 เพิ่มหน้า `/admin` (ผู้ใช้ · กลุ่ม · audit log) — งานประจำทำในหน้าเว็บได้หมด ส่วนนี้คือเรื่องที่**ตั้งใจไม่ให้ทำในแอป**

### I1 ตั้ง super admin (เพิ่ม/ถอน)
เหมือน H1 ทุกข้อ: ไม่มีหน้าเว็บหรือสคริปต์ใดยกใครเป็น super admin ได้ — ใช้ SQL บรรทัดเดียวหลังผู้นั้นสมัครบัญชีธรรมดาแล้ว
```bash
turso db shell maewmeet-prod "UPDATE user SET is_admin = 1 WHERE username_normalized = lower('ชื่อผู้ใช้') AND status = 'active';"
turso db shell maewmeet-prod "SELECT username, is_admin, status FROM user WHERE is_admin = 1;"
```
- ผลที่ควรเห็นจากคำสั่งที่สอง: มีเฉพาะชื่อที่ boss ตั้งใจ · มีผลทันที (แอปอ่านสิทธิ์จาก DB ทุก request) ไม่ต้องล็อกอินใหม่
- แนะนำให้มี super admin **อย่างน้อย 2 คน** (คนที่ไว้ใจ) — เพื่อให้ I2 ทำได้โดยไม่ต้องใช้ทางฉุกเฉิน
- ถอนสิทธิ์: เปลี่ยน `1` เป็น `0` · **ห้ามถอนคนสุดท้าย** (ระบบจะไม่มีใครอนุมัติ reset PIN ได้)
- super admin ระงับ (suspend) กันเองในแอปไม่ได้ และลบบัญชีตัวเองในแอปไม่ได้ (ตั้งใจ — ADR 0003 §R5)

### I2 super admin ลืม PIN
1. **มี super admin คนอื่น (ทางปกติ)**: คนที่ลืมกด "ลืม PIN" ที่ `/forgot` บนเครื่องของตัวเอง → super admin อีกคนอนุมัติที่ `/admin/pin-resets` (ยืนยันตัวตนนอกแอปก่อน) → ใช้ PIN `123456` บนเครื่องเดิมภายใน 24 ชม. → ตั้ง PIN ใหม่ — เหมือนผู้ใช้ทั่วไปทุกข้อ
2. **มี super admin คนเดียว (ทางฉุกเฉิน)**: ใช้ `scripts/admin-reset-pin.ts` ตาม **H4.2–H4.4** โดย**ข้าม H4.1** (pepper ไม่ได้หาย — ไม่ต้องสร้างค่าใหม่ ไม่แตะ Vercel)
   - หน้าต่าง PowerShell นั้นต้อง**ไม่มี** `PIN_PEPPER_*` (สคริปต์ปฏิเสธถ้า pepper ในเครื่องตรงกับฐาน — กันการใช้ผิดที่) · แฟลก `--confirm-pepper-lost` ยังต้องใส่ (ความหมายจริง = "ยอมรับว่าใช้ทางฉุกเฉิน")
   - ผล: PIN เดิมของบัญชีนั้นใช้ไม่ได้ทันที ได้ cookie ผูกเครื่อง 24 ชม. → login ด้วย `123456` บนเครื่องที่ใส่ cookie → ตั้ง PIN ใหม่ · ผู้ใช้คนอื่นไม่โดนผลกระทบ · มีแถว `script.adminResetPin` ใน audit log
   - หลังกู้: ทำ I1 เพิ่ม super admin คนที่สองไว้ จะได้ไม่ต้องใช้ทางนี้อีก

### I3 ลบบัญชีด้วยมือ (OPS — ใช้เมื่อผู้ใช้ลบเองในแอปไม่ได้เท่านั้น)
ทางปกติคือผู้ใช้ลบเองที่แท็บ "ฉัน" → "ลบบัญชี" (ต้องใส่ PIN · ถ้าเป็นผู้ดูแลกลุ่มต้องโอนก่อน) · ทำด้วยมือเฉพาะกรณีเหล่านี้:
- **ลบบัญชี super admin**: ทำ I1 ถอน `is_admin` ของบัญชีนั้นก่อน (ต้องเหลือ super admin อย่างน้อย 1 คน) แล้วให้เจ้าของลบเองในแอป — **ไม่ต้องใช้ SQL ข้างล่าง**
- **เจ้าของขอให้ลบแต่เข้าแอปไม่ได้** (ลืม PIN และไม่อยากกู้): ยืนยันตัวตนนอกแอปก่อน แล้วทำขั้นตอนด้านล่าง
- **บัญชีที่ต้องเอาออกเพราะใช้ผิด**: ใช้ "ระงับ" ที่ `/admin/users` ก่อนเสมอ (ย้อนได้) · ลบด้วยมือเฉพาะเมื่อ boss ตัดสินแล้ว

☐ **I3.1** หา id และตรวจว่าไม่ได้เป็นผู้ดูแลกลุ่มใด (ต้องได้ **0 แถว** จากคำสั่งที่สอง — ถ้าไม่ใช่ ให้โอนผู้ดูแลกลุ่มนั้นที่ `/admin/groups` → กลุ่ม → "โอนความเป็นผู้ดูแล" ก่อน):
```bash
turso db shell maewmeet-prod "SELECT id, username, status, is_admin FROM user WHERE username_normalized = lower('ชื่อผู้ใช้');"
turso db shell maewmeet-prod "SELECT g.id, g.name FROM group_member gm JOIN groups g ON g.id = gm.group_id WHERE gm.user_id = 'USER_ID' AND gm.role = 'admin' AND g.deleted_at IS NULL;"
```
ต้องเห็น `status` = `active` หรือ `suspended` (บัญชีที่ระงับไว้ลบได้เลย ไม่ต้องยกเลิกระงับก่อน) และ `is_admin = 0` (ถ้า `is_admin = 1` → ทางแรกของ I3 แทน)

☐ **I3.2** สร้างไฟล์ `delete-user.sql` ในเครื่อง (แทน `USER_ID` **ทุกที่** ด้วย id จาก I3.1 — ใน editor ใช้ Find/Replace) — ทำแบบเดียวกับ `POST /api/me/delete` ทุกข้อ (`src/lib/data/repos/account.ts`) ในธุรกรรมเดียว · รันซ้ำได้ไม่เกิดผลซ้ำ (id ของแถว audit ต้องเป็นรูป UUID — cursor ของหน้า audit ตรวจรูปนี้) · ทดสอบแล้วด้วย `tests/ops/manual-delete-sql.test.ts`:
```sql
BEGIN;
-- 1) ด่าน: ลบได้เฉพาะบัญชี active หรือถูกระงับ · ไม่ใช่ super admin · ไม่ถือผู้ดูแลกลุ่มที่ยังอยู่ (ไม่ตรง = ไม่มีอะไรเปลี่ยน ทุกคำสั่งข้างล่างไม่ได้แถว)
DELETE FROM login_throttle WHERE key = 'u:' || (SELECT username_normalized FROM user WHERE id = 'USER_ID' AND status IN ('active', 'suspended') AND is_admin = 0
   AND NOT EXISTS (SELECT 1 FROM group_member gm JOIN groups g ON g.id = gm.group_id WHERE gm.user_id = 'USER_ID' AND gm.role = 'admin' AND g.deleted_at IS NULL));
UPDATE user SET status = 'deleted', deleted_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000, updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000,
       pin_hash = NULL, must_change_pin = 0, display_name = '', line_user_id = NULL,
       username = 'deleted-' || id, username_normalized = 'deleted-' || id
 WHERE id = 'USER_ID' AND status IN ('active', 'suspended') AND is_admin = 0
   AND NOT EXISTS (SELECT 1 FROM group_member gm JOIN groups g ON g.id = gm.group_id WHERE gm.user_id = 'USER_ID' AND gm.role = 'admin' AND g.deleted_at IS NULL);
-- 2) ร่องรอย (ทุกคำสั่งทำเฉพาะเมื่อขั้น 1 สำเร็จ)
UPDATE notification SET params = json_set(params, '$.inviterName', '')
 WHERE kind = 'group.invite.received' AND user_id <> 'USER_ID' AND EXISTS (SELECT 1 FROM user WHERE id = 'USER_ID' AND status = 'deleted')
   AND json_extract(params, '$.inviteId') IN (SELECT id FROM group_invite WHERE created_by = 'USER_ID');
UPDATE notification SET params = json_set(params, '$.inviteeName', '')
 WHERE kind IN ('group.invite.accepted', 'group.invite.declined') AND user_id <> 'USER_ID' AND EXISTS (SELECT 1 FROM user WHERE id = 'USER_ID' AND status = 'deleted')
   AND json_extract(params, '$.inviteId') IN (SELECT id FROM group_invite WHERE invitee_user_id = 'USER_ID');
DELETE FROM session WHERE user_id = 'USER_ID' AND EXISTS (SELECT 1 FROM user WHERE id = 'USER_ID' AND status = 'deleted');
DELETE FROM group_member WHERE user_id = 'USER_ID' AND EXISTS (SELECT 1 FROM user WHERE id = 'USER_ID' AND status = 'deleted');
DELETE FROM busy_block WHERE user_id = 'USER_ID' AND EXISTS (SELECT 1 FROM user WHERE id = 'USER_ID' AND status = 'deleted');
DELETE FROM appointment_rsvp WHERE user_id = 'USER_ID' AND EXISTS (SELECT 1 FROM user WHERE id = 'USER_ID' AND status = 'deleted');
DELETE FROM notification_outbox WHERE user_id = 'USER_ID' AND EXISTS (SELECT 1 FROM user WHERE id = 'USER_ID' AND status = 'deleted');
DELETE FROM line_link_code WHERE user_id = 'USER_ID' AND EXISTS (SELECT 1 FROM user WHERE id = 'USER_ID' AND status = 'deleted');
DELETE FROM notification WHERE user_id = 'USER_ID' AND EXISTS (SELECT 1 FROM user WHERE id = 'USER_ID' AND status = 'deleted');
UPDATE group_invite SET status = 'revoked', revoked_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000, revoked_by = 'USER_ID'
 WHERE created_by = 'USER_ID' AND status = 'active' AND EXISTS (SELECT 1 FROM user WHERE id = 'USER_ID' AND status = 'deleted');
UPDATE group_invite SET status = 'declined' WHERE invitee_user_id = 'USER_ID' AND kind = 'direct' AND status = 'active' AND EXISTS (SELECT 1 FROM user WHERE id = 'USER_ID' AND status = 'deleted');
UPDATE pin_reset_request SET status = 'cancelled' WHERE user_id = 'USER_ID' AND status IN ('pending', 'approved') AND EXISTS (SELECT 1 FROM user WHERE id = 'USER_ID' AND status = 'deleted');
UPDATE pin_reset_request SET requester_ua = NULL, requester_country = NULL WHERE user_id = 'USER_ID' AND EXISTS (SELECT 1 FROM user WHERE id = 'USER_ID' AND status = 'deleted');
INSERT INTO audit_log (id, actor_id, action, target_type, target_id, group_id, meta, created_at)
 SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))), NULL, 'user.delete', 'user', 'USER_ID', NULL, NULL, CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE EXISTS (SELECT 1 FROM user WHERE id = 'USER_ID' AND status = 'deleted') AND NOT EXISTS (SELECT 1 FROM audit_log WHERE action = 'user.delete' AND target_id = 'USER_ID');
COMMIT;
```
☐ **I3.3** รัน: `turso db shell maewmeet-prod < delete-user.sql` → ผลที่ควรเห็น: จบเงียบ ๆ ไม่มี error (ถ้ามี error ธุรกรรมจะไม่ถูกบันทึก — อ่านข้อความ แล้วแจ้ง Lead อย่าแก้สุ่ม) · ลบไฟล์ `delete-user.sql` ทิ้ง
☐ **I3.4** ตรวจ: `turso db shell maewmeet-prod "SELECT username, status, display_name, pin_hash IS NULL FROM user WHERE id = 'USER_ID';"` ต้องได้ `deleted-<id> | deleted | (ว่าง) | 1` · ใน `/admin/audit` กรอง "รหัสเป้าหมาย" = USER_ID ต้องเห็น "ลบบัญชีตัวเอง" โดยผู้ทำ = "ระบบ"
- สิ่งที่ยังอยู่ (เหมือนลบในแอป): นัดที่ผู้นั้นสร้าง (ผู้สร้างแสดงเป็น "บัญชีที่ถูกลบ") · audit log เดิม · แถว `user` ที่ไม่มีชื่อ/PIN · **ไม่มีการกู้คืน** และไม่มี hard purge ใน R5

## J. LINE OA — แจ้งเตือนก่อนนัด (R10)
อ้างอิง R10_CONTRACT §1.5, §2, §8 · ถ้าไม่ใส่ env ทั้งสองตัว = ช่องทาง LINE ปิดเงียบ กระดิ่งในแอปยังทำงานปกติ

### J1 ตั้งค่า LINE (boss ทำ main บอกทีละขั้น)
**ลำดับ:** J1.1 ทำ **ก่อน merge** · J1.2–J1.5 ทำ **หลัง merge** (merge แล้ว Vercel deploy ทันที โค้ดใหม่ต้องมีคอลัมน์ `appointment.scheduled_at` ในฐานแล้ว ไม่งั้น production พัง)

☐ **J1.1 (ก่อน merge)** รัน migration `0004` กับฐาน **preview (`maewmeet-preview`) ก่อน แล้วค่อย prod (`maewmeet-prod`)** ด้วยคำสั่งแบบ B6 (เปลี่ยน URL/token เป็นของแต่ละฐาน) · ตรวจว่าจบไม่มี error และมีตาราง `appointment_reminder`, `line_link_code` กับคอลัมน์ `scheduled_at` · migration เพิ่มอย่างเดียว โค้ดรุ่นเก่ายังใช้ฐานนี้ได้
☐ **J1.2 (หลัง merge)** LINE Developers Console → Provider `maewmeet` → Messaging API channel → ออก **Channel access token (long-lived)** · เก็บใน Bitwarden ทันที · **ห้ามส่งในแชท/ภาพหน้าจอ** (Channel secret อยู่แท็บ Basic settings)
☐ **J1.3 (หลัง merge)** Vercel → Settings → Environment Variables → เพิ่ม `LINE_MESSAGING_ACCESS_TOKEN` และ `LINE_MESSAGING_CHANNEL_SECRET` เป็น **Secret** เลือก environment **Production เท่านั้น** (Preview ไม่ติ๊ก) → **Redeploy** production
☐ **J1.4 (หลัง merge)** LINE Console → Messaging API → Webhook URL = `https://maewmeet.vercel.app/api/line/webhook` → กด **Verify** (ควรขึ้น Success) → เปิด **Use webhook**
☐ **J1.5 (หลัง merge)** ทดสอบ (R10-11): `/me` → เชื่อมต่อ LINE → ส่งโค้ดในแชท OA → ได้ข้อความยืนยัน → สร้างนัดที่ตอบ "ไป" แล้วรอเตือน → ต้องได้ 1 ครั้ง ไม่ซ้ำ · ค่อยชวนเพื่อน
- แผนฟรีส่งได้ 300 ข้อความ/เดือน เกินแล้วส่งไม่ได้ (กระดิ่งยังทำงาน) · ข้อความตอบกลับ (reply) ตอนเชื่อมบัญชีไม่กินโควตา

### J2 ตรวจว่า Schedules ทำงาน
Schedule ชื่อ `reminders` อยู่ใน `vercel.json` ทุก 15 นาที (เวลา `Asia/Bangkok`) เรียก `GET /api/cron/reminders` พร้อม `Authorization: Bearer <CRON_SECRET>` · `/api/cron/daily` เดิมยังเป็น Cron Job (`crons`) ไม่เปลี่ยน
☐ **J2.1** Vercel → Project → **Schedules** → ต้องเห็น `reminders` สถานะ Active (Production) · แถบ Cron Jobs ยังเห็น `/api/cron/daily`
☐ **J2.2** เลือก `reminders` → ดู **execution history**: ต้องมีรอบใหม่ทุก ~15 นาที (เหลื่อมได้ในกรอบ jitter 15 นาทีบน Hobby) และสถานะ 200
☐ **J2.3** ทดสอบทันที: ปุ่ม **Run Schedule** หรือ `vercel schedules invoke reminders` (นับ 1 รอบในโควตา) · ได้ 401 = `CRON_SECRET` ของ deployment นั้นไม่ตรง → Redeploy (Vercel ส่งค่า `CRON_SECRET` ของ deployment ปัจจุบัน)
☐ **J2.4** โควตา: ~2,900 รอบ/เดือนจากเพดาน Hobby 5,000 รอบ/เดือน (รันด้วยมือก็นับ) · ถ้าเกิน Vercel จะบล็อกจนรอบบิลถัดไป
- Preview: schedule บน branch preview เริ่มต้น **Inactive** (ไม่รันเอง) · ถ้าจะทดสอบให้ Enable ชั่วคราวใน Schedules แล้วปิดหลังทดสอบ · preview ไม่มี LINE env จึงไม่ส่งถึงคนจริงอยู่แล้ว
- Schedules ยังเป็น beta ถ้าไม่ทำงาน → แจ้ง main เพื่อเปลี่ยนไปใช้ cron-job.org เรียก endpoint เดิม (ไม่ต้องแก้ endpoint)

## ภาคผนวก: ตารางสรุปตัวแปร env
อ้างอิงเต็มใน `.env.example` (ARCHITECTURE §7) · ที่มาของกติกาเข้ม/ผ่อน: `src/lib/shared/env.ts`
| ตัวแปร | ต้องมีเมื่อ | ถ้าขาด |
|---|---|---|
| `TURSO_DATABASE_URL` | ทุกที่ (deploy ต้องเป็น `libsql://`/`https://`) | แอปไม่เริ่ม: ทุก URL 500 (G1) |
| `TURSO_AUTH_TOKEN` | production + preview | แอปไม่เริ่ม: ทุก URL 500 (G1) |
| `APP_SECRET` (base64 ≥ 32 ไบต์) | ทุกที่ | แอปไม่เริ่ม: ทุก URL 500 (G1) |
| `CRON_SECRET` (≥ 16 ตัว) | ทุกที่ | แอปไม่เริ่ม: ทุก URL 500 (G1) · keepalive ล้ม |
| `APP_ORIGIN` | production (preview ใช้ `VERCEL_URL` แทนได้) | แอปไม่เริ่ม: ทุก URL 500 (G1) |
| `PIN_PEPPER_CURRENT_VERSION`, `PIN_PEPPER_V<n>` | ทุกที่ที่ต้อง login/สมัคร (บังคับตั้งแต่ R1) | แอปยังเริ่มได้ แต่ **health 503** (`pepper.ok:false`) และ login/สมัครตอบ `AUTH_MAINTENANCE` — ไม่มีใครถูกล็อก (G7) |
| `TRUST_PROXY_HEADERS` | ไม่บังคับ — ตั้ง `1` เฉพาะ self-host หลัง proxy ที่เขียนทับ header IP (Vercel ไม่ต้องตั้ง) | ไม่เชื่อ header IP → ถัง `unknown` ร่วม เพดาน ×50 |
| `LINE_MESSAGING_ACCESS_TOKEN`, `LINE_MESSAGING_CHANNEL_SECRET` | production เท่านั้น เมื่อจะเปิด LINE (ส่วน J) | ช่องทาง LINE ปิดเงียบ · กระดิ่งทำงานปกติ |
| `PLACE_SEARCH_ENABLED`, `NOMINATIM_*`, `NEXT_PUBLIC_MAP_*`, `LOG_LEVEL` | ไม่บังคับ (มีค่าเริ่มต้น) | ใช้ค่าเริ่มต้น |

## ภาคผนวก — การเก็บกวาด busy (R3)
cron รายวัน (`/api/cron/daily`) ลบ `busy_block` ที่ `end_at` เก่ากว่า 90 วัน (`BUSY_RETENTION_DAYS`) ผลอยู่ใน `cleaned.oldBusyBlocks` · เพดาน 300 รายการ/คน นับแถวที่ `end_at > now − 8 วัน` (หน้าต่างที่ยังแก้/ย้อนลงได้) จึงไม่ต้องรอ cron เพื่อคุมจำนวน

## ภาคผนวก — Server-Timing: วัดเวลา DB ต่อคำขอ (R7)
**คืออะไร:** header `Server-Timing` ที่เซิร์ฟเวอร์แนบมากับคำตอบ API บอกว่าคำขอนั้นใช้ DB กี่ query นานเท่าไร และใช้เวลารวมเท่าไร เช่น `db;dur=84.2;desc="6 queries", total;dur=131.5` (หน่วยมิลลิวินาที) — ใช้หาว่าหน้าไหนช้าเพราะ DB (Turso ญี่ปุ่น) หรือเพราะอย่างอื่น

**แนบเมื่อไร:** เฉพาะ **ผู้ใช้ที่ล็อกอินแล้ว + คำตอบสำเร็จ (สถานะ < 400)** · เฉพาะ **API (`/api/...`)** — ยังไม่มีบนหน้าเว็บ (RSC) · ไม่แนบให้ login/สมัคร/ลืม PIN/health/cron และไม่แนบเมื่อคำตอบเป็น error · ค่าใน header มีแค่ตัวเลข ไม่มี SQL, พารามิเตอร์, id หรือข้อมูลผู้ใช้

**env `SERVER_TIMING_ENABLED`**
| ค่า | ผล |
|---|---|
| `true` | เปิด |
| `false` | ปิด |
| ไม่ตั้ง/ว่าง | เปิด ยกเว้นเมื่อ `VERCEL_ENV=production` (production = ปิด) |
| ค่าอื่น | ปิด (และ `assertEnv` แจ้งชื่อตัวแปร) |

**เปิดชั่วคราวบน Vercel (preview ไม่ต้องทำอะไร — ไม่ตั้งก็เปิดอยู่แล้ว · production ต้องตั้งเอง):**
1. Vercel → โปรเจกต์ maewmeet → **Settings → Environment Variables**
2. **Add New** → Key `SERVER_TIMING_ENABLED` · Value `true` · เลือก environment ที่ต้องการ (Preview และ/หรือ Production) → Save
3. ไปแท็บ **Deployments** → deploy ล่าสุด → เมนู `…` → **Redeploy** (ค่า env ใหม่มีผลหลัง redeploy เท่านั้น)
4. **ปิดกลับ:** ลบตัวแปรนั้น (production จะกลับไปปิด) หรือแก้ Value เป็น `false` → Redeploy อีกครั้ง · ทำทันทีที่วัดเสร็จ

**ขั้นตอนให้ boss อ่านค่าเอง (ทีละขั้น):**
1. เปิดหน้า preview ใน Chrome แล้ว **ล็อกอิน** (ต้องล็อกอิน ไม่งั้น header ไม่ขึ้น)
2. กด **F12** (เปิด DevTools) → แท็บ **Network**
3. ติ๊ก **Disable cache** ไว้ (ให้วัดจริง ไม่ใช่จากแคช) แล้วกดปุ่ม **Fetch/XHR** เพื่อเหลือแต่คำขอ API
4. ในแอป กดสลับแท็บ (หน้าแรก, ปฏิทิน, กลุ่ม, ฉัน) หรือกด **RSVP** หนึ่งครั้ง — จะมีแถว `/api/...` โผล่ในรายการ
5. คลิกแถว `/api/...` หนึ่งแถว → แท็บ **Timing** → เลื่อนลงหาหัวข้อ **Server Timing**
6. อ่านสองบรรทัด: **`db`** = เวลาที่ใช้กับ DB (ms) และจำนวน query (`N queries`) · **`total`** = เวลารวมที่เซิร์ฟเวอร์ใช้ (ms)
7. จดมาให้ main: ชื่อ endpoint (เช่น `/api/appointments/...`), สิ่งที่ทำ (เปิดหน้าไหน/RSVP), ค่า `db` (ms + จำนวน query), ค่า `total` (ms) · ทำซ้ำ 3 รอบต่อ endpoint แล้วจดทุกรอบ (รอบแรกอาจช้ากว่าเพราะ cold start) · ถ้าไม่เห็นหัวข้อ Server Timing → ตรวจว่าล็อกอินแล้ว คำตอบสำเร็จ และ env เปิดอยู่ (ดูตารางด้านบน) แล้วแจ้ง main
