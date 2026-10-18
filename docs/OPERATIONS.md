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

☐ **A2** ติดตั้ง Git for Windows (<https://git-scm.com>) แล้ว clone repo (หลังจาก push จาก bundle แล้ว):
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
☐ **C2** เก็บในตัวจัดการรหัสผ่าน: รายการชื่อ **`maewmeet PIN_PEPPER_V1 (production)`** · ช่องรหัสผ่าน = ค่า pepper · ช่องโน้ต: วันที่สร้าง + "fingerprint: (เติมใน R1)"
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

**ตั้งแต่ R1**: สคริปต์ `scripts/pepper-fingerprint.ts` จะคำนวณ fingerprint แบบเดียวกับที่แอปเก็บในฐาน (HMAC-SHA256) ให้เทียบกับ 8 ตัวแรกในหน้า super admin:
```powershell
Get-Clipboard | npx tsx scripts/pepper-fingerprint.ts
```
(ใน R0 สคริปต์ยังตอบ `ยังไม่พร้อมใช้` และ exit 3 — ตั้งใจ) · สคริปต์รับค่าทาง stdin เท่านั้น **ห้าม**พิมพ์ pepper ต่อท้ายคำสั่งเป็น argument

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

  ตัวแปรที่ไม่ต้องใส่ (มีค่าเริ่มต้นในโค้ดแล้ว): `NOMINATIM_BASE_URL`, `NEXT_PUBLIC_MAP_TILE_URL`, `NEXT_PUBLIC_MAP_ATTRIBUTION` · `VERCEL_URL`/`VERCEL_ENV` Vercel ใส่ให้เอง · ตัวแปร `LINE_*` ยังไม่ใช้ใน v1
  ถ้าค่าใดใน `.env.example` เปลี่ยนในรอบหน้า Lead จะแจ้งในรายงาน

☐ **D4** กด **Deploy** → รอจน Status = Ready
☐ **D5** Project → **Settings → Build and Deployment → Node.js Version** = **24.x** (ปกติตรงอยู่แล้วเพราะ `package.json` ระบุ `"engines": {"node": "24.x"}` — ถ้าไม่ตรงให้แก้แล้ว Redeploy)
☐ **D6** Project → **Settings → Domains** ดูโดเมน production (ปกติ `https://maewmeet.vercel.app` ถ้าชื่อว่าง) — ถ้า**ไม่ตรง**กับ `APP_ORIGIN` ที่ใส่ใน D3 ให้แก้ `APP_ORIGIN` เป็นค่าจริง (ขึ้นต้น `https://` ไม่มี `/` ท้าย ไม่มี path) แล้ว **Deployments → … → Redeploy**
☐ **D7** Project → **Settings → Cron Jobs** ควรเห็น `/api/cron/daily` ตาราง `0 19 * * *` (= ตี 2 เวลาไทย คลาดได้ถึง 59 นาที) · cron ทำงานเฉพาะ production deployment

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
> - อีเมลของ workflow แบบตั้งเวลาส่งถึง **คนที่สร้าง workflow** (หรือคนล่าสุดที่แก้บรรทัด `cron` / คนที่เปิดใช้ใหม่) → ไฟล์ต้องถูก push จากบัญชีของ boss (ตามวิธีส่งงานแบบ bundle อยู่แล้ว) · ถ้าเคยกด Disable แล้วเปิดใหม่ คนที่กดเปิดจะเป็นผู้รับ
> - repo ต้องเป็น **private** — repo สาธารณะที่ไม่มีความเคลื่อนไหว 60 วัน GitHub จะปิด workflow ตั้งเวลาเอง
> - ก่อนตั้ง E1 workflow จะ "ข้าม" พร้อมคำเตือนสีเหลือง (ไม่ล้ม ไม่ส่งอีเมล)

---

## F. ตรวจหลัง deploy (ทำทุกครั้งที่ deploy production)
☐ **F1** เปิดในเบราว์เซอร์ `https://<โดเมนจาก D6>/api/health` ควรเห็น (เลขเวอร์ชัน/ชั่วโมงต่างได้):
```json
{"ok":true,"version":"0.1.0","node":"v24.x.x","argon2":true,"db":true,"heartbeatAgeHours":{"vercelCron":null,"githubActions":null}}
```
  - `ok:true` + `db:true` = แอปต่อฐานได้ และ env ครบ
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
login ทั้งระบบตอบ "ปิดปรับปรุงชั่วคราว" + health 503 = pepper ใน Vercel หาย/ผิด → **อย่าสร้างใหม่** → เอาค่าจากตัวจัดการรหัสผ่าน (C2) ใส่ `PIN_PEPPER_V1` ใน Vercel → Redeploy → ทำ C8 เทียบ fingerprint · ถ้าหายครบทุกสำเนาจริง ๆ เท่านั้นจึงใช้ทางกู้ฉุกเฉินของ super admin (ADR 0002 §7.4 — สคริปต์จะมาในรอบที่ทำ auth/admin) และแจ้ง Lead

---

## ภาคผนวก: ตารางสรุปตัวแปร env
อ้างอิงเต็มใน `.env.example` (ARCHITECTURE §7) · ที่มาของกติกาเข้ม/ผ่อน: `src/lib/shared/env.ts`
| ตัวแปร | ต้องมีเมื่อ | ถ้าขาด |
|---|---|---|
| `TURSO_DATABASE_URL` | ทุกที่ (deploy ต้องเป็น `libsql://`/`https://`) | แอปไม่เริ่ม: ทุก URL 500 (G1) |
| `TURSO_AUTH_TOKEN` | production + preview | แอปไม่เริ่ม: ทุก URL 500 (G1) |
| `APP_SECRET` (base64 ≥ 32 ไบต์) | ทุกที่ | แอปไม่เริ่ม: ทุก URL 500 (G1) |
| `CRON_SECRET` (≥ 16 ตัว) | ทุกที่ | แอปไม่เริ่ม: ทุก URL 500 (G1) · keepalive ล้ม |
| `APP_ORIGIN` | production (preview ใช้ `VERCEL_URL` แทนได้) | แอปไม่เริ่ม: ทุก URL 500 (G1) |
| `PIN_PEPPER_CURRENT_VERSION`, `PIN_PEPPER_V<n>` | ตั้งแต่ R1 บังคับ (R0 ตั้งไว้ล่วงหน้า) | R1: login ปิด (`AUTH_MAINTENANCE`) ไม่มีใครโดนล็อก |
| `PLACE_SEARCH_ENABLED`, `NOMINATIM_*`, `NEXT_PUBLIC_MAP_*`, `LOG_LEVEL` | ไม่บังคับ (มีค่าเริ่มต้น) | ใช้ค่าเริ่มต้น |
