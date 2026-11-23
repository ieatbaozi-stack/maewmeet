# QA `fix/post-v1-polish` — F18 `guest.goingHint` + eslint ignore worktree

> ผู้ตรวจ: qa (อิสระ) · Antigravity · **Claude Opus 5.5** (ผู้ทำ: Gemini 4 Neon — คนละโมเดล คนละแชต ตาม AGENTS.md §6) · branch `fix/post-v1-polish` HEAD `65b881b` · ตรวจ 2026-11-23 · ระดับงาน A (ไม่แตะ `src/app/api/**`, auth/rbac, schema, ความลับ)

## Verdict: ผ่านแบบมีข้อสังเกต
โค้ดในขอบเขตถูกต้อง เทสต์ครอบ ไม่ถอยหลัง · มี 1 ข้อ 🟡 ที่ F18 ยังแก้ไม่ครบทุกหน้าที่แขกเห็น (การ์ดหน้าหลัก) — ไม่ได้แก้ใน commit qa เพราะไม่ได้รับมอบ รอ boss ตัดสิน

## ข้อพบ (เรียงตามความรุนแรง)
1. 🟡 **ควรแก้ — F18 ยังเหลือบนหน้าหลัก** `src/components/home/HomeView.tsx:480-482` แสดง `appointments.rsvp.goingHint` ("ตอบ “ไป” = ช่วงนี้ไม่ว่างในทุกกลุ่ม") ทุกการ์ดนัดถัดไป รวมการ์ดที่ `isGuestItem(a)` เป็นจริง (`HomeView.tsx:402` แสดงชิปแขกบนการ์ดเดียวกัน · `src/lib/data/services/home.ts:11-23` ส่งการ์ดแขกมาที่หน้าหลักได้ รวมผู้ใช้ที่ไม่มีกลุ่มเลย) · สถานการณ์: ผู้ใช้ที่มาเป็นแขกและยังไม่มีกลุ่ม เปิดหน้าหลัก → เห็นข้อความ "ไม่ว่างในทุกกลุ่ม" ซึ่งคือปัญหาเดียวกับ F18 · ทางแก้เล็ก (frontend): `t(isGuestItem(a) ? "guest.goingHint" : "appointments.rsvp.goingHint")` + เพิ่ม assertion ในเทสต์ render หน้าหลัก
2. 🟢 **ข้อเสนอ** `docs/design/V1_UI_AUDIT.md:89` (F18) ยังเขียนว่า "ไม่แก้ตอนนี้" — เจ้าของคือ ux ควรต่อท้ายว่าแก้แล้วใน branch นี้ (หรือรอบที่ปิดข้อ 1) เพื่อให้ audit ตรงของจริง
3. (ข้อมูล) ความถูกต้องของข้อความใหม่: ไล่ `src/lib/data/repos/appointment-guest.ts:213-229` (ADR 0016 §5.3) — แขกที่ตอบ going ถูกนับเป็น busy ใน **กลุ่มของแขกเอง** (`a.group_id <> :gid`) และนัดขึ้นในรายการของแขก (`listMyGuestAppointmentRows`) → ข้อความ "ไม่ว่างในปฏิทินของคุณ (และกลุ่มที่คุณอยู่)" / "busy on your calendar (and any groups you’re in)" ตรงพฤติกรรมจริง · TH/EN อ่านเป็นธรรมชาติ ไม่แปลตรงตัว

## Code review (9 ข้อ)
| ข้อ | ผล | หมายเหตุ |
|---|---|---|
| 1 ตรง contract/ขอบเขต | ผ่าน (มีข้อพบ 1) | contract ย่อตาม HANDOFF §5 · ไฟล์ตรงบทบาท: messages=ux, components=frontend, eslint/CHANGELOG=ops, docs/team+reports=secretary · ผู้เขียน commit ตรงบทบาท อีเมล noreply ถูก trailer `Gemini 4 Neon <noreply@google.com>` |
| 2 ถูกจริง | ผ่าน | `goingHint ?? t(...)` — ผู้ใช้เดิม (`AppointmentDetail.tsx:250`) ไม่ส่ง prop จึงได้ข้อความเดิม · ส่งเฉพาะหน้าแขก · hint แสดงเฉพาะ `closed === null` เหมือนเดิม · `aria-describedby` ยังผูก id เดิม |
| 3 สถาปัตยกรรม | ผ่าน | prop เสริมแบบ optional ไม่สร้างคอมโพเนนต์ซ้ำ |
| 4 คุณภาพโค้ด | ผ่าน | มี JSDoc ของ prop · คอมเมนต์ R6D ปรับให้กลางขึ้น |
| 5 คุณภาพเทสต์ | ผ่าน | `tests/ui/share-render.test.ts` ตรวจทั้ง TH/EN ว่ามี `guest.goingHint` และ **ไม่มี** ข้อความเดิม (ครอบการถอยกลับ) · ไม่ครอบหน้าหลัก (ข้อพบ 1) |
| 6 กฎเหล็ก | ผ่าน | ข้อความผ่าน messages ไม่ hard-code · ไม่แตะสิทธิ์/ความลับ/schema/เวลา |
| 7 ประสิทธิภาพ | ผ่าน | ไม่มีผล |
| 8 เอกสาร (DOCS_SYNC) | ผ่าน | CHANGELOG `[Unreleased]` · HANDOFF/PROGRESS/รายงานวันอัปเดต · ข้อเสนอ 2 |
| 9 ความปลอดภัยที่เห็นชัด | ไม่พบ | — |

`eslint.config.mjs` เพิ่ม `.claude/worktrees/**` ใน global ignores — ถูกต้อง (worktree ของ Claude Code ไม่ใช่โค้ดของ repo) ไม่กระทบกฎอื่น

## คำสั่งที่รันเอง + ผลจริง
| คำสั่ง | ผล |
|---|---|
| `npx vitest run tests/ui/share-render.test.ts --reporter=agent` | 1 file · 18 tests ผ่าน |
| `npx vitest run tests/i18n tests/ui tests/ops/docs-sync.test.ts tests/ops/operations-doc.test.ts --reporter=agent` | 44 files · 983 tests ผ่าน |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run build` | **รันไม่ได้ใน sandbox** — `ERR_SWC_NATIVE_CACHE` (เข้า `AppData\Local\swc` ไม่ได้) ปัญหาเดียวกับผู้ทำ · ยึดผล CI |
| `bash .github/scripts/check-style-literals.sh src` | **รันไม่ได้** — `Bash/E_ACCESSDENIED` (WSL) · branch นี้ไม่แตะ CSS จึงไม่น่ากระทบ · ยึดผล CI job `lint` |

## สิ่งที่ตรวจไม่ได้
- build/e2e ในเครื่อง (ข้อจำกัด sandbox/Windows ตาม AGENTS.md §9) → ต้องดู CI บน PR
- ภาพหน้าจอ 375/390/768 สว่าง/มืด ของหน้าแขก — ข้อความยาวขึ้นเล็กน้อย (EN ~85 ตัวอักษร) ใช้คลาส `rsvp-hint` เดิมที่ตัดบรรทัดได้ ความเสี่ยงต่ำ แต่ไม่ได้เปิดดูจริง
