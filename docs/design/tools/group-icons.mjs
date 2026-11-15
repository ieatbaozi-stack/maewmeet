#!/usr/bin/env node
// R15a — ชุดไอคอนกลุ่ม 24 แบบ → docs/design/tools/group-icons.json (แหล่งอ้างอิงเดียวของ key/ชื่อ/เส้นทางไอคอน)
// ใช้: LUCIDE_NODES=/path/to/lucide-static@1.57.0/icon-nodes.json node docs/design/tools/group-icons.mjs
// ทุกแบบคือ Lucide 1.57.0 (ISC) เส้นทางคัดลอกจาก icon-nodes.json ตรงตัว ยกเว้น 2 แบบที่ Lucide ไม่มี (badminton, soccer)
// ซึ่งวาดเองตามสเปก Lucide เดียวกัน: ตาราง 24×24, เส้น 2, ปลายและมุมมน, ไม่มีสีพื้น (fill none)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const nodesPath = process.env.LUCIDE_NODES;
if (!nodesPath) throw new Error('ตั้ง LUCIDE_NODES ชี้ไป icon-nodes.json ของ lucide-static 1.57.0');
const L = JSON.parse(readFileSync(nodesPath, 'utf8'));

// วาดเอง (ตามสเปก Lucide)
const CUSTOM = {
  badminton: [ // ลูกขนไก่: ฐานโค้งมน + กระโปรงขนบานออก + ขอบบน + เส้นขนกลาง + เส้นรัด
    ['path', { d: 'M9 19a3 3 0 0 0 6 0Z' }],
    ['path', { d: 'm9 19-3.5-15' }],
    ['path', { d: 'm15 19 3.5-15' }],
    ['path', { d: 'M5.5 4q6.5-2 13 0' }],
    ['path', { d: 'M12 19V3' }],
    ['path', { d: 'M7.2 11.4q4.8 1.6 9.6 0' }],
  ],
  soccer: [ // ลูกฟุตบอล: วงกลม + ห้าเหลี่ยมกลาง + เส้นแบ่งห้าเส้น
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['path', { d: 'm12 8.5 3.33 2.42-1.27 3.91H9.94l-1.27-3.91Z' }],
    ['path', { d: 'M12 8.5V2' }],
    ['path', { d: 'm15.33 10.92 6.18-2.01' }],
    ['path', { d: 'm14.06 14.83 3.82 5.26' }],
    ['path', { d: 'M9.94 14.83 6.12 20.09' }],
    ['path', { d: 'M8.67 10.92 2.49 8.91' }],
  ],
};

// [key, ที่มา, ชื่อไทย, ชื่ออังกฤษ] — ลำดับนี้คือลำดับในตัวเลือก (แมวมาก่อน = ค่าเริ่มต้น)
export const GROUP_ICONS = [
  ['cat', 'cat', 'แมว', 'Cat'],
  ['food', 'utensils', 'อาหาร', 'Food'],
  ['hotpot', 'cooking-pot', 'ชาบู หม้อไฟ', 'Hot pot'],
  ['dessert', 'ice-cream-cone', 'ของหวาน', 'Dessert'],
  ['coffee', 'coffee', 'กาแฟ', 'Coffee'],
  ['drinks', 'beer', 'สังสรรค์', 'Drinks'],
  ['badminton', null, 'แบดมินตัน', 'Badminton'],
  ['soccer', null, 'ฟุตบอล', 'Football'],
  ['volleyball', 'volleyball', 'วอลเลย์บอล', 'Volleyball'],
  ['fitness', 'dumbbell', 'ออกกำลังกาย', 'Workout'],
  ['bike', 'bike', 'ปั่นจักรยาน', 'Cycling'],
  ['game', 'gamepad-2', 'เกม', 'Games'],
  ['music', 'music', 'ดนตรี', 'Music'],
  ['karaoke', 'mic-vocal', 'คาราโอเกะ', 'Karaoke'],
  ['movie', 'clapperboard', 'ดูหนัง', 'Movies'],
  ['travel', 'plane', 'เที่ยว', 'Travel'],
  ['camping', 'tent', 'แคมป์ปิ้ง', 'Camping'],
  ['work', 'briefcase', 'ทำงาน', 'Work'],
  ['study', 'graduation-cap', 'เรียน', 'Study'],
  ['home', 'house', 'บ้าน', 'Home'],
  ['shopping', 'shopping-bag', 'ช้อปปิ้ง', 'Shopping'],
  ['heart', 'heart', 'หัวใจ', 'Heart'],
  ['party', 'party-popper', 'ปาร์ตี้', 'Party'],
  ['star', 'star', 'ดาว', 'Star'],
];

const icons = GROUP_ICONS.map(([key, src, th, en]) => {
  const nodes = src ? L[src] : CUSTOM[key];
  if (!nodes) throw new Error('ไม่พบไอคอน ' + (src ?? key));
  return { key, source: src ? `lucide:${src}` : 'custom', th, en, nodes };
});
if (new Set(icons.map((i) => i.key)).size !== icons.length) throw new Error('key ซ้ำ');
for (const i of icons) if (!/^[a-z]{2,12}$/.test(i.key)) throw new Error('key ไม่ผ่านรูปแบบ ' + i.key);

writeFileSync(resolve(here, 'group-icons.json'), JSON.stringify({
  _source: 'Lucide 1.57.0 (ISC, https://lucide.dev) + 2 ไอคอนวาดเองตามสเปก Lucide (badminton, soccer) · สร้างโดย group-icons.mjs',
  default: 'cat',
  icons,
}, null, 1) + '\n');
console.log('เขียน group-icons.json:', icons.length, 'แบบ');
