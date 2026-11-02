# R6E_POLISH.md — คำและสเปกการโหลด/การเคลื่อนไหว (E1, E2, E4, E11, E12)

> เจ้าของ: ux · 2026-11-02 · ต่อจาก UI_DIRECTION §5 (หัวข้อนี้เป็นตัวละเอียดของ §5 ไม่ขัดกัน)

## 1. คีย์ข้อความที่เปลี่ยน/เพิ่ม (th + en ครบ)
| คีย์ | TH | EN | หมายเหตุ frontend |
|---|---|---|---|
| `appointments.goingConfirm.conflictMore` (แก้) | และนัดอื่นอีก | and more | **เลิกส่ง `count`** (E1) |
| `appointments.goingConfirm.conflictConfirmBusy` (ใหม่) | ไปนัดนี้ | Go anyway | ใช้เมื่อชนเฉพาะ busy ที่ลงเอง ไม่มีนัดอื่น (E2) · ชนนัด (มีหรือไม่มี busy ร่วม) ใช้ `conflictConfirm` เดิม |
| `busy.form.overlap.title` | ช่วงนี้ลงไม่ว่างไว้แล้ว | You already have busy time then | หัวข้อ dialog (E11) |
| `busy.form.overlap.body` | ช่วงที่เลือกทับกับที่คุณลงไว้ก่อนหน้า จะลงซ้ำอีกไหม | This overlaps busy time you added earlier. Add it again anyway? | |
| `busy.form.overlap.listAria` | ช่วงไม่ว่างที่ทับกัน | Busy time that overlaps | aria-label ของรายการ |
| `busy.form.overlap.item` | `{title} · {time}` | `{title} · {time}` | รายการมีชื่อ |
| `busy.form.overlap.itemPlain` | ช่วงไม่ว่างที่คุณลงไว้ · `{time}` | Busy time you added · `{time}` | ไม่มีชื่อ หรือชื่อถูกซ่อน/ว่าง |
| `busy.form.overlap.more` | และรายการอื่นอีก | and more | เมื่อทับเกินที่แสดง (แนะนำแสดง ≤ 4) ไม่มีตัวเลข |
| `busy.form.overlap.confirm` | ลงซ้ำ | Add it again | ปุ่มหลัก = บันทึก |
| `busy.form.overlap.back` | กลับไปแก้ | Back to edit | ปุ่มรอง + Esc · focus เริ่มที่ปุ่มนี้ (ปลอดภัยกว่า) |
| `common.loading` (ใหม่) | กำลังโหลด… | Loading… | ข้อความ sr-only ของวงหมุน/skeleton ที่ไม่มีข้อความของตัวเอง |
| `common.navLoading` (ใหม่) | กำลังเปิดหน้า… | Opening the page… | sr-only ของสัญญาณนำทาง (`role="status"`) |

ปุ่มกำลังส่งใช้คีย์ `…saving` ที่มีอยู่เดิม (ข้อความในปุ่มเปลี่ยนเป็น "กำลังบันทึก…" + วงหมุนหน้าข้อความ) ไม่ต้องมีคีย์ใหม่

## 2. E4 — คำ RSVP
เลย์เอาต์ต้องแก้ก่อน (grid 3 คอลัมน์เท่ากัน `min-width:0`, padding แนวนอนปุ่ม ≤ 8px, `white-space: nowrap`, ขนาดตัวอักษรไม่ต่ำกว่า `--text-sm` 14px) คงคำเดิม "ไป / อาจไป / ไม่ไป" และ "Going / Maybe / Can't go"
ที่ 375 px แต่ละปุ่มกว้าง ≈ 105 px ข้อความ "Can't go" 14px ≈ 58 px จึงพอ ถ้า frontend วัดแล้วยังไม่พอจริงเท่านั้น ให้ใช้คำสำรอง (ต้องเพิ่มคีย์ด้วย ux ก่อน):
- EN: "Can't go" → "Can't" · "Maybe" คงเดิม · "Going" คงเดิม
- TH: คงเดิมทั้งหมด (สั้นพออยู่แล้ว)
อย่าซ่อนคำเหลือแค่ไอคอน

## 3. E12 — สเปกการโหลด/การเคลื่อนไหว (ให้ frontend ทำ)
ทั้งหมด CSS ล้วน ไม่เพิ่ม lib · ค่าสี/เวลาเป็น token

### 3.1 สัญญาณนำทาง — **เลือก: แถบ progress บางด้านบนสุด**
เหตุผล: ไม่บังเนื้อหา ไม่ดันเลย์เอาต์ เห็นได้ทุกแท็บ ใช้ได้ทุกขนาดจอ
- ตำแหน่ง `position: fixed; top: 0; left: 0; right: 0; height: var(--progress-h)` (3px) · เคารพ safe-area บน (ชิดขอบบนจริง ไม่ซ้อนใต้ status bar) · `z-index` เหนือแถบหัว/ใต้ dialog
- เริ่มเมื่อกดแท็บล่าง/ลิงก์ภายใน · **แสดงเมื่อรอ > 150 ms** (`--loading-delay: 150ms` ใช้เป็นค่าใน JS timer หรือ `animation-delay` — ถ้าเสร็จก่อน ไม่แสดงเลย ไม่กระพริบ)
- ภาพ: แถบสี `--progress-fill` กว้างค่อยๆ ไปถึง ~80% แล้วค้าง (CSS keyframes `transform: scaleX()` 0→0.8 ใน ~2 s ease-out) · เสร็จแล้ว เติม 100% แล้วจางหาย 150 ms (`--dur-fast`) · ราง `--progress-track` โปร่งๆ
- a11y: องค์ประกอบมี `role="status"` + ข้อความ sr-only `common.navLoading` (ใส่เฉพาะตอนแสดง) · `aria-hidden` กับตัวแถบเอง
- reduced-motion: ไม่มีการเลื่อน/เติม แสดงเป็นแถบเต็มความกว้างนิ่งที่ opacity 0.6 ตลอดช่วงรอ แล้วหายทันที (ยังเห็นสัญญาณ แต่ไม่เคลื่อนไหว)

### 3.2 วงหมุนในปุ่มที่กำลังส่ง (บันทึก/ส่ง/RSVP/ยืนยัน dialog)
- ปุ่มต้องมี `aria-busy="true"` + `disabled` (หรือ `aria-disabled` + ดัก click) ระหว่างส่ง → กดซ้ำไม่ได้
- วงหมุน 16×16 px (`--spinner-size`) หน้าข้อความปุ่ม เส้น 2px · ข้อความเปลี่ยนเป็นคำ "กำลัง…" เดิมของปุ่มนั้น (เช่น `busy.form.saving`) · **ความกว้างปุ่มคงเดิม**: จองที่ให้วงหมุนไว้ล่วงหน้าหรือวางแบบ absolute ทับเมื่อข้อความปุ่มสั้น เพื่อไม่ให้ปุ่มขยับ
- หมุน 0.8 s linear วนจนจบ (เป็นข้อยกเว้นเดียวของ "ห้ามวนตลอด" ใน §5 เพราะสั้นและมีจุดจบ) · แสดงทันทีสำหรับปุ่ม (ผู้ใช้เพิ่งกดเอง ไม่ต้องหน่วง)
- reduced-motion: ไม่หมุน แสดงเป็นวงแหวนเส้นประนิ่ง (ครึ่งวง) คู่กับข้อความ "กำลัง…" · ความหมายยังอยู่ที่ข้อความ

### 3.3 LoadingState / `cal-loading` / รายการที่กำลังโหลด
- **ใช้ skeleton นิ่ง (ไม่มี shimmer ตาม §5)** เป็นกล่องสี `--skeleton` ขนาด/ความสูงเท่าของจริงที่จะมา (แถวรายการ 56 px, ช่องปฏิทินตาม grid จริง) → โหลดเสร็จแล้วไม่ขยับ (CLS = 0)
- พื้นที่ที่ไม่รู้รูปทรง (หน้าเปล่า, แผนที่): วงหมุน 24 px (`--spinner-size-lg`) กลางกล่องที่จอง min-height ไว้ + ข้อความที่ผ่านคีย์ `…loading` เดิมของหน้านั้น (มองเห็นได้ ไม่ใช่แค่ sr-only)
- ใส่ `role="status"` + `aria-busy` บนโซน; ข้อความ sr-only ใช้ `common.loading` เฉพาะที่ไม่มีข้อความของตัวเอง
- หน่วงแสดง 150 ms เหมือน 3.1 (ถ้าข้อมูลมาเร็ว ไม่ต้องวาด skeleton) แต่ถ้าแสดงแล้ว คงอยู่อย่างน้อย 250 ms กันกะพริบ
- reduced-motion: skeleton นิ่งอยู่แล้ว · วงหมุนใช้แบบนิ่งตาม 3.2

### 3.4 transition ของ sheet และสลับแท็บ
| อย่าง | ระยะ | easing | สิ่งที่เคลื่อน |
|---|---|---|---|
| เปิด sheet | `--dur` 180 ms | `--ease-out` | `transform: translateY(100%→0)` + backdrop opacity 0→1 |
| ปิด sheet | `--dur-fast` 150 ms | ease-in `cubic-bezier(0.4,0,1,1)` | กลับด้าน (ออกเร็วกว่าเข้า) |
| สลับแท็บ | `--dur-fast` 150 ms | `--ease-out` | เนื้อหาใหม่ fade `opacity 0→1` + `translateY(4px→0)` · ไม่สไลด์ทั้งหน้า ไม่ทำให้ฟอร์ม/โฟกัสหลุด |
| dialog (ยืนยัน) | `--dur-fast` 150 ms | `--ease-out` | opacity + `scale(.98→1)` |
เฉพาะ `transform`/`opacity` (ห้าม animate width/height/top) · ทุกอย่างอยู่ใน ≤ 200 ms (ใช้ `--dur-fast`/`--dur` ซึ่งเป็น 150/180 ms อยู่แล้ว; ไม่ใช้ `--dur-slow` ในรอบนี้)

### 3.5 reduced-motion (สรุป)
`@media (prefers-reduced-motion: reduce)`: token `--dur*` เป็น 0 อยู่แล้ว (tokens.css) · เพิ่ม: ปิด keyframes ของแถบ progress และวงหมุน (`animation: none`) แล้วใช้แบบนิ่งตาม 3.1/3.2 · สัญญาณต้องยังเห็น (ไม่ซ่อนทั้งหมด) · ไม่มี aurora เคลื่อน (มีอยู่แล้ว)

### 3.6 Tokens ที่ต้องเพิ่มใน `src/styles/tokens.css` (ทั้งสว่าง/มืด; ผู้เพิ่ม = ux ถ้า main สั่ง หรือ frontend ตาม contract)
| token | สว่าง | มืด | คอนทราสต์ (ตรวจแล้วจากค่า token ที่มี) |
|---|---|---|---|
| `--progress-fill` | `var(--accent)` #4B59C2 | `var(--accent)` #A8B2F0 | กับ `--bg` #FAF8F5 5.65:1 (สว่าง) / 8.81:1 (มืด) วัดด้วย contrast.mjs — ผ่าน 3:1 สำหรับองค์ประกอบกราฟิก (WCAG 1.4.11) |
| `--progress-track` | `var(--accent-soft)` | `var(--accent-soft)` | ราง ตกแต่ง ไม่ต้องผ่านคอนทราสต์ |
| `--spinner-arc` | `var(--accent)` | `var(--accent)` | เหมือนข้างบน · ในปุ่มหลัก (พื้น accent) ให้ใช้สีตัวอักษรของปุ่ม `currentColor` |
| `--spinner-track` | `var(--line)` | `var(--line)` | ตกแต่ง |
| `--skeleton` | `var(--surface-2)` | `var(--surface-2)` | ตกแต่ง (ข้อความ "กำลังโหลด…" ต้องมองเห็นด้วย `--ink-muted` ≥ 4.5:1 ตามเดิม) |
| `--progress-h` | 3px | 3px | |
| `--spinner-size` / `--spinner-size-lg` | 16px / 24px | เหมือนกัน | |
| `--loading-delay` | 150ms | 150ms | ใช้ใน CSS `animation-delay`/อ้างค่าใน JS; reduced-motion ไม่ต้องเป็น 0 (ยังหน่วงเพื่อกันกะพริบ) |
เพิ่ม token ใน tokens.css และคู่วัดใน docs/design/tools/contrast.mjs แล้ว (ผลวัดจริง: progress/spinner บน bg 5.65 / 8.81, บน surface 5.99 / 7.97, บน skeleton 5.22 / 7.11; ink-muted บน skeleton 5.67 / 6.13)
