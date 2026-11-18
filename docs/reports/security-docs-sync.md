# Security review — docs/sync-r15 (DOCS_SYNC_CONTRACT §6: dependency + เอกสาร)

- ผู้ตรวจ: Security (อิสระ ไม่ได้เขียนงานนี้) · 2026-11-18 · branch `docs/sync-r15` HEAD `2bc7808` · ช่วง `8af88ee..HEAD` (7 commit, 53 ไฟล์) · เทียบ DOCS_SYNC_CONTRACT §6 · กฎเหล็ก CLAUDE.md ข้อ 7
- วิธี: อ่าน diff ของ lockfile ทุกบรรทัดที่เป็นโครงสร้าง · เทียบ integrity กับ registry · อ่าน advisory จาก GitHub API · ไล่โค้ด `next-intl` / `next` ใน `node_modules` · ค้นใน trace ของ build (`.next/**/*.nft.json`) · สแกนบรรทัดที่เพิ่มทุกบรรทัด · ไม่แก้ `src/`/`tests/`/config · `git status` สะอาดหลังตรวจ
- เครื่อง: Windows · ✅ = ยืนยันด้วยการรันจริง · 📖 = ยืนยันจากการอ่านโค้ด · ❓ = ยืนยันไม่ได้

## สรุป
| ระดับ | จำนวน |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 1 |
| Info | 4 |

**Verdict: ผ่านแบบมีข้อสังเกต** — override สองตัวจำกัดขอบเขตถูกต้อง lockfile เปลี่ยนเฉพาะ esbuild/minimatch (และ dependency ใหม่ 1 ตัวของ minimatch 11.0.1 ที่ถูกต้อง) ทุกแพ็กเกจมาจาก `registry.npmjs.org` และ integrity ตรงกับ registry · picomatch ยังไม่ถึงคำขอของผู้ใช้ (ยืนยันจากโค้ดและ trace ของ build) · เอกสารไม่มีความลับ ไม่มีข้อมูลคน และไม่มี URL ฐานข้อมูลจริง · Low 1 คือความเสี่ยงคงค้างของ picomatch ที่ยอมรับได้ แต่ต้องติดตามต่อ

## 1. Dependency (commit `a3d18ed`)
| ข้อ | ผล | หลักฐาน |
|---|---|---|
| ขอบเขต `overrides` | **PASS** | 📖 `package.json` ใช้ override แบบซ้อน: `@typescript-eslint/typescript-estree` → `minimatch 11.0.1` · `@esbuild-kit/core-utils` → `esbuild 0.25.12` ไม่ได้บังคับทั้งต้นไม้ · ✅ `npm ls esbuild minimatch --all` แสดง `minimatch@11.0.1 overridden` เฉพาะใต้ typescript-estree · ส่วน eslint ตัวอื่นยังใช้ `3.1.5` ซึ่งอยู่นอกช่วงที่ได้รับผลกระทบ `>=7.0.0 <11.0.1` (ยืนยันกับ `gh api advisories/GHSA-g3hv-75wg-m249`) · `esbuild@0.25.12 overridden` ใต้ core-utils · vite/tsx ใช้ 0.28.2 ของตัวเอง |
| lockfile เปลี่ยนเฉพาะสองตัวนี้ | **PASS** | ✅ `git show a3d18ed -- package-lock.json`: `-` esbuild/@esbuild/* 0.18.20 (23 รายการ) และ minimatch 10.2.6 · `+` esbuild/@esbuild/* 0.25.12 (27 รายการ รวมแพลตฟอร์มใหม่ aix-ppc64, netbsd-arm64, openbsd-arm64, openharmony-arm64) และ minimatch 11.0.1 · แพ็กเกจใหม่ตัวเดียวคือ `@isaacs/nonrecursive-glob-match@1.1.0` (dependency ของ minimatch 11.0.1, `dev: true`) · range ของ `brace-expansion` เปลี่ยนเป็น `^5.0.12` แต่ตัวที่ติดตั้ง (5.0.12) เหมือนเดิม |
| registry / resolved | **PASS** | ✅ `grep '"resolved"' package-lock.json \| grep -v https://registry.npmjs.org/` → ไม่พบ (ทั้งไฟล์) |
| integrity ตรงกับ registry | **PASS** | ✅ `npm view <pkg> dist.integrity` ตรงกับ lockfile ทุกตัวที่สุ่มตรวจ: `minimatch@11.0.1` (`sha512-t+Vn6DX4…`), `@isaacs/nonrecursive-glob-match@1.1.0` (`sha512-GPm/Dbvk…`), `esbuild@0.25.12` (`sha512-bbPBYYrt…`), `@esbuild/linux-x64@0.25.12` (`sha512-uqZMTLr/…`), `@esbuild/win32-x64@0.25.12` (`sha512-alJC0uCZ…`) · ผู้ดูแล: isaacs / evanw+esbuild ตามปกติ |
| ช่องโหว่สองตัวปิดแล้ว | **PASS** | ✅ `npm audit --json`: moderate = 0 (ไม่มี esbuild/minimatch แล้ว) · เหลือ high 18 รายการ ทุกรายการสืบมาจาก picomatch GHSA-fc5q-39xc-vjpf ตัวเดียว |
| ไม่ทำให้เครื่องมือพัง | **PASS** | ✅ `npm ls --all` exit 0 · `core-utils/node_modules/esbuild --version` = 0.25.12 · `npm run lint` exit 0 · `drizzle-kit --version` v0.31.11 · `drizzle-kit check` → "Everything's fine" |

## 2. picomatch GHSA-fc5q-39xc-vjpf (high, ยังไม่มีรุ่นแก้)
- ✅ `gh api advisories/GHSA-fc5q-39xc-vjpf`: `picomatch <= 4.0.7`, `first_patched_version: null`, CVSS `AV:N/AC:L/PR:N/UI:N/A:H` · **เงื่อนไขคือผู้โจมตีต้องกำหนด "รูปแบบ glob" ได้เอง** (เช่น `+(*)`, `+(*a)`) แล้วจับคู่กับสตริงสั้นที่สร้างมา
- ✅ ที่มา (`npm ls picomatch @parcel/watcher --all`): vite/vitest/tinyglobby/fdir (เทสต์) · `@next/eslint-plugin-next → fast-glob → micromatch → picomatch@2.3.2` (lint) · `next-intl@4.14.9 → @parcel/watcher@2.6.0 → picomatch@4.0.7` (production dependency)
- 📖 `@parcel/watcher` ถูก import เฉพาะใน `next-intl/dist/cjs/development/plugin.cjs` และ `extractor/source/SourceFileWatcher.js` · plugin สร้าง `SourceFileWatcher` เฉพาะเมื่อตั้งค่า `extract` · `next.config.ts:103` เรียก `createNextIntlPlugin("./src/i18n/request.ts")` (ส่ง path อย่างเดียว ไม่มี `extract`) → ไม่ทำงานทั้งตอน build และ runtime · ถึงจะเปิดใช้ รูปแบบ `ignore` ก็เป็นค่าคงที่ (`IGNORED_DIRECTORIES`) ไม่ได้มาจากผู้ใช้
- ✅ build ปัจจุบันมี trace 85 ไฟล์ (`find .next -name "*.nft.json"`) → ไม่มีไฟล์ไหนอ้าง `node_modules/picomatch`, `@parcel/watcher`, `micromatch`, `minimatch` หรือ `esbuild` เลย (ไม่มี `.next/standalone` เพราะไม่ได้ตั้ง `output`)
- 📖 สิ่งที่ npm audit มองไม่เห็น: `next` มี picomatch ฝังมาเอง (`next/dist/compiled/picomatch`, อยู่ใน `.next/next-server.js.nft.json`) ใช้ใน `shared/lib/match-local-pattern.js` / `match-remote-pattern.js` โดย `makeRe(pattern.pathname ?? '**')` ซึ่งรูปแบบมาจาก `images.localPatterns/remotePatterns` ในคอนฟิก ส่วน URL ของผู้ใช้เป็นแค่สตริงที่นำมาทดสอบ ไม่ใช่รูปแบบ · แอปไม่ได้ตั้ง `images` และ `grep -rn "next/image" src` = 0 → ไม่เข้าเงื่อนไข
- ✅ `grep -rn "picomatch|micromatch|minimatch|parcel/watcher" src` → ไม่พบ (โค้ดของเราไม่เรียก glob)
- **Verdict ข้อ 2: เห็นด้วยกับ ops** — ไม่มีทางที่ input ของผู้ใช้จะกลายเป็นรูปแบบ glob บน production → ดู Low 1

## 3. เอกสารและไฟล์อื่นที่เปลี่ยน (`git diff 8af88ee..HEAD`)
- ✅ สแกนบรรทัดที่เพิ่มทั้งหมด 904 บรรทัด (รวมไฟล์ที่ไม่ใช่ .md/.html) ด้วย regex หา URL ฐานข้อมูล (`postgres|mysql|redis|mongodb|libsql://<host>`), token (`ghp_`, `github_pat_`, `sk_`, `xox*`, `AKIA`, JWT `eyJ…`, `-----BEGIN`, `Bearer …`, hex/base64 ยาว ≥40 ยกเว้น `sha512-` ของ lockfile), การกำหนดค่า `SECRET|TOKEN|PASSWORD|API_KEY|DATABASE_URL|CHANNEL_ACCESS = <ค่า>`, LINE user id `U[0-9a-f]{32}`, เบอร์โทร, `*.vercel.app` → **ไม่พบค่าจริง**
  - อีเมลที่พบมีแค่ `309017158+…@users.noreply.github.com` (noreply ของ boss ที่ใช้เป็นผู้เขียน commit อยู่แล้ว) ซึ่งไม่ใช่อีเมลจริง
  - URL ฐานข้อมูลมีแค่ placeholder `libsql://…` (ARCHITECTURE) และของเดิม `libsql://maewmeet-prod-xxxx.turso.io` (OPERATIONS)
  - ชื่อคนในตัวอย่าง UI (`docs/design/tools/build-calendar.mjs`) เป็นข้อมูลสมมติชุดเดิม diff เปลี่ยนแค่ attribute `data-slot` เป็น `data-color`/`data-shape`
- 📖 ไฟล์ที่ไม่ใช่เอกสาร: `next.config.ts` และ `.github/workflows/keepalive.yml` เปลี่ยนแค่คอมเมนต์ (CSP/header ไม่เปลี่ยน) · `tests/ops/docs-sync.test.ts` เป็นเทสต์ใหม่ (qa เป็นคนตรวจ)
- 📖 OPERATIONS ไม่มีคำแนะนำที่ลดความปลอดภัย: บอกให้ `TRUST_PROXY_HEADERS` ตั้งเฉพาะ self-host หลัง proxy ที่เขียน header IP ทับ (ถูกต้องตาม ADR 0002 §3) · `LINE_*` ยังเป็นชนิด Secret · ระบุว่า repo เป็น public และวิธีเปิด scheduled workflow กลับมาใหม่ (ไม่ได้แนะนำให้ใส่ความลับลง repo) · ภาคผนวก Dependabot ห้ามใช้ `npm audit fix --force` ซึ่งถูกต้อง

## ข้อพบ
### Low 1 — picomatch GHSA-fc5q-39xc-vjpf ยังคงอยู่ (ยอมรับความเสี่ยงได้ แต่ต้องติดตาม)
- `@parcel/watcher` (มี install script และเป็น native addon) ถูกติดตั้งบน Vercel เพราะเป็น dependency ของ `next-intl` แต่ไม่ถูกโหลด (trace = 0) · picomatch ที่ next ฝังมาเองใช้กับรูปแบบจากคอนฟิกเท่านั้น
- ข้อเสนอ: **ยอมรับความเสี่ยงตามที่บันทึกใน OPERATIONS** และติดตามต่อด้วยเงื่อนไขชัดเจน: (ก) เมื่อ picomatch ออกรุ่นแก้ ให้เพิ่ม override/อัปเดต (ข) ถ้าวันหนึ่งเปิด `next-intl` `extract`, ตั้ง `images.localPatterns/remotePatterns` หรือโค้ดของเราเริ่มรับ glob/รูปแบบจากผู้ใช้ ต้องประเมินใหม่ก่อน merge (ค) ไม่ต้องติดตั้งทางแก้ชั่วคราว (เช่น override ด้วย fork) เพราะไม่มีเส้นทางที่ถูกโจมตีได้

### Info 1 — ห้ามใช้ `npm audit fix` แม้ไม่ใส่ `--force`
- ✅ `npm audit fix --dry-run --package-lock-only` → "Will install vitest@3.1.4, which is a breaking change" และยังเหลือ picomatch ทุกตัว (ช่วงที่ได้รับผลกระทบคือทุกรุ่น) · OPERATIONS เตือนแค่ `--force` เสนอให้ ops เพิ่มคำว่า "ห้ามรัน `npm audit fix` ทั้งแบบมีและไม่มี `--force` จนกว่าจะมีรุ่นแก้" ในรอบถัดไป (ไม่บล็อก)

### Info 2 — ตัวเลข audit ใน PROGRESS ไม่ตรงกับหลัง override
- `docs/team/PROGRESS.md:310` เขียนว่า "npm audit 23 รายการ (10 moderate, 13 high)" แต่หลัง `a3d18ed` ผลจริงคือ `{"moderate":0,"high":18,"total":18}` (✅ `npm audit --json` metadata) · ส่งให้ secretary แก้ตัวเลข หรือเขียนกำกับว่าเป็นตัวเลขก่อน override

### Info 3 — dependency ใหม่ `@isaacs/nonrecursive-glob-match`
- มาพร้อม minimatch 11.0.1 (ประกาศใน `dependencies` ของ minimatch เอง) ผู้ดูแลคือ isaacs คนเดียวกับ minimatch · integrity ตรงกับ registry · `dev: true` → ไม่ถูกส่งขึ้น production · บันทึกไว้เพื่อให้ตรวจได้ว่าการเพิ่มแพ็กเกจนี้ตั้งใจ ไม่ได้แอบเข้ามา

### Info 4 — มี commit ใหม่เข้ามาระหว่างตรวจ
- ตอนเริ่มตรวจ HEAD = `0b67738` จากนั้นมี `2bc7808` (docs(ci): keepalive comment) เพิ่มเข้ามา รายงานนี้ครอบคลุมถึง `2bc7808` แล้ว ถ้ามี commit หลังจากนี้ ต้องตรวจส่วนต่างเพิ่ม

## ยืนยันไม่ได้
- ❓ build บน Vercel จริง (Linux) — ใช้ trace ของ `.next` ในเครื่อง (สร้างเมื่อ 2026-11-18 15:20 หลัง override) แทน
- ❓ ไม่ได้รัน `npm test`/e2e ทั้งชุด (เป็นงานของ qa · เครื่อง Windows มีปัญหาเดิม EPERM/timeout) ให้ดูผลจริงจาก CI
- ❓ integrity ของ `@esbuild/*` ตรวจแค่ linux-x64 และ win32-x64 ส่วนแพลตฟอร์มอื่นตรวจแค่ว่า `resolved` มาจาก registry.npmjs.org และ npm ตรวจ integrity เองตอนติดตั้ง
