// 1b: ชื่อที่ผู้ใช้ตั้งเอง (displayName / ชื่อกลุ่ม / username) ต้องถูกครอบ <bdi> (bidi isolate) ทุกจุดที่แสดงในหน้ากลุ่ม/admin/me
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Name, withNames } from '@/components/Name';

describe('<Name> / withNames', () => {
  it('ครอบด้วย <bdi> และ escape ข้อความ', () => {
    expect(renderToStaticMarkup(createElement(Name, null, 'ab‮cd'))).toBe('<bdi>ab‮cd</bdi>');
    expect(renderToStaticMarkup(createElement(Name, null, '<b>'))).toBe('<bdi>&lt;b&gt;</bdi>');
  });
  it('withNames: ข้อความเหมือนเดิมทุกตัวอักษร แต่ชื่อแต่ละตัวถูกครอบ <bdi> (ในประโยค)', () => {
    const fmt = (n: { a: string; b: string }) => `ก ${n.a} ชวนเข้า ${n.b} จบ`;
    const html = renderToStaticMarkup(createElement('p', null, withNames(fmt, { a: 'x\u202Ey', b: 'กลุ่ม <1>' })));
    expect(html).toBe('<p>ก <bdi>x\u202Ey</bdi> ชวนเข้า <bdi>กลุ่ม &lt;1&gt;</bdi> จบ</p>');
    expect(html.replace(/<\/?bdi>/g, '').replace(/<\/?p>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')).toBe(fmt({ a: 'x\u202Ey', b: 'กลุ่ม <1>' }));
  });
  it('withNames: ชื่อว่าง/ไม่มีตัวแทนในข้อความ ก็ไม่พัง', () => {
    expect(renderToStaticMarkup(createElement('p', null, withNames(() => 'ไม่มีชื่อ', { a: '' })))).toBe('<p>ไม่มีชื่อ</p>');
  });
});

// จุดแสดงชื่อที่ผู้ใช้ตั้งเอง: ต้องผ่าน <Name> หรือ withNames (ห้ามวาง {…name} ดิบใน JSX)
const SITES: [string, RegExp[]][] = [
  ['src/components/groups/MemberList.tsx', [/<Name>\{m\.displayName\}<\/Name>/]],
  ['src/components/groups/GroupsView.tsx', [/<Name>\{g\.name\}<\/Name>/, /inviter: inv\.inviterName, group: inv\.groupName \}\)\}/, /withNames\(/]],
  ['src/components/groups/InviteSection.tsx', [/withNames\(/, /name: c\.creatorName \}\)\}/, /username: d\.inviteeName \?\? "" \}\)\}/]],
  ['src/components/admin/PinResetList.tsx', [/<Name>\{item\.username\}<\/Name>/]],
  ['src/app/(app)/me/page.tsx', [/<Name>\{user\.displayName\}<\/Name>/]],
  ['src/app/(app)/groups/[gid]/page.tsx', [/<Name>\{group\.name\}<\/Name>/]],
  ['src/app/(app)/groups/[gid]/settings/page.tsx', [/<Name>\{group\.name\}<\/Name>/]],
];
describe('จุดแสดงชื่อผู้ใช้ครอบ bdi', () => {
  for (const [file, pats] of SITES) {
    it(file, () => {
      const src = readFileSync(file, 'utf8');
      for (const p of pats) expect(src).toMatch(p);
    });
  }
});
