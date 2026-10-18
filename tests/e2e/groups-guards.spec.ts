// R2 guard ของหน้ากลุ่ม (R2-6 ฝั่งหน้าจอ): ยังไม่ล็อกอิน → /login · คนนอกกลุ่ม/ไม่มีกลุ่ม/id เพี้ยน/กลุ่มที่ลบแล้ว → เนื้อหา not-found
// หมายเหตุ (เหมือน guards.spec.ts R1): guard เป็น redirect()/notFound() ใน server component ใต้ loading.tsx (streaming) → HTTP 200
//   จึงยืนยันด้วย URL ปลายทาง/เนื้อหา · ความต่าง "คนนอกกลุ่ม" vs "ไม่มีกลุ่มนี้" ต้องไม่มี (ไม่ยืนยันว่ากลุ่มมีอยู่ — ADR 0003)
import { randomUUID } from 'node:crypto';
import { expect, test } from './support/auth';
import { setPrefs, watchConsole } from './support/fixtures';
import { api, createGroupApi, go, joinViaApiCode, person, signup } from './support/groups';
import { LOCALES, msg } from './support/messages';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'guard รันที่ mobile-390 ตัวเดียว');
});

const GID = '3f2b8c1e-7a4d-4e0b-9c55-0d1a2b3c4d5e';

test.describe('ยังไม่ล็อกอิน', () => {
  for (const path of ['/groups', `/groups/${GID}`, `/groups/${GID}/settings`, '/groups/not-a-uuid']) {
    test(`${path} → /login`, async ({ page, context, baseURL }) => {
      await setPrefs(context, baseURL!, { locale: 'en' });
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(msg('en', 'login.title'));
    });
  }

  test('API กลุ่มทุกตัวที่ลองตอนยังไม่ล็อกอิน → 401 (ไม่ใช่ 404/200)', async ({ context }) => {
    const calls = [
      ['GET', '/api/groups', undefined],
      ['POST', '/api/groups', { name: 'x' }],
      ['GET', `/api/groups/${GID}`, undefined],
      ['PATCH', `/api/groups/${GID}`, { name: 'x' }],
      ['DELETE', `/api/groups/${GID}`, {}],
      ['POST', `/api/groups/${GID}/invites/code`, {}],
      ['POST', `/api/groups/${GID}/leave`, {}],
      ['GET', '/api/me/invites', undefined],
      ['POST', '/api/invites/redeem', { code: 'AAAA-AAAA' }],
    ] as const;
    for (const [m, p, body] of calls) expect((await api(context.request, m, p, body)).status, `${m} ${p}`).toBe(401);
  });
});

for (const locale of LOCALES) {
  test(`${locale}: คนนอกกลุ่ม / id ที่ไม่มี / id เพี้ยน / กลุ่มที่ลบแล้ว → หน้า not-found เหมือนกันทุกกรณี`, async ({ newDevice, baseURL }) => {
    const owner = await newDevice();
    const member = await newDevice();
    const outsider = await newDevice();
    for (const x of [owner, member, outsider]) await setPrefs(x.context, baseURL!, { locale });
    const [po, pm, px] = [person('Own'), person('Mem'), person('Out')];
    await signup(owner.context, po);
    await signup(member.context, pm);
    await signup(outsider.context, px);
    // เนื้อหา not-found ไม่ใช่ error ของ network — 404 ของ fetch ไม่ควรมี; ถ้ามี console error/CSP ให้ล้ม
    const problems = watchConsole(outsider.page);

    const live = await createGroupApi(owner.context.request, `Guard ${Date.now().toString(36)}`);
    await joinViaApiCode(owner.context.request, live, member.context.request);
    const doomed = await createGroupApi(owner.context.request, `Doomed ${Date.now().toString(36)}`);
    await joinViaApiCode(owner.context.request, doomed, member.context.request);
    expect((await api(owner.context.request, 'DELETE', `/api/groups/${doomed}`)).status).toBe(200);

    const notFoundTitle = msg(locale, 'notFound.title');
    const snapshot = async (path: string): Promise<string> => {
      await go(outsider.page, path);
      await expect(outsider.page).toHaveURL(new RegExp(`${path.replace(/\//g, '\\/')}$`));
      await expect(outsider.page.getByRole('heading', { level: 1 })).toHaveText(notFoundTitle);
      await expect(outsider.page.getByRole('link', { name: msg(locale, 'notFound.cta') })).toBeVisible();
      return (await outsider.page.locator('main').innerText()).trim();
    };

    // คนนอกกลุ่มที่ id มีอยู่จริง = ข้อความเดียวกับ id ที่ไม่มีอยู่ (ไม่ยืนยันว่ากลุ่มมี)
    const baseline = await snapshot(`/groups/${randomUUID()}`);
    for (const path of [`/groups/${live}`, `/groups/${live}/settings`, `/groups/${doomed}`, `/groups/${doomed}/settings`, '/groups/not-a-uuid', `/groups/${live}x`]) {
      expect(await snapshot(path), path).toBe(baseline);
    }
    // ไม่รั่วชื่อกลุ่มหรือชื่อสมาชิกในหน้า not-found
    await expect(outsider.page.locator('body')).not.toContainText(po.displayName);

    // กลุ่มที่ลบแล้ว: สมาชิกเดิม (ไม่ใช่แค่คนนอก) ก็เห็น not-found · ผู้สร้าง (เคยเป็น admin) ก็เห็น
    for (const who of [member, owner]) {
      await go(who.page, `/groups/${doomed}`);
      await expect(who.page.getByRole('heading', { level: 1 })).toHaveText(notFoundTitle);
      await go(who.page, `/groups/${doomed}/settings`);
      await expect(who.page.getByRole('heading', { level: 1 })).toHaveText(notFoundTitle);
    }
    // กลุ่มที่ยังอยู่: สมาชิกเข้าได้ปกติ (guard ไม่บล็อกเกินจริง) และรายการกลุ่มไม่มีกลุ่มที่ลบแล้ว
    await go(member.page, `/groups/${live}`);
    await expect(member.page.getByRole('heading', { level: 1 })).not.toHaveText(notFoundTitle);
    await go(member.page, '/groups');
    await expect(member.page.getByRole('link', { name: /Doomed/ })).toHaveCount(0);
    await expect(member.page.getByRole('link', { name: /Guard/ })).toHaveCount(1);

    // API: คนนอกกลุ่ม → 404 (ไม่ใช่ 403) ทั้งกลุ่มที่มีอยู่และที่ลบแล้ว
    const r = outsider.context.request;
    for (const g of [live, doomed]) {
      expect((await api(r, 'GET', `/api/groups/${g}`)).status, `GET ${g}`).toBe(404);
      expect((await api(r, 'PATCH', `/api/groups/${g}`, { name: 'x' })).status, `PATCH ${g}`).toBe(404);
      expect((await api(r, 'POST', `/api/groups/${g}/invites/code`)).status, `code ${g}`).toBe(404);
      expect((await api(r, 'POST', `/api/groups/${g}/leave`)).status, `leave ${g}`).toBe(404);
    }
    expect(problems).toEqual([]);
  });
}
