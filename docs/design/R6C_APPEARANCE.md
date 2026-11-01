# R6C — ตัวเลือก "หน้าตาของฉันในกลุ่มนี้" (ทิศทางให้ frontend)

ที่อยู่: `/groups/[gid]/settings` ส่วนใหม่ใต้ "สมาชิกและบทบาท" (เปิดได้ทุกบทบาท ไม่ใช่ view-only) · ข้อความทั้งหมดจาก `groupSettings.appearance.*` (th/en) · ใช้ tokens เดิม ไม่เพิ่ม token ใหม่

## เลย์เอาต์
- การ์ดเดียวกว้างเต็ม (ตามส่วนอื่นในหน้า) · ลำดับ: หัวข้อ + คำอธิบาย → **ตัวอย่างอวาตาร์ใหญ่** (`.member-avatar.lg` + ตัวอักษรย่อจริงของผู้ใช้ จัดกึ่งกลาง, `role="img"` aria-label = `previewAria`) → กลุ่มสี → กลุ่มรูปทรง → ปุ่ม "ใช้แบบอัตโนมัติ"
- 375/390: ตัวเลือกเป็นกริด 5 คอลัมน์ x 2 แถว (ช่องละ >= `--tap` 44px, ช่องว่าง `--space-2`) · 768+: 10 ช่องแถวเดียวต่อกลุ่ม ถ้าไม่พอให้ wrap ห้ามเลื่อนแนวนอน
- กลุ่มสี: แต่ละช่อง = `member-avatar` ที่ `data-color=N` และ `data-shape` = รูปทรง **ปัจจุบันของตัวอย่าง** (เห็นผลรวมจริง)
- กลุ่มรูปทรง: แต่ละช่อง = `member-avatar` ที่ `data-shape=N` และ `data-color` = สี **ปัจจุบันของตัวอย่าง**
- ในช่องใส่ตัวอักษรย่อเหมือนตัวอย่าง (aria-hidden) · ชื่อสี/รูปทรงเป็นข้อความที่ screen reader อ่าน (`color.N` / `shape.N`) ไม่ต้องแสดงบนจอ แต่ช่องที่เลือกแสดงชื่อใต้ตัวอย่างใหญ่ได้ (ช่วยคนตาบอดสี)

## Semantics และคีย์บอร์ด
- 2 `role="radiogroup"` มี `aria-labelledby` ชี้ `colorLabel` / `shapeLabel` · แต่ละช่อง `role="radio"` `aria-checked` + `aria-label` = ชื่อ · roving tabindex: Tab เข้ากลุ่มละ 1 จุด, ลูกศรเลื่อน+เลือก, Home/End
- ถ้าใช้ `<input type="radio">` ซ่อนด้วย visually-hidden แทนได้ (ง่ายกว่า, ลูกศรมาฟรี) ห้ามใช้ `display:none`

## บันทึก: **บันทึกทันทีเมื่อเลือก** (ไม่มีปุ่มบันทึก)
เหตุผล: ตัวอย่างใหญ่เปลี่ยนทันทีอยู่แล้ว, ค่าแก้กลับได้ทุกเมื่อ ไม่มีความเสียหาย, ลดขั้นบนมือถือ · PATCH หลังเลือก → แสดง `saving` ใน `aria-live="polite"` แล้ว `saved`/`failed` (ล้มเหลว: คืนค่าเดิมในตัวอย่าง + `failed`) · ปุ่ม "ใช้แบบอัตโนมัติ" ส่ง `{color:null, shape:null}` → `autoSaved` · ปิดปุ่มระหว่างรอ (ห้ามส่งซ้อน) · ปุ่มนี้ไม่ต้องมีเมื่ออยู่ในค่าอัตโนมัติอยู่แล้ว (disabled + `autoHint`)

## สถานะ selected (ไม่พึ่งสีอย่างเดียว — WCAG 1.4.1)
- ช่องที่เลือก: วงแหวนหนา `--focus-ring` x 2 สี `--text` ห่างจากช่อง `--space-1` **และ** เครื่องหมายถูกเล็กมุมล่างขวา (SVG เส้น, ใช้ `currentColor`) · ช่องที่ไม่เลือกไม่มีทั้งสองอย่าง
- focus ring ต่างจาก selected: ใช้ `outline: var(--focus-ring) solid var(--focus)` + `outline-offset` ตามที่ปุ่มอื่นในแอปใช้ (`:focus-visible`) · focus กับ selected ซ้อนกันได้ต้องยังแยกออก
- ธีมมืด: วงแหวน/เครื่องหมายถูกใช้ token ที่สลับธีมเอง (`--text`, `--focus`) ห้ามฮาร์ดโค้ดสี

## Anti-slop
ไม่ gradient · ไม่เงา (ใช้ขอบ `--line-control`) · ไม่อีโมจิ · ไม่แอนิเมชันเด้ง (ตัวอย่างเปลี่ยนทันที เคารพ `prefers-reduced-motion`) · ไม่มี hex/px นอก tokens

## คีย์
`groupSettings.appearance.`: title, body, previewAria({color},{shape}), colorLabel, shapeLabel, optionAria({name}), auto, autoHint, saving, saved, autoSaved, failed, color.1-10, shape.1-10
