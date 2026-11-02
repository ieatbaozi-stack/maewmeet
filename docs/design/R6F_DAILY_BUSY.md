# R6F — ลง busy หลายวันแบบ "เฉพาะช่วงเวลา" (design note สำหรับ frontend)

ผู้เขียน: ux · ที่มา: R6F_CONTRACT, ADR 0010 · คีย์ทั้งหมดอยู่ใน `messages/*.json` (th/en) ใต้ `busy.form.scope|summary|series|error.daily`, `busy.series`, `busy.toast.*`

## 1. ฟอร์ม (BusyFormSheet)
ลำดับในโหมด "หลายวัน" (type = multi):
1. เลือกวัน (ปฏิทินช่วง เดิม)
2. segmented 2 ปุ่ม `busy.form.scope.label`: **ทั้งวัน** (ค่าเริ่มต้น = พฤติกรรมเดิม) | **เฉพาะช่วงเวลา** · ใต้ปุ่มแสดงข้อความ `scope.help.allDay|daily` ของตัวที่เลือก
3. เฉพาะช่วงเวลา → แสดงช่อง Starts/Ends เดิม (`busy.form.time.*`) + `scope.timeHint` · ส่ง `kind:"daily"`; ทั้งวัน → `kind:"all_day"` เดิม
4. สรุปก่อนบันทึก (เฉพาะ daily ที่เลือกวัน+เวลาครบ): `summary.daily` ("28 วัน · 17:00–20:00 ทุกวัน") + บรรทัดรอง `summary.dailyNote` · aria ใช้ `summary.dailyAria` · แทนบรรทัด "รวม" เดิม (`form.total`) ห้ามแสดงซ้อนสอง
5. ปิดตัวเลือกเวลาข้ามเที่ยงคืน (ไม่โชว์ `form.overnight`) ใน daily · เวลาจบเลือกได้ช้าสุด 23:30
6. ปุ่มบันทึกเดิม (`form.submit`) · overlap popup E11 เดิม

ตอนแก้รายการที่อยู่ในชุด (edit, seriesId != null): แสดงข้อความเตือนเบาๆ `form.series.editNote` เหนือปุ่มบันทึก (ไม่ใช่ error) · แก้ได้ทีละวัน · ปุ่มลบในฟอร์ม = เปิด dialog ลบชุด (ข้อ 3)

Wireframe (375px):
```
[ ทั้งวัน | เฉพาะช่วงเวลา ]
เวลาเดิมทุกวันในช่วงนี้ เช่น เรียนทุกเย็น ...
[ เริ่ม 17:00 ] [ จบ 20:00 ]
ใช้เวลานี้กับทุกวันที่เลือก ...
28 วัน · 17:00–20:00 ทุกวัน
จะบันทึกเป็น 28 รายการแยกรายวัน ...
[ บันทึก ]
```

## 2. ป้ายและรายละเอียด
- รายการใน "ของฉัน" ที่ seriesId != null: ป้ายเล็ก `series.tag` (หรือ `series.tagCount` ถ้ารู้จำนวนวัน) ข้างแท็ก "ซ่อนรายละเอียด" · มี aria `series.tagAria` · ต้องไม่พึ่งสีอย่างเดียว (มีข้อความ)
- ในฟอร์มแก้/รายละเอียดของเจ้าของ: `series.detail` (ถ้ารู้จำนวน+เวลา) หรือ `series.detailPlain`
- ป้ายนี้เห็นเฉพาะเจ้าของ (R6F-7: คนอื่นไม่รู้ว่าเป็นชุด)

## 3. ลบ
- รายการไม่มีชุด: dialog เดิม `busy.delete.*`
- รายการมีชุด: dialog `series.deleteTitle` + `deleteBody` (หรือ `deleteBodyCount`) · ปุ่ม 3 อัน เรียงบนลงล่าง: **ลบวันนี้** (`deleteOne` + `deleteOneHelp`, `DELETE …?scope=one`) · **ลบทั้งชุด** (`deleteAll`/`deleteAllCount` + `deleteAllHelp`, `scope=series`, สไตล์ danger) · **ยกเลิก** (`cancel`) · ทุกปุ่ม ≥ 44px
- ลบทั้งชุด ขอยืนยันอีกชั้น: `series.confirmAllTitle` + `confirmAllBody(Count)` + ปุ่ม `confirmAll` + `cancel` (บอกชัดว่ารวมวันที่ผ่านแล้ว) — frontend จะรวมเป็นขั้นเดียวก็ได้ถ้าข้อความ `deleteAllHelp` ครบ แต่ต้องมีคำว่ารวมวันที่ผ่านแล้ว
- toast: `toast.deletedDay`, `toast.deletedSeries` / `toast.deletedSeriesCount` · หลังสร้าง: `toast.savedDaily` (count) แทน `toast.saved`

## 4. Error (daily)
ฟอร์มแสดงใต้ปุ่มบันทึก ด้วยคีย์ `busy.form.error.daily.*` ทุกข้อความบอกว่า "ยังไม่ได้บันทึกสักวัน" (ยกเว้น end):
| รหัสจากเซิร์ฟเวอร์ | คีย์ |
|---|---|
| `LIMIT_REACHED` busyCount | `daily.count` ({max}) |
| `LIMIT_REACHED` busySpan | `daily.span` ({max} = 62) |
| `LIMIT_REACHED` busyBackdate | `daily.backdate` ({max} = 7) |
| `INVALID_RANGE` kind=time | `daily.end` |
| `RATE_LIMITED` (429) | `daily.rate` (หรือใช้ `appointments.rateRetry` ถ้ามี retryAfter) |
| อื่นๆ / เครือข่าย | `daily.generic` · ข้อความรหัสทั่วไปยังใช้ `errors.*` เดิมได้ (INVALID_DATE, INVALID_LOCAL_TIME, TIME_NOT_ON_STEP ฯลฯ) |
ฟอร์มต้องเก็บค่าที่กรอกไว้ (เหมือน `form.error.save`)

## 5. สถานะที่ต้องมี (checklist)
ปกติ · เลือกวันยังไม่ครบ (ไม่แสดงสรุป) · มีสรุป · กำลังบันทึก (`form.saving`) · error แต่ละข้อ · overlap popup · dark/light · th/en · 375/390/768 ไม่ล้น (สรุปยาวขึ้นบรรทัดใหม่ได้)
