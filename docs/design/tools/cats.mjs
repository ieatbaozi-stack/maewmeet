#!/usr/bin/env node
// สร้างชุดแมว maewmeet จากชิ้นส่วนร่วมชุดเดียว (หัว/ตัว/หาง) เพื่อให้สัดส่วนคงที่ทั้งชุด
// ใช้: node docs/design/tools/cats.mjs   → เขียน public/brand/cats/*.svg
// สไตล์: เส้นเดียวหนาเท่ากัน (stroke 3 ใน viewBox 120) สี currentColor
//        ลงสีบางส่วนผ่าน CSS var: --cat-coat (ขน = พื้นผิว), --cat-fill (หู/แก้ม/ของ), --cat-fill-2 (ของที่ถือ)
//        ค่า fallback ในวงเล็บ var() = ค่าธีมสว่าง ใช้เมื่อเปิดเป็น <img> (ธีมมืดให้ฝัง inline เพื่อรับ var)
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const out = resolve(root, 'public/brand/cats');
mkdirSync(out, { recursive: true });

const COAT = 'fill="var(--cat-coat, #FFFFFF)"';
const F1 = 'fill="var(--cat-fill, #F4D9A8)"';
const F2 = 'fill="var(--cat-fill-2, #CFE8D8)"';
const NONE = 'fill="none"';
const INK = 'fill="currentColor" stroke="none"';

// ---- ชิ้นส่วนร่วม (พิกัดฐาน: หัวกลาง 60,44) ----
const headShape = 'M40 50 C38 40 39 30 42 19 L54 27 C58 26 62 26 66 27 L78 19 C81 30 82 40 80 50 C78 60 70 65 60 65 C50 65 42 60 40 50 Z';
const innerEars = `<path d="M44.5 25 L45.5 33 L51 28.5 Z" ${F1} stroke="none"/><path d="M75.5 25 L74.5 33 L69 28.5 Z" ${F1} stroke="none"/>`;
const cheeks = `<circle cx="46.5" cy="53.5" r="3.2" ${F1} stroke="none"/><circle cx="73.5" cy="53.5" r="3.2" ${F1} stroke="none"/>`;
const eyes = {
  open: `<circle cx="52" cy="46" r="2.3" ${INK}/><circle cx="68" cy="46" r="2.3" ${INK}/>`,
  happy: `<path d="M48.5 47 Q52 43.5 55.5 47" ${NONE}/><path d="M64.5 47 Q68 43.5 71.5 47" ${NONE}/>`,
  closed: `<path d="M48.5 45.5 Q52 48.5 55.5 45.5" ${NONE}/><path d="M64.5 45.5 Q68 48.5 71.5 45.5" ${NONE}/>`,
};
const mouth = `<path d="M58.3 51.5 L61.7 51.5 L60 53.3 Z" ${INK}/><path d="M60 53.5 Q58 56.5 55.8 55" ${NONE}/><path d="M60 53.5 Q62 56.5 64.2 55" ${NONE}/>`;
const head = (eye = 'open', t = '') =>
  `<g${t ? ` transform="${t}"` : ''}><path d="${headShape}" ${COAT}/>${innerEars}${cheeks}${eyes[eye]}${mouth}</g>`;

const tail = `<path d="M81 100 C95 102 102 92 98 81 C96 75 91 75 91 79" ${NONE}/>`;
const body = `<path d="M47 60 C40 70 36 86 38 100 C39 104 42 106 46 106 L74 106 C78 106 81 104 82 100 C84 86 80 70 73 60 Z" ${COAT}/>`;
const legs = `<path d="M53.5 88 C53.5 96 53.5 102 54.5 106" ${NONE}/><path d="M66.5 88 C66.5 96 66.5 102 65.5 106" ${NONE}/>`;
const sitBase = (eye) => tail + body + legs + head(eye);
// อุ้งมือจับของ (วงรีเล็ก) ใช้ซ้ำทุกท่าที่ถือของ
const paw = (x, y) => `<ellipse cx="${x}" cy="${y}" rx="4.2" ry="3.6" ${COAT}/>`;

const poses = {
  sit: { th: 'นั่ง', en: 'Sitting', use: 'หน้าว่างทั่วไป', svg: sitBase('open') },
  wave: {
    th: 'โบกมือ', en: 'Waving', use: 'หน้าเข้าสู่ระบบ / สมัครสำเร็จ',
    svg: sitBase('happy') +
      `<path d="M74 70 C82 64 86 56 87 48" ${NONE}/>${paw(87.5, 45)}` +
      `<path d="M95 40 L99 36" ${NONE}/><path d="M96.5 48 L101.5 47.5" ${NONE}/>`,
  },
  calendar: {
    th: 'ถือปฏิทิน', en: 'Holding a calendar', use: 'ปฏิทินกลุ่มยังไม่มีใครลงวันไม่ว่าง',
    svg: sitBase('open') +
      `<rect x="42" y="72" width="36" height="29" rx="3" ${F2}/>` +
      `<path d="M42 80 L78 80" ${NONE}/><path d="M51 68.5 L51 75" ${NONE}/><path d="M69 68.5 L69 75" ${NONE}/>` +
      `<circle cx="51" cy="87" r="1.6" ${INK}/><circle cx="60" cy="87" r="1.6" ${INK}/><circle cx="69" cy="87" r="1.6" ${INK}/>` +
      `<circle cx="51" cy="94" r="1.6" ${INK}/><path d="M57.5 94 L59.5 96 L63 92" ${NONE}/>` +
      paw(41, 89) + paw(79, 89),
  },
  map: {
    th: 'ถือแผนที่', en: 'Holding a map', use: 'นัดยังไม่ได้ใส่สถานที่',
    svg: sitBase('open') +
      `<path d="M36 76 L49 72 L61 77 L73 72 L85 76 L85 100 L73 96 L61 101 L49 96 L36 100 Z" ${F1}/>` +
      `<path d="M49 72 L49 96" ${NONE}/><path d="M61 77 L61 101" ${NONE}/><path d="M73 72 L73 96" ${NONE}/>` +
      `<path d="M41 92 C47 86 54 92 58 86 C62 80 68 88 72 84" ${NONE} stroke-dasharray="0.5 4.5"/>` +
      `<circle cx="78" cy="83" r="2.4" ${INK}/>` + paw(36, 88) + paw(85, 88),
  },
  tea: {
    th: 'ถือแก้วชา', en: 'Holding tea', use: 'ทุกคนว่าง ไม่มีนัด / พัก',
    svg: sitBase('closed') +
      `<path d="M56 74 C53.5 70 58 67.5 55.5 63.5" ${NONE}/><path d="M64 74 C61.5 70 66 67.5 63.5 63.5" ${NONE}/>` +
      `<path d="M70 83 C77 83 77 94 70 94" ${NONE}/>` +
      `<rect x="49" y="78" width="21" height="20" rx="3" ${F1}/>` + paw(48.5, 89) + paw(70.5, 91),
  },
  pin: {
    th: 'ถือหมุดสถานที่', en: 'Holding a pin', use: 'สร้างนัดสำเร็จ',
    svg: sitBase('happy') +
      `<path d="M74 70 C80 64 84 60 86 56" ${NONE}/>` +
      `<path d="M87 55 C81 47 78.5 42.5 78.5 38.5 A8.5 8.5 0 0 1 95.5 38.5 C95.5 42.5 93 47 87 55 Z" ${F2}/>` +
      `<circle cx="87" cy="38.5" r="3" ${COAT}/>` + paw(85.5, 57.5),
  },
  cheer: {
    th: 'ชูสองมือ', en: 'Cheering', use: 'ทุกคนว่างตรงกัน / ทุกคนตอบรับนัด',
    svg: sitBase('happy') +
      `<path d="M74 70 C82 64 86 56 87 48" ${NONE}/>${paw(87.5, 45)}` +
      `<path d="M46 70 C38 64 34 56 33 48" ${NONE}/>${paw(32.5, 45)}` +
      `<path d="M24 34 L20 30" ${NONE}/><path d="M30 28 L29 22" ${NONE}/><path d="M96 34 L100 30" ${NONE}/><path d="M90 28 L91 22" ${NONE}/>`,
  },
  sleep: {
    th: 'นอน', en: 'Sleeping', use: 'ไม่มีการแจ้งเตือน / ยังไม่มีนัด',
    svg: `<path d="M98 100 C108 100 110 88 104 82" ${NONE}/>` +
      `<path d="M36 102 C30 102 28 92 34 84 C42 74 58 72 72 72 C88 72 100 78 102 90 C103 98 100 102 94 102 Z" ${COAT}/>` +
      `<path d="M62 102 C62 98 66 96 70 98" ${NONE}/>` +
      head('closed', 'translate(-18 32)') +
      `<path d="M30 102 C30 98 36 96 40 98 C42 99 42 102 40 102" ${COAT}/>` +
      `<path d="M76 46 L84 46 L76 54 L84 54" ${NONE}/><path d="M90 30 L96 30 L90 36 L96 36" ${NONE}/>`,
  },
  peek: {
    th: 'โผล่ขอบ', en: 'Peeking', use: 'หน้าว่างที่พื้นที่จำกัด (รายการนัด, กลุ่ม)',
    svg: head('open', 'translate(0 20)') +
      `<path d="M12 86 L108 86" ${NONE}/>` +
      `<path d="M42 86 C42 79 51 79 51 86" ${COAT}/><path d="M69 86 C69 79 78 79 78 86" ${COAT}/>`,
  },
  lost: {
    th: 'งง', en: 'Lost', use: '404 / ผิดพลาด',
    svg: tail + body + legs + head('open', 'rotate(-12 60 46)') +
      `<path d="M88 24 C88 15 101 15 101 23 C101 29 94.5 29 94.5 35" ${NONE}/><circle cx="94.5" cy="41" r="2" ${INK}/>`,
  },
};

const wrap = (title, inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" aria-label="${title}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
<title>${title}</title>
${inner}
</svg>
`;

const manifest = [];
for (const [key, p] of Object.entries(poses)) {
  writeFileSync(resolve(out, `cat-${key}.svg`), wrap(`แมวเจอกัน — ${p.th}`, p.svg));
  manifest.push({ key, file: `cat-${key}.svg`, th: p.th, en: p.en, use: p.use });
}
writeFileSync(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`เขียน ${manifest.length} ท่า → public/brand/cats/`);
