// R0-11 — aurora: เลเยอร์ filter เดียว · ≤ 4 ก้อน · reduced-motion หยุด · แท็บไม่ active หยุด · ไม่มีสคริปต์ภายนอก
// ไม่อิงชื่อ class: หาเลเยอร์จาก computed style (element เดียวในหน้าที่มี filter) แล้วนับลูกที่เคลื่อนไหว
import type { Page } from '@playwright/test';
import { test } from './support/auth';
import { expect } from './support/fixtures';

// R1: แท็บในแอปต้องล็อกอิน — หน้าที่ต้องล็อกอินสมัครผู้ใช้ใหม่ผ่าน API ก่อน (ไม่งั้นเทสต์จะวัดหน้า /login ซ้ำ ๆ)
const ANON = { cookies: [], origins: [] };
const NEEDS_LOGIN = new Set(['/', '/me', '/calendar', '/groups']);

const AURORA_PAGES = ['/', '/me', '/calendar', '/groups', '/login', '/signup', '/forgot', '/no-such-page-r0'];

/** ข้อมูลเลเยอร์ filter + animation ของลูก */
async function auroraInfo(page: Page) {
  return page.evaluate(() => {
    const filtered = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => getComputedStyle(el).filter !== 'none');
    const layer = filtered[0];
    const blobs = layer ? [...layer.querySelectorAll<HTMLElement>('*')] : [];
    const hiddenFromAT = layer ? layer.closest('[aria-hidden="true"]') !== null : false;
    const anims = layer ? document.getAnimations().filter((a) => a.effect && layer.contains((a.effect as KeyframeEffect).target as Node)) : [];
    return {
      filterLayers: filtered.length,
      blobs: blobs.length,
      hiddenFromAT,
      fixed: layer ? getComputedStyle(layer.closest('[aria-hidden="true"]') ?? layer).position : null,
      animating: anims.filter((a) => a.playState === 'running').length,
      animNames: blobs.map((b) => getComputedStyle(b).animationName),
    };
  });
}

for (const path of AURORA_PAGES) {
  test(`${path}: เลเยอร์ filter เดียว ≤ 4 ก้อน ซ่อนจาก screen reader`, async ({ world, openAs }) => {
    const { page } = await openAs(NEEDS_LOGIN.has(path) ? world.user : ANON);
    await page.goto(path, { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(new RegExp(path === '/' ? '/$' : `${path}(\\?.*)?$`));
    const a = await auroraInfo(page);
    expect(a.filterLayers).toBe(1);
    expect(a.blobs).toBeGreaterThanOrEqual(1);
    expect(a.blobs).toBeLessThanOrEqual(4);
    expect(a.hiddenFromAT).toBe(true);
    expect(a.fixed).toBe('fixed');
  });

  test(`${path}: ไม่มี <script src> จากโดเมนภายนอก และไม่โหลดสคริปต์ภายนอก`, async ({ world, openAs, baseURL }) => {
    const { page } = await openAs(NEEDS_LOGIN.has(path) ? world.user : ANON);
    const origin = new URL(baseURL!).origin;
    const external: string[] = [];
    page.on('request', (r) => {
      if (r.resourceType() === 'script' && new URL(r.url()).origin !== origin) external.push(r.url());
    });
    await page.goto(path, { waitUntil: 'networkidle' });
    const srcs = await page.evaluate(() => [...document.scripts].map((s) => s.src).filter(Boolean));
    expect(srcs.length).toBeGreaterThan(0); // มีสคริปต์ของ Next เอง — กันเทสต์ผ่านเพราะไม่ได้ดูอะไรเลย
    expect(srcs.filter((s) => new URL(s).origin !== origin)).toEqual([]);
    expect(external).toEqual([]);
  });
}

test('เคลื่อนไหวตามปกติเมื่อไม่ได้ลดการเคลื่อนไหว', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  await page.goto('/login', { waitUntil: 'networkidle' });
  const a = await auroraInfo(page);
  expect(a.animating).toBeGreaterThan(0);
  expect(a.animNames.some((n) => n !== 'none')).toBe(true);
  await ctx.close();
});

test('prefers-reduced-motion: reduce → animation หยุดนิ่ง', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  for (const path of ['/login', '/signup']) {
    await page.goto(path, { waitUntil: 'networkidle' });
    const a = await auroraInfo(page);
    expect(a.animating, path).toBe(0);
    expect(a.animNames.every((n) => n === 'none'), path).toBe(true);
  }
  await ctx.close();
});

test('แท็บไม่ active (visibilitychange) → animation หยุด และกลับมาเล่นต่อ', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  await page.goto('/login', { waitUntil: 'networkidle' });
  const setHidden = (hidden: boolean) =>
    page.evaluate((h) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  expect((await auroraInfo(page)).animating).toBeGreaterThan(0);
  await setHidden(true);
  await expect.poll(async () => (await auroraInfo(page)).animating).toBe(0);
  await setHidden(false);
  await expect.poll(async () => (await auroraInfo(page)).animating).toBeGreaterThan(0);
  await ctx.close();
});
