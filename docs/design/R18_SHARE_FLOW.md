# R18 §S — แชร์นัดให้คนนอกกลุ่ม: flow, wireframe, ถ้อยคำ (S9)

> ผู้เขียน: ux · 2026-11-20 · ที่มา: [R18_CONTRACT.md](../contracts/R18_CONTRACT.md) §S (ต้นฉบับว่าแขกเห็นอะไร) · ADR 0016 (architect เขียนคู่กัน — ถ้าขัดกับเอกสารนี้ ให้ยึด contract §S แล้วแจ้ง ux)
> ข้อความทั้งหมดอยู่ใน `messages/th.json` + `en.json` namespace `share` · `shareLanding` · `guest` · `guests` · `notifications.appointment.guest` · `privacy.guest` (รายการคีย์ท้ายเอกสาร) · ไม่มีสีใหม่ ใช้ token และคอมโพเนนต์เดิม (`Sheet`, `ConfirmDialog`, `btn-*`, `alert-*`, `Avatar`, ชิป)
> ออกแบบมือถือ 375 ก่อน แล้วขยายเป็น 768 (iPad) · ทุกหน้าใช้ได้ทั้ง TH/EN และสว่าง/มืด

## 0. หลักคิด
1. **คนนอกคือ "แขกของนัดเดียว"** — หน้าตาและข้อความต้องไม่ทำให้รู้สึกว่าเข้ากลุ่มแล้ว (ไม่มีแท็บกลุ่ม ไม่มีรายชื่อสมาชิก)
2. **บอกว่าเห็นอะไร/ไม่เห็นอะไรตั้งแต่ก่อนส่ง** (sheet ของคนชวน) และก่อนกด "เพิ่มนัดนี้" (หน้าลิงก์) — ไม่ให้ใครเซอร์ไพรส์เรื่องความเป็นส่วนตัว
3. **หน้าก่อน login รั่วน้อยที่สุด**: เห็นเฉพาะที่ contract §S3 ระบุ · หน้าหมดอายุ/ยกเลิก/ไม่พบ **ไม่บอกชื่อนัด ชื่อกลุ่ม หรือเวลา**
4. **ข้อความแชร์ไม่ใส่ข้อมูลส่วนตัวเกินชื่อนัด + เวลา** (`share.shareText` ไม่มีชื่อกลุ่ม ชื่อสมาชิก สถานที่)
5. ปุ่มทำลาย (ปิดลิงก์ / นำแขกออก / ออกจากนัด) = L1 ตาม [R17_DELETE_CONFIRM.md](R17_DELETE_CONFIRM.md): ปุ่มแดงบน "ยกเลิก" ล่าง โฟกัสเริ่มที่ "ยกเลิก" บอกว่าอะไรหาย/กู้ไม่ได้

## 1. ภาพรวม flow
```
สมาชิก (หน้านัด) ── "ชวนคนนอก" ──► Sheet ชวน ── คัดลอก / ส่งต่อ (share sheet → LINE)
                                         │
แขก (ยังไม่ login) ◄── เปิดลิงก์ /i/<token> ─┘
   │  หน้าการ์ดนัด (public, noindex)
   ├─ ไม่ได้ login ──► [เข้าสู่ระบบ] / [สมัครบัญชี] ──► (redirect กลับ path ภายในเดิม) ─┐
   └─ login แล้ว ─────────────────────────────────────────────────────────────────────┤
                                                                                         ▼
                                              [เพิ่มนัดนี้] ──► นัดขึ้นหน้าหลัก/ปฏิทิน ──► หน้านัด (มุมมองแขก)
                                                                                         ├─ ตอบ ไป/อาจไป/ไม่ไป
                                                                                         └─ ออกจากนัด (L1)
สมาชิก (หน้านัด) ── ส่วน "แขกนอกกลุ่ม" ── นำออก (L1)
```
สถานะพิเศษของลิงก์ที่หน้าเปิดต้องรับ: **ใช้ได้ · เต็ม · หมดอายุ · ถูกปิด · ไม่พบ · คุณเป็นสมาชิกกลุ่มอยู่แล้ว · คุณเป็นแขกอยู่แล้ว** (ตารางสถานะ §7)

## 2. ฝั่งสมาชิก: ปุ่มและ sheet "ชวนคนนอก"
**จุดวางปุ่ม** (หน้านัด `AppointmentDetail`): ปุ่มรอง `btn btn-secondary` ไอคอน `user-plus` + `share.invite.button` อยู่ใต้ส่วน "ใครไปบ้าง" ก่อนส่วน "แขกนอกกลุ่ม" · `aria-label` = `share.invite.aria` · เห็นเฉพาะนัดที่ยังไม่ยกเลิก/ไม่จบ (ซ่อนนัดที่ยกเลิก/ผ่านแล้ว — เซิร์ฟเวอร์ตรวจเสมอ ข้อความผิดพลาด `share.error.cancelled/past`)

**Sheet (375)** — bottom sheet, โฟกัสเริ่มที่ปุ่มหลัก "คัดลอกลิงก์"
```
┌───────────────────────────────────┐
│ ชวนคนนอกกลุ่ม                  ✕  │  share.sheet.title
│ ส่งลิงก์ให้เพื่อนที่ไม่ได้อยู่ในกลุ่ม…  │  share.sheet.lead (muted)
│                                   │
│ ลิงก์ชวน                          │  share.link.label
│ ┌───────────────────────────────┐ │
│ │ https://…/i/Xk3…  (readonly)   │ │  ช่อง readonly, ตัดกลางด้วย … ได้ แต่ copy ได้ครบ
│ └───────────────────────────────┘ │
│ [ คัดลอกลิงก์ ]   [ ส่งต่อ ]        │  primary / secondary (ส่งต่อ ซ่อนถ้าไม่มี navigator.share)
│                                   │
│ คนที่เปิดลิงก์จะเห็น ✓              │  seesTitle + sees  (ไอคอน check)
│ และจะไม่เห็น ✕                     │  hidesTitle + hides (ไอคอน x)
│                                   │
│ ลิงก์นี้เป็นของคุณ … “มากับ {ชื่อ}”  │  share.sheet.mine
│ รับแขกได้สูงสุด 10 คนต่อนัด · 3 คน   │  share.sheet.limit
│ ลิงก์ใช้ได้จนนัดจบ หรือจนมีคนปิดลิงก์ │  share.sheet.valid
│ ─────────────────────────────────  │
│ ลิงก์ชวนที่ยังใช้อยู่ (ถ้ามีมากกว่า 1) │  share.links.* (เฉพาะคนที่ปิดลิงก์ของคนอื่นได้)
│  ลิงก์ของ A            [ปิดลิงก์]    │
│ [ ปิดลิงก์ของฉัน ]  (text-danger)    │  share.revoke.cta → L1
│ [ เสร็จแล้ว ]                       │
└───────────────────────────────────┘
```
- กดคัดลอก → ข้อความ `share.copied` ใน `aria-live=polite` + ปุ่มเปลี่ยนเป็นไอคอน check 2 วินาที (ไม่พึ่งสีอย่างเดียว) · คัดลอกไม่ได้ → `share.copyFailed`
- ส่งต่อ → Web Share API: `title = share.shareTitle`, `text = share.shareText` ({title}, {when}), `url` · ข้อความไม่ใส่ชื่อกลุ่ม/สถานที่/ชื่อสมาชิก
- กดซ้ำได้ลิงก์เดิม (หนึ่งลิงก์ต่อคนต่อนัด) — sheet เปิดแล้วเรียก "สร้างหรือขอลิงก์เดิม" ระหว่างรอแสดง `share.sheet.creating` (skeleton ไม่เกิน 1 บรรทัด ไม่ shimmer)
- เมื่อแขกเต็ม 10: ปุ่มยังแสดงลิงก์ได้ แต่บรรทัด limit เป็นสี `--warn-ink` + ไอคอน `triangle-alert` ("… 10 คน") และหน้าลิงก์ของแขกจะขึ้น "เต็มแล้ว" (ไม่ซ่อนปุ่ม เพราะแขกบางคนอาจออก)
- ปิดลิงก์ของฉัน → `ConfirmDialog` L1 (`share.revoke.title/body/confirm`, ปุ่มแดง "ปิดลิงก์", ยกเลิก = `common.cancel`) → toast `share.revoke.done` · ใช้คำว่า "ปิดลิงก์" (ไม่ใช่ "ยกเลิก") เพื่อไม่ชนกับปุ่ม "ยกเลิก" ของ dialog
- **768:** sheet เป็น dialog กลางจอ กว้างสูงสุด 480 เหมือนกล่องอื่นของแอป · ปุ่มคัดลอก/ส่งต่อเรียงแถวเดียว

## 3. หน้าลิงก์สาธารณะ (แขกยังไม่ login)
เส้นทาง `/i/<token>` · `noindex` · ไม่มี bottom nav ไม่มีแท็บ (ไม่ใช่ส่วนของแอปหลังล็อกอิน) · ใช้โครงเดียวกับหน้า login (การ์ดบน aurora/veil เดิม) · แมวเส้นเรียบท่านั่งเล็กๆ เหนือหัวข้อ (ชุดเดิม)

**ก่อน login (375)**
```
        (แมว)
 {name} ชวนคุณ                       shareLanding.invitedBy   (ชื่อด้วย <bdi>/Name)
┌───────────────────────────────────┐
│ กินข้าวบ้านเฟิร์น                   │  ชื่อนัด 24
│ [calendar] เสาร์ 6 ธ.ค. · 18:00–20:00       │  ไอคอน Lucide `calendar` (ไม่ใช้อีโมจิ)
│ [map-pin] บ้านเฟิร์น  [เปิดแผนที่]          │  ปุ่มแผนที่เดิม (Google/Apple)
│ กลุ่ม ก๊วนเสาร์                     │  shareLanding.inGroup
│ ไป 4 คน · อาจไป 2 คน               │  counts.* เป็นตัวเลขล้วน ไม่มีชื่อ/avatar สมาชิก
└───────────────────────────────────┘
 เข้าสู่ระบบหรือสมัครบัญชีก่อน …       shareLanding.loginHint
 [ เข้าสู่ระบบ ]                       primary
 [ สมัครบัญชี ]                        secondary
 คุณจะเห็นเฉพาะนัดนี้ …                shareLanding.note
 ดูว่าแขกเห็นอะไรบ้าง                  → /privacy#guest
```
- ไม่มีรายชื่อ ไม่มี avatar สมาชิก ไม่มีนัดอื่น ไม่มีข้อมูล busy (contract §S3)
- ตัวเลขนับ: ถ้าไป 0 และอาจไป 0 → `counts.none` ("ยังไม่มีใครตอบ") · ถ้าอย่างใดอย่างหนึ่งเป็น 0 ซ่อนส่วนนั้น · ให้ `aria-label` ของแถวนับเป็น `counts.aria`
- login/สมัคร → ส่ง `next=/i/<token>` (เฉพาะ path ภายในที่ขึ้นต้น `/i/` — เซิร์ฟเวอร์ตรวจ) กลับมาแล้วเห็นการ์ดเดิม ตอนนี้ปุ่มหลักเป็น **"เพิ่มนัดนี้"**

**login แล้ว (375)** — ปุ่มหลักเดียว: `shareLanding.cta.add` เต็มความกว้าง · กดแล้ว `cta.adding` (disabled, BusyButton) → สำเร็จ toast `shareLanding.added` แล้วไปหน้านัด (มุมมองแขก) · ผิดพลาด `shareLanding.addError` ใน `form-error` ใต้ปุ่ม (ปุ่มกดซ้ำได้) · กลายเป็นเต็ม/หมดอายุระหว่างนั้น → สลับเป็นหน้าสถานะที่ตรง
- **768:** การ์ดเดียวกลางจอ กว้างสูงสุด 480 · ไม่ขยายเป็นสองคอลัมน์

## 4. หน้าสถานะ (ลิงก์ใช้ไม่ได้ / ไม่มีสิทธิ์ซ้ำ)
การ์ดเดียวกับหน้า login: ไอคอนใหญ่ 24 (`link-2-off` / `users` / `clock`) + หัวข้อ + ข้อความ + ปุ่ม "ไปหน้าหลัก" (`shareLanding.state.home`) ไม่มีปุ่มอื่น · **ไม่แสดงชื่อนัด/กลุ่ม/เวลา** (กันรั่วจากลิงก์ที่ปิดแล้ว)

| สถานะ | หัวข้อ | ข้อความ | เหตุ |
|---|---|---|---|
| เต็ม | `state.full.title` | `state.full.body` ({max}) | แขกครบ 10 · หน้านี้แสดงได้เฉพาะเมื่อลิงก์ยังใช้ได้ แต่ที่เต็ม (ยืนยันที่เซิร์ฟเวอร์ตอนกด "เพิ่ม" ด้วย — กันแข่ง) |
| หมดอายุ | `state.expired.*` | นัดจบ/ถูกยกเลิก/กลุ่มถูกลบ รวมเป็นข้อความเดียว ไม่แยกเหตุผล | กันบอกว่านัดถูกยกเลิกหรือกลุ่มถูกลบ |
| ถูกปิด | `state.revoked.*` | คนที่ส่งลิงก์ปิดไว้ · หรือคนชวนออกจากกลุ่ม | ขอลิงก์ใหม่ได้ |
| ไม่พบ | `state.invalid.*` | token ผิด/ไม่มี | ข้อความต่างจาก "ถูกปิด" เล็กน้อยได้ แต่ไม่ยืนยันว่า token เคยมีอยู่ |
| เป็นสมาชิกอยู่แล้ว | `already.member.*` | ใช้สิทธิ์สมาชิกตามเดิม ไม่สร้างแถวแขก | ปุ่ม `already.member.cta` → หน้านัดในกลุ่ม |
| เป็นแขกอยู่แล้ว | `already.guest.*` | — | ปุ่ม `already.guest.cta` → หน้านัด |

## 5. มุมมองแขกในหน้านัด
ใช้หน้านัดเดียวกับสมาชิก (`AppointmentDetail`) แต่ซ่อนส่วนที่แขกต้องไม่เห็น (ซ่อนที่เซิร์ฟเวอร์ — API ไม่ส่งข้อมูลมา UI แค่ไม่แสดง)

| ส่วน | สมาชิก | แขก |
|---|---|---|
| ชื่อนัด เวลา สถานที่ รายละเอียด | เห็น | เห็น |
| ชื่อกลุ่ม | ลิงก์ไปหน้ากลุ่ม | **ข้อความล้วน ไม่เป็นลิงก์** (`appointments.detail.inGroup`) |
| ป้ายสถานะ | — | แถบ `guest.banner` ("คุณมาในฐานะแขก มากับ {name}") + ชิป `guest.badge` ข้างชื่อนัด |
| "ใครไปบ้าง" รายชื่อ | ชื่อ + avatar | **ซ่อน** แทนด้วยหัวข้อ `guest.counts.title` + ตัวเลข (ไป N · อาจไป N · ไม่ไป N) |
| คำตอบของตัวเอง (RSVP) | ตอบได้ | ตอบได้ (ปุ่ม `appointments.rsvp.answer.*` เดิม) |
| รายชื่อแขกคนอื่น | เห็น | **ซ่อน** (เห็นแค่ในตัวเลขรวม) |
| ชวนคนนอก | เห็นปุ่ม | **ซ่อน** |
| แก้ไข/ยกเลิกนัด | ตามสิทธิ์ | **ซ่อน** + ข้อความ `guest.limits` (muted) |
| เพิ่มลงปฏิทินในเครื่อง (.ics) | เห็น | เห็น |
| ออกจากนัด | — | ปุ่มรอง ข้อความแดงใต้ส่วนท้ายหน้า `guest.leave.cta` → L1 |

**ออกจากนัด (L1):** ปุ่ม `guest.leave.confirm` สีแดง ("ออกจากนัด") · ยกเลิก = `common.cancel` โฟกัสเริ่มที่ยกเลิก · ข้อความ `guest.leave.body` บอกว่าหายจากหน้าหลัก/ปฏิทินและไม่ได้แจ้งเตือนอีก และกลับมาได้เมื่อเปิดลิงก์อีก (ถ้านัดไม่จบ/ไม่เต็ม) · สำเร็จ → toast `guest.leave.done` แล้วกลับหน้าหลัก

**นัดที่แขกเห็นเมื่อถูกนำออก/ลิงก์ถูกยกเลิก:** เปิดหน้านัดเดิม → หน้า "ไม่พบนัดนี้" เดิม (`appointments.detail.gone`) ไม่บอกว่าถูกนำออก (รู้จากแจ้งเตือนแล้ว)

**หน้าหลักของแขก:** นัดของแขกแสดงในรายการ "นัดถัดไป" เดิมพร้อมชิป `guest.badge` · ปฏิทินแสดงนัดเหมือนนัดทั่วไป แต่ไม่มีข้อมูลกลุ่มอื่นเพิ่ม · บัญชีที่ไม่มีกลุ่มเลย ใช้หน้าหลักว่างเดิม (ไม่แสดงปุ่ม "สร้างนัด" ถ้าไม่มีกลุ่ม — ตามพฤติกรรมเดิม)

## 6. ฝั่งสมาชิก: ส่วน "แขกนอกกลุ่ม" ในหน้านัด
**375** — หัวข้อ `guests.title` ({count}) + `guests.limit` ({count} จาก {max}) ทางขวา (muted) · รายการแต่ละแถว (ใช้ pattern เดียวกับแถว RSVP):
```
แขกนอกกลุ่ม · 3                  3 จาก 10 คน
┌───────────────────────────────────┐
│ (ก) ใหม่ [แขก]        ไป            │  avatar (ตัวอักษรย่อ + สีสมาชิกวนแบบเดิม) + ชื่อ + ชิป guests.badge + คำตอบ
│     มากับ เฟิร์น         [นำออก]     │  guests.with · ปุ่มข้อความ guests.remove (เฉพาะคนที่มีสิทธิ์)
├───────────────────────────────────┤
│ …                                  │
└───────────────────────────────────┘
```
- คำตอบใช้ `appointments.rsvp.answer.*` · ยังไม่ตอบ = `guests.noReply` · ความหมายไม่พึ่งสี (ข้อความเสมอ)
- ไม่มีแขก → `guests.empty` ภายใต้หัวข้อ (ไม่ซ่อนส่วนทั้งส่วน ให้สมาชิกรู้ว่ามีฟีเจอร์นี้) · `aria-label` ของรายการ = `guests.listAria`
- **นำออก:** แสดงเฉพาะผู้ที่มีสิทธิ์ (คนสร้างนัด · admin/mod · คนที่ชวนแขกคนนั้น) — เป็นการซ่อนปุ่มเพื่อ UX เท่านั้น เซิร์ฟเวอร์ตรวจสิทธิ์ทุกครั้ง · `aria-label` = `guests.removeAria`
- กดแล้วเป็น **`ConfirmDialog` L1 หนึ่งขั้น** (`guests.removeConfirm.title/body/confirm`): ปุ่มแดง "นำออก" · ยกเลิก = `common.cancel` โฟกัสเริ่มที่ยกเลิก · สำเร็จ toast `guests.removed` ({name}) · ผิดพลาด `guests.removeError` ใน dialog
- ชื่อแขกใช้ชื่อที่แสดง (display name) ห่อด้วย `<bdi>`/`Name` ตามแพตเทิร์นเดิม
- **768:** รายการสองคอลัมน์ได้เมื่อกว้าง ≥ 720 (เหมือนรายชื่อ RSVP) · ปุ่ม "นำออก" ชิดขวาแถวเดียวกับชื่อ

## 7. แจ้งเตือน (กระดิ่ง) — ข้อความ
ไม่มีตัวแปรชื่อสมาชิกอื่นนอกจาก "คนที่ชวนเรา" และไม่มีชื่อผู้กระทำใน cancelled/updated (แขกไม่รู้จักสมาชิก ไม่ควรรั่วชื่อ) · ลิงก์ไปหน้านัด · แขกที่ถูกนำออกลิงก์ไป `/` (หน้าหลัก)

| kind (เสนอ) | ผู้รับ | คีย์ | โทน/ไอคอน |
|---|---|---|---|
| `appointment.guest.added` | แขก | `notifications.appointment.guest.added` {title, when, inviterName} | ok · `user-plus` |
| `appointment.guest.joined` | คนที่ชวน | `….guest.joined` {guestName, title, when} | ok · `user-plus` |
| `appointment.guest.removed` | แขก | `….guest.removed` {title, when} | warn · `user-minus` |
| `appointment.guest.cancelled` | แขก | `….guest.cancelled` {title, when} | warn · `calendar-x` |
| `appointment.guest.updated` | แขก | `….guest.updated` {changes: time\|place\|other, title, when} | neutral · `calendar-clock` |
| เตือนก่อนนัด (กระดิ่ง/LINE) | แขก | ใช้ `notifications.appointment.reminder_1d/1h` เดิม (มีชื่อกลุ่ม ซึ่งแขกเห็นอยู่แล้วบนการ์ด) | เดิม |

`guest.joined` เป็น **ข้อเสนอเสริม** (ไม่อยู่ใน contract §S) — frontend/platform จะใช้หรือไม่ก็ได้ ไม่ใช้ก็ไม่กระทบ (คีย์ค้างไว้ได้ เทสต์ i18n ไม่ห้าม)

## 8. ความเป็นส่วนตัว (`/privacy`)
เพิ่มส่วน "แขกที่ได้รับลิงก์ชวน" (`privacy.guest.title` + 4 ย่อหน้า: `preview`, `joined`, `members`, `retention`) ใต้ส่วน "ใครเห็นอะไร" · ใส่ `id="guest"` ให้ลิงก์จากหน้าลิงก์สาธารณะ (`shareLanding.privacyLink`) · frontend ทำ layout (นอกขอบเขต ux)

## 9. a11y และสถานะ
- ทุกปุ่มไอคอน+ข้อความมี `aria-label` ที่ระบุเป้าหมาย (ชื่อนัด/ชื่อแขก) · ตัวเลขนับใช้ `counts.aria`
- โฟกัสหลังเปิด sheet = ปุ่ม "คัดลอกลิงก์" · dialog ทำลาย = "ยกเลิก" · ปิด sheet คืนโฟกัสไปปุ่ม "ชวนคนนอก"
- `aria-live=polite` สำหรับ "คัดลอกลิงก์แล้ว" และข้อความผิดพลาดใน sheet
- เป้าสัมผัสทุกปุ่ม ≥ `--tap` (รวม "นำออก" ซึ่งเป็นปุ่มข้อความ ต้องมี padding ให้ถึง)
- สีข้อความใช้ token ที่ผ่านคอนทราสต์แล้ว (`--ink`, `--ink-muted`, `--danger-ink`, `--warn-ink`) · ไม่มีคู่สีใหม่ → ไม่ต้องเพิ่มใน `contrast.mjs`
- TH ยาว/EN ยาว: ปุ่ม `btn-block` ห่อบรรทัดได้ ไม่ตัดข้อความ · ชื่อนัด/ชื่อแขกยาวใช้ `overflow-wrap:anywhere`

| หน้า/ส่วน | โหลด | ว่าง | ผิดพลาด | ปกติ | อื่น |
|---|---|---|---|---|---|
| Sheet ชวน | `share.sheet.creating` | — | `share.error.*` ใน sheet + ปุ่มลองใหม่ (`common.retry`) | ลิงก์+ปุ่ม | เต็ม (warn) |
| หน้าลิงก์ | หน้าเรนเดอร์ฝั่งเซิร์ฟเวอร์ (ไม่มีโหลด) | `counts.none` | `shareLanding.addError` | การ์ด+ปุ่ม | §4 ทั้งหมด |
| รายชื่อแขก | อยู่ในโหลดของหน้านัด | `guests.empty` | `guests.removeError` | แถวต่อแขก | — |
| มุมมองแขก | โหลดของหน้านัด | — | `appointments.detail.error` เดิม | ตาม §5 | `…gone` เดิม |

## 10. สิ่งที่ยังไม่ได้ทำ / ต้องให้คนอื่นตัดสิน
- **ภาพหน้าจอ 375/390/768 สว่าง/มืด: ยังไม่มี** เพราะยังไม่มี UI (frontend ทำหลังเอกสารนี้) — ux จะถ่ายและตรวจใน V5 หลัง frontend เสร็จ · เอกสารนี้เป็น wireframe ข้อความ ไม่ใช่ภาพจริง
- **เสนอ architect/platform (ADR 0016):** (1) แขกที่ถูกนำออกเปิดลิงก์เดิมกลับเข้ามาได้อีกหรือไม่ (ถ้าลิงก์ยังใช้ได้ = ได้) ถ้าต้องการกันให้ต้องมีรายการห้าม · ข้อความ `guests.removeConfirm.body` เขียนตามกรณี "เข้าได้อีกถ้าเปิดลิงก์ใหม่" (2) `shareLanding.state.invalid` กับ `revoked` ควรตอบ HTTP เหมือนกัน (404) เพื่อไม่ให้เดา token
- **เสนอ frontend:** ใช้ `ConfirmDialog` ที่มีอยู่ทั้ง 3 จุดทำลาย (ไม่ต้องสร้างคอมโพเนนต์ใหม่) · หน้า `/i/[token]` ไม่ใช้ layout ที่มี bottom nav
- **ErrorCode:** ไม่เพิ่ม `errors.*` — ข้อความผิดพลาดของ §S อยู่ใต้ `share.error.*` · ถ้า platform เพิ่ม ErrorCode ใหม่ (เช่น ลิงก์เต็ม) ต้องแจ้ง ux เพิ่ม `errors.<CODE>` TH/EN (เทสต์ R0-9 บังคับ) ห้ามเติมเอง

## 11. คีย์ข้อความที่เพิ่ม (messages/th.json + en.json — ทั้งสองภาษาตรงกัน ผ่าน `tests/i18n/messages.test.ts`)
- `share.invite.{button,aria}` · `share.sheet.{title,lead,seesTitle,sees,hidesTitle,hides,mine,limit,valid,creating,done}` · `share.link.label` · `share.{copy,copied,copyFailed,share,shareTitle,shareText}` · `share.revoke.{cta,title,body,confirm,done}` · `share.links.{title,item,revokeAria}` · `share.error.{generic,cancelled,past,rate,revoke}`
- `shareLanding.{invitedBy,inGroup,loginHint,note,privacyLink,added,addError}` · `shareLanding.counts.{going,maybe,none,aria}` · `shareLanding.cta.{add,adding,login,signup}` · `shareLanding.already.{member,guest}.{title,body,cta}` · `shareLanding.state.{full,expired,revoked,invalid}.{title,body}` · `shareLanding.state.home`
- `guest.{badge,banner,limits}` · `guest.counts.title` · `guest.leave.{cta,title,body,confirm,done,error}`
- `guests.{title,listAria,limit,badge,with,noReply,empty,remove,removeAria,removed,removeError}` · `guests.removeConfirm.{title,body,confirm}`
- `notifications.appointment.guest.{added,joined,removed,cancelled,updated}`
- `privacy.guest.{title,preview,joined,members,retention}`
- D2: `adminGroup.restore.inviteNote` · `adminGroup.restore.confirm.inviteNote`
- H4: `calendar.busyRateLimited.{title,body}` (ปุ่ม "ลองอีกครั้ง" ใช้ `common.retry` เดิม)
- C1: `busy.series.{confirmOneTitle,confirmOneBody,confirmOne}` · `busy.routine.scope.confirmOne.{title,body,confirm}` · `groupSettings.invite.direct.confirm.{title,body,confirm}`
