# R14 — busy แบบประจำ (routine) — design note สำหรับ frontend (R14b)

ผู้เขียน: ux · ที่มา: R14_CONTRACT §1.1 §1.2 §6 §8, ADR 0012 §4 §6 §8 · คีย์ข้อความทั้งหมดอยู่ใน `messages/th.json` / `en.json` ใต้ `busy.routine.*` (ข้อความ error ของเพดานเพิ่ม `errors.LIMIT_REACHED` ด้วย) · ใช้ component/tokens เดิมทั้งหมด ไม่มีสีหรือ hex ใหม่

ยึดแบบเดียวกับ [R6F_DAILY_BUSY.md](R6F_DAILY_BUSY.md): bottom sheet, segmented, ปุ่ม ≥ 44px, ข้อผิดพลาดไม่ล้างค่าที่กรอก, ทุก error บอกว่า "ยังไม่ได้ลงสักวัน"

## 1. จุดเข้า
| ที่ | อะไร |
|---|---|
| หน้า "ช่วงไม่ว่างของฉัน" หัวหน้า | ปุ่มรองข้างปุ่มหลัก "ลงวันไม่ว่าง": `busy.routine.add` ("ลงแบบประจำ") — ปุ่มหลักยังเป็นปุ่มเดียวที่ทึบ (กฎ UI_DIRECTION "ปุ่มหลัก 1 สีเท่านั้น") · ปุ่มรองเป็นขอบ `--line-control` พื้น `--surface` |
| หน้าว่างของ "ช่วงไม่ว่างของฉัน" | เพิ่มปุ่มรอง `routine.add` ใต้ปุ่มเดิม + บรรทัด `routine.addHelp` |
| ปุ่มลอย (FAB) / ฟอร์มลง busy เดิม | ไม่เปลี่ยน ไม่ยัด routine เข้าฟอร์มเดิม (กันฟอร์มรก) — เป็น sheet แยก `RoutineFormSheet` |

iPad ≥ 768: sheet กว้าง `--content-max` กลางจอ เหมือนฟอร์ม busy เดิม

## 2. ฟอร์ม RoutineFormSheet (ลำดับบนลงล่าง)
หัว `routine.form.title` (แก้: `form.editTitle`)

1. **ปุ่มทางลัด (preset)** `preset.label` + `preset.hint` · ชิปเลื่อนไม่ได้ ห่อบรรทัด (flex-wrap) ปุ่มละ ≥ 44px · 5 ปุ่ม ตาม contract §1.1:

   | ปุ่ม (key `preset.*`) | เติมให้ | ชื่อรายการเริ่มต้น |
   |---|---|---|
   | `work` | จ.–ศ. · ระบุเวลา 09:00–18:00 | `preset.work` |
   | `class` | จ.–ศ. · ระบุเวลา · เวลาว่าง (ให้เลือกเอง) | `preset.class` |
   | `gym` | ไม่เลือกวัน · ระบุเวลา ว่าง | `preset.gym` |
   | `weekend` | ส. อา. · ทั้งวัน | `preset.weekendTitle` |
   | `custom` | ว่างทั้งหมด | ว่าง |

   กดแล้วเติมค่าเฉพาะที่ preset กำหนด และ **ไม่ทับสิ่งที่ผู้ใช้พิมพ์ไปแล้ว** (ชื่อ/บันทึก) · ปุ่มที่กดล่าสุดแสดงสถานะเลือก (`--accent-soft` + `aria-pressed`) แต่แก้ค่าต่อได้ ไม่ผูกกัน · ชื่อเริ่มต้นเติมเป็นข้อความตามภาษาปัจจุบันลงช่อง "ทำอะไร" (`busy.form.what.*` ใช้ซ้ำ) ผู้ใช้แก้ได้
2. **วัน** `weekdays.label` + `weekdays.help` · 7 ปุ่มวงกลม/สี่เหลี่ยมมน เรียง จ.→อา. (`WEEK_START = 1`) · ข้อความ `weekdays.short.*` · aria-label `weekdays.long.*` + role group `weekdays.groupAria` · เลือก = `--accent-soft` + ขอบ `--accent-ink` + ไอคอนถูก Lucide `Check` เล็ก (ไม่พึ่งสี) · ขนาดแต่ละปุ่ม 44×44 ที่ 375px (7×44 + ช่องว่าง 4 = 332 < 343 ใช้ได้) · ใต้แถว: 3 ปุ่มลัดตัวอักษร (`weekdays.quick.weekdays|weekend|every`) แตะแล้วตั้งชุดนั้นทับ · ไม่เลือกเลย = ข้อความ `weekdays.required` สีข้อความผิดพลาด (`--danger-ink`) ใต้แถว + ปิดปุ่มบันทึก
3. **เวลา** `time.label` · segmented 2 ปุ่ม: `time.timed` (ค่าเริ่ม) | `time.allDay` + `time.allDayHelp`
   - ระบุเวลา: ช่อง `time.start` / `time.end` ใช้ตัวเลือกเวลาเดิมของฟอร์ม busy (ขั้น 30 นาที) · **ตัวเลือกเวลาจบมี "24:00"** เป็นรายการสุดท้าย แสดง `time.endMidnight` (ส่ง `"24:00"`) · เลือกแล้วแสดง `time.midnightNote` ใต้ช่อง
   - **ข้ามเที่ยงคืน**: ไม่ต้องมีสวิตช์ — ถ้าเวลาจบ ≤ เวลาเริ่ม (เช่น 22:00 → 06:00) ถือว่าข้ามเที่ยงคืน แสดงป้ายเล็ก `time.overnight` ข้างช่องเวลาจบ + บรรทัด `time.overnightNote` ที่เติมตัวอย่างจากวันแรกที่เลือก (`{day}` = ชื่อวันเต็ม `weekdays.long.*`, `{nextDay}` = วันถัดไป, `{start}` `{end}`) เช่น "นับเป็นของวันที่เริ่ม เลือก “จันทร์” = จันทร์ 22:00 ถึงอังคาร 06:00" · ถ้ายังไม่เลือกวัน ใช้ "จันทร์" เป็นตัวอย่าง
   - เวลาจบ = เวลาเริ่มพอดี: ใต้ช่องเวลาแสดง `error.end` (ห้ามบันทึก) · เซิร์ฟเวอร์ตอบ `INVALID_RANGE kind=time` ใช้ข้อความเดียวกัน
   - ทั้งวัน: ซ่อนช่องเวลา
4. **ช่วงที่ใช้** `range.label` · segmented `range.kind.weeks` (ค่าเริ่ม) | `range.kind.months` · ใต้ปุ่มแสดงเพดาน `range.limitWeeks` ({max}=26) หรือ `range.limitMonths` ({max}=6) เป็นข้อความรองเล็ก
   - **ทางลัดช่วง** `range.shortcut.label` (ชิปแถวเดียวห่อได้): `shortcut.thisMonth` "ทั้งเดือนนี้" (= เดือนนี้ ตามที่ boss ตัดสิน B2 → สลับเป็นโหมดเดือน เริ่ม=จบ=เดือนนี้) · `shortcut.next4Weeks` "4 สัปดาห์จากนี้" (โหมดสัปดาห์ จากสัปดาห์นี้ถึงอีก 3 สัปดาห์) · `shortcut.next3Months` "3 เดือนจากนี้" (โหมดเดือน เดือนนี้ถึงอีก 2 เดือน) — ux เสนอเพิ่มสองปุ่มหลัง เพราะเป็นความต้องการที่พบบ่อย (ภาคเรียน, ไตรมาส) และอยู่ในเพดาน
   - **สัปดาห์**: ช่อง `range.from` / `range.to` แต่ละช่องเป็นตัวเลือก (listbox ใน sheet ย่อย หรือ native-like picker ของแอป) แสดงรายการสัปดาห์ถัดไปประมาณ 52 รายการ · แต่ละรายการแสดงเป็น **ช่วงวันที่** ด้วย `range.week` เช่น "16–22 พ.ย." / "30 พ.ย.–6 ธ.ค." (EN "16–22 Nov" / "30 Nov–6 Dec") ห้ามใช้เลขสัปดาห์ · สัปดาห์ปัจจุบันติดป้าย `range.thisWeek` · รายการเริ่มที่สัปดาห์นี้ (เลือกเริ่มเป็นสัปดาห์ในอดีตไม่ต้องทำ — "ทั้งเดือนนี้" ครอบกรณีนั้นแล้ว) · ส่ง `fromWeek` / `toWeek` เป็นวันจันทร์ของสัปดาห์
   - **เดือน**: ช่องเดียวกัน แต่รายการเป็นเดือน "พ.ย. 2569" / "Nov 2026" (พ.ศ./ค.ศ. ตามภาษา ADR 0004 §6) เดือนนี้ติดป้าย `range.thisMonth` · เริ่มจากเดือนนี้ไปข้างหน้า (ถึง 12 เดือน) · ส่ง `fromMonth` / `toMonth` เป็น `YYYY-MM`
   - ข้อจำกัดให้ UI กันก่อนยิง: "ถึง" ต้อง ≥ "ตั้งแต่" (เลือก "ตั้งแต่" ไปเกิน "ถึง" → ดัน "ถึง" ตามอัตโนมัติ) · ยาวเกินเพดาน → ตัวเลือกที่เกินเป็น disabled พร้อมข้อความ `range.limitWeeks|Months` · เซิร์ฟเวอร์ยังตรวจซ้ำเสมอ
   - `range.pastNote` แสดงเมื่อช่วงเริ่มก่อนวันนี้ (เช่น "ทั้งเดือนนี้" กลางเดือน)
5. **ชื่อ / ซ่อนรายละเอียด / บันทึกส่วนตัว** ใช้ `busy.form.what.*`, `busy.form.hide.*`, `busy.form.note.*` เดิมทุกอย่าง · ไม่ซ้ำข้อความ
6. **สรุปก่อนบันทึก** (กล่อง `--surface-2` ขอบ `--line`, aria-live polite) แสดงเมื่อเลือกวัน เวลา(หรือทั้งวัน) ช่วง ครบ:
   - บรรทัดใหญ่ (น้ำหนัก 600): **`summary.days`** "จะลง 17 วัน" — จำนวนวันคำนวณฝั่ง client ด้วย `src/lib/calendar` (`routineRange` + `expandRoutine` นับ ตั้งแต่วันนี้ ไม่ใช้ `new Date()` เอง) ให้ตรงกับที่เซิร์ฟเวอร์จะสร้าง
   - บรรทัดรอง: `summary.line` "{days} · {time}" เช่น "จ.–ศ. · 09:00–18:00" (หรือ `summary.lineAllDay`) · วันที่ติดกันย่อเป็น `weekdays.range`, ทั้ง 7 วัน = `weekdays.every`, ไม่ติดกันเรียงด้วยช่องว่าง "จ. อ. พฤ. ศ."
   - บรรทัดรอง 2: `summary.span` "ตั้งแต่ 16 พ.ย. ถึง 13 ธ.ค. 2569"
   - `summary.pastNote` เมื่อช่วงเริ่มก่อนวันนี้
   - (ไม่บล็อก) `summary.overlapGoing` เมื่อมีวันทับนัดที่ตอบ "ไป" — แสดงได้ถ้ามีข้อมูลอยู่แล้ว ถ้าต้องยิง API เพิ่มให้ข้ามได้ ไม่ใช่เงื่อนไขผ่าน
   - 0 วัน: แสดง `summary.zero` แทน และปิดปุ่มบันทึก (เซิร์ฟเวอร์จะตอบ `NO_OCCURRENCE` ถ้าหลุดไป)
   - กฎ "นับเป็นวันที่เริ่ม" อธิบายเฉพาะตอนข้ามเที่ยงคืน (ข้อ 3) ไม่ใส่ในสรุปเพื่อไม่ให้รก
7. **ประกาศ D5** (ข้อความสถานะ ไม่ใช่ error) เหนือปุ่มบันทึก: `visibility` ("เพื่อนในทุกกลุ่มที่คุณอยู่จะเห็นช่วงนี้") + `busy.form.visibilityGroups` (จำนวนกลุ่ม) + `visibilityHide` · ไอคอน Lucide `Users` ขนาด 16 · พื้น `--surface-2` ข้อความ `--ink` · ไม่ใช่ modal (ห้ามขวางตอนเปิด) ; `busy.form.notice.*` เดิม (ประกาศครั้งแรก) ใช้ต่อได้
8. ปุ่มบันทึก `form.submit` ("ลง 17 วัน", ตัวเลขตามสรุป) · ระหว่างบันทึก `busy.form.saving` · แก้ = `form.submitEdit` · ปุ่มรองในโหมดแก้: ไม่มีปุ่มลบในฟอร์ม (ลบทำที่รายการ ข้อ 5)

โหมดแก้ (`routine.form.editTitle`): บรรทัดบอกขอบเขตเหนือฟอร์ม `form.editing.all|fromWeek|fromMonth` · ช่อง "ตั้งแต่" ล็อก (disabled) แสดง `range.fromLocked` · แก้ "ถึง" ได้ = ต่ออายุ

Wireframe 375px:
```
ลงแบบประจำ
เริ่มจากแบบที่ใช้บ่อย
[ทำงาน][เรียน/คลาส][ยิม][เสาร์–อาทิตย์][สร้างเอง]
วันที่ติด
(จ.)(อ.)(พ.)(พฤ.)(ศ.)(ส.)(อา.)
 จ.–ศ.  ส.–อา.  ทุกวัน
เวลา          [ระบุเวลา | ทั้งวัน]
[เริ่ม 09:00]  [จบ 18:00]
ช่วงที่ใช้     [เป็นสัปดาห์ | เป็นเดือน]
ทางลัด [ทั้งเดือนนี้][4 สัปดาห์จากนี้][3 เดือนจากนี้]
ตั้งแต่ [16–22 พ.ย. (สัปดาห์นี้)]
ถึง    [14–20 ธ.ค.]
ทำอะไร (ไม่บังคับ) [ทำงาน        ]
[สวิตช์] ซ่อนว่าทำอะไร
บันทึกส่วนตัว ...
┌ จะลง 17 วัน ───────────────┐
│ จ.–ศ. · 09:00–18:00        │
│ ตั้งแต่ 16 พ.ย. ถึง 20 ธ.ค. 2569 │
└────────────────────────────┘
(Users) เพื่อนในทุกกลุ่มที่คุณอยู่จะเห็นช่วงนี้ · ตอนนี้ 2 กลุ่ม
[ ลง 17 วัน ]
```
sheet เลื่อนในตัว (max-height ~ 92dvh) ปุ่มบันทึกติดล่าง (sticky) เหมือนฟอร์มเดิม · 390 = 375 กว้างขึ้นเล็กน้อย ไม่มีการจัดเรียงต่าง · 768 = sheet กว้าง `--content-max` ชิป preset และวันเรียงแถวเดียวไม่ห่อ

## 3. รายการ "แบบประจำของฉัน" (ส่วนในหน้าช่วงไม่ว่างของฉัน)
- ส่วนแยกใต้รายการ busy เดี่ยว (และเหนือ "นัดที่ฉันตอบไป") หัว `mine.title` + `mine.count` + `mine.lead`
- ข้อมูลจาก `GET /api/me/busy-routines` · รายการเดี่ยวเดิมไม่รวมวันของ routine (เซิร์ฟเวอร์กรอง `routine_id IS NULL` — frontend ไม่ต้องกรอง)
- แถวละ routine (การ์ดแถวเดียวกับ busy เดิม ปุ่มทั้งแถวกดได้ ≥ 44px): บรรทัด 1 ชื่อ (`busy.mine.noTitle` ถ้าไม่มี) + แท็ก `busy.mine.hiddenTag` ถ้าซ่อน · บรรทัด 2 `mine.when`/`mine.whenAllDay` · บรรทัด 3 `mine.span` ช่วงวันที่ + **`mine.remaining`** "เหลืออีก 12 วัน" (ถ้าจบแล้ว `mine.ended`) · ปุ่มเล็ก `mine.extend` เมื่อเหลือ ≤ 14 วันหรือจบแล้ว (เปิดฟอร์มแก้ขอบเขต "ทั้งหมดที่ยังไม่ถึง" โฟกัสช่อง "ถึง")
- แตะแถว → sheet เลือกขอบเขตแก้ (ข้อ 4) · ปุ่มลบ/แก้อยู่ใน sheet นั้นเลือกขอบเขต (ไอคอนถังขยะในแถว → sheet ลบ)
- `mine.limitNear` เมื่อ ≥ 8 จาก 10 ชุด
- สถานะ: โหลด `mine.loading` (กล่องนิ่ง `--surface-2`) · ว่าง `mine.empty.title|body` + ปุ่ม `routine.add` + แมวท่าเดิมของหน้าว่าง busy · ผิดพลาด `mine.error.title|body` + ปุ่มลองใหม่เดิม

## 4. Sheet เลือกขอบเขต แก้/ลบ
เปิดจาก (ก) แถว routine ในรายการ → ขอบเขตอ้างอิง **สัปดาห์/เดือนที่กำลังเป็นอยู่** (หรือที่แรกของ routine ถ้ายังไม่เริ่ม) (ข) แถววันเดียวในปฏิทินของฉัน/รายการที่มี `routineId` → ขอบเขตอ้างอิง **สัปดาห์/เดือนของวันที่แตะ**

Sheet ครึ่งจอ ปุ่มเรียงบนลงล่าง เต็มความกว้าง ≥ 56px สูง (ชื่อ 1 บรรทัด + คำอธิบาย 1–2 บรรทัด) · ปุ่มยกเลิก `scope.cancel` ล่างสุด:

| ลำดับ | แก้ (`scope.edit.*`) | ลบ (`scope.delete.*`) | API |
|---|---|---|---|
| 1 เฉพาะวันนี้ | `one` + `oneHelp` | `one` + `oneHelp` | แก้: `PATCH /api/me/busy/:id` (หลุดเป็น busy เดี่ยว) · ลบ: `DELETE /api/me/busy/:id` |
| 2 ตั้งแต่…ไป | `fromWeek` {range} หรือ `fromMonth` {month} ตาม `rangeKind` + `fromHelp` | `fromWeek` / `fromMonth` + `fromHelp` | `PATCH`/`DELETE /api/me/busy-routines/:id` พร้อม `from` |
| 3 ทั้งหมด | `all` + `allHelp` | `all` + `allHelp` (สไตล์ danger `--danger`/`--on-danger`) | ไม่ส่ง `from` |

- {range} ของสัปดาห์ที่เลือกแสดงเป็นช่วงวันที่ เช่น "16–22 พ.ย." · {month} = "พ.ย. 2569"
- **ซ่อนข้อ 2** เมื่อสัปดาห์/เดือนอ้างอิงคือตัวแรกของ routine (ผลเท่ากับ "ทั้งหมด") และเมื่อ routine มีวันเหลือน้อยกว่าที่แยกได้ ให้เหลือ 2 ตัวเลือก
- ลบข้อ 2 (`delete.fromHelp`) บอกว่าถ้าหยุดตั้งแต่วันนี้ ช่วงของวันนี้ที่ผ่านไปแล้วหายด้วย
- ลบ "ทั้งหมด" ขอยืนยันอีกชั้น (dialog): `scope.confirmAll.title` + `body` ({title}; ไม่มีชื่อใช้ `bodyNoTitle`) บอกชัดว่ารวมวันที่ผ่านแล้วและเพื่อนเลิกเห็นทันที · ปุ่ม `confirmAll.confirm` (danger) + `scope.cancel` · ข้อ 1 และ 2 ไม่ต้องยืนยันซ้ำ (ข้อความใต้ปุ่มบอกผลไว้ชัดแล้ว และ 1 ย้อนได้ด้วยการลงใหม่)
- แก้ข้อ 1: เปิดฟอร์ม busy เดิม (`BusyFormSheet`) พร้อมบรรทัดเตือนเบา ใช้ `busy.routine.scope.edit.oneHelp` เป็นข้อความเหนือปุ่มบันทึก · ถ้าชนเพดาน 300 (`LIMIT_REACHED busyCount`) ใช้ข้อความเดิม
- แก้ข้อ 2/3: เปิด `RoutineFormSheet` โหมดแก้ (ข้อ 2 ท้าย) ค่าเริ่มต้นจากกฎเดิม
- toast หลังสำเร็จ: `toast.updated` · `toast.deletedOne` · `toast.stopped` ({date} = วันเริ่มของสัปดาห์/เดือนที่เลือก) · `toast.deletedAll`

## 5. วันของ routine ในปฏิทินของฉัน
- แถว/ชิป busy ของ routine หน้าตาเหมือน busy เดี่ยวทุกอย่าง (สี `--busy`, ลายเฉียง, ช่วงเวลาเป็นตัวอักษร) เพื่อให้ตรงกับที่เพื่อนเห็น · เพิ่มเฉพาะ **ป้ายเล็ก `calendar.tag` ("ประจำ")** พื้น `--surface-2` ข้อความ `--ink-muted` ขอบ `--line` + ไอคอน Lucide `Repeat` 14px · aria `calendar.tagAria` · ไม่พึ่งสีอย่างเดียว · เห็นเฉพาะเจ้าของ (ข้อมูล `routineId` มีเฉพาะฝั่งเจ้าของ)
- ในรายละเอียดวัน/แถวที่แตะ: `calendar.detail` ({days} · {time}) / `detailAllDay` / `detailPlain` (ถ้าไม่ได้โหลดกฎ)
- ปฏิทินเดือน 42 วันที่ 375px: ป้ายแสดงเฉพาะใน sheet รายละเอียดวันและรายการ ไม่ใส่ในช่องวันเล็ก (กันแน่น)
- วันที่แยกเป็น busy เดี่ยวแล้ว (หลังแก้เฉพาะวันนี้) ไม่มีป้าย

## 6. Error ฝั่งฟอร์ม (ตรวจ → ข้อความ)
แสดงเป็นแถบ alert `--danger-soft`/`--danger-ink` เหนือปุ่มบันทึก (เว้นที่ระบุว่าใต้ช่อง) · เก็บค่าที่กรอกไว้ · ทุกข้อความบอก "ยังไม่ได้ลงสักวัน"

| จากเซิร์ฟเวอร์ | แสดงที่ | คีย์ |
|---|---|---|
| `LIMIT_REACHED` `routines` ตอนสร้าง ({max}=10) | แถบ | `busy.routine.error.routines` |
| `LIMIT_REACHED` `routines` ตอนแก้ "ตั้งแต่…ไป" ที่ต้องแยกชุด ({max}=20, 409) | แถบ | `error.routinesEdit` (แนะนำให้แก้ "ทั้งหมดที่ยังไม่ถึง" แทน) |
| `LIMIT_REACHED` `routineRows` ({max}=1500) | แถบ | `error.routineRows` |
| `LIMIT_REACHED` `routineSpan` | แถบ | `error.spanWeeks` ถ้า `rangeKind=weeks` ({max}=26), `error.spanMonths` ถ้า months ({max}=6) |
| `LIMIT_REACHED` `routineAhead` ({max}=12) | ใต้ช่อง "ถึง" | `error.ahead` |
| `LIMIT_REACHED` `busyCount` (จากการแยกวัน) | แถบ | `errors.LIMIT_REACHED` เดิม |
| `INVALID_RANGE` `kind=dates` เพราะช่วงจบไปแล้ว | ใต้ช่องช่วง | `error.ended` (ถ้าเป็นลำดับ ต้น>ปลาย ใช้ `errors.INVALID_RANGE` เดิม แต่ UI กันไว้แล้ว) |
| `INVALID_RANGE` `kind=time` | ใต้ช่องเวลา | `error.end` |
| `VALIDATION` `fields.weekdays=REQUIRED` | ใต้แถววัน | `error.weekdaysRequired` (เหมือน `weekdays.required`) |
| `VALIDATION` `fields.weekdays=NO_OCCURRENCE` ตอนสร้าง/แก้ช่วง | แถบ (ใกล้สรุป) | `error.noOccurrence` |
| `VALIDATION` `fields.weekdays=NO_OCCURRENCE` ตอนแก้ในที่แล้วไม่เหลือวันอนาคต | แถบ | `error.noOccurrenceEdit` (แนะนำ "หยุดตั้งแต่…" หรือลบทั้งหมด) |
| `INVALID_LOCAL_TIME` | ใต้ช่องเวลา | `error.dst` |
| `NOT_FOUND` (แก้/ลบ) | แถบ + รีเฟรชรายการ | `error.gone` |
| `RATE_LIMITED` | แถบ | `error.rate` (มี retryAfter ใช้ `appointments.rateRetry`) |
| อื่นๆ/เครือข่าย | แถบ | `error.generic` |

`errors.LIMIT_REACHED` (ข้อความกลางตาม `limit`) ถูกเพิ่ม 4 ชนิดไว้เป็น fallback (`routineSpan` ไม่ระบุหน่วย เพราะ max เป็นสัปดาห์หรือเดือนตามชนิดช่วง) ที่อื่นที่เรียกใช้ข้อความกลาง · ฟอร์มใช้คีย์ใน `busy.routine.error.*` เพราะเจาะจงกว่า

## 7. สถานะที่ต้องมี (checklist สำหรับ frontend/qa)
ฟอร์ม: ว่าง (หลังกด "สร้างเอง") · เติมจาก preset แต่ละปุ่ม · ยังไม่เลือกวัน (ไม่มีสรุป ปุ่มปิด) · เลือกครบมีสรุป · ข้ามเที่ยงคืน (มี `overnightNote`) · จบ 24:00 · ทั้งวัน · 0 วัน (`summary.zero`) · ช่วงเริ่มในอดีต (`pastNote`) · กำลังบันทึก · error แต่ละแถวในข้อ 6 · โหมดแก้ (ทั้งหมด / ตั้งแต่สัปดาห์ / ตั้งแต่เดือน) ·
รายการ: โหลด · ว่าง · ปกติ · จบแล้ว/ต่ออายุ · ผิดพลาด · ใกล้เพดาน ·
sheet ขอบเขต: แก้ 3 ข้อ · ลบ 3 ข้อ · ซ่อนข้อ 2 · dialog ยืนยันลบทั้งหมด ·
ธีม สว่าง/มืด · ภาษา th/en · 375/390/768 ไม่ล้น (ชื่อยาว ตัดด้วย ellipsis บรรทัดเดียว มีชื่อเต็มใน aria) · แถววัน 7 ปุ่มไม่ล้นที่ 375 · ปุ่มทุกตัว ≥ 44px

## 8. คีย์ข้อความ (สรุป)
`busy.routine.{add, addHelp}` · `form.{title, editTitle, submit, submitEdit, editing.{all, fromWeek, fromMonth}}` · `preset.{label, hint, work, class, gym, weekend, custom, weekendTitle}` · `weekdays.{label, help, groupAria, required, every, range, quick.{weekdays, weekend, every}, short.{mon…sun}, long.{mon…sun}}` · `time.{label, allDay, timed, allDayHelp, start, end, endMidnight, midnightNote, overnight, overnightNote}` · `range.{label, kind.{weeks, months}, from, to, fromAria, toAria, week, thisWeek, thisMonth, fromLocked, limitWeeks, limitMonths, pastNote, shortcut.{label, thisMonth, next4Weeks, next3Months}}` · `summary.{days, line, lineAllDay, span, pastNote, zero, overlapGoing, aria}` · `visibility`, `visibilityHide` · `mine.{title, lead, count, loading, when, whenAllDay, span, remaining, ended, extend, openAria, deleteAria, limitNear, truncated, empty.{title, body}, error.{title, body}}` · `scope.{cancel, edit.{title, one, oneHelp, fromWeek, fromMonth, fromHelp, all, allHelp}, delete.{title, one, oneHelp, fromWeek, fromMonth, fromHelp, all, allHelp}, confirmAll.{title, body, bodyNoTitle, confirm}}` · `toast.{saved, updated, deletedOne, stopped, deletedAll}` · `calendar.{tag, tagAria, detail, detailAllDay, detailPlain}` · `error.{save, gone, rate, routines, routineRows, spanWeeks, spanMonths, ahead, ended, weekdaysRequired, noOccurrence, dst, end, generic}` · และ `errors.LIMIT_REACHED` เพิ่ม select `routines | routineRows | routineSpan | routineAhead`

ใช้ซ้ำจาก busy เดิม (ไม่เพิ่มใหม่): `busy.form.what.*`, `busy.form.hide.*`, `busy.form.note.*`, `busy.form.visibilityGroups`, `busy.form.notice.*`, `busy.form.saving`, `busy.mine.{noTitle, hiddenTag}`, `appointments.rateRetry`

## 8.1 หน้าวันว่าง: `detailTruncated`
เมื่อ GET availability ตอบ `detailTruncated: true` แสดงบรรทัดข้อความรอง `availability.detailTruncated` (กล่องโน้ต `--surface-2` แบบเดียวกับ `availability.truncated`) — หมายถึงรายละเอียดว่าใครติดอะไรถูกตัด แต่ช่วงว่างถูกต้อง · ต่างจาก `truncated` เดิม (ช่วงว่างอาจผิด) ถ้ามีทั้งสองให้แสดงเฉพาะ `truncated`

หมายเหตุคำศัพท์: UI ใช้ "แบบประจำ" / "routine" ตลอด (OPERATIONS ใช้ "กิจวัตร" เป็นศัพท์ภายในเอกสาร ไม่ใช่ UI)

## 8.2 ข้อตัดสินใจรอบ R14b
- ป้ายเดือนในตัวเลือกและ sheet ขอบเขต: **ใช้แบบยาวของ lib** ("พฤศจิกายน พ.ศ. 2569" / "November 2026") ไม่ต้องเพิ่มรูปแบบสั้นใน `src/lib/calendar` — อ่านง่ายกว่าและพอดีที่ 375px (ข้อความ "พ.ย. 2569" ในข้อ 2 ด้านบนถือว่าถูกแทนที่)
- ช่วงวันที่ในแถวรายการ: ถ้าอยู่ปีเดียวกัน ให้ย่อเป็น "1–30 พ.ย. 2569" (ไม่ซ้ำปี)
- ไอคอน `repeat` ตรวจกับ lucide-static 1.57.0 แล้ว ตรงทั้ง 4 path และเพิ่มใน `docs/design/tools/lucide-icons.json`
- `mine.deleteAria` ("ลบ {title}") ใช้กับปุ่มถังขยะในแถว · `mine.truncated` ใช้เมื่อรายการที่จบแล้วถูกตัดที่ 50 ({count}=50)
- CONFLICT → `error.save` และปุ่มบันทึกก่อนมีสรุปใช้ `form.title` : ยอมรับ

## 9. สิ่งที่ยังไม่ได้ตรวจ
ยังไม่มีภาพหน้าจอ 375/390/768 สว่าง/มืด เพราะ R14a ไม่มี UI — ux จะแนบภาพจริงจากงาน frontend ใน R14b · ไม่มีสีใหม่ จึงไม่ต้องเพิ่มคู่ใน `docs/design/tools/contrast.mjs` (ใช้คู่เดิม: `--ink`/`--surface-2`, `--ink-muted`/`--surface-2`, `--accent-soft-ink`/`--accent-soft`, `--danger-ink`/`--danger-soft`, `--on-danger`/`--danger`)
