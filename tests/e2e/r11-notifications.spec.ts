// R11 — กระดิ่งแสดงชนิดแจ้งเตือนใหม่ (R11_CONTRACT §1 §3 · R11-8): 375/390/768 (= project) × th/en × light/dark
//   1) /notifications แสดง 13 แถว (7 ชนิด รวมตัวแปรของ changes/response/role) ข้อความถูกภาษา + กดแล้วไปหน้าที่สัญญากำหนด + ไม่ล้นแนวนอนแม้ชื่อกลุ่ม/ชื่อนัด/ชื่อคนยาวสุด
//   2) params ไม่ครบ → ข้อความ "แสดงไม่ได้" ไม่มีลิงก์ · 3) กระดิ่งว่าง: ข้อความตรงของจริง
// แถวใส่ตรงใน DB ของเซิร์ฟเวอร์ E2E (notify() ฝั่งเซิร์ฟเวอร์ทดสอบที่ Vitest) — สเปกนี้ทดสอบเฉพาะฝั่งแสดงผล/การนำทาง/จอ
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './support/auth';
import { createApptApi, daysAhead } from './support/appt';
import { setPrefs, watchConsole } from './support/fixtures';
import { checkLayout, createGroupApi, go, membersApi, type Theme } from './support/groups';
import { LOCALES, msg, type Locale } from './support/messages';
import { insertNotifications } from './support/notif';

const THEMES: readonly Theme[] = ['light', 'dark'];
const noOverflow = async (page: Page, label: string) => {
  const w = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth, b: document.body.scrollWidth }));
  expect(w.s, `${label}: documentElement ไม่ล้นแนวนอน`).toBeLessThanOrEqual(w.c);
  expect(w.b, `${label}: body ไม่ล้นแนวนอน`).toBeLessThanOrEqual(w.c);
};

// ค่าที่ยาวสุดเท่าที่ระบบยอมรับ (ชื่อกลุ่ม ≤ 40, ชื่อนัด ≤ 80) และไม่มีช่องว่างให้ตัดบรรทัด — ทดสอบการล้น
const LONG_PERSON = 'Pneumonoultramicroscopicsilicovolcano'.slice(0, 38);
const LONG_TITLE = `Title${'x'.repeat(75)}`;
const slot = (d: string) => ({ startDate: d, startTime: '10:00', endDate: d, endTime: '11:00' });

type Row = { kind: string; params: Record<string, unknown>; href: (gid: string, aid: string) => string };
const MARK = { title: 'ZZtitle', when: 'ZZwhen', groupName: 'ZZgroup', actorName: 'ZZactor', responderName: 'ZZresp', memberName: 'ZZmem' } as const;
const MARK_RE = /ZZ(?:title|when|group|actor|resp|mem)/g;

/** ข้อความจริงของแต่ละภาษา แล้วหั่นตรงค่าที่ผู้ใช้ใส่ → ส่วนข้อความคงที่ของชนิด/ตัวแปรนั้น (ใช้ยืนยันว่าเลือกแขนของ select ถูก) */
const fragments = (locale: Locale, key: string, extra: Record<string, string> = {}): string[] =>
  msg(locale, key, { ...MARK, ...extra })
    .split(MARK_RE)
    .map((s) => s.trim())
    .filter(Boolean);
const clean = (s: string) => s.replace(/[⁦-⁩‪-‮]/g, '').replace(/\s+/g, ' ');

for (const locale of LOCALES) {
  for (const theme of THEMES) {
    test.describe(`${locale} · ${theme}`, () => {
      test('กระดิ่ง: ชนิดใหม่ทั้ง 7 (13 แถว) ข้อความถูกต้อง กดแล้วไปถูกหน้า ไม่ล้นแนวนอนแม้ชื่อยาวสุด', async ({ page, context, baseURL, user }, testInfo: TestInfo) => {
        void user;
        await setPrefs(context, baseURL!, { locale, theme });
        const groupName = `LongG${Math.random().toString(36).slice(2, 6)}${'g'.repeat(31)}`.slice(0, 40);
        const gid = await createGroupApi(context.request, groupName);
        const me = (await membersApi(context.request, gid))[0]!;
        const aid = await createApptApi(context.request, gid, { title: LONG_TITLE, ...slot(daysAhead(5)) });
        const startAt = Date.now() + 5 * 86_400_000;
        const appt = { groupId: gid, groupName, appointmentId: aid, title: LONG_TITLE, startAt, tz: 'Asia/Bangkok' };
        const toAppt = (_g: string, a: string) => `/appointments/${a}`;
        const toGroup = (g: string) => `/groups/${g}`;
        const rows: Row[] = [
          { kind: 'appointment.cancelled', params: { ...appt, actorName: LONG_PERSON }, href: toAppt },
          { kind: 'appointment.updated', params: { ...appt, actorName: LONG_PERSON, changes: 'time' }, href: toAppt },
          { kind: 'appointment.updated', params: { ...appt, actorName: LONG_PERSON, changes: 'place' }, href: toAppt },
          { kind: 'appointment.updated', params: { ...appt, actorName: LONG_PERSON, changes: 'both' }, href: toAppt },
          { kind: 'appointment.rsvp_changed', params: { ...appt, responderName: LONG_PERSON, response: 'going' }, href: toAppt },
          { kind: 'appointment.rsvp_changed', params: { ...appt, responderName: LONG_PERSON, response: 'maybe' }, href: toAppt },
          { kind: 'appointment.rsvp_changed', params: { ...appt, responderName: LONG_PERSON, response: 'not_going' }, href: toAppt },
          { kind: 'group.member.joined', params: { groupId: gid, groupName, memberName: LONG_PERSON }, href: toGroup },
          { kind: 'group.member.left', params: { groupId: gid, groupName, memberName: LONG_PERSON }, href: toGroup },
          { kind: 'group.member.removed', params: { groupId: gid, groupName }, href: () => '/groups' },
          { kind: 'group.member.role_changed', params: { groupId: gid, groupName, role: 'admin' }, href: toGroup },
          { kind: 'group.member.role_changed', params: { groupId: gid, groupName, role: 'moderator' }, href: toGroup },
          { kind: 'group.member.role_changed', params: { groupId: gid, groupName, role: 'member' }, href: toGroup },
        ];
        await insertNotifications(me.userId, rows);
        const expectedFrags = (r: Row): string[] => {
          const p = r.params;
          switch (r.kind) {
            case 'appointment.updated':
              return fragments(locale, 'notifications.appointment.updated', { changes: p.changes as string });
            case 'appointment.rsvp_changed':
              return fragments(locale, 'notifications.appointment.rsvp_changed', { response: p.response as string });
            case 'group.member.role_changed':
              return fragments(locale, 'notifications.group.member.role_changed', { role: p.role as string });
            default:
              return fragments(locale, `notifications.${r.kind}`);
          }
        };

        const problems = watchConsole(page);
        await go(page, '/');
        await expect(page.getByTestId('bell-badge')).toHaveText('9+'); // 13 แถวยังไม่อ่าน > 9
        await go(page, '/notifications');
        const list = page.getByTestId('notif-row');
        await expect(list).toHaveCount(rows.length);
        await expect(page.getByText(msg(locale, 'notifications.unknown'))).toHaveCount(0);

        // ใหม่สุดก่อน → แถวสุดท้ายที่ใส่อยู่บนสุด
        const seen = new Set<string>();
        for (const [i, r] of rows.entries()) {
          const row = list.nth(rows.length - 1 - i);
          const label = `${r.kind} ${String(r.params.changes ?? r.params.response ?? r.params.role ?? '')}`;
          await expect(row, label).toHaveAttribute('href', r.href(gid, aid));
          await expect(row, label).toHaveAttribute('data-unread', 'true');
          const text = clean((await row.textContent()) ?? '');
          for (const f of expectedFrags(r)) expect(text, `${label}: ข้อความคงที่ "${f}"`).toContain(f);
          expect(text, label).toContain(groupName);
          if (r.kind.startsWith('appointment.')) expect(text, label).toContain(LONG_TITLE);
          if ('actorName' in r.params || 'responderName' in r.params || 'memberName' in r.params) expect(text, label).toContain(LONG_PERSON);
          // removed ไม่เปิดเผยชื่อผู้นำออก (สัญญา §1)
          if (r.kind === 'group.member.removed') expect(text).not.toContain(LONG_PERSON);
          // ทุกแถว (รวมตัวแปรของ select) ต้องได้ข้อความต่างกัน — กันแขน select ตกไป other ทุกกรณี
          const body = expectedFrags(r).join('|');
          expect(seen.has(`${r.kind}|${body}`), `${label}: ข้อความซ้ำกับแถวอื่น`).toBe(false);
          seen.add(`${r.kind}|${body}`);
        }
        await noOverflow(page, 'notifications ชื่อยาว');
        await checkLayout(page, testInfo, 'r11-notifications', locale, theme);

        // กดแต่ละชนิดหนึ่งแถว → ไปหน้าตามสัญญา
        const probes: { kind: string; index: number; url: RegExp }[] = [
          { kind: 'cancelled', index: 0, url: new RegExp(`/appointments/${aid}$`) },
          { kind: 'updated', index: 1, url: new RegExp(`/appointments/${aid}$`) },
          { kind: 'rsvp_changed', index: 4, url: new RegExp(`/appointments/${aid}$`) },
          { kind: 'joined', index: 7, url: new RegExp(`/groups/${gid}$`) },
          { kind: 'left', index: 8, url: new RegExp(`/groups/${gid}$`) },
          { kind: 'removed', index: 9, url: /\/groups$/ },
          { kind: 'role_changed', index: 10, url: new RegExp(`/groups/${gid}$`) },
        ];
        for (const p of probes) {
          await go(page, '/notifications');
          await page.getByTestId('notif-row').nth(rows.length - 1 - p.index).click();
          await expect(page, p.kind).toHaveURL(p.url);
          if (p.url.source.includes('appointments')) await expect(page.getByRole('heading', { name: LONG_TITLE }).first()).toBeVisible();
        }
        expect(problems).toEqual([]);
      });

      test('params ไม่ครบ/ค่าแปลก → แสดงเป็น "แสดงไม่ได้" ไม่มีลิงก์ ไม่รั่วค่าดิบ', async ({ page, context, baseURL, user }) => {
        void user;
        await setPrefs(context, baseURL!, { locale, theme });
        const gid = await createGroupApi(context.request, `R11 bad ${Math.random().toString(36).slice(2, 6)}`);
        const me = (await membersApi(context.request, gid))[0]!;
        const base = { groupId: gid, groupName: 'G', appointmentId: 'a1', title: 'T', startAt: Date.now(), tz: 'Asia/Bangkok' };
        await insertNotifications(me.userId, [
          { kind: 'appointment.updated', params: { ...base, actorName: 'X', changes: 'weird' } },
          { kind: 'group.member.role_changed', params: { groupId: gid, groupName: 'G', role: 'owner' } },
          { kind: 'appointment.rsvp_changed', params: { ...base, responderName: 'X', response: 'dunno' } },
        ]);
        const problems = watchConsole(page);
        await go(page, '/notifications');
        const rows = page.getByTestId('notif-row');
        await expect(rows).toHaveCount(3);
        for (let i = 0; i < 3; i++) {
          await expect(rows.nth(i)).toContainText(msg(locale, 'notifications.unknown'));
          await expect(rows.nth(i)).not.toHaveAttribute('href', /.+/);
        }
        await expect(page.getByText(/weird|owner|dunno/)).toHaveCount(0);
        await noOverflow(page, 'notifications unknown');
        expect(problems).toEqual([]);
      });

      test('กระดิ่งว่าง: ข้อความหัวข้อ/คำอธิบายตรงของจริง · ไม่มีป้ายบนกระดิ่ง', async ({ page, context, baseURL, user }, testInfo: TestInfo) => {
        void user;
        await setPrefs(context, baseURL!, { locale, theme });
        const problems = watchConsole(page);
        await go(page, '/notifications');
        const empty = page.getByTestId('notif-empty');
        await expect(empty).toContainText(msg(locale, 'notifications.empty.title'));
        await expect(empty).toContainText(msg(locale, 'notifications.empty.body'));
        await expect(page.getByTestId('notif-row')).toHaveCount(0);
        await noOverflow(page, 'notifications empty');
        await checkLayout(page, testInfo, 'r11-notifications-empty', locale, theme);
        await go(page, '/');
        await expect(page.getByTestId('bell-badge')).toHaveCount(0);
        expect(problems).toEqual([]);
      });
    });
  }
}
