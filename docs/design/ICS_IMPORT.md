# ICS Import — นำเข้าไฟล์ `.ics` เป็นเวลาไม่ว่างของฉัน: flow, wireframe, ถ้อยคำ (U1–U3)

> ผู้เขียน: ux · 2026-11-23 · ที่มา: [ICS_IMPORT_CONTRACT.md](../contracts/ICS_IMPORT_CONTRACT.md) §3 (U1–U3), §6 (B1–B4) · [ADR 0017](../adr/0017-ics-import.md) (Accepted)
> ข้อความทั้งหมดอยู่ใน `messages/th.json` + `messages/en.json` namespace `busy.import.*` · `errors.ICS_TOO_LARGE` / `errors.ICS_INVALID` · `privacy.calendar.import` · ไม่มีสีใหม่ ใช้ token และคอมโพเนนต์เดิม (`Sheet`, `btn-*`, `alert-*`, `tag-*`, `Name`, `Icon`)
> ออกแบบมือถือ 375 ก่อน แล้วขยายเป็น 390 / 768 (iPad) · ทุกหน้าใช้ได้ทั้ง TH/EN และสว่าง/มืด · เป้าแตะ ≥ 44px · คอนทราสต์ ≥ 4.5:1 · ไม่มีเลื่อนแนวนอน

## 0. หลักคิด
1. **โปร่งใสเรื่องความเป็นส่วนตัวตั้งแต่ขั้นแรก:** บอกชัดเจนว่าไฟล์ `.ics` ใช้อ่านเฉพาะวันเวลา (และชื่อสั้นหากผู้ใช้เลือกแสดง) ไม่เก็บไฟล์ต้นฉบับ ไม่ส่งต่อให้ใคร และ **เปิด "ซ่อนรายละเอียดจากคนในกลุ่ม" เป็นค่าเริ่มต้น** (B3)
2. **เห็นก่อนบันทึกเสมอ (2 ขั้น):** ขั้น 1 เลือกไฟล์ `.ics` + ช่วงล่วงหน้า (ดีฟอลต์ 90 วัน) → ขั้น 2 Preview รายการทั้งหมดพร้อมติ๊กเลือก/ตัดออก เห็นเหตุผลที่ข้าม เห็นรายการซ้ำ (ไม่ติ๊กโดยค่าเริ่มต้น) และเห็นโควตา `X/300` ก่อนกดยืนยัน
3. **ใช้ภาษามนุษย์ ไม่โชว์ศัพท์เทคนิค:** แทนที่จะเขียน `RRULE` / `TRANSP:TRANSPARENT` ให้เขียน "นัดซ้ำ" (พร้อมคำแนะนำตั้ง "แบบประจำ" ในแอปแทน) / "รายการที่ตั้งว่าว่าง" · แทน `STEP_MINUTES` ให้เขียน "ปัดเวลาให้ลงตัวครึ่งชั่วโมง"

## 1. จุดเข้า (หน้าปฏิทิน แท็บ "ของฉัน")
- แถบหัวแท็บ "ของฉัน" (`busy-head` ใน `CalendarView`): วางปุ่มรอง `btn btn-secondary` **"นำเข้า .ics"** (`busy.import.button`, ไอคอน `calendar-plus`, `data-testid="ics-import-open"`) คู่กับปุ่ม "ลงแบบประจำ" ในกลุ่มปุ่ม `busy-head-actions` (`display: flex; flex-wrap: wrap; gap: var(--space-2)`) เพื่อไม่ให้ล้นจอ 375px
- หน้าว่างของแท็บ "ของฉัน" (`MineList` empty state): มีปุ่มรอง "นำเข้า .ics" ด้วยเช่นกัน เพื่อให้ผู้ใช้ใหม่ที่ยังไม่มีช่วงไม่ว่างนำเข้าได้ทันที

## 2. Wireframe Sheet 2 ขั้น (`IcsImportSheet`, `data-testid="ics-import-sheet"`)

### ขั้นที่ 1 — เลือกไฟล์ `.ics` (`step === "pick"`)
```
┌───────────────────────────────────┐
│ นำเข้าไฟล์ .ics                 ✕ │  busy.import.title
│ ดึงเวลาไม่ว่างจาก Google, Apple    │  busy.import.lead
│ หรือ Outlook เข้ามาครั้งเดียว       │
│                                   │
│ ช่วงเวลาล่วงหน้า                    │  busy.import.window.label
│ [30 วัน] [60 วัน] [90 วัน*] [180 วัน]│  segmented cols-4 (ดีฟอลต์ 90 วัน · B2)
│                                   │
│ ┌───────────────────────────────┐ │
│ │     [calendar-plus]           │ │  ปุ่มเลือกไฟล์ใหญ่แตะง่าย ≥ 48px
│ │    เลือกไฟล์ .ics จากเครื่อง     │ │  busy.import.pick.cta
│ │  รองรับไฟล์ .ics ไม่เกิน 512 KB  │ │  busy.import.pick.hint
│ └───────────────────────────────┘ │
│                                   │
│ [lock] ไฟล์ใช้สร้างช่วงไม่ว่างของ   │  alert / note ความเป็นส่วนตัว
│ บัญชีคุณเท่านั้น ไม่เก็บไฟล์ต้นฉบับ   │  busy.import.privacyNote
│ และไม่ส่งต่อใคร                    │
│                                   │
│ (error banner ถ้าไฟล์ใหญ่/อ่านไม่ได้)│  role="alert"
└───────────────────────────────────┘
```
- `<input type="file" accept=".ics,text/calendar" />` ผูก label/ปุ่มที่มีเป้าแตะ ≥ 44px · รองรับกดเลือกซ้ำไฟล์เดิมได้ (reset `value` หลังอ่าน)
- client ตรวจขนาด > 512 KB ก่อนส่งเพื่อขึ้นข้อความทันที (`errors.ICS_TOO_LARGE`) · ระหว่างอ่าน/ส่งไปเซิร์ฟเวอร์แสดงสถานะกำลังอ่าน (`busy.import.loading`, `aria-busy="true"`)

### ขั้นที่ 2 — ตัวอย่างก่อนนำเข้า (`step === "preview"`)
```
┌───────────────────────────────────┐
│ ตรวจสอบก่อนนำเข้า               ✕ │  busy.import.preview.title
│ [ชื่อไฟล์.ics]  [เปลี่ยนไฟล์]       │  busy.import.preview.changeFile
│                                   │
│ ช่วงล่วงหน้า: [30][60][90*][180]   │  เปลี่ยนช่วงแล้วรีเฟรช preview อัตโนมัติ
│                                   │
│ ┌───────────────────────────────┐ │
│ │ พบ 12 รายการ · เลือกไว้ 10      │ │  สรุป + โควตา
│ │ โควตาช่วงไม่ว่าง: 25/300        │ │  busy.import.quota (X/300)
│ │ (เตือนเมื่อเลือกเกินโควตาคงเหลือ) │ │
│ └───────────────────────────────┘ │
│                                   │
│ [✓] ซ่อนรายละเอียดจากคนในกลุ่ม     │  switch/checkbox (เปิดเป็นค่าเริ่มต้น · B3)
│ เพื่อนจะเห็นแค่ว่าคุณ “ไม่ว่าง”       │  busy.import.hideDetailHint
│                                   │
│ (ถ้ามีรายการที่ปัดเวลา)             │
│ [info] บางรายการถูกปัดเป็นช่วง     │  busy.import.roundedNote
│ ครึ่งชั่วโมงเพื่อกันนัดทับ            │
│                                   │
│ (ถ้ามีรายการที่ข้าม — details พับได้)│
│ ▸ ข้ามไป 4 รายการ                 │  busy.import.skipped.summary
│   • นัดซ้ำ 2 รายการ — แนะนำตั้ง     │  busy.import.skipped.rrule (B1)
│     “แบบประจำ” ในแอปแทน            │
│   • ผ่านมาแล้ว 1 รายการ            │  past / tooFarAhead / transparent /
│   • ตั้งสถานะว่าว่าง 1 รายการ        │  cancelled / tooLong / invalid
│                                   │
│ เลือกทั้งหมด | ไม่เลือก (ถ้ามีรายการ)│  ปุ่มช่วยเลือกเร็ว ≥ 44px
│ ┌───────────────────────────────┐ │
│ │ [✓] ประชุมทีม                  │ │  checkbox row เป้าแตะ ≥ 44px
│ │     จ. 24 พ.ย. · 09:00–11:00   │ │  [ปัดเวลา] (tag-muted ถ้า rounded)
│ │───────────────────────────────│ │
│ │ [ ] ไปหาหมอ                    │ │  รายการซ้ำ: ไม่ติ๊กโดยค่าเริ่มต้น (B4)
│ │     อ. 25 พ.ย. · ทั้งวัน        │ │  [ซ้ำกับที่มีอยู่] (tag-muted)
│ └───────────────────────────────┘ │
│                                   │
│ [ นำเข้า 10 รายการ ] (primary)     │  disabled เมื่อเลือก 0 หรือเกินโควตา/100
│ [ ยกเลิก ]           (secondary)  │
└───────────────────────────────────┘
```

## 3. สถานะขอบทั้งหมด (Edge States)
| สถานะ | การแสดงผล |
|---|---|
| ไฟล์เกิน 512 KB หรือเกิน 20,000 บรรทัด / 500 รายการ | `alert-err` (`errors.ICS_TOO_LARGE`) ที่ขั้น 1 เลือกไฟล์ใหม่ได้ทันที |
| ไฟล์ไม่ใช่ `.ics` / binary / ไม่มี `VCALENDAR` | `alert-err` (`errors.ICS_INVALID`) ที่ขั้น 1 |
| ไฟล์ถูกต้องแต่ไม่มีรายการที่ใช้ได้เลย (`items.length === 0`) | แสดงสถานะว่างในขั้น 2 (`busy.import.empty.title` + `body`) พร้อมสรุปเหตุผลที่ข้าม (ถ้ามี) + ปุ่มเปลี่ยนช่วงวันหรือเปลี่ยนไฟล์ |
| ทุกรายการซ้ำกับที่มีอยู่แล้ว | ติ๊กเลือกเริ่มต้น = 0 · ปุ่มนำเข้า disabled พร้อมข้อความ `busy.import.allDuplicates` |
| เลือกเกินโควตาคงเหลือ (`selected > remaining`) หรือเกิน 100 รายการต่อครั้ง | แสดง `alert-warn` บอกจำนวนสูงสุดที่เลือกได้ (`busy.import.overQuota` / `busy.import.overBatch`) และปิดปุ่มนำเข้าจนกว่าจะลดจำนวน |
| อัปโหลด/บันทึกโดน Rate Limit (`429`) | แสดง `errors.RATE_LIMITED` ใน `alert-err` ไม่เสียข้อมูลที่เลือกไว้ |
| บันทึกชนเพดาน 300 ระหว่างทาง (`409 LIMIT_REACHED`) | แสดง `errors.LIMIT_REACHED` (`limit: busyCount, max: 300`) |
| บันทึกสำเร็จ | ปิด sheet → โหลดรายการ "ของฉัน" ใหม่ → แสดง toast `busy.toast.imported` ("นำเข้า {count} รายการแล้ว") |

## 4. รายการคีย์ข้อความ (`messages/th.json` + `messages/en.json`)
- `errors.ICS_TOO_LARGE`, `errors.ICS_INVALID`
- `busy.toast.imported`
- `busy.import.*`: `button`, `title`, `lead`, `loading`, `privacyNote`, `window.{label, d30, d60, d90, d180}`, `pick.{cta, hint}`, `preview.{title, changeFile, found, selectedCount, quota, selectAll, selectNone, noTitle, roundedTag, duplicateTag, allDuplicates, hideDetail, hideDetailHint, roundedNote, overQuota, overBatch, submit, submitting}`, `empty.{title, body}`, `skipped.{summary, rrule, cancelled, transparent, past, tooFarAhead, tooLong, invalid}`
- `privacy.calendar.import`: คำอธิบายความเป็นส่วนตัวของการนำเข้า `.ics` บนหน้า `/privacy` (U3)
