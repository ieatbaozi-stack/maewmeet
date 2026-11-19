// R16 §2 (U1–U4) + H4 ฝั่งกระดิ่ง: คำเชิญจาก super admin นอกกลุ่ม · โครงที่ตรวจได้ใน node (CSS/ซอร์ส) ของ UI เล็ก
import { createTranslator } from 'next-intl';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { notificationView } from '@/components/notifications/model';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
const messages = (l: 'th' | 'en') => JSON.parse(read(`messages/${l}.json`));
const render = (l: 'th' | 'en', key: string, values: Record<string, string>) => createTranslator({ locale: l, messages: messages(l) })(key as never, values as never) as string;
const strip = (s: string) => s.replace(/[⁨⁩]/g, '');
type Known = { known: true; messageKey: string; values: Record<string, string>; href: string };

describe('H4 group.invite.received — actorSystemAdmin', () => {
  const base = { groupId: 'g1', groupName: 'ก๊วนแมว', inviterName: '' };
  it('TH: super admin นอกกลุ่ม → "ผู้ดูแลระบบ" แทนชื่อ', () => {
    const v = notificationView('group.invite.received', { ...base, actorSystemAdmin: true }, 'th', 'บัญชีที่ถูกลบ', 'ผู้ดูแลระบบ') as Known;
    expect(v.known).toBe(true);
    expect(strip(v.values.inviterName!)).toBe('ผู้ดูแลระบบ');
    expect(strip(render('th', v.messageKey, v.values))).toContain('ผู้ดูแลระบบ');
    expect(v.href).toBe('/groups');
  });
  it('EN: ใช้ป้าย "System admin" ที่ผู้เรียกส่งมา', () => {
    const v = notificationView('group.invite.received', { ...base, actorSystemAdmin: true }, 'en', 'Deleted account', 'System admin') as Known;
    expect(strip(v.values.inviterName!)).toBe('System admin');
    expect(strip(render('en', v.messageKey, v.values))).toContain('System admin');
  });
  it('แถวเก่า (ไม่มี key) หรือ false = พฤติกรรมเดิม · ชื่อจริงชนะเมื่อ false · ไม่มีชื่อ+ไม่มีธง = UNKNOWN', () => {
    const named = notificationView('group.invite.received', { ...base, inviterName: 'นุ่น' }, 'th', 'บัญชีที่ถูกลบ', 'ผู้ดูแลระบบ') as Known;
    expect(strip(named.values.inviterName!)).toBe('นุ่น');
    const off = notificationView('group.invite.received', { ...base, inviterName: 'นุ่น', actorSystemAdmin: false }, 'th', 'x', 'ผู้ดูแลระบบ') as Known;
    expect(strip(off.values.inviterName!)).toBe('นุ่น');
    expect(notificationView('group.invite.received', base, 'th').known).toBe(false);
  });
  it('ค่าที่ไม่ใช่ true จริง ("true") ไม่นับ · ไม่ส่งป้าย = ไม่เปลี่ยนพฤติกรรม', () => {
    const s = notificationView('group.invite.received', { ...base, inviterName: 'a', actorSystemAdmin: 'true' }, 'th', 'x', 'ผู้ดูแลระบบ') as Known;
    expect(strip(s.values.inviterName!)).toBe('a');
    expect(notificationView('group.invite.received', { ...base, actorSystemAdmin: true }, 'th').known).toBe(false);
  });
});

describe('U1 StepBar — ป้ายเสร็จ + "Take another look" อยู่ใต้ชื่อขั้น (เยื้องตามชื่อ)', () => {
  it('ทั้งสองอยู่ใน .steps-text > .steps-meta ไม่ใช่ลูกตรงของ .steps-row', () => {
    const src = read('src/components/groups/StepBar.tsx');
    const text = src.slice(src.indexOf('className="steps-text"'), src.indexOf('</span>\n        );'));
    expect(text).toContain('className="steps-meta"');
    expect(text).toContain('className="steps-done"');
    expect(text).toContain('className="steps-redo"');
    expect(read('src/components/groups/groups.css')).toMatch(/\.steps-meta \{[^}]*flex-wrap: wrap/);
  });
});

describe('U2 legend แท็บเอากลับ — สีเดียวกับวันที่ล็อก', () => {
  it('.sk-sw.lock ใช้ token เดียวกับ .sk-day.is-locked (surface-2 + line)', () => {
    const css = read('src/styles/skip-days.css');
    expect(css).toMatch(/\.sk-day\.is-locked \{[^}]*background: var\(--surface-2\)[^}]*border-color: var\(--line\)/);
    expect(css).toMatch(/\.sk-sw\.lock \{[^}]*background: var\(--surface-2\)[^}]*border-color: var\(--line\)/);
    expect(read('src/components/busy/RoutineSkipSheet.tsx')).toContain('mode === "restore" ? " lock" : ""');
  });
});

describe('U3 ออกจากระบบ/ลบบัญชี ส่งสัญญาณนำทางให้ NavProgress', () => {
  it.each(['src/components/auth/AccountActions.tsx', 'src/components/account/DeleteAccountSheet.tsx'])('%s: signalNavStart("/login") ก่อน router.replace', (f) => {
    const src = read(f);
    expect(src).toContain('import { signalNavStart } from "@/components/shell/nav-start"');
    expect(src.indexOf('signalNavStart("/login")')).toBeGreaterThan(-1);
    expect(src.indexOf('signalNavStart("/login")')).toBeLessThan(src.indexOf('router.replace("/login")'));
  });
});

describe('U4 skeleton ค้างขั้นต่ำ 250 ms ครอบ loading.tsx', () => {
  it('SkeletonHold อยู่ที่ root layout และใช้ skeletonHoldUntil เดิม', () => {
    expect(read('src/app/layout.tsx')).toContain('<SkeletonHold />');
    const src = read('src/components/shell/SkeletonHold.tsx');
    expect(src).toContain('skeletonHoldUntil');
    expect(src).toContain('NAV_LOADING_ATTR');
  });
});

describe('H4b รายการคำเชิญ (GroupsView) — inviterLabel', () => {
  it.each(['th', 'en'] as const)('%s: SA นอกกลุ่ม → common.systemAdmin · ชื่อว่าง → account.deletedName · ปกติ → ชื่อจริง', async (l) => {
    const { inviterLabel } = await import('@/components/groups/invite-label');
    const m = messages(l);
    const sa = m.common.systemAdmin as string;
    const gone = m.account.deletedName as string;
    expect(sa && gone && sa !== gone).toBeTruthy();
    expect(inviterLabel({ inviterName: '', actorSystemAdmin: true }, sa, gone)).toBe(sa);
    expect(inviterLabel({ inviterName: '', actorSystemAdmin: false }, sa, gone)).toBe(gone);
    expect(inviterLabel({ inviterName: '' }, sa, gone)).toBe(gone);
    expect(inviterLabel({ inviterName: 'นุ่น', actorSystemAdmin: false }, sa, gone)).toBe('นุ่น');
  });
  it('GroupsView ใช้ inviterLabel กับ common.systemAdmin', () => {
    const src = read('src/components/groups/GroupsView.tsx');
    expect(src).toContain('inviterLabel(inv, t("common.systemAdmin"), t("account.deletedName"))');
  });
});

describe('H4c โค้ดเชิญ (InviteSection) — creatorLabel', () => {
  it.each(['th', 'en'] as const)('%s: SA นอกกลุ่ม → common.systemAdmin · ชื่อว่าง → account.deletedName · ปกติ → ชื่อจริง', async (l) => {
    const { creatorLabel } = await import('@/components/groups/invite-label');
    const m = messages(l);
    const sa = m.common.systemAdmin as string;
    const gone = m.account.deletedName as string;
    expect(creatorLabel({ creatorName: '', creatorSystemAdmin: true }, sa, gone)).toBe(sa);
    expect(creatorLabel({ creatorName: '', creatorSystemAdmin: false }, sa, gone)).toBe(gone);
    expect(creatorLabel({ creatorName: '' }, sa, gone)).toBe(gone);
    expect(creatorLabel({ creatorName: 'นุ่น', creatorSystemAdmin: false }, sa, gone)).toBe('นุ่น');
  });
  it('InviteSection ใช้ creatorLabel กับ common.systemAdmin', () => {
    expect(read('src/components/groups/InviteSection.tsx')).toContain('creatorLabel(c, t("common.systemAdmin"), t("account.deletedName"))');
  });
});
