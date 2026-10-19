// 1b: ชื่อที่ผู้ใช้ตั้งเอง (displayName / ชื่อกลุ่ม / username) ต้องถูกครอบ <bdi> (bidi isolate) ทุกจุดที่แสดงในหน้ากลุ่ม/admin/me
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Name, isolateName } from '@/components/Name';

describe('<Name> / isolateName', () => {
  it('ครอบด้วย <bdi> และ escape ข้อความ', () => {
    expect(renderToStaticMarkup(createElement(Name, null, 'ab‮cd'))).toBe('<bdi>ab‮cd</bdi>');
    expect(renderToStaticMarkup(createElement(Name, null, '<b>'))).toBe('<bdi>&lt;b&gt;</bdi>');
  });
  it('isolateName = FSI…PDI', () => {
    expect(isolateName('x')).toBe('⁨x⁩');
  });
});

// จุดแสดงชื่อที่ผู้ใช้ตั้งเอง: ต้องผ่าน <Name> หรือ isolateName (ห้ามวาง {…name} ดิบใน JSX)
const SITES: [string, RegExp[]][] = [
  ['src/components/groups/MemberList.tsx', [/<Name>\{m\.displayName\}<\/Name>/]],
  ['src/components/groups/GroupsView.tsx', [/<Name>\{g\.name\}<\/Name>/, /inviter: isolateName\(inv\.inviterName\)/, /group: isolateName\(inv\.groupName\)/]],
  ['src/components/groups/InviteSection.tsx', [/isolateName\(c\.creatorName\)/, /isolateName\(d\.inviteeName/]],
  ['src/components/groups/DangerSections.tsx', [/isolateName\(m\.displayName\)/]],
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
