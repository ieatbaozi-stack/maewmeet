# R17 — การยืนยันก่อนลบ + ออกแบบกู้คืนกลุ่ม (A3 · A1 · A2 · G3 · G5)

> ผู้เขียน: ux · 2026-11-19 · ที่มา: [R17_CONTRACT.md](../contracts/R17_CONTRACT.md) §1–§2 · boss: "อะไรที่เป็นลบหายถาวร ควรให้การ confirmation มันหนักแน่นครับ ไม่ได้กดลบกันง่ายๆ"
> ข้อความทั้งหมดอยู่ใน `messages/th.json` + `en.json` (รายการคีย์ท้ายเอกสาร) · ไม่มีสีใหม่ ใช้ token เดิม (`btn-danger`, `alert-warn`, `--danger-ink`) ที่ผ่านคอนทราสต์ตาม [CONTRAST.md](CONTRAST.md) แล้ว

## 0. ระดับการยืนยัน (นิยามกลาง)
| ระดับ | หน้าตา | ใช้เมื่อ |
|---|---|---|
| **L1 กดยืนยัน** | `ConfirmDialog`: ข้อความบอกผล · ปุ่มแดงบน "ยกเลิก" ล่าง · โฟกัสเริ่มที่ "ยกเลิก" | ลบ/ยกเลิกที่หายถาวรแต่กระทบ 1 รายการ หรือทำย้อนด้วยการเชิญ/สร้างใหม่ได้ |
| **L2 พิมพ์ยืนยัน** | L1 + ช่องพิมพ์ชื่อ (กลุ่ม/ชื่อผู้ใช้) ปุ่มแดงกดไม่ได้จนกว่าจะตรง | หายถาวรและกระทบหลายคน/ทั้งบัญชี |
| **L3 พิมพ์ + PIN** | L2 แล้วตามด้วยใส่ PIN (เซิร์ฟเวอร์ตรวจ) | ลบบัญชีเท่านั้น |

กฎร่วม: ปุ่มแดงไม่ใช่ปุ่มที่โฟกัสตอนเปิด · ข้อความต้องบอก "อะไรหาย" และ "กู้คืนได้ไหม/ภายในกี่วัน" ตรงๆ · การซ่อนปุ่มไม่นับเป็นการป้องกัน (สิทธิ์ตรวจที่เซิร์ฟเวอร์)

## 1. A3 — สำรวจปุ่มลบ/ยกเลิก/เพิกถอน/ตัดการเชื่อมทั้งแอป
อ่านจาก `src/components/**` (route จาก `src/app/api/**`) เมื่อ 2026-11-19

| # | การกระทำ | ไฟล์ | หายถาวร? | ยืนยันตอนนี้ | ระดับที่ควรเป็น | ต้องแก้ |
|---|---|---|---|---|---|---|
| 1 | ลบบัญชี | `account/DeleteAccountSheet.tsx` | **ถาวร** ล้างข้อมูลทันที ไม่มีใครกู้ได้ | หน้าข้อมูล → ใส่ PIN | **L3** | **A1 (frontend+auth)** เพิ่มช่องพิมพ์ชื่อผู้ใช้ในหน้าแรก + แจ้ง "แม้แต่ผู้ดูแลระบบ" + รายการ LINE |
| 2 | ลบกลุ่ม (admin กลุ่ม) | `groups/DangerSections.tsx` (`DeleteSection`) | ไม่ — กู้ได้ 30 วันโดย SA แล้วหายถาวร | **มี L2 แล้ว** (พิมพ์ชื่อกลุ่ม) | **L2** | เปลี่ยนแค่ข้อความ (G4/A2) — ใช้คีย์เดิม ข้อความใหม่แล้ว |
| 3 | ลบกลุ่ม (SA) | `admin/AdminGroupDetail.tsx` | ไม่ — SA กู้เองได้ 30 วัน | **มี L2 แล้ว** | **L2** | เปลี่ยนข้อความ + ปุ่มเปลี่ยนจาก "ลบกลุ่มถาวร" เป็น "ลบกลุ่ม" (ไม่ถาวรแล้ว) |
| 4 | กู้คืนกลุ่ม (ใหม่) | `admin/AdminGroupDetail.tsx`, `AdminGroups.tsx` | — (ไม่ทำลาย) | — | **L1** (tone `primary`) | G3 สร้างใหม่ |
| 5 | ลบ busy รายการเดียว | `busy/BusyFormSheet.tsx` (`confirmDelete`) | ถาวร | L1 + สรุปรายการ | **L1** | ไม่ต้องแก้ |
| 6 | ลบ busy ในชุดรายวัน: "วันนี้" | `BusyFormSheet.tsx` (`SeriesDeleteDialog` → `onOne`) | ถาวร (1 วัน) | เลือกขอบเขตจาก sheet 2 ตัวเลือก คำอธิบายใต้ปุ่ม (แตะ 2 ครั้ง) | **L1 ผ่าน chooser** พอ | ไม่ต้องแก้ (ปุ่มระบุผลชัด กระทบ 1 วัน) |
| 7 | ลบ busy ในชุดรายวัน: "ทั้งชุด" | `BusyFormSheet.tsx` (`confirm` step) | ถาวร รวมวันที่ผ่านมา | **L1 มีแล้ว** (2 ขั้น) | **L1** | ไม่ต้องแก้ |
| 8 | ลบตารางประจำ "เฉพาะวันนี้" | `busy/RoutineScopeSheet.tsx` (`one`) | ถาวร (1 วัน) | chooser เท่านั้น | **L1 ผ่าน chooser** พอ | ไม่ต้องแก้ |
| 9 | **เลิกตารางประจำ "ตั้งแต่สัปดาห์/เดือนนี้ไป"** | `RoutineScopeSheet.tsx` (`from`) | **ถาวร หลายวัน** | **ไม่มี confirm — ยิง API ทันทีที่แตะ** (`choose()` → `runDelete`) | **L1** | **แก้รอบนี้ (frontend)** ใส่ `ConfirmDialog` ก่อน `runDelete("from")` ใช้คีย์ `busy.routine.scope.confirmFrom.*` |
| 10 | ลบตารางประจำ "ทั้งหมด" | `RoutineScopeSheet.tsx` (`all`) | ถาวร รวมวันที่ผ่านมา | **L1 มีแล้ว** | **L1** | ไม่ต้องแก้ |
| 11 | ยกเลิกนัด | `appointments/AppointmentDetail.tsx` (`cancelling`) | นัดยังอยู่ในรายการแต่ติด "ยกเลิก" แก้/ตอบอีกไม่ได้ ย้อนไม่ได้ | L1 + บอกจำนวนคนที่จะได้รับแจ้ง · โฟกัสที่ "เก็บไว้" | **L1** | ไม่ต้องแก้ |
| 12 | นำสมาชิกออก | `groups/MemberList.tsx` (`remove`) | เชิญกลับได้ | L1 | **L1** | ไม่ต้องแก้ |
| 13 | ออกจากกลุ่มเอง | `groups/DangerSections.tsx` (`LeaveSection`) | กลับมาได้ถ้ามีคนเชิญ | L1 | **L1** | ไม่ต้องแก้ |
| 14 | เพิกถอนโค้ดเชิญ | `groups/InviteSection.tsx` (`revoke`) | ถาวร (สร้างโค้ดใหม่ได้) | L1 | **L1** | ไม่ต้องแก้ |
| 15 | ยกเลิกคำเชิญตรง | `InviteSection.tsx` (`cancelDirect`) | ถาวร แต่ส่งใหม่ได้ ไม่มีข้อมูลสูญ | **ไม่มี confirm โดยตั้งใจ** (คอมเมนต์ในโค้ด) | ไม่ต้องยืนยัน | ไม่แก้ — ผลกระทบเล็ก ย้อนได้ด้วยการส่งใหม่ (เสนอ main ถ้า boss อยากเข้ม) |
| 16 | ปฏิเสธคำเชิญเข้ากลุ่ม | `groups/GroupsView.tsx` (`respond decline`) | ถาวรฝั่งผู้รับ (ผู้เชิญส่งใหม่ได้) | ไม่มี confirm | ไม่ต้องยืนยัน | ไม่แก้ — ไม่มีข้อมูลสูญ · ปุ่มระบุกลุ่มใน aria ชัด |
| 17 | ตัดการเชื่อม LINE | `account/LineSection.tsx` | ไม่ (เชื่อมใหม่ได้) | L1 (`Sheet` alert โฟกัสที่ยกเลิก) | **L1** | ไม่ต้องแก้ |
| 18 | ออกจากระบบทุกเครื่อง | `auth/AccountActions.tsx` | ไม่ (เข้าใหม่ได้) | L1 | **L1** | ไม่ต้องแก้ |
| 19 | ออกจากระบบเครื่องนี้ | `AccountActions.tsx` | ไม่ | ไม่มี | ไม่ต้องยืนยัน | ไม่แก้ |
| 20 | โอนความเป็นผู้ดูแล | `DangerSections.tsx` / `MemberList.tsx` / `AdminGroupDetail.tsx` | ไม่ทำลายข้อมูล | L1 (tone `primary`) | **L1** | ไม่ต้องแก้ |
| 21 | ระงับบัญชี (SA) | `admin/AdminUsers.tsx` | ไม่ (เปิดคืนได้) | L1 (tone `danger`) | **L1** | ไม่ต้องแก้ |
| 22 | ปฏิเสธคำขอรีเซ็ต PIN (SA) | `admin/PinResetList.tsx` | ถาวรต่อคำขอนั้น (ผู้ใช้ขอใหม่ได้) | Sheet ยืนยัน | **L1** | ไม่ต้องแก้ |
| 23 | ข้ามวัน/เอาวันกลับ (routine skip) | `busy/RoutineSkipSheet.tsx` | ไม่ (เอากลับได้) | sheet เลือกวัน + ปุ่มบันทึก | ไม่ต้องยืนยันเพิ่ม | ไม่แก้ |

**จุดที่หายถาวรแต่ไม่มี confirm เลย (frontend แก้รอบนี้): ข้อ 9 เท่านั้น.**
ข้อ 15–16 ไม่มีข้อมูลสูญ จึงเว้นไว้ โดยเสนอ main ตัดสินว่าจะเข้มกว่านี้ไหม · ข้อ 6 และ 8 ตั้งใจไม่เพิ่ม dialog เพราะ chooser แตะแล้วเห็นผลของแต่ละปุ่มชัดและกระทบ 1 วัน — ถ้า boss อยากเข้มกว่านี้ใช้ `confirmFrom` รูปแบบเดียวกันได้
**ที่ยกระดับเกินขอบเขตรอบนี้ (เสนอ main):** ลบทั้งชุด busy/ตารางประจำ (ข้อ 7, 10) เป็น L1 ที่ข้อความบอกผลชัดแล้ว · ไม่เสนอ L2 เพราะเป็นข้อมูลของตัวเอง 100%

## 2. A1 — ลบบัญชี (L3)
**ลำดับหน้า** (`DeleteAccountSheet`): `info` → `pin` (มี `transfer` / `superAdmin` แทรกตามเดิม)

**หน้า `info` (ขั้น 1)** — เลื่อนอ่านได้ใน sheet
1. หัวข้อ `account.delete.title` + ข้อความนำ `account.delete.lead` ("ลบแล้วกู้คืนไม่ได้ แม้แต่ผู้ดูแลระบบก็เอากลับมาให้ไม่ได้ …")
2. กล่องเตือน `alert-warn` + ไอคอน `triangle-alert` ข้อความ `account.delete.noRestore` (ตัวหนา) — อยู่เหนือรายการ
3. "สิ่งที่จะหายไป" (`goneTitle`) ไอคอน x: `sessions` · `groups` · `busy` (ช่วงไม่ว่าง+บันทึกส่วนตัว) · `rsvp` (ตอบรับนัด+แจ้งเตือน) · `invites` · `name` · **`line` (ใหม่)** · `resets` — frontend เพิ่ม `"line"` ใน `GONE` ก่อน `resets`
4. "สิ่งที่ยังอยู่" (`keepTitle`) ไอคอน check — เดิม
5. ช่อง **พิมพ์ชื่อผู้ใช้**: label `typeLabel` · hint `typeHint` ({username} = ชื่อผู้ใช้ของตัวเอง ห่อ `<bdi>`/`Name` ตามแพตเทิร์นเดิม) · `autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}` · เทียบด้วย `deleteTypeMatches`-แบบเดียวกับกลุ่ม แต่ชื่อผู้ใช้ไม่ต้อง normalise พิเศษ
6. ปุ่ม: **"ไปต่อ ใส่ PIN" (`continue`, แดง) กดไม่ได้จนกว่าพิมพ์ตรง** · "ยกเลิก" (`common.cancel`) ล่าง · **โฟกัสเริ่มที่ "ยกเลิก"** (มีอยู่แล้ว ห้ามเปลี่ยน)

**หน้า `pin` (ขั้น 2):** `pinTitle` + ข้อความขั้นสุดท้าย `pinLast` (แทน/เหนือ `pinHint` ตามพื้นที่) · ปุ่ม "ย้อนกลับ" + "ยกเลิก" · ครบ 6 หลักส่งทันที (เดิม) · ส่ง `{ pin, confirmUsername }`

**ข้อผิดพลาด:** เซิร์ฟเวอร์ตอบ 400 เมื่อ `confirmUsername` ไม่ตรง (ไม่นับ PIN ผิด) → frontend กลับไปหน้า `info` แสดง `usernameMismatch` (role=alert) เหนือช่องพิมพ์ และล้าง PIN · PIN ผิด ใช้ข้อความ `errors.INVALID_CREDENTIALS` เดิม

**ทำไมพิมพ์ username ไม่ใช่คำว่า "ลบ":** กันมือพลาดแบบเดียวกับพิมพ์ชื่อกลุ่ม และบังคับให้ผู้ใช้ตั้งใจจริงว่าเป็นบัญชีตัวเอง (กัน autofill/กดซ้ำ) · hint บอกชัดว่าไม่ใช่ PIN เพื่อไม่ให้พิมพ์ PIN ลงช่องที่มองเห็นได้

## 3. A2 — ลบกลุ่ม (L2) + ข้อความ G4
ใช้ dialog เดิม 2 จุด (admin กลุ่ม `DeleteSection`, SA `AdminGroupDetail`) — โครง "พิมพ์ชื่อกลุ่ม" มีอยู่แล้ว ไม่ต้องสร้างใหม่ · ปรับถ้อยคำ:
- **admin กลุ่ม** (`groupSettings.delete.*`): บอกว่าลบแล้ว "กู้คืนเองไม่ได้ แต่ผู้ดูแลระบบกู้ให้ได้ภายใน 30 วัน" · ใน dialog: "ถ้าอยากได้กลุ่มคืน ให้ติดต่อผู้ดูแลระบบภายใน 30 วัน หลังจากนั้นกลุ่มจะหายถาวร"
- **SA** (`adminGroup.delete.*`): "คุณกู้คืนได้จากหน้านี้ภายใน 30 วัน หลังจากนั้นหายถาวร" · ปุ่ม "ลบกลุ่มนี้" / "Delete group" (เลิกใช้คำว่า "ถาวร" เพราะไม่ถาวรทันที)
- ปุ่มแดงกดไม่ได้จนกว่าพิมพ์ชื่อตรง · โฟกัสเริ่มที่ "ยกเลิก" (ConfirmDialog เดิม)
- หน้า `privacy`: `privacy.retention.groups` และ `privacy.delete.noRestore` แก้ให้ตรงนโยบายใหม่ (เก็บ 30 วัน · บัญชีกู้ไม่ได้แม้ผู้ดูแลระบบ)

## 4. G3 — หน้า admin กลุ่ม: กู้คืน
**แถวในรายการ** (`AdminGroups`, ตัวกรอง "ลบแล้ว"/"ทั้งหมด", เฉพาะแถวที่ลบแล้ว):
- บรรทัดเดิม "ลบเมื่อ {date}" (`adminGroups.deletedAt`) + บรรทัดใหม่ `adminGroups.purgeIn` ({days}: "จะลบถาวรในอีก N วัน" / `=0` "จะลบถาวรวันนี้") ใช้โทน `muted` ธรรมดา **เมื่อ ≤ 7 วัน ใช้ `--danger-ink`** (ข้อความ + ไอคอน `clock` ไม่พึ่งสีอย่างเดียว) — สีนี้มีใน token อยู่แล้ว
- ปุ่ม `adminGroups.restore` ("กู้คืน", `btn btn-secondary`, ไอคอน `rotate-ccw`) พร้อม `aria-label` = `adminGroups.restoreAria` · เป้าสัมผัส ≥ `--tap` · มือถือ 375: ปุ่มเต็มความกว้างใต้ข้อความ (ไม่ชิดขวาให้ชนชื่อกลุ่มยาว)
- ไม่ลอยออกจากหน้ารายการ: กดแล้วเปิด `ConfirmDialog` (tone `primary`) → สำเร็จ toast `adminGroup.restore.done` แล้วแถวเปลี่ยนเป็น "ใช้งานอยู่"
- days คำนวณจากวันที่ (ท้องถิ่น Asia/Bangkok) ผ่าน `src/lib/calendar` ห้ามคำนวณด้วย `new Date()` เอง

**หน้ารายละเอียด** (`AdminGroupDetail`, กลุ่มที่ลบแล้ว): banner `deletedBanner` เดิม + บรรทัด `adminGroup.purgeIn` · ส่วนใหม่ `adminGroup.restore.title/body/cta` แทนที่ส่วน "ลบกลุ่ม/โอนผู้ดูแล" ที่ซ่อนอยู่เมื่อกลุ่มถูกลบ

**Confirm dialog** (`adminGroup.restore.confirm.*`): ชื่อ "กู้คืนกลุ่ม {group}?" · ข้อความบอกว่าสมาชิกจะได้รับแจ้ง + บันทึกว่าคุณเป็นคนทำ · ปุ่ม primary "กู้คืนกลุ่ม" · L1 พอ เพราะไม่ทำลายอะไร

**ข้อความผิดพลาด** (แสดงใน dialog แบบ `form-error sheet-error` ตามเดิม · `adminGroup.restore.error.*`):
| สาเหตุ | คีย์ | หลังแสดง |
|---|---|---|
| เกิน 30 วัน (ยังไม่ถูก cron ลบ) | `expired` | ปุ่มกู้คืนหายไป รีเฟรชแถว |
| ไม่เหลือ admin ที่บัญชี active | `noAdmin` | คงปุ่มไว้ (ไม่มีทางแก้ในแอปรอบนี้ — เสนอ main ถ้าต้องมี "กู้พร้อมตั้งผู้ดูแลใหม่") |
| ถูกลบถาวรแล้ว (404/แถวหาย) | `purged` | ปิด dialog รีเฟรชรายการ |
| มีคนกู้ไปแล้ว (แข่งกัน) | `alreadyRestored` | รีเฟรชแถวเป็น "ใช้งานอยู่" |

**แมปจากเซิร์ฟเวอร์:** ตอนนี้ `ERROR_CODES` ไม่มีรหัสเฉพาะ · ถ้า platform เลือกใช้ `CONFLICT`/`NOT_FOUND` + `details.reason` ฝั่ง frontend แมป reason → 4 คีย์ข้างบน · ถ้า platform เพิ่ม ErrorCode ใหม่ ต้องมี `errors.<CODE>` ทั้งสองภาษา (เทสต์ R0-9 บังคับ) — แจ้ง ux ให้เพิ่มคำให้ ห้าม frontend เติมเอง

## 5. G5 — แจ้งเตือนในกระดิ่ง "กลุ่ม X ถูกกู้คืนแล้ว"
- kind: `group.restored` · params: `groupId`, `groupName` · แสดง `notifications.group.restored` ({groupName})
- ผู้กระทำแสดงเป็นคำว่า "ผู้ดูแลระบบ/A system admin" **ตายตัวในข้อความ ไม่มีตัวแปรชื่อ** (ไม่รั่วว่าใครเป็น SA — แนวเดียวกับ R16) · ไม่ส่ง LINE
- ไอคอน `rotate-ccw` · tone `ok` · href `/groups/{groupId}` (กลุ่มกลับมาเข้าได้แล้ว ต่างจาก `member.removed` ที่ลิงก์ไป `/groups`)
- รูปแบบเดียวกับ `group.member.removed` ใน `notifications/model.ts`: ถ้าไม่มี `groupName`/`groupId` → `UNKNOWN`

## 6. สิ่งที่ยังไม่ได้ทำ / ข้อควรระวัง
- ภาพหน้าจอ 375/390/768 ยังไม่มี เพราะ UI ยังไม่ถูกสร้าง (frontend ทำในรอบนี้) — ต้องถ่ายหลัง frontend เสร็จ
- หน้า `docs/design/samples/group-settings.html` ยังมีข้อความเก่า "กู้คืนไม่ได้" ของลบกลุ่ม (ตัวอย่างเก่า ไม่ใช่ product)
- ข้อความ ICU ผ่านเทสต์ `tests/i18n/messages.test.ts` (th/en ตรงกัน ตัวแปรตรงกัน format ได้)

## 7. คีย์ข้อความที่เพิ่ม/แก้ (messages/th.json + en.json)
**เพิ่มใหม่**
- `notifications.group.restored` — {groupName}
- `account.delete.noRestore` · `account.delete.typeLabel` · `account.delete.typeHint` ({username}) · `account.delete.usernameMismatch` · `account.delete.pinLast` · `account.delete.gone.line`
- `adminGroups.purgeIn` ({days}) · `adminGroups.restore` · `adminGroups.restoreAria` ({group})
- `adminGroup.purgeIn` ({days}) · `adminGroup.restore.title` · `.body` · `.cta` · `.confirm.title` ({group}) · `.confirm.body` · `.confirm.confirm` · `.done` ({group}) · `.error.expired` · `.error.noAdmin` · `.error.purged` · `.error.alreadyRestored`
- `busy.routine.scope.confirmFrom.title` · `.body` · `.confirm`

**แก้ข้อความ (คีย์เดิม ตัวแปรเดิม)**
- `account.delete.lead` · `account.delete.gone.groups`
- `adminGroup.deletedBanner` ({date}) · `adminGroup.delete.body` · `adminGroup.delete.confirm.body` ({count}) · `adminGroup.delete.confirm.confirm`
- `groupSettings.delete.body` · `groupSettings.delete.confirm.body`
- `privacy.retention.groups` · `privacy.delete.noRestore`
