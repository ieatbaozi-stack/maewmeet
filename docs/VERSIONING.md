# VERSIONING — การนับเวอร์ชันและการออกรุ่นของ maewmeet

> เจ้าของ: Release engineer (#15) · อ้างอิง: [PROCESS.md](../PROCESS.md) ข้อ 7 · [CLAUDE.md](../CLAUDE.md) กฎ 10 · [CHANGELOG.md](../CHANGELOG.md)
> สคริปต์: `scripts/release.ts` · คนรัน release: **boss เท่านั้น** (agent เสนอเลข ไม่ออกรุ่นเอง ไม่ push)

## 1. รูปแบบเวอร์ชัน
- ใช้ [Semantic Versioning 2.0.0](https://semver.org/lang/th/) รูปแบบ `MAJOR.MINOR.PATCH` (เช่น `0.1.0`)
- **รุ่นแรกคือ `v0.1.0`** (จบรอบ R0) · `package.json` เริ่มที่ `0.0.0` = ยังไม่เคยออกรุ่น
- git tag รูปแบบ **`vX.Y.Z`** (มี `v` นำหน้า) เป็น annotated tag (`git tag -a`) เท่านั้น
- pre-release (`0.2.0-rc.1`) ใช้ได้ถ้าจำเป็น แต่ปกติไม่ใช้ · build metadata (`+xxx`) ไม่ใช้

## 2. ชื่อรอบงาน ≠ เวอร์ชัน
R0–R7 เป็น **ชื่อรอบงาน** ของทีม ไม่ใช่เลขเวอร์ชัน · รอบหนึ่งอาจออก 0, 1 หรือหลายรุ่น · เลขาและรายงานอ้างเวอร์ชันจาก tag + CHANGELOG เท่านั้น
ตัวอย่าง: "R0 จบ → เสนอ v0.1.0" · "R1 จบ → เสนอ v0.2.0" · "แก้บั๊ก login หลัง R1 → v0.2.1"

## 3. เลขไหนขยับเมื่อไหร่

### ก่อน 1.0 (ช่วงที่เราอยู่ตอนนี้)
| ขยับ | เมื่อไหร่ | ตัวอย่าง |
|---|---|---|
| **MINOR** (`0.x.0`) | มีความสามารถใหม่ที่ผู้ใช้เห็น · **มี migration / เปลี่ยน schema** · เปลี่ยนพฤติกรรม API · เพิ่ม/เปลี่ยน env | จบรอบ R1 (login), เพิ่มตาราง, เพิ่ม env ใหม่ |
| **PATCH** (`0.x.y`) | แก้บั๊ก · แก้ข้อความ/แปล · ปรับสไตล์ · อัปเดต dependency ที่ไม่เปลี่ยนพฤติกรรม · เอกสาร — **ไม่มี migration และไม่เปลี่ยน env** | แก้ปุ่มล้นจอ 375px |

ก่อน 1.0 เราไม่ขยับ MAJOR — การเปลี่ยนแบบ breaking ขยับ MINOR **และต้องมีหัวข้อ "Upgrade notes"** ใน CHANGELOG ของรุ่นนั้น

### หลัง 1.0
MAJOR = breaking · MINOR = ความสามารถใหม่ที่ไม่ breaking (migration แบบเพิ่มอย่างเดียวได้) · PATCH = แก้บั๊ก

### ถือว่า "breaking" เมื่อ (ต้องมี Upgrade notes เสมอ)
1. **migration ที่ย้อนไม่ได้** — ลบ/เปลี่ยนชื่อคอลัมน์หรือตาราง, เปลี่ยนชนิดข้อมูล, แปลงข้อมูลเดิม, เพิ่ม constraint ที่ข้อมูลเก่าอาจไม่ผ่าน
2. **env ที่ต้องตั้งใหม่หรือแก้** — เพิ่มตัวแปร "ต้องมี", เปลี่ยนชื่อ/รูปแบบค่า, ต้องสร้างความลับใหม่ (เช่น pepper เวอร์ชันใหม่)
3. **ต้องทำมือบนบริการภายนอก** — Vercel (cron/โดเมน), Turso, GitHub Secrets/Actions
4. ผู้ใช้เดิมถูกบังคับออกจากระบบ/ต้องตั้ง PIN ใหม่ · URL/คุกกี้ที่ผู้ใช้เก็บไว้ใช้ไม่ได้
5. ลบหรือเปลี่ยนรูปแบบ endpoint ที่มีคนเรียกอยู่ (รวม cron/keep-alive)

"Upgrade notes" ต้องบอก **ทีละข้อ** ว่า boss ต้องทำอะไร ก่อน/หลัง deploy และถ้าไม่ทำจะเกิดอะไร

## 4. CHANGELOG
- รูปแบบ [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) · ใหม่อยู่บน
- ทุกงานที่รวมเข้า `main` เพิ่มบรรทัดใต้ `## [Unreleased]` (Lead รวม/ปรับให้ตรงของจริงตอนรวมรอบ)
- หัวข้อย่อยที่ใช้: `### Added` · `### Changed` · `### Deprecated` · `### Removed` · `### Fixed` · `### Security` · `### Upgrade notes` (ของเราเพิ่มเอง — ใส่เมื่อเข้าเงื่อนไข §3) · `### Docs`
- บรรทัดหมายเหตุ `>` ใต้ `[Unreleased]` (เช่น "ข้อเสนอเลขเวอร์ชัน") เป็นหมายเหตุร่าง — ไม่นับเป็นเนื้อหา และถูกตัดออกตอนออกรุ่น · หัวข้อย่อยที่ว่างก็ถูกตัดออกด้วย
- ตอน release สคริปต์ย้าย `[Unreleased]` → `## [X.Y.Z] - YYYY-MM-DD` (วันที่ตามเวลา **Asia/Bangkok**) แล้วสร้าง `[Unreleased]` ว่างใหม่ — **ห้ามแก้หัวข้อรุ่นที่ออกไปแล้ว** (ยกเว้นแก้คำผิด)

## 5. กติกาการออกรุ่น
- ออกรุ่นจาก **`main` ที่สะอาดเท่านั้น** (ไม่มีไฟล์ค้างแก้/ยังไม่ commit, ไม่มีไฟล์ untracked) และควรตรงกับ `origin/main` (pull ก่อน)
- เวอร์ชันใหม่ต้อง **มากกว่า tag ล่าสุด** และ tag นั้นต้องยังไม่มี
- ใต้ `[Unreleased]` ต้องมีเนื้อหาจริง (ไม่ใช่หัวข้อว่าง)
- เกตต้องผ่านทั้งหมดก่อน: `npm run lint` → `npm run typecheck` → `npm test` → `npm run build`
- Lead เสนอเลขในรายงานรอบ (ผ่านเลขา) → boss อนุมัติ → **boss รันสคริปต์และ push เอง**
- สคริปต์ **ไม่ push** — พิมพ์คำสั่ง push ให้ boss ก๊อปไปรันเอง

## 6. ขั้นตอนที่ boss รัน (Windows PowerShell — ก๊อปวางทีละบล็อก)

> แทน `0.1.0` ด้วยเลขที่ Lead เสนอ · รันในโฟลเดอร์ repo (เช่น `cd C:\path\to\maewmeet`) · ต้องมี Node 24 และ git

**1) ไปที่ `main` และดึงล่าสุด**
```powershell
git switch main
git pull --ff-only
git status
```
`git status` ต้องขึ้น `nothing to commit, working tree clean` — ถ้าไม่ ให้หยุดแล้วแจ้ง Lead

**2) ติดตั้ง dependency ให้ตรง lockfile**
```powershell
npm ci
```

**3) ซ้อมก่อน (ไม่แก้ไฟล์ ไม่สร้าง commit/tag)**
```powershell
npx tsx scripts/release.ts 0.1.0 --dry-run
```
ดูว่า "ผลการตรวจ" ผ่านทุกข้อ และ diff ของ `CHANGELOG.md` / `package.json` ถูกต้อง · exit code 0 = พร้อม

**4) ออกรุ่นจริง** (รันเกต lint/typecheck/test/build ก่อน ใช้เวลาหลายนาที)
```powershell
npx tsx scripts/release.ts 0.1.0
```
สคริปต์จะ: แก้ `CHANGELOG.md` + `package.json` (+ `package-lock.json`) → commit `chore(release): v0.1.0` → สร้าง tag `v0.1.0` (ในเครื่องเท่านั้น)

**5) ตรวจแล้ว push** (สคริปต์พิมพ์คำสั่งนี้ให้ตอนจบด้วย)
```powershell
git show --stat HEAD
git push origin main
git push origin v0.1.0
```

**ถ้ารันแล้วเปลี่ยนใจก่อน push** (ยกเลิก commit + tag ในเครื่อง):
```powershell
git tag -d v0.1.0
git reset --hard HEAD~1
```
> ใช้ได้เฉพาะ **ก่อน push** เท่านั้น · ถ้า push แล้วห้ามลบ tag — ออกรุ่น PATCH ใหม่แทน

### ข้อความ error ที่พบบ่อย
| ข้อความ | แก้ |
|---|---|
| `ต้องอยู่บน branch main` | `git switch main` |
| `working tree ไม่สะอาด` | commit/ทิ้งไฟล์ที่ค้าง หรือแจ้ง Lead (ห้ามลบไฟล์ที่ไม่รู้จัก) |
| `เวอร์ชันต้องมากกว่า tag ล่าสุด` | ใช้เลขที่ใหม่กว่า — ดู tag ล่าสุดด้วย `git describe --tags --abbrev=0` |
| `[Unreleased] ว่าง` | ยังไม่มีอะไรให้ออกรุ่น — แจ้ง Lead |
| เกต `npm run …` ล้ม | ไม่มีไฟล์ถูกแก้ · ส่งข้อความ error ให้ Lead |

## 7. รายละเอียดสคริปต์ `scripts/release.ts`
```
npx tsx scripts/release.ts <version> [--dry-run] [--skip-gates]
```
| ตัวเลือก | ผล |
|---|---|
| `<version>` | SemVer ไม่มี `v` นำหน้า (ใส่ `v` มาก็รับได้) |
| `--dry-run` | ตรวจเงื่อนไข + แสดงแผนและ diff ทั้งหมด **ไม่แก้ไฟล์ ไม่รันคำสั่ง git ที่เขียน ไม่รันเกต npm** · exit 0 = เงื่อนไขครบ, exit 1 = มีข้อไม่ผ่าน (แผนยังแสดงให้ดู) |
| `--skip-gates` | ข้ามเกต npm (ใช้เมื่อ Lead ยืนยันว่า CI เขียวบน commit นี้แล้วเท่านั้น) |

ลำดับที่ทำ (ไม่ใช่ dry-run): ตรวจเงื่อนไข → เกต npm → แก้ไฟล์ → `git commit` (เฉพาะไฟล์ที่แก้) → `git tag -a` · ถ้าขั้นใดหลังแก้ไฟล์ล้ม สคริปต์คืนไฟล์เดิมให้ (ไม่มี commit/tag ค้าง)

logic ที่ทดสอบได้ (export จาก `scripts/release.ts`): `parseSemver`, `compareSemver`, `latestVersionFromTags`, `getUnreleasedBody`, `hasUnreleasedContent`, `applyRelease`, `bumpJsonVersion`, `bumpLockVersion`, `bangkokDate`, `checkPreconditions`, `unifiedDiff`, `runRelease` · เทสต์ใน `tests/release/`
