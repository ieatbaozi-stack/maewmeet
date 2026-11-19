# ADR 0014 — CSP คง `'unsafe-inline'` ไม่ใช้ nonce (ยอมรับความเสี่ยง)

- **Status**: Accepted (2026-11-18) · boss ตัดสิน B3 = **(ก) ไม่ทำ CSP nonce ยอมรับความเสี่ยง** ใน [R16_CONTRACT](../contracts/R16_CONTRACT.md) §5 · บันทึกโดย Architect 2026-11-19
- **เกี่ยวข้อง**: [ADR 0001](0001-stack-and-project-structure.md) §1 (ไม่ใช้ `proxy.ts` ใน v1) · [ADR 0008](0008-i18n-and-theme.md) §4 (ธีมไม่มีสคริปต์กันกระพริบ) · `next.config.ts` `contentSecurityPolicy()` · `docs/OPERATIONS.md` (ops บันทึกเหตุผลฝั่งปฏิบัติการ) · `docs/design/ARCHITECTURE.md` ข้อ 11.3
- **เจ้าของการ implement**: ไม่มีงานโค้ด (คงสภาพเดิม) · Ops ดูแล `next.config.ts` + `tests/ops/headers.test.ts`

## Context
- CSP production ปัจจุบัน: `script-src 'self' 'unsafe-inline'` · `style-src 'self' 'unsafe-inline'` · ไม่มี `'unsafe-eval'` · `object-src 'none'` · `frame-src 'none'` · `base-uri 'self'` · `connect-src 'self'` (อ่าน `next.config.ts` 2026-11-19)
- App Router ส่งข้อมูล RSC เป็น inline `<script>self.__next_f.push(...)</script>` ทุกหน้า → ถ้าไม่มี `'unsafe-inline'` ต้องใช้ nonce ต่อ request · React เรนเดอร์ prop `style` เป็น attribute → `style-src` ก็ต้องมี `'unsafe-inline'` หรือ nonce (คอมเมนต์ใน `next.config.ts`, ops R0)
- เอกสาร Next (ฉบับใน `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`, next 16.4.5): nonce ใส่ผ่าน Proxy · "you **must use dynamic rendering to add nonces**" · หัวข้อ Performance Implications: "Dynamic pages cannot be cached at the edge by default" · มีทางเลือก hash/SRI แบบ experimental (`experimental.sri`)
- ความเสี่ยงที่ `'unsafe-inline'` เปิดไว้คือ XSS แบบ inline script ทำงานได้ถ้ามีช่องฉีด HTML · แอปไม่มี HTML จากผู้ใช้ (React escape ทุกข้อความ ไม่มี `dangerouslySetInnerHTML` กับข้อมูลผู้ใช้ — ตามที่ R16 §5 B3 ระบุ)

## Decision
1. คง CSP ตามเดิม (`'unsafe-inline'` ใน `script-src` และ `style-src`) · ไม่เพิ่ม `proxy.ts` · ไม่เปิด `experimental.sri`
2. ยังคงชั้นป้องกันอื่น: ไม่มี `'unsafe-eval'` ใน production · `object-src`/`frame-src 'none'` · `base-uri 'self'` · `connect-src 'self'` · React escape · ไม่เรนเดอร์ HTML ดิบจากผู้ใช้
3. ห้ามมี CSP สองที่พร้อมกัน — ถ้าวันหนึ่งย้ายไป nonce ต้องย้ายทั้งก้อนไปที่ `proxy.ts` และลบออกจาก `next.config.ts` (เบราว์เซอร์บังคับทุก policy ซ้อนกัน)

## Consequences
- XSS ที่อาศัย inline script ไม่ถูก CSP กันเป็นชั้นสุดท้าย — การป้องกันหลักคือไม่มีช่องฉีด HTML · **โค้ดใหม่ที่ใช้ `dangerouslySetInnerHTML` หรือแทรก HTML จากข้อมูลผู้ใช้ ต้องเปิดเรื่องนี้ใหม่** (security ตรวจทุกรอบที่แตะข้อมูลคน)
- ไม่เพิ่มงาน/ความเสี่ยงหน้าพัง และไม่ขัด ADR 0001 §1
- ทบทวนเมื่อ: มี HTML/markdown จากผู้ใช้ · ยกเลิกข้อห้าม `proxy.ts` · `experimental.sri` เป็น stable และครอบ inline script ของ RSC ได้

## ทางเลือกที่ไม่เลือก
- **(ข) nonce ผ่าน `proxy.ts` ในรอบแยก** — ต้องยกเว้น ADR 0001 §1 · เสี่ยงหน้าพังถ้าสคริปต์/สไตล์ไหนไม่ได้ nonce · `style` attribute ของ React ใช้ nonce ไม่ได้ (nonce ใช้กับ element `<style>`/`<script>`) จึงอาจยังต้องคง `'unsafe-inline'` ใน `style-src` อยู่ดี — ข้อนี้ **ยังไม่ได้ทดลอง**
- **hash/SRI (`experimental.sri`)** — experimental · เอกสาร Next อธิบายว่าสร้าง hash ของไฟล์ JavaScript ตอน build · **ยังไม่ยืนยัน**ว่าครอบ inline `self.__next_f.push` ที่สร้างต่อ request ได้

## ยืนยันแล้ว / ยังไม่ยืนยัน
- ยืนยันแล้ว (อ่านไฟล์ 2026-11-19): ค่า CSP ใน `next.config.ts` · ข้อความในเอกสาร Next ฉบับ 16.4.5 ใน `node_modules` ที่อ้างข้างบน · ผลตัดสิน boss ใน R16_CONTRACT §5 · `grep -rn dangerouslySetInnerHTML src` ไม่พบเลย (2026-11-19)
- ยังไม่ยืนยัน: เหตุผล "nonce ทำให้ช้าลง" ใน R16 §5 อิงการเสีย static/cache — แต่ root layout อ่านคุกกี้ (locale/theme) อยู่แล้ว หน้าส่วนใหญ่จึงน่าจะ dynamic อยู่แล้ว ต้นทุนเพิ่มจริงของ nonce จึง**ยังไม่ได้วัด** (ไม่เปลี่ยนผลตัดสิน — ความเสี่ยงหน้าพังและข้อห้าม `proxy.ts` ยังอยู่)

## แหล่งอ้างอิง
- Next.js docs — Content Security Policy (ฉบับที่มากับ next 16.4.5: `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`, เข้าถึง 2026-11-19) · ฉบับเว็บ https://nextjs.org/docs/app/guides/content-security-policy (ไม่ได้เปิดเว็บในรอบนี้)
