# Security review — R6E (backlog cleanup · E11 ลง busy ทับ · E12 สัญญาณโหลด)

- ผู้ตรวจ: Security (อิสระ ไม่ได้เขียนโค้ดนี้) · 2026-11-02 · branch `chore/r6e-cleanup` HEAD `37b9f60` · ช่วง `37271af..HEAD` (18 commit) · เทียบ R6E_CONTRACT §2/§4 (R6E-5, R6E-6), security-r6d L1/L2, กฎเหล็ก CLAUDE.md ข้อ 6–8
- วิธี: อ่าน diff ทั้งหมดที่แตะ `src/` + รันเทสต์ของทีมเอง + PoC ของผู้ตรวจ (ไฟล์ช่วยอยู่นอก repo ใน scratchpad ไม่ commit: `af/` = สำเนา authorize-first + `src/app/api` + services สำหรับฉีด route ปลอม · `e5poc.mjs` = จำลอง assertion E5 กับรูปแบบรั่ว 7 แบบ) · ไม่แก้ `src/`/`tests/`/config
- เครื่อง: Windows (checkout CRLF) · qa/ops รันใน checkout เดียวกันพร้อมกัน (มี rebuild `.next` ระหว่างตรวจ — ดู "สิ่งที่ตรวจไม่ได้/ข้อจำกัด")
- สัญลักษณ์: ✅ = ยืนยันด้วยการรันจริง · 📖 = ยืนยันจากการอ่านโค้ดเท่านั้น

## สรุป
| ระดับ | จำนวน |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| Info | 4 |

**Verdict: ผ่าน** — รอบนี้ไม่แตะ api/auth/rbac/schema/serializer/config ความปลอดภัย · E11 เรียกแค่ `GET /api/me/busy` ของ session user (เซิร์ฟเวอร์ผูก `me.id` จาก `authorize`) ไม่มีข้อมูลคนอื่น ไม่ส่งข้อมูลใหม่ออก · E12 ไม่มี inline script/dependency ใหม่ CSP ไม่เปลี่ยน · E5 assertion จับการรั่วของ `CT` ทางอื่นได้จริง · E6 scan จับ route ที่ลืม wrapper ได้บน Windows (53 route) · R6D L1/L2 ปิดได้

## Verdict ต่อเกต
| เกต | ผล | หลักฐาน |
|---|---|---|
| **1. ไม่แตะ api/auth/rbac/schema/serializer** | **PASS** | ✅ `git diff --stat 37271af..HEAD -- src/app/api src/lib drizzle` → **ว่าง (0 ไฟล์)** · ✅ `git diff --stat 37271af..HEAD -- next.config.ts src/proxy.ts .env.example drizzle package.json package-lock.json` → ว่าง · ไฟล์ `src/` ที่เปลี่ยนทั้งหมดเป็น client component/CSS: `src/app/layout.tsx` (+`<NavProgress/>`), `src/app/globals.css`, `src/styles/*.css`, `src/components/{busy,shell,appointments,groups,home,auth,account,calendar}/*` · `src/components/appointments/model.ts` (+10 บรรทัด, โมเดล UI ของปุ่ม RSVP) |
| **2. E11 busy ทับ (client)** | **PASS** | 📖 `BusyFormSheet.tsx` `findOwnOverlaps` → `callApi('/api/me/busy' + listQueryFor(c), { method: 'GET' })` เท่านั้น · query สร้างจาก `localStartDate/localEndDate` ที่ผ่าน `normalizeBusyInput` (รูป `YYYY-MM-DD`) ไม่มีข้อความผู้ใช้ใน URL · body ที่ POST/PATCH ยังเป็น `built.payload` ตัวเดิม (`save(payload)`) ไม่มีฟิลด์ใหม่ · 📖 เซิร์ฟเวอร์: `src/app/api/me/busy/route.ts:6-11` → `listMyBusy(actor, …)` → `listOwnActiveBusy/listOwnBusyInRange(ctx.db, me.id, …)` (`src/lib/data/services/busy.ts:211-223`) · manifest action `busy.list.own` ✅ (authorize-first ส่วน C ผ่าน) · popup แสดง `title` + เวลาของ busy ของเจ้าตัวเท่านั้น (ไม่มี note, ไม่มีชื่อคน) render เป็นข้อความ React (ไม่มี `innerHTML`) · `overlap-model.ts` pure ไม่แตะเครือข่าย/DOM · ✅ grep diff `src/`: ไม่มี `console.*`, `process.env`, `localStorage`/`sessionStorage`, `dangerouslySetInnerHTML`, URL ภายนอก · ✅ unit `tests/ui/r6e-busy-overlap.test.ts` ผ่าน · ✅ e2e `r6e-busy-overlap.spec.ts` 3/3 ผ่าน |
| **3. E12 NavProgress / CSP / dependency** | **PASS** | 📖 `NavProgress.tsx`: ฟัง `click` แบบ capture แค่ "อ่าน" — ไม่เรียก `preventDefault`, ไม่เปลี่ยน `location`, ไม่ส่งเครือข่าย · `isInternalNavClick` ตัดลิงก์ต่าง origin/`target`≠`_self`/`download`/modifier ออก (แถบไม่ทำงานกับลิงก์ภายนอกเลย) · ไม่เก็บ/ส่ง href ไปที่ใด · อ่านแค่ CSS var `--loading-delay` และ `[data-nav-loading]` · ✅ ไม่มี `<script>`/inline script ใหม่ใน diff · `next.config.ts` (CSP) ไม่เปลี่ยน · ✅ `package.json`/`package-lock.json` ไม่เปลี่ยน (ไม่มี dependency ใหม่) |
| **4. E5 assertion `appt-story.spec.ts:129-134`** | **PASS (Info 1)** | ✅ e2e `appt-story.spec.ts --project=mobile-390 --retries=0` ผ่าน (31.6s และรอบแยก output อีกครั้ง) · ✅ PoC จำลอง assertion (regex คัดลอกตรงจาก `:133-134`) กับ 7 กรณี: myConflicts ถูกต้อง 1 และ 2 ชิ้น → 0 (ผ่าน) · `CT` ใน block ปฏิทินกลุ่ม → **ล้ม** · `CT` ใน `overlap.items` รูปอื่น → **ล้ม** · `CT` ใน RSC payload (escape `\"`) → **ล้ม** · `CT` ในฟิลด์ `note` ข้าง myConflicts → **ล้ม** · อ็อบเจกต์รูปเดียวกับ myConflicts ใน endpoint อื่น → ไม่ล้ม (ข้อจำกัด ดู Info 1) · 📖 รูป `"kind":"busy","busyId":…,"title":…` ตรงกับลำดับคีย์ของ `toMyConflictDto` (`src/lib/data/serializers/appointments.ts:202-215`) · การตรวจ `CN` (note) ยังห้ามทุก response ของ B (`:131`) และการตรวจข้ามผู้ใช้ (A ห้ามทั้ง `CN`/`CT`, `:92-95`) อยู่ครบ |
| **5. R6D L1/L2 ตรวจซ้ำ** | **PASS — ปิดทั้งคู่** | **L1** ✅ ตามข้อ 4 (`1541016` ใช้รูปแบบที่ security-r6d เสนอ + escape regex) · **L2** 📖 `src/app/(app)/groups/[gid]/page.tsx:37` อ่าน `mm_group` ผ่าน `parseCurrentGroupCookie(cookies().get(CURRENT_GROUP_COOKIE))` ฝั่งเซิร์ฟเวอร์ · `:54` เรนเดอร์ `<RememberGroup>` เฉพาะ `myRole !== null && remembered !== group.id` → ไม่ PUT เมื่อคุกกี้ = gid · ✅ e2e `r6d-going-busy.spec.ts:86` (R6D-1 ซึ่งนับ PUT `/api/me/current-group` ที่ `:127`) ผ่าน · สิทธิ์ยังตรวจที่เซิร์ฟเวอร์ใน PUT เหมือนเดิม (ไม่เปลี่ยนในรอบนี้) |
| **6. ความลับ + E6 authorize-first** | **PASS** | ✅ grep ทุกบรรทัดที่เพิ่มใน `git diff 37271af..HEAD` หา `secret\|token\|password\|api_key\|BEGIN PRIVATE\|TURSO_AUTH\|sk-\|ghp_\|pin=<ตัวเลข>` → พบแค่คำว่า "token" ของดีไซน์ (CSS token) ไม่มีความลับ · ✅ `npx vitest run tests/security/authorize-first.test.ts` ผ่านบน Windows (รวม 3 ไฟล์ 156/156) · ✅ ฉีด route ปลอม: สำเนาใน scratchpad (`af/`) baseline 135/135 · เพิ่ม `src/app/api/zz-fake/route.ts` (`export async function GET()` ไม่ผ่าน `route()`) → **1 failed** `B. … > src/app/api/zz-fake/route.ts` · ลบแล้ว → 135/135 · พบ route ที่สแกน **53** ไฟล์ (≥ 20 ตาม R6E-6) · 📖 การแก้ `be05a8a` เปลี่ยนแค่การเทียบ path เป็น `rel(f)` (normalize `\`→`/`) ไม่ผ่อนเงื่อนไขอื่น |

## Findings
ไม่มี Critical/High/Medium/Low

## Info
1. **E5 — การลบรูปที่อนุญาตไม่ผูก URL** (`tests/e2e/appt-story.spec.ts:133-134`): regex ลบอ็อบเจกต์รูป myConflicts จาก *ทุก* response ของ B ถ้าวันหน้ามี endpoint อื่น (เช่น ปฏิทินกลุ่ม) ใช้ `toMyConflictDto` หรือรูปเดียวกันแล้วส่ง `CT` ออก เทสต์นี้จะไม่จับ (✅ PoC กรณีสุดท้าย) · ตอนนี้ไม่มีเส้นทางแบบนั้น (📖 ใช้ `toMyConflictDto` แค่ใน `services/appointments.ts`) · ถ้าจะเข้มขึ้น (test): ลบรูปที่อนุญาตเฉพาะ response ของ `/api/appointments/<id>` และ `/rsvp` · อีกข้อ: รายงาน r6d เขียนว่ารูปนี้ "ใช้ได้กับ RSC payload" ซึ่งไม่ตรง — ใน RSC คีย์ถูก escape (`\"kind\"`) จึงไม่ถูกลบ ผลคือเทสต์ **เข้มกว่า** (ล้มแทนผ่าน) ไม่ใช่ช่องโหว่ · ไม่บล็อก
2. **E11 ไม่ดู `truncated` และช่วงยาวใช้รายการที่ยังไม่จบ** (`BusyFormSheet.tsx` `findOwnOverlaps`, `overlap-model.ts` `listQueryFor`): อาจไม่เตือนบางรายการที่ทับ — ผลแค่ UX (popup เป็นคำเตือนไม่บล็อก) เซิร์ฟเวอร์ตัดสินการบันทึกเองเหมือนเดิม ไม่ใช่ความปลอดภัย
3. **E11 เพิ่ม GET 1 ครั้งต่อการกดบันทึก** — อ่านของตัวเองเท่านั้น ไม่เพิ่มพื้นผิวโจมตี · เช็กล้ม/เครือข่ายล้ม = บันทึกตามเดิม (`catch → []`) ไม่มี error ของเซิร์ฟเวอร์หลุดออกมาแสดง
4. **CSP ยังมี `'unsafe-inline'` ใน script-src/style-src** (`next.config.ts:44-45`) — ของเดิม ไม่เปลี่ยนในรอบนี้ (E12 เป็น CSS ล้วน + component ปกติ) · เรื่อง nonce ยังอยู่ใน hardening เดิม

## คำสั่งที่รัน + ผลจริง
| คำสั่ง | ผล |
|---|---|
| `git log --oneline 37271af..HEAD` | 18 commit (`5ee2f45` … `37b9f60`) |
| `git diff --stat 37271af..HEAD -- src/app/api src/lib drizzle` | ว่าง |
| `git diff --stat 37271af..HEAD -- next.config.ts src/proxy.ts .env.example drizzle package.json package-lock.json` | ว่าง |
| `git merge-base --is-ancestor 1541016 37271af` / `814136b` | ทั้งคู่เป็น ancestor (การแก้ L1/L2 เข้ามาก่อนรอบนี้ · `appt-story.spec.ts` ไม่เปลี่ยนในช่วงนี้) |
| `npx vitest run tests/security/authorize-first.test.ts tests/ui/r6e-busy-overlap.test.ts tests/ui/r6e-rsvp-model.test.ts` | 3 files passed · **156 passed (156)** |
| สำเนา authorize-first ใน scratchpad `af/` · `npx vitest run` | baseline **135 passed** → ฉีด `zz-fake/route.ts` **1 failed / 135 passed (136)** → ลบแล้ว **135 passed** |
| `node scratchpad/e5poc.mjs` | 2 กรณีถูกต้อง = 0 · 4 กรณีรั่ว = FAIL(1) · 1 กรณีข้อจำกัด = 0 (Info 1) |
| `npx playwright test tests/e2e/appt-story.spec.ts --project=mobile-390 --retries=0` | **1 passed (31.6s)** (build `.next` 22:42) |
| `npx playwright test r6d-going-busy + r6e-busy-overlap --project=mobile-390 --retries=0 --workers=1` (ครั้งแรก) | exit 137 / ครั้งที่สอง 11 failed — `ECONNREFUSED :3000` เพราะมีคนอื่น rebuild `.next` (BUILD_ID 23:10) ระหว่างรัน **ไม่ใช่ผลของโค้ด** |
| เดิม + `appt-story` (หลัง build 23:10) | 9 passed · 3 failed **ตอน teardown** `browserContext.close: ENOENT …test-results\.playwright-artifacts-*\traces` (อีกโปรเซสล้าง `test-results/` พร้อมกัน) ตัวเทสต์ไม่มี assertion ล้ม |
| 3 ตัวที่ล้มตอน teardown รันใหม่ด้วย `--output=<scratchpad>/pw-out` | **3 passed (1.1m)** · exit 0 |
| grep บรรทัดที่เพิ่มใน diff หา secret/token/PIN | ไม่พบความลับ (มีแค่คำว่า design token) |
| grep บรรทัดที่เพิ่มใน `src/` หา `console.`/`process.env`/storage/`innerHTML`/`dangerously`/`http(s)://` | ไม่พบ |

## สิ่งที่ตรวจไม่ได้ / ข้อจำกัด
- ไม่ได้ฉีดการรั่วจริงในโค้ดแอป (serializer) แล้วรัน e2e — ต้องแก้ `src/` + rebuild ใน checkout ที่ qa/ops ใช้พร้อมกัน จึงพิสูจน์ด้วยการจำลอง assertion แทน (regex คัดลอกตรง) · test agent รายงานว่าฉีดแล้วล้ม — ผู้ตรวจไม่ได้เห็นผลนั้นเอง
- e2e รันแค่ `mobile-390` บน Windows กับ build ในเครื่อง · ไม่ได้รัน `r6e-loading.spec.ts`/`r6e-layout.spec.ts` (ไม่เกี่ยวกับความปลอดภัยโดยตรง) · ผลจริงทุกโปรเจกต์ดูจาก CI
- ไม่ได้รัน `npm test` ทั้งชุด (ปัญหา EPERM/CRLF เดิมบน Windows นอกขอบเขต)
