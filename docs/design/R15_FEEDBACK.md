# R15a — ไอคอนกลุ่ม · ไอคอนแอป · เว้นบางวัน · ปรับหน้าจอเล็กน้อย (โน้ตดีไซน์)

ผู้เขียน: ux · ที่มา: R15_CONTRACT §1.1–§1.4, §5, §6, §8 (boss เห็นชอบ 2026-11-15) · ไม่มีสีใหม่ ทุกค่ามาจาก tokens (สว่าง/มืด) · ข้อความทั้งหมดอยู่ใน `messages/th.json` / `en.json` (คีย์ครบสองภาษา ผ่าน `tests/i18n`)

ภาพประกอบ: ตัวอย่างโต้ตอบ `docs/design/samples/r15-feedback.html` (`?lang=th|en&theme=light|dark&state=…` — states: `picker picker-cat picker-saving picker-error settings settings-default settings-member where all card card-toast skip skip-none skip-next skip-limit skip-restore skip-saving skip-error skip-stale skip-empty appicon`) · ภาพหน้าจอ 375/390/768 อยู่ `docs/design/screenshots/r15a/` (โฟลเดอร์นี้อยู่ใน `.gitignore` ตามธรรมเนียมของ repo — ไม่ถูก commit; สร้างใหม่ด้วย `node docs/design/tools/shoot-r15.cjs . docs/design/screenshots/r15a picker,375,th,light …`) · สร้างหน้าตัวอย่างด้วย `node docs/design/tools/build-r15.mjs`

| ไฟล์ | อะไร |
|---|---|
| `docs/design/tools/group-icons.json` | ต้นฉบับชุดไอคอนกลุ่ม: key, ที่มา, ชื่อ TH/EN, เส้นทาง SVG ครบ 24 แบบ (platform/frontend คัดลอกจากที่นี่) |
| `docs/design/tools/group-icons.mjs` | สคริปต์สร้างไฟล์ข้างบนจาก lucide-static 1.57.0 (`LUCIDE_NODES=…/icon-nodes.json node docs/design/tools/group-icons.mjs`) |
| `public/brand/app/*.png` · `docs/design/tools/app-icon.mjs` | ไอคอนแอป 4 ไฟล์ + สคริปต์ที่สร้าง (`node docs/design/tools/app-icon.mjs`) |
| `docs/design/tools/contrast.mjs` | เพิ่ม 7 คู่ R15 (ไม่มีสีใหม่) · `npm run contrast` ไม่ผ่าน 0 คู่ |

---

## 1. ไอคอนกลุ่ม (B1/B2)

### 1.1 ชุดไอคอน 24 แบบ (ลำดับนี้ = ลำดับในตัวเลือก)

เลือกจาก Lucide เป็นหลัก เพราะทั้งแอปใช้ Lucide ชุดเดียว (UI_DIRECTION §3: ห้ามผสมชุด) เส้น 1.75–2 ปลายมน ไม่มีพื้นสี จึงเข้ากับแอปและรับสว่าง/มืดจาก `currentColor` ทุกแบบ · เส้นทางทุกแบบตรวจกับ `lucide-static@1.57.0/icon-nodes.json` (ดาวน์โหลดมาเทียบ ไม่ได้เดา) ยกเว้น 2 แบบที่ Lucide ไม่มี

**แมวใช้ไอคอน `cat` ของ Lucide ไม่ใช้ภาพแมวแบรนด์ (`public/brand/cats`)** เพราะภาพแมวแบรนด์ขั้นต่ำ 48px ละเอียดเกินสำหรับ 16–28px และอีก 23 แบบเป็นเส้นเดียวกัน ถ้าใช้แมวลายเส้นหนากับไอคอนเส้นบางจะดูไม่เป็นชุดเดียวกัน

| # | key | ที่มา | ชื่อไทย | ชื่ออังกฤษ |
|---|---|---|---|---|
| 1 | `cat` (ค่าเริ่มต้น) | lucide `cat` | แมว | Cat |
| 2 | `food` | lucide `utensils` | อาหาร | Food |
| 3 | `hotpot` | lucide `cooking-pot` | ชาบู หม้อไฟ | Hot pot |
| 4 | `dessert` | lucide `ice-cream-cone` | ของหวาน | Dessert |
| 5 | `coffee` | lucide `coffee` | กาแฟ | Coffee |
| 6 | `drinks` | lucide `beer` | สังสรรค์ | Drinks |
| 7 | `badminton` | **วาดเอง** (ลูกขนไก่) | แบดมินตัน | Badminton |
| 8 | `soccer` | **วาดเอง** (ลูกฟุตบอล) | ฟุตบอล | Football |
| 9 | `volleyball` | lucide `volleyball` | วอลเลย์บอล | Volleyball |
| 10 | `fitness` | lucide `dumbbell` | ออกกำลังกาย | Workout |
| 11 | `bike` | lucide `bike` | ปั่นจักรยาน | Cycling |
| 12 | `game` | lucide `gamepad-2` | เกม | Games |
| 13 | `music` | lucide `music` | ดนตรี | Music |
| 14 | `karaoke` | lucide `mic-vocal` | คาราโอเกะ | Karaoke |
| 15 | `movie` | lucide `clapperboard` | ดูหนัง | Movies |
| 16 | `travel` | lucide `plane` | เที่ยว | Travel |
| 17 | `camping` | lucide `tent` | แคมป์ปิ้ง | Camping |
| 18 | `work` | lucide `briefcase` | ทำงาน | Work |
| 19 | `study` | lucide `graduation-cap` | เรียน | Study |
| 20 | `home` | lucide `house` | บ้าน | Home |
| 21 | `shopping` | lucide `shopping-bag` | ช้อปปิ้ง | Shopping |
| 22 | `heart` | lucide `heart` | หัวใจ | Heart |
| 23 | `party` | lucide `party-popper` | ปาร์ตี้ | Party |
| 24 | `star` | lucide `star` | ดาว | Star |

**แบดมินตัน/ฟุตบอล: Lucide 1.57.0 ไม่มี** (มีแค่ `volleyball`, `rugby-ball`, `goal`, `feather`) จึงวาดเอง 2 แบบตามสเปก Lucide เดียวกัน — ตาราง 24×24, เส้น 2, ปลายและมุมมน, ไม่มีสีพื้น — และคัดลอกเส้นทางไว้ใน `group-icons.json` (`"source": "custom"`):

```
badminton: <path d="M9 19a3 3 0 0 0 6 0Z"/> <path d="m9 19-3.5-15"/> <path d="m15 19 3.5-15"/> <path d="M5.5 4q6.5-2 13 0"/> <path d="M12 19V3"/> <path d="M7.2 11.4q4.8 1.6 9.6 0"/>
soccer:    <circle cx="12" cy="12" r="10"/> <path d="m12 8.5 3.33 2.42-1.27 3.91H9.94l-1.27-3.91Z"/> <path d="M12 8.5V2"/> <path d="m15.33 10.92 6.18-2.01"/> <path d="m14.06 14.83 3.82 5.26"/> <path d="M9.94 14.83 6.12 20.09"/> <path d="M8.67 10.92 2.49 8.91"/>
```
ดูผลที่ 16–28px ในภาพ `r15-feedback-all-390-th-light.png` · ถ้า Lucide เพิ่มไอคอนเหล่านี้ภายหลัง ให้สลับเป็นของ Lucide ได้โดยไม่เปลี่ยน key

### 1.2 สัญญาสำหรับ platform (allowlist กลาง)

- ค่าคงที่เดียวทั้งเซิร์ฟเวอร์และ UI เช่น `src/lib/shared/group-icons.ts`: `export const GROUP_ICON_KEYS = ["cat","food","hotpot","dessert","coffee","drinks","badminton","soccer","volleyball","fitness","bike","game","music","karaoke","movie","travel","camping","work","study","home","shopping","heart","party","star"] as const;` + `type GroupIconKey` + `DEFAULT_GROUP_ICON = "cat"`
- `groups.icon text NULL`: `NULL` = ยังไม่ตั้ง = แสดงแมว · เซิร์ฟเวอร์รับเฉพาะ key ในรายการนี้หรือ `null` (ล้าง) · ไม่รับรูป/URL/emoji (B1) · key รูปแบบ `^[a-z]{2,12}$`
- ผู้ใช้เลือก "แมว" ในตัวเลือก: ฝั่ง UI ส่ง `null` (ไม่เก็บ `"cat"`) เพื่อให้ "ยังไม่ตั้ง" กับ "เลือกแมว" เป็นค่าเดียว — เซิร์ฟเวอร์ยังต้องรับ `"cat"` ได้ (ไม่ผิด)
- ค่าที่อ่านจากฐานแล้วไม่อยู่ในรายการ (ลบ key ภายหลัง/ข้อมูลเสีย) → UI แสดงแมว ห้าม error
- DTO ที่ต้องมี `icon: GroupIconKey | null`: รายการกลุ่ม (`/groups`), กลุ่มใน payload ปฏิทิน (สลับกลุ่ม/หัวปฏิทิน), นัดบนหน้าหลัก (ชื่อกลุ่มของนัดถัดไป + แถวนัด), หน้ากลุ่ม
- ชื่อ TH/EN ของไอคอนอยู่ที่ `groupIcon.names.<key>` (ครบ 24 คีย์ ตรงกับ allowlist · เทสต์ควรตรวจว่าทุก key ใน `GROUP_ICON_KEYS` มี `groupIcon.names.<key>` ใน th และ en)
- frontend: ทำคอมโพเนนต์ `GroupIcon` (props `icon: string | null`, `variant: "tile" | "glyph"`, `size: "sm" | "md" | "lg"`) นำเส้นทางจาก `group-icons.json` ไปไว้ใน `src/components/icons/group-icons.ts` — **ไฟล์แยก ไม่ใส่ใน `lucide.ts`** เพราะ `lucide.ts` ประกาศว่า "คัดลอกจาก Lucide เท่านั้น" แต่ชุดนี้มี 2 แบบวาดเอง

### 1.3 การแสดงผล: tile และ glyph

| แบบ | หน้าตา | ใช้ที่ |
|---|---|---|
| **tile** | ไอคอนเส้นบนพื้นสี่เหลี่ยมมน `--accent-soft` ตัวเส้น `--accent-soft-ink` (ผ่าน 4.5:1 ทั้งสองธีม; `npm run contrast`) | หัวปฏิทิน, แผ่นสลับกลุ่ม, การ์ดในหน้ากลุ่ม, ส่วนตั้งค่า |
| **glyph** | ไอคอนเส้นเปล่า `--ink-muted` 20px (16px ในแถว) ไม่มีพื้น | บรรทัดกลุ่มในการ์ดนัดบนหน้าหลัก (แทนไอคอน `users` เดิม) และแถวนัด |

| ขนาด tile | กล่อง | ไอคอน | มุม | ที่ไหน |
|---|---|---|---|---|
| `sm` | 28px | 16px | `--radius-sm` | ปุ่มสลับกลุ่มที่หัวปฏิทิน |
| `md` | 44px (`--tap`) | 24px | `--radius-sm` | แถวในแผ่นสลับกลุ่ม · การ์ดในหน้ากลุ่ม |
| `lg` | 56px (`--tap-lg`) | 28px | `--radius-lg` | ส่วนตั้งค่ากลุ่ม · (ทางเลือก) หัวหน้ากลุ่ม |

- ไอคอนเป็นของตกแต่ง (`aria-hidden`) เสมอ เพราะชื่อกลุ่มอยู่ข้างๆ เป็นข้อความ · ถ้าต้องใช้ลำพัง ใช้ `groupIcon.aria` "ไอคอนกลุ่ม: {name}"
- ไม่ใช้สีต่างกันต่อไอคอน — สีเดียวกันทุกแบบ (accent-soft) ความต่างอยู่ที่รูปร่าง เพื่อไม่ชนกับสีประจำตัวสมาชิกและสถานะ busy/ว่าง
- ไม่ตั้งค่า = `cat` (ท่าเดียวกับที่แสดงทุกจุด ไม่มีสถานะ "ว่าง")

| จุดที่แสดง (contract §1.2) | ชิ้นส่วนเดิม | เพิ่มอะไร |
|---|---|---|
| หัวปฏิทิน / ตัวเลือกกลุ่ม | ปุ่มสลับกลุ่ม (`calendar.groupSwitch.label`) · `GroupSwitchSheet` | ปุ่มหัวปฏิทิน: tile `sm` + ชื่อกลุ่ม + ลูกศรลง · แถวในแผ่น: tile `md` ซ้ายสุด ก่อนชื่อและจำนวนสมาชิก วงกลมเลือกขวาสุดเหมือนเดิม |
| การ์ดในหน้ากลุ่ม | `GroupsView` แถว `.group-rows .row` | tile `md` นำหน้า `row-main` (ชื่อ · จำนวนคน · บทบาท) แล้วลูกศร |
| หน้าหลัก | การ์ดนัดถัดไป + แถวนัด | บรรทัดกลุ่มใช้ glyph แทน `users` · แถวนัด `appt-row-meta` นำหน้าชื่อกลุ่มด้วย glyph 16px |
| (ทางเลือก) หัวหน้ากลุ่ม | `/groups/[gid]` | tile `lg` ข้างชื่อกลุ่ม ถ้าไม่ทำให้หัวแน่นที่ 375 |

### 1.4 ตัวเลือกไอคอน (Picker)

**อยู่ที่:** หน้าตั้งค่ากลุ่ม ส่วนใหม่ "ไอคอนกลุ่ม" ต่อจากส่วนชื่อกลุ่ม (ก่อนช่วงเวลาที่นับว่าว่าง) · คีย์ `groupSettings.icon.*`

**ใครเห็นอะไร (B2):** ผู้ดูแล (admin) และผู้ช่วยดูแล (moderator) (และ super admin ตามกติกาเดิมของการแก้กลุ่ม) เห็นปุ่ม "เปลี่ยนไอคอน" · สมาชิกทั่วไปเห็นส่วนเดียวกันแบบอ่านอย่างเดียว (tile + ชื่อ + บรรทัดล็อก `viewOnly`) ไม่มีปุ่ม · **ซ่อนปุ่มไม่ใช่การป้องกัน** เซิร์ฟเวอร์ตรวจสิทธิ์ `group.icon.update` เสมอ (ถ้าถูกถอนบทบาทระหว่างเปิดอยู่ → `groupSettings.icon.error.forbidden`)

ส่วนตั้งค่า (ภาพ `settings`, `settings-default`, `settings-member`):
```
ไอคอนกลุ่ม
เลือกรูปเล็กๆ ให้กลุ่ม เพื่อนในกลุ่มจะเห็นในปฏิทิน หน้ากลุ่ม และหน้าหลัก
[tile lg]  ตอนนี้ใช้: แบดมินตัน      (ไม่ตั้ง: "ยังไม่ได้เลือก ใช้รูปแมวให้ก่อน")
[ ✎ เปลี่ยนไอคอน ]                    (ปุ่มรอง ≥ 44px)
```

**แผ่นเลือก (bottom sheet สูง)** หัว `picker.title` · ข้อความ `picker.hint` ("อยากกลับไปใช้แบบเดิม เลือกแมวได้เลย") · ตาราง · ปุ่มติดล่าง `picker.save` "ใช้ไอคอนนี้" (ปุ่มหลักปุ่มเดียวของแผ่น)

| จอ | คอลัมน์ | ช่องละ | หมายเหตุ |
|---|---|---|---|
| 375 | 4 (6 แถว) | ~80×88px | ครบ 24 แบบในจอเดียวไม่ต้องเลื่อน (วัดจริงที่ 375×812) |
| 390 | 4 | ~85×88px | เหมือน 375 |
| 768 | 6 (4 แถว) | ~94×88px | แผ่นกว้าง `--content-max` กลางจอ เหมือนแผ่นฟอร์มอื่น |

- ช่องละ: ไอคอน 28px + ชื่อ (`--text-xs` 13px, ห่อได้ 2 บรรทัด เช่น "ออกกำลังกาย" "ชาบู หม้อไฟ") · `min-height` 88px, เป้าแตะ ≥ 44px ทั้งช่อง · ขอบ `--line-control` 1px พื้น `--surface`
- **สถานะที่เลือก ไม่พึ่งสีอย่างเดียว:** ขอบหนา 2px `--accent-ink` + พื้น `--accent-soft` + **วงกลมเครื่องหมายถูก** มุมขวาบน (`--accent` / `--on-accent`) + ตัวอักษรหนา + `aria-checked="true"` (คู่สีเพิ่มใน contrast.mjs)
- ทางเข้าแผ่น: เริ่มที่ไอคอนปัจจุบันถูกเลือกไว้ (ไม่ตั้ง = แมว) · เลือกแล้วยังไม่บันทึกจนกด "ใช้ไอคอนนี้" (เปลี่ยนใจปิดแผ่นได้ ไม่มีอะไรเกิด)
- a11y: `role="radiogroup"` + `aria-label` = `picker.listAria` · ช่องเป็น `role="radio"` ชื่อ = `groupIcon.names.<key>` (ไม่ซ้ำกับข้อความที่เห็น — เป็นอันเดียวกัน) · roving tabindex (Tab เข้าที่ตัวที่เลือก) · ลูกศรซ้าย/ขวา ±1, บน/ล่าง ±จำนวนคอลัมน์, Home/End · ตัวเลือกใหม่ย้ายโฟกัสพร้อมเลือก · Esc ปิดแผ่น · โฟกัสกลับที่ปุ่ม "เปลี่ยนไอคอน"

| สถานะ | แสดง |
|---|---|
| ปกติ | ตาราง + ปุ่ม "ใช้ไอคอนนี้" |
| ยังไม่เปลี่ยนจากของเดิม | ปุ่ม `aria-disabled="true"` · กดแล้วประกาศ `picker.unchanged` ใน `role="status"` ใต้ตาราง (ไม่ปิดแผ่น) |
| กำลังบันทึก | ปุ่มเป็น `picker.saving` + `aria-busy` · ตาราง/ปิดแผ่นยังใช้ไม่ได้ |
| สำเร็จ | ปิดแผ่น · toast `groupSettings.icon.toast.saved` · tile ในส่วนตั้งค่าเปลี่ยนทันที · refresh ข้อมูลกลุ่มให้ทุกจุดตรงกัน |
| ล้มเหลวทั่วไป/เครือข่าย | แถบ alert เหนือตาราง `icon.error.generic` (ไอคอนยังเป็นอันเดิม ค่าที่เลือกในแผ่นยังอยู่) |
| 403 (สิทธิ์ถูกถอน) | `icon.error.forbidden` · ซ่อนปุ่มหลังรีเฟรช |
| 429 | ข้อความกลาง `errors.RATE_LIMITED` |
| 404 (กลุ่มหาย) | ข้อความกลาง `errors.NOT_FOUND` |

---

## 2. ไอคอนแอป iOS/Android + manifest (§1.3)

**งานศิลป์ที่เลือก:** หัวแมวชิ้นเดียวกับโลโก้ (`public/brand/logo-mark.svg`) บนพื้นสีครามแบรนด์ `--accent` ธีมสว่าง `#4B59C2` · ขนแมว `#FFFFFF` (= `--surface`) เส้น `#2A2833` (= `--ink`) ในหู/แก้ม `#F4D9A8` (= `--cat-fill`) — ไม่มีสีใหม่ · เหตุผล: แมวขาวบนคราม ชัดที่ 60px บนหน้าจอโฮม (ดูภาพ `r15-feedback-appicon-375-th-light.png`), ไม่กลมกลืนกับวอลเปเปอร์สว่างหรือมืด · ใช้เฉพาะ "หัว" ไม่ใช้ตัวเต็ม เพราะไอคอนเล็กต้องอ่านเป็นใบหน้าก่อน

| ไฟล์ (`public/brand/app/`) | ขนาด | พื้นหลัง | ใช้ที่ |
|---|---|---|---|
| `apple-touch-icon.png` | 180×180 | เต็มพื้น ครามทึบ **ไม่มี alpha** (ตรวจแล้ว 3 ช่อง) | `<link rel="apple-touch-icon">` (iOS ตัดมุมเอง) |
| `icon-192.png` | 192×192 | มุมมน โปร่งใสมุม | manifest `purpose: "any"` |
| `icon-512.png` | 512×512 | มุมมน โปร่งใสมุม | manifest `purpose: "any"` |
| `icon-maskable-512.png` | 512×512 | เต็มพื้น ไม่มี alpha · หัวกว้างราว 52% อยู่ในวงกลมเขตปลอดภัยรัศมี 40% | manifest `purpose: "maskable"` |

สร้างใหม่: `node docs/design/tools/app-icon.mjs` (ใช้ sharp ของ repo) · ตรวจแล้วว่าตัวมัสเกเบิลพอดีวงกลมและมุมมนเมื่อครอปวงกลม

### 2.1 ค่าสำหรับ `manifest` (frontend ทำ `src/app/manifest.ts` หรือไฟล์ static)
```json
{
  "name": "แมวเจอกัน",
  "short_name": "แมวเจอกัน",
  "description": "นัดเพื่อนให้ง่าย รู้ว่าวันไหนทุกคนว่าง · Find a day your friends are all free",
  "lang": "th",
  "id": "/",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#FAF8F5",
  "theme_color": "#FAF8F5",
  "icons": [
    { "src": "/brand/app/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/brand/app/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/brand/app/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```
- `theme_color` / `background_color` = `--bg` ธีมสว่าง `#FAF8F5` (= `THEME_COLOR.light` ใน `src/styles/tokens.meta.ts` — manifest รองรับค่าเดียว ไม่แยกธีม) · ธีมมืดใช้ `<meta name="theme-color">` สองตัวตามสื่อ (`THEME_COLOR.dark` = `#17161C`) ที่ `viewport.themeColor` ของ layout มีอยู่แล้ว ซึ่งเบราว์เซอร์ใช้แทนค่าใน manifest
- แยก `any` กับ `maskable` เป็นสองรายการ ห้ามรวม `"any maskable"` (พื้นมุมมนของ `any` จะโดนครอปซ้ำ)
- **ชื่อ:** manifest เป็นภาษาไทยค่าเดียว (`แมวเจอกัน`, 9 ตัวอักษร พอดีใต้ไอคอน iOS) · `apple-mobile-web-app-title` (Next: `metadata.appleWebApp.title`) ให้ใช้ `brand.appName` ตามภาษาผู้ใช้ (th "แมวเจอกัน" / en "maewmeet") ถ้าทำได้ง่าย เพราะ iOS อ่านชื่อนี้ตอนเพิ่มไอคอน
- metadata: `icons.apple = { url: "/brand/app/apple-touch-icon.png", sizes: "180x180" }` · `appleWebApp: { capable: true, title, statusBarStyle: "default" }`

### 2.2 แถบสถานะ iOS (standalone) กับธีมสว่าง/มืด — คำแนะนำ: `default`
| ค่า | ผล | ประเมิน |
|---|---|---|
| **`default`** | เนื้อหาเริ่มใต้แถบสถานะ แถบสีระบบ (สว่าง = ขาวตัวดำ, มืด = ดำตัวขาว ตามการตั้งค่าเครื่อง) | **แนะนำ** อ่านออกทั้งสองธีม ไม่ต้องกันที่ด้านบนเพิ่ม |
| `black-translucent` | เนื้อหาไหลใต้แถบ ตัวอักษรแถบสีขาวเสมอ | ไม่เอา: ตัวขาวบน `--bg` สว่างอ่านไม่ออก ตอนธีมสว่าง |
| `black` | แถบดำทึบ | ไม่เอา: ขัดกับธีมสว่าง |

ข้อสังเกตให้ boss เทียบตอนทดสอบ T3: ถ้า "ธีมแอป" ไม่ตรงกับ "โหมดเครื่อง" (เช่นแอปมืด เครื่องสว่าง) แถบสถานะจะเป็นขาวเหนือหน้าจอมืดแคบๆ ยอมรับได้ · safe area: ล่างใช้ `env(safe-area-inset-bottom)` อยู่แล้วที่แถบนำทาง (`globals.css`) ด้านบนใส่ `padding-top: env(safe-area-inset-top)` ให้หัวหน้าไว้เผื่อ (เป็น 0 ในแบบ `default`)

### 2.3 ที่ต้องแจ้งผู้ใช้ (ให้ secretary ใส่ใน quickstart)
- iPhone: Safari → ปุ่มแชร์ → "เพิ่มไปยังหน้าจอโฮม" → ชื่อ "แมวเจอกัน" → เพิ่ม · Android (Chrome): ⋮ → "ติดตั้งแอป" หรือ "เพิ่มลงในหน้าจอหลัก"
- **ครั้งแรกที่เปิดจากไอคอน อาจต้องเข้าสู่ระบบอีกครั้ง** — หน้าจอโฮมบน iPhone แยกที่เก็บคุกกี้จาก Safari (ไม่ใช่บั๊ก) · ลิงก์ภายนอก (Google Maps, LINE, Google Calendar) เปิดในหน้าต่างเบราว์เซอร์ของระบบแล้วกลับแอปได้

---

## 3. "เว้นบางวัน" ของแบบประจำ (§1.1)

คีย์ `busy.routine.skip.*` · ภาพ `skip*`, `card*` · ยึดแบบเดียวกับ R14_BUSY_ROUTINE: bottom sheet, ปุ่ม ≥ 44px, error ไม่ล้างค่าที่เลือก, ทุก error บอกว่า "ยังไม่มีอะไรเปลี่ยน"

### 3.1 ปุ่มบนการ์ด (รายการ "แบบประจำของฉัน")
```
┌────────────────────────────────────────┐
│ ทำงาน                               >  │  แตะแถว = แก้ (เดิม)
│ จ.–ศ. · 09:00–18:00                    │
│ 16 พ.ย. – 13 ธ.ค. · เหลืออีก 18 วัน    │  จำนวนที่เหลือ "ไม่นับวันที่เว้น"
│ [📅✕ เว้นไว้ 2 วัน]                    │  ชิปข้อความ (ซ่อนเมื่อ 0)
│        [ 📅✕ เว้นบางวัน ]  [🗑]         │  แถว .rt-actions
└────────────────────────────────────────┘
```
- ปุ่ม "เว้นบางวัน" (`skip.button`, ไอคอน `calendar-x`) เป็นปุ่มรอง ≥ 44px อยู่ใน `.rt-actions` ก่อนถังขยะ · aria `skip.buttonAria` {title}
- แสดงเมื่อชุดยังไม่จบ **หรือ** มีวันเว้นที่ยังไม่ผ่านให้คืน · ชุดที่จบแล้วและไม่มีวันเว้นค้าง: ไม่แสดง (ปุ่ม "ต่ออายุ" เดิมแทน)
- ชิป `skip.chip` "เว้นไว้ N วัน" (ข้อความ + ไอคอน ไม่พึ่งสี) บอกจำนวนวันเว้นที่ **ยังไม่ผ่าน** เท่านั้น
- `mine.remaining` ("เหลืออีก N วัน") ต้องนับเฉพาะวันที่ยังไม่ผ่านและไม่ถูกเว้น (frontend คำนวณจาก `expandRoutine` + รายการเว้น)

### 3.2 แผ่น "เว้นบางวัน" (ภาพ `skip`)
```
เว้นบางวัน                                 [x]
แตะวันที่อยากเว้น เลือกได้หลายวัน แล้วกดยืนยันครั้งเดียว
[ เว้นวัน | วันที่เว้นไว้ (2) ]     ← แท็บ แสดงเมื่อมีวันเว้นค้าง ≥ 1
 <   พฤศจิกายน 2569   >
 จ  อ  พ  พฤ  ศ  ส  อา
[16][17][18✓][19✓][20] 21  22
[23][24̶][25̶][26][27]  28  29
[30]
 ☐ วันของชุดนี้  ☑ เลือกแล้ว  ▨ เว้นไว้แล้ว       ← คำอธิบายสัญลักษณ์
 เลือกแล้ว 2 วัน                                  ← role=status
 วันที่เว้นจะหายจากปฏิทินเพื่อนทุกกลุ่มทันที ...
─────────────────────────────────────────────
[ล้างที่เลือก]  [        เว้น 2 วัน        ]
```
- **ปฏิทินเล็ก:** 7 คอลัมน์ เริ่มจันทร์ (เหมือน `MonthGrid`) ช่อง ≥ 44×44px (375: ช่องละ ~45px) · แสดง **ตั้งแต่สัปดาห์แรกที่ยังมีวันของชุดที่ยังไม่ผ่าน** ถึงสัปดาห์สุดท้ายของเดือนนั้น (ไม่แสดงสัปดาห์ที่ผ่านไปแล้ว) · เดือนก่อน/ถัดไปด้วยปุ่ม ‹ › 44px (`calendar.prev/next`) ปิดที่เดือนแรก/สุดท้ายของชุด (`aria-disabled`) · การเลือกคงอยู่ข้ามเดือน · ชื่อเดือนเป็น `aria-live="polite"`
- **สถานะของช่อง** (ไม่พึ่งสีอย่างเดียว):
  | ช่อง | ลักษณะ | พฤติกรรม |
  |---|---|---|
  | วันของชุด ยังไม่เลือก | กรอบ `--line-control` พื้น `--surface` | กดเลือกได้ (`aria-pressed=false`) |
  | เลือกแล้ว | พื้น `--accent-soft` กรอบ 2px `--accent-ink` + **เครื่องหมายถูก** ใต้ตัวเลข | กดอีกครั้งเพื่อเลิกเลือก |
  | เว้นไว้แล้ว (แท็บ "เว้นวัน") | ลายเฉียง `--hatch` บน `--surface-2` + **ขีดฆ่าตัวเลข** | กดไม่ได้ (`aria-disabled`) แต่ยังโฟกัส/อ่านได้ ("เว้นไว้แล้ว") |
  | วันนอกชุด/ก่อนวันนี้ | ตัวเลข `--ink-muted` ไม่มีกรอบ | ไม่ใช่ปุ่ม (`aria-hidden`) |
  วันนี้นับว่ายังไม่ผ่าน (เว้นได้) · เซิร์ฟเวอร์เป็นผู้ตัดสินว่า "ผ่านแล้ว" ตามวันท้องถิ่นของแอป (Asia/Bangkok)
- **ชื่อช่องสำหรับ screen reader:** `skip.day.aria` "{date}, เลือกไว้ / เว้นไว้แล้ว" + `aria-pressed` · กลุ่มของตารางมี `aria-label` `skip.calendar.aria` {month}
- **แท็บ "วันที่เว้นไว้ (N)"** (ย้อนกลับ/เอาวันกลับ): ตารางเดิม แต่เฉพาะวันที่เว้นไว้และยังไม่ผ่านกดได้ (ลายเฉียง; เลือกแล้ว = พื้น accent-soft + กรอบ 2px + เครื่องหมายถูก) วันอื่นเป็น `is-locked` · ปุ่มยืนยัน "เอากลับ N วัน" (`skip.confirmRestore`) · แท็บนี้ซ่อนเมื่อไม่มีวันเว้นค้าง
- **เพดาน 31 วันต่อคำขอ:** เลือกครบ 31 → ช่องที่ยังไม่เลือกกลายเป็น `is-locked` (`aria-disabled`) + แถบเหลือง `skip.limit` ("เลือกได้ครั้งละไม่เกิน 31 วัน") แทนที่จะปล่อยให้กดแล้วค่อยพัง · ถ้ายังเหลือวันเว้นอีก ทำอีกรอบหลังยืนยันได้ · เซิร์ฟเวอร์ตอบ `LIMIT_REACHED skipDays` → ข้อความกลาง `errors.LIMIT_REACHED` (เพิ่มชนิด `skipDays` แล้ว)
- **ปุ่มล่าง (sticky):** ซ้าย "ล้างที่เลือก" (`skip.clear` ปุ่มลิงก์ ≥ 44px) · ขวาปุ่มหลักเต็มที่เหลือ **"เว้น N วัน"** (`skip.confirm` ตัวเลขตามที่เลือก) · เลือก 0 วัน = `aria-disabled` ทั้งคู่ · ระหว่างบันทึก `skip.saving` + `aria-busy`
- **ยืนยันครั้งเดียว ไม่มี dialog ซ้อน** เพราะเอากลับได้ (แท็บ "วันที่เว้นไว้") — ต่างจากลบทั้งชุดที่ย้อนไม่ได้ · ปุ่มระบุจำนวนวันอยู่แล้วจึงเป็นการยืนยันที่ชัด
- ข้อความอธิบาย (`skip.note`) อยู่เหนือปุ่มล่าง: เพื่อนเห็นทันที, ไม่กลับมาแม้แก้ทั้งชุด, เอากลับได้จนถึงวันนั้น

### 3.3 สถานะ
| สถานะ | แสดง |
|---|---|
| ปกติ / เลือกแล้ว | ตามข้างบน (ภาพ `skip`, `skip-none`, `skip-next`) |
| ไม่เหลือวันให้เว้น (ทุกวันถูกเว้นหมด หรือชุดจบระหว่างเปิดแผ่น) | แท็บยังอยู่ถ้ามีวันเว้น + แมว `sleep` + `skip.empty.title/body` · ไม่มีปุ่มล่าง (ภาพ `skip-empty`) |
| ชนเพดาน 31 | แถบ `skip.limit` + ช่องที่เหลือล็อก (ภาพ `skip-limit`) |
| กำลังบันทึก | ปุ่มหลัก `skip.saving` · ตาราง/ปิดแผ่นไม่ตอบสนอง |
| สำเร็จ | ปิดแผ่น · toast `skip.toast.skipped` {count} (หรือ `restored`) · ชิป/"เหลืออีก N วัน" บนการ์ดเปลี่ยน · โฟกัสกลับปุ่ม "เว้นบางวัน" · **ไม่มีปุ่ม "เลิกทำ" ใน toast** (toast ปัจจุบันไม่มี action) ย้อนกลับทำที่แท็บ "วันที่เว้นไว้" |
| ล้มเหลวทั่วไป/เครือข่าย | alert เหนือปุ่มล่าง `skip.error.generic` ค่าที่เลือกยังอยู่ |
| วันที่เลือกผ่านไปแล้ว/ไม่อยู่ในชุด (VALIDATION) | `skip.error.stale` (ให้ปิดแล้วเปิดใหม่ → โหลดรายการใหม่) |
| NOT_FOUND (ชุดถูกลบจากเครื่องอื่น) | ข้อความเดิม `busy.routine.error.gone` + รีเฟรชรายการ ปิดแผ่น |
| RATE_LIMITED | `skip.error.rate` (ไม่ใช้ `busy.routine.error.rate` เพราะข้อความนั้นพูดถึง "ไม่มีวันที่ถูกเพิ่ม") |

### 3.4 สัญญากับ platform/frontend
- API: คำขอเดียวเว้นหรือคืนหลายวัน (≤ 31 `DateISO`, ทำอย่างใดอย่างหนึ่งต่อคำขอ) — ชื่อ/รูปแบบ platform กำหนด · UI ต้องการให้ตอบ: จำนวนที่เปลี่ยนจริง (`count` ใน toast) และ `NOT_FOUND`/`VALIDATION`/`LIMIT_REACHED skipDays`/`RATE_LIMITED` แยกกัน
- `GET /api/me/busy-routines` ต้องส่งรายการวันที่เว้นที่ยังไม่ผ่าน (`skippedDates`) ต่อชุด เพื่อวาดแท็บ/ชิป/จำนวนที่เหลือโดยไม่ยิงเพิ่ม · วันของชุดคำนวณฝั่ง client ด้วย `src/lib/calendar` (`expandRoutine`) ห้ามใช้ `new Date()` เอง
- เว้นแล้ว "หายจากปฏิทินทุกกลุ่ม" ทันที (ใช้ `busy_routine_skip` เดิม) — ไม่ใช่เรื่องของ UI แต่ต้องรีเฟรชปฏิทินที่เปิดค้าง

---

## 4. ปรับหน้าจอเล็กน้อย (§1.4)

### 4.1 ฟอร์มแบบประจำ: แถบล่างที่ 375 (qa-r14b)
- **ย้าย `busy.routine.visibilityHide` เข้าเนื้อฟอร์ม** วางเป็น `field-hint` (class `rt-hide-hint` มีอยู่แล้ว) **ใต้สวิตช์ "ซ่อนว่าทำอะไร"** (ข้อความเดิม ไม่ต้องแก้) — มันอธิบายสวิตช์นั้นโดยตรงจึงอยู่ถูกที่
- แถบล่าง (sticky) เหลือ: ประกาศ D5 หนึ่งบรรทัด `busy.routine.visibility` + `busy.form.visibilityGroups` (ห่อได้ไม่เกิน 2 บรรทัดที่ 375) + ปุ่มบันทึก · เป้าหมาย: ข้อความในแถบ ≤ 2 บรรทัด + ปุ่ม 44px ไม่ให้แถบกินเกินราว 1/4 ของจอ 375×667

### 4.2 แถบขั้นตอน: ขั้น 3 ไม่ค้าง "ถัดไป" (R8 qa L4)
**สัญญาณ:** ขั้น 3 "ดูวันที่ว่างตรงกัน" นับว่าเสร็จเมื่อผู้ใช้ **เปิดแท็บ "ว่างตรงกัน" ของกลุ่มนั้นและเนื้อหาแสดงสำเร็จ** (ไม่ใช่แค่กดลิงก์ หรือหน้ายังโหลด/พัง)

**สถานะที่เก็บ (ฝั่ง client ล้วน):** `localStorage["mm:free-seen:v1:<userId>:<groupId>"] = "1"` — เขียนตอนมุมมอง `v=free` ของกลุ่มนั้น render ข้อมูลสำเร็จ · อ่านด้วย `useSyncExternalStore` (server snapshot = ยังไม่เห็น เหมือน `intro-flag.ts`) · ฟัง `storage` event ให้แท็บอื่นอัปเดต
**เหตุผลที่ไม่เก็บที่เซิร์ฟเวอร์:** (1) เป็นคำใบ้ onboarding ไม่ใช่ข้อมูลที่ใครต้องเห็น ไม่มีค่าทางธุรกิจ (2) ไม่ต้องมี schema/endpoint/สิทธิ์ใหม่ — migration 0006 แก้ย้อนไม่ได้อยู่แล้ว (ลบตาราง) ไม่ควรเติมเรื่องเล็ก (3) ไม่ติดตามพฤติกรรมผู้ใช้ลงฐาน (PDPA) (4) ผลเสียเมื่อพลาดแค่ขั้นนั้นขึ้น "ถัดไป" อีกครั้งบนเครื่องใหม่ ซึ่งแก้ด้วยกฎด้านล่าง

**กฎคำนวณ** (`computeSteps` เพิ่ม `freeSeen: boolean`):
- `free` เสร็จ = `freeSeen` **หรือ** ขั้น `plan` เสร็จ (กลุ่มที่มีนัดแล้วย่อมหาวันได้แล้ว — กันเครื่องใหม่/ล้างข้อมูลแล้วขั้นเก่ากลับมา)
- `allDone` = ครบทั้ง 4 ขั้น (เดิมไม่นับขั้น 3) · `doneCount` นับขั้น 3 ด้วย
- "ถัดไป" = ขั้นแรกที่ยังไม่เสร็จตามลำดับ 1→4 · เสร็จแล้วปุ่มในขั้น 3 เปลี่ยนเป็นลิงก์รอง `group.steps.free.ctaDone` "ดูอีกครั้ง" (ไม่ใช่ปุ่มหลัก) และป้าย `group.steps.done` · ชื่อ/เนื้อหาเดิม
- SSR แสดงตามสถานะ "ยังไม่เห็น" แล้วอัปเดตหลัง hydrate (ไม่เกินหนึ่งเฟรช) ไม่ประกาศผ่าน aria-live
- เทสต์ R8 ที่ล็อก "ขั้น 3 ไม่เสร็จเสมอ" ต้องปรับ (test)

### 4.3 ปุ่ม Apple/Google Maps กว้างเท่ากันที่ 768
สาเหตุ: ที่ ≥ 48em `.map-app { flex: 0 1 auto; min-width: calc(var(--tap-lg) * 3) }` → ความกว้างตามข้อความ (Apple Maps กับ Google Maps ต่างกัน; ปุ่มค้นหาใน Apple Maps ยาวกว่า) · แก้ใน `src/styles/appointments.css` (frontend):
```css
@media (min-width: 48em) {
  .map-apps { display: grid; grid-template-columns: repeat(2, minmax(calc(var(--tap-lg) * 3), 14rem)); justify-content: start; }
  .map-apps .map-app, .map-apps.is-find .map-app { width: 100%; min-width: 0; flex: none; }
  .map-apps:has(> .map-app:only-child) { grid-template-columns: minmax(calc(var(--tap-lg) * 3), 14rem); }
}
```
(375/390 ยังคงเดิม: ปุ่มคู่ในฟอร์มแบ่งครึ่งแถว, ปุ่ม "ค้นหาใน…" ในการ์ดรายละเอียดเต็มความกว้างเรียงลง) · ปุ่มเดียว (เครื่องไม่ใช่ Apple) ไม่ยืดเต็มจอ · ภาพ `appt-detail-nocoords-768-th-light.png` แสดงปัญหานี้ (ปุ่มกว้างไม่เท่ากัน) ไว้เป็นภาพ "ก่อนแก้" — ตัวอย่างอ้างอิง CSS ปัจจุบันของ repo

### 4.4 EN "Certain hours" ตัดบรรทัดที่ 375
`busy.form.scope.daily` EN "Certain hours" → **"Set hours"** (9 ตัวอักษร จาก 13) · สาเหตุจริงอีกข้อ: ตัวเลือกเป็น `.segmented.busy-types` ซึ่งเป็นกริด 3 คอลัมน์โดยปริยายแต่มีแค่ 2 ปุ่ม จึงได้ช่องละ ~1/3 ของแถว (~105px ที่ 375) — **แนะนำ frontend เติมคลาส `cols-2`** (`.segmented.cols-2` มีอยู่แล้วใน globals.css) ที่ `BusyFormSheet.tsx` แถวเวลาในแต่ละวัน ให้ได้ช่องละครึ่งแถว (~165px) · TH "เฉพาะช่วงเวลา" คงเดิม · ข้อความช่วย `scope.help.daily` ยังอธิบายความหมายเต็ม

### 4.5 ป้ายชุด (series tag) สำหรับ screen reader
ปัญหา: `<span aria-label=…>` บนองค์ประกอบ generic ไม่มี role → `aria-label` ถูกละเว้น (ARIA) · แก้ใน `MineList.tsx` (frontend) **อย่าใช้ aria-label บน span**: ให้ข้อความที่เห็นเป็น `aria-hidden` และเพิ่มข้อความ `sr-only` ที่ขึ้นต้นด้วยคำเดียวกับที่เห็น
```tsx
<span className="tag tag-muted" data-testid="busy-series-tag">
  <Icon .../>
  <span aria-hidden="true">{t("busy.series.tag")}</span>
  <span className="sr-only">{t("busy.series.tagAria")}</span>
</span>
```
ปรับค่า `busy.series.tagAria` และ `busy.routine.calendar.tagAria` แล้วให้ขึ้นต้นด้วยข้อความที่เห็น (WCAG 2.5.3 label in name): TH "ชุดรายวัน: วันนี้เป็นหนึ่งในชุดไม่ว่างรายวัน", EN "In a series: this day is one of a daily busy series"; ประจำ: TH "ประจำ: วันนี้มาจากแบบประจำ", EN "Routine: this day comes from a routine" · ใช้รูปแบบเดียวกันกับป้าย "ประจำ" (`rt-tag` ใน `BusyItemLine.tsx` ซึ่งตอนนี้ก็เป็น `<span aria-label>` เช่นกัน) · ผลต่อเทสต์: `tests/e2e/r14b-busy-routine.spec.ts:228` ตรวจ `aria-label` ของ `routine-tag` ต้องเปลี่ยนเป็นตรวจข้อความ sr-only (test) · `r6f-daily-busy.spec.ts` ที่ตรวจ `toContainText(busy.series.tag)` ยังผ่านเพราะข้อความที่เห็นยังอยู่ใน DOM

### 4.6 `/privacy` (B4)
เพิ่มคีย์ `privacy.see.busyStatus` · แทรก **หลัง `see.members`** (ลำดับ items: `owner, members, busyStatus, note, outsiders, groups, superAdmin`) — แก้ `src/app/privacy/page.tsx` (frontend; นอกขอบเขต ux) · อัปเดต `privacy.updated` เป็น 15 พ.ย. 2569 / 15 Nov 2026 แล้ว
- TH: "สมาชิกในกลุ่มเห็นด้วยว่าคุณลงวันไม่ว่างใน 30 วันข้างหน้าแล้วหรือยัง ถ้ายังไม่ได้ลง จะมีป้าย “ยังไม่ได้ลงวันไม่ว่าง” ข้างชื่อคุณ ส่วนรายละเอียดของแต่ละรายการเป็นไปตามข้อด้านบน"
- EN: "People in a group with you can see whether you’ve added busy time for the next 30 days. If you haven’t, a “No busy days yet” tag shows next to your name. What each entry shows follows the rules above."
- ตรงกับของจริง: ป้าย `group.members.noBusyBadge` ("ยังไม่ได้ลงวันไม่ว่าง" / "No busy days yet") ในรายชื่อสมาชิก

### 4.7 ป้ายกลาง super admin (B7 — ใช้ใน R15b)
`common.systemAdmin` = "ผู้ดูแลระบบ" / "System admin" · ใช้แทนชื่อผู้ใช้ในกระดิ่งและข้อความ LINE ของกลุ่ม เมื่อผู้กระทำเป็น super admin ที่ไม่ได้เป็นสมาชิกกลุ่ม (เช่น ยกเลิกนัด/นำสมาชิกออก) — ผู้ส่ง `actorName` ให้เป็นค่านี้ตามภาษาของผู้รับ (คีย์ `common.*` อ่านได้ทุกที่; platform เลือกภาษาผู้รับจาก `user.locale`)

### 4.8 ตัวอย่างดีไซน์เก่า (R13)
อัปเดต `docs/design/samples/appt-detail.html`, `appt-form.html` และ `tools/templates/appt-form.html` (+ `templates/appt-detail.html`, `tools/build-appointments.mjs`, `tools/shoot.mjs`) ให้ตรง R13: ไม่มีค้นหา/ชิป "เลือกแล้ว"/แผนที่ OSM · ฟอร์ม = ชื่อ + ช่องลิงก์ + ปุ่ม Apple/Google Maps (สถานะ `place-name`, `place-link`, `place-link-error`, `place-coords-error`, `place-long`) · รายละเอียด = การ์ดสถานที่ชื่อ + ปุ่มตามกรณี (`nolink` มีลิงก์, `coords-only` พิกัดเก่า, `nocoords` มีแต่ชื่อ → Apple + Google, `noplace`) · ลบสถานะ `map-failed`/`map-loading` · ระหว่างนี้แก้ตัวสร้างที่พังอยู่ก่อนแล้ว (`home.row.aria` ขาด `countdown`, `notifications.appointment.cancelled` ขาด `actorName`) ให้ `build-samples.mjs` ทำงานครบและไม่เหลือไอคอน/ข้อความที่หาไม่เจอ · เก็บเฉพาะ `appt-detail`/`appt-form` ที่สร้างใหม่ (ไฟล์ตัวอย่างอื่นไม่แตะ)

---

## 5. คีย์ข้อความใหม่/ที่แก้ (th + en ครบ · `tests/i18n` ผ่าน)

| กลุ่ม | คีย์ |
|---|---|
| ไอคอนกลุ่ม | `groupIcon.aria` · `groupIcon.names.<24 key>` · `groupSettings.icon.{title,body,current,currentDefault,change,changeAria,viewOnly}` · `groupSettings.icon.picker.{title,hint,listAria,selected,save,saving,unchanged}` · `groupSettings.icon.toast.saved` · `groupSettings.icon.error.{generic,forbidden}` |
| เว้นบางวัน | `busy.routine.skip.{button,buttonAria,chip,chipAria,title,lead,note,restoreCalendarAria,count,limit,clear,confirm,confirmRestore,saving}` · `skip.mode.{label,skip,restore}` · `skip.calendar.{aria,prev,next}` · `skip.day.aria` · `skip.legend.{available,selected,skipped}` · `skip.empty.{title,body}` · `skip.toast.{skipped,restored}` · `skip.error.{generic,stale,rate}` · `errors.LIMIT_REACHED` เพิ่มชนิด `skipDays` |
| ขั้น 3 | `group.steps.free.ctaDone` |
| privacy | `privacy.see.busyStatus` · `privacy.updated` (ค่าใหม่) |
| กลาง | `common.systemAdmin` |
| แก้ค่า | `busy.form.scope.daily` (EN "Set hours") · `busy.series.tagAria` · `busy.routine.calendar.tagAria` (ขึ้นต้นด้วยข้อความที่เห็น) |

`groupSettings.icon.picker.selected` ("เลือกอยู่") ใช้เป็นข้อความ sr-only/เสริมได้ถ้า frontend ต้องการประกาศสถานะนอกเหนือ `aria-checked` · ข้อความเว้นวันบอก "ยังไม่มีอะไรเปลี่ยน" ทุกกรณีล้มเหลว (ตามกติกา R14)

---

## 6. เช็กลิสต์ (PROCESS.md)
- ภาพหน้าจอ 375/390/768 · TH/EN · สว่าง/มืด: `docs/design/screenshots/r15a/` (ตัวเลือกไอคอน, เว้นบางวัน, ตั้งค่ากลุ่ม, จุดแสดงไอคอน, การ์ดแบบประจำ, ไอคอนแอป) + ภาพตัวอย่าง R13 ที่อัปเดต (`appt-detail-*`, `appt-form-*`, `place-field-375-en-light.png`)
- เป้าแตะ ≥ 44px: วัดจาก DOM จริงของตัวอย่างทุกสถานะ ไม่พบเป้าที่เล็กกว่า 44px · ไม่มีการล้นแนวนอนที่ 375/390/768
- คอนทราสต์: `npm run contrast` ไม่ผ่าน 0 คู่ (เพิ่ม 7 คู่ R15 ไม่มีสีใหม่)

## 7. CSS อ้างอิงสำหรับ frontend
ต้นแบบ CSS ครบ (ค่าจาก tokens ล้วน) อยู่ในค่าคงที่ `CSS` ของ `docs/design/tools/build-r15.mjs` — คลาส `.gi`, `.gi-glyph`, `.gi-grid`, `.gi-opt`, `.gi-check` (ไอคอนกลุ่ม) และ `.sk-*` (เว้นบางวัน; ช่องวันใช้รูปแบบเดียวกับ `.rt-day` ที่มีอยู่) · ย้ายไป `src/styles/` ตามเจ้าของไฟล์ (frontend) · ไม่ต้องเพิ่ม token ใหม่
