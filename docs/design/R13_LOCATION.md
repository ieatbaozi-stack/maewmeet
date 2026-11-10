# R13 — สถานที่แบบวางลิงก์ (โน้ตดีไซน์)

ผู้เขียน: ux · ที่มา: R13_CONTRACT §1.1, §1.2, §1.4, §1.5 · ใช้ token เดิมทั้งหมด (สว่าง/มืด) ไม่เพิ่มสี · ข้อความทุกอย่างผ่าน `messages/*.json`

## 1. ฟอร์มนัด: ลำดับองค์ประกอบ (บนลงล่าง)
```
สถานที่ (ไม่บังคับ)                 places.label + appointments.form.optional
[ ชื่อสถานที่ ...............  ]    places.name.placeholder
ชื่อที่เพื่อนจะเห็นในนัด    12/120   places.name.hint + ตัวนับ
ลิงก์แผนที่ (ไม่บังคับ)             places.link.label
[ วางลิงก์ https://… หรือพิกัด ]   places.link.placeholder
เปิดแอปแผนที่ ค้นหาที่นั่น กด ...   places.link.hint (ใต้ช่อง ผูก aria-describedby)
เปิดแผนที่เพื่อหาที่               places.apps.lead
[ Apple Maps ] [ Google Maps ]     places.apps.* (กลุ่ม role=group, aria-label=groupAria)
(ข้อผิดพลาดลิงก์ผิด: errors.INVALID_MAP_URL เดิม แสดงใต้ช่องลิงก์ เหนือคำแนะนำ)
```
- ชื่อและลิงก์เห็นทันที ไม่มีปุ่มค้นหา ไม่มีชิป "เลือกแล้ว" · สองช่องแก้อิสระ
- ปุ่มแผนที่อยู่ท้ายสุด เพราะผู้ใช้ทำตามลำดับ: พิมพ์ชื่อ → กดปุ่มเปิดแผนที่ → คัดลอกลิงก์ → กลับมาวาง · ถ้าชื่อว่างปุ่มยังกดได้ (เปิดหน้าแรกของแผนที่) ใช้ aria `*AriaBlank`
- iPhone/iPad/Mac: Apple Maps ก่อน แล้ว Google Maps · เครื่องอื่นและตอน SSR: Google Maps ปุ่มเดียว (เพิ่ม Apple หลัง hydrate)

## 2. ขนาดและจัดวาง
| จอ | จัดวาง |
|---|---|
| 375 | ช่องกว้างเต็มแถว · ปุ่มแผนที่ 2 ปุ่มแบ่งครึ่งแถว (`flex:1 1 0`, gap 8) สูง >= 44px · ข้อความปุ่มไม่ตัดบรรทัด (`white-space:nowrap`; “Apple Maps” 10 ตัวอักษร พอดีครึ่งแถว) ปุ่มเดียว (Android) กว้างเต็มแถว |
| 390 | เหมือน 375 |
| 768 | คอลัมน์ฟอร์มกว้างสูงสุดเดิม · ปุ่มแผนที่ไม่ยืดเต็มจอ: `flex:0 1 auto` + `min-width:160px` ชิดซ้าย |

- ปุ่ม/ช่อง/ลิงก์ทุกชิ้น สูง >= 44px · เป็นปุ่มรอง (outline, ขอบ `--line-control`) ไม่แย่งกับปุ่มบันทึก · ไอคอนหมุดเส้นเรียบ 20px ซ้ายข้อความ (aria-hidden) ถ้ามี
- สว่าง/มืด: ใช้ `--ink`, `--surface`, `--line-control`, `--ink-muted` (คำแนะนำ 13px) เหมือน R12 · ห้ามใช้สีตายตัว · focus ring เดิม
- คำแนะนำใต้ช่องไม่ซ่อนใน tooltip

## 3. การ์ดสถานที่ในหน้ารายละเอียด (§1.2) — ไม่มีภาพแผนที่
ชื่อสถานที่ (หรือ `places.selected.defaultName`) เป็นหัวการ์ด แล้วปุ่มเดียวตามกรณี (เลือกจากบนลงล่าง):
| กรณี | ข้อความย่อยใต้ชื่อ | ปุ่ม |
|---|---|---|
| มีลิงก์ https | `places.selected.linkOnly` {host} | `places.openLink` {host} · aria `openLinkAria` |
| มีแต่พิกัด (นัดเก่า) | `places.selected.coords` | `places.open` (geo:) · aria `openAria` |
| มีแต่ชื่อ | ไม่มี | `places.find.google` (+ `places.find.apple` บน iPhone/iPad/Mac) · aria `find.googleAria` / `find.appleAria` {name} |

### แก้ปุ่มตัดสองบรรทัด/ข้อความชิดขอบที่ 375 (backlog qa R12.1)
สาเหตุที่น่าจะเป็น: ข้อความ `เปิดลิงก์แผนที่ (host)` ยาวกว่าปุ่ม และปุ่มไม่มี padding ซ้ายขวาเมื่อข้อความขึ้นบรรทัดใหม่ · วิธีแก้ที่เสนอ frontend:
1. ปุ่มกว้างเต็มการ์ด (`width:100%`) padding แนวนอน >= 16px · `min-height:44px`
2. ข้อความปุ่ม `display:flex; align-items:center; justify-content:center; gap:8px; text-align:center`
3. ส่วน host ตัดด้วย `overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0` ในกล่อง `<span>` ของมันเอง ไม่ให้ดันทั้งปุ่มขึ้นสองบรรทัด · ไอคอนไม่หด (`flex:none`)
4. ปุ่มคู่ (Google/Apple): `flex-wrap:wrap` ที่ 375 ให้ปุ่มที่สองลงบรรทัดใหม่แทนการบีบ ไม่ให้ตัดกลางข้อความ
- ตรวจ 375/390/768 สว่าง/มืด ไม่มีข้อความชิดขอบหรือล้น

## 4. ป้ายในปฏิทิน (§1.4)
- `appointments.calendar.labelMap` = "แผนที่" / "Map" · `labelPlan` = "ดูนัดในแมวเจอกัน" / "See the plan in maewmeet"
- **คีย์เก็บแค่ป้าย ไม่มีเครื่องหมายโคลอน** · platform ต่อ `": "` เอง: `${labelMap}: ${mapUrl}` และ `${labelPlan}: ${planUrl}` (ภาษาไทยใช้ ": " ตามด้วยเว้นวรรคเดียวกัน)
- EN ใช้ชื่อแอปเป็นข้อความตายตัว "maewmeet" ตรงกับ `brand.appName` (en) · TH ใช้ "แมวเจอกัน" ตรงกับ `brand.appName` (th) · ถ้าเปลี่ยนชื่อแบรนด์ต้องแก้สองคีย์นี้ด้วย

## 5. `/privacy` (§1.5)
- ส่วน `privacy.places` เปลี่ยนชื่อหัวเป็น "สถานที่และแผนที่ / Places and maps" และมีข้อความใหม่ `privacy.places.links` (Google/Apple ส่งชื่อเมื่อกดเท่านั้น)
- `privacy.calendar.body` แก้ให้ตรง §1.4 (ลิงก์แผนที่ใน URL/Location, ป้ายใน Details) · `privacy.collect.groups` เพิ่ม "ลิงก์แผนที่" · `privacy.updated` = 11 พ.ย. 2569 / 11 Nov 2026
- **frontend ต้องแก้ `src/app/privacy/page.tsx` (นอกขอบเขต ux):** บรรทัด `{ key: "places", items: ["search", "tiles", "noTracking"] }` → `items: ["links", "noTracking"]` แล้วลบคีย์ `privacy.places.search` และ `privacy.places.tiles` (th+en) ตอนเดียวกัน · `tests/e2e/privacy.spec.ts` ไม่มีข้อความ OSM ที่ตรวจ (grep แล้ว)

## 6. คีย์ใหม่ทั้งหมด (th+en ครบ)
`places.name.hint` (เปลี่ยนค่า) · `places.link.{label,placeholder,hint}` · `places.apps.{lead,groupAria,google,apple,googleAria,googleAriaBlank,appleAria,appleAriaBlank}` · `places.find.{google,apple,googleAria,appleAria}` · `appointments.calendar.{labelMap,labelPlan}` · `privacy.places.links` · แก้ค่า: `privacy.places.title`, `privacy.calendar.body`, `privacy.collect.groups`, `privacy.updated`

## 7. คีย์ที่ลบแล้ว / ที่ frontend ต้องลบหลังแก้โค้ด
ลบแล้ว (grep ยืนยันไม่มีใครอ้าง): `places.name.hintCount`

**frontend ลบหลังเอาโค้ดที่อ้างออก** (ตอนนี้ยังอ้างอยู่ใน `PlaceField.tsx` / `PlaceMap.tsx` / `privacy/page.tsx` จึงยังลบไม่ได้):
- `places.search.*` ทั้งกลุ่ม (button, searching, aria, tooShort, results, count, pickAria, attribution, noResults.*, error, rateLimited, disabled)
- `places.paste.*` ทั้งกลุ่ม (ถูกแทนด้วย `places.link.*`)
- `places.selected.aria` · `places.clear` · `places.clearAria` (ชิป "เลือกแล้ว")
- `places.map.*` ทั้งกลุ่ม (region, loading, failed.*, attribution — ภาพแผนที่/OSM)
- `privacy.places.search` · `privacy.places.tiles`

**คงไว้ (ยังใช้):** `places.label`, `places.name.placeholder`, `places.selected.{coords,linkOnly,defaultName}`, `places.open`, `places.openAria`, `places.openLink`, `places.openLinkAria`

หมายเหตุ: ไม่มีเทสต์ที่ตรวจว่าคีย์ถูกใช้จริง (มีแต่ th/en ตรงกัน) · แนะนำ qa grep `places\.(search|paste|map|clear)|selected\.aria` ให้ว่างก่อนปิดรอบ (R13-6)
