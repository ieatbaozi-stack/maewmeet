// fixture ร่วม: ตั้ง cookie ภาษา/ธีม · เก็บ console error / CSP violation · วัดเลย์เอาต์
import { test as base, expect, type BrowserContext, type ConsoleMessage, type Page } from '@playwright/test';
import { isFaviconNotFound, type ConsoleProblem } from './console-filter';
import type { Locale } from './messages';

export type Theme = 'system' | 'light' | 'dark';
export const THEMES: readonly Theme[] = ['system', 'light', 'dark'];

export async function setPrefs(context: BrowserContext, baseURL: string, prefs: { locale?: Locale; theme?: Theme }) {
  const cookies = [];
  if (prefs.locale) cookies.push({ name: 'mm_locale', value: prefs.locale, url: baseURL });
  if (prefs.theme) cookies.push({ name: 'mm_theme', value: prefs.theme, url: baseURL });
  await context.addCookies(cookies);
}

export type { ConsoleProblem };

/**
 * console error (warning ไม่นับ) + pageerror + ทุกข้อความที่พูดถึง Content Security Policy (ทุกระดับ)
 * 404 ของ /favicon.ico ถูกข้ามเสมอ (isFaviconNotFound) · CSP/error อื่นยังนับ
 * ignore(msg) — กรองกรณีที่คาดไว้ เช่น 404 ของตัวเอกสารเองในหน้า not-found
 */
export function watchConsole(page: Page, ignore: (m: ConsoleProblem) => boolean = () => false): ConsoleProblem[] {
  const problems: ConsoleProblem[] = [];
  page.on('console', (m: ConsoleMessage) => {
    const p = { type: m.type(), text: m.text(), url: m.location().url };
    const isCsp = /Content Security Policy/i.test(p.text);
    if ((p.type === 'error' || isCsp) && !isFaviconNotFound(p) && !ignore(p)) problems.push(p);
  });
  page.on('pageerror', (e) => problems.push({ type: 'pageerror', text: e.message }));
  return problems;
}

export type Layout = {
  lang: string;
  theme: string | undefined;
  scrollWidth: number;
  clientWidth: number;
  bodyScrollWidth: number;
  smallTargets: string[];
  targetCount: number;
};

/** R6E E12: รอให้ transition เข้า/ออกของ sheet/dialog/หน้า (จำกัดเวลา ≤ 200 ms) จบก่อนวัดขนาด — ข้าม animation วนไม่รู้จบ (aurora/วงหมุน) */
export async function settleAnimations(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
  });
}

/** R0-12: ไม่มี horizontal scroll + a/button/input ที่มองเห็นทุกตัว ≥ 44×44 CSS px */
export async function measureLayout(page: Page, minTarget = 44): Promise<Layout> {
  await settleAnimations(page);
  return page.evaluate((min) => {
    const de = document.documentElement;
    const small: string[] = [];
    let count = 0;
    for (const el of document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [role="button"], [role="link"]')) {
      let r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
      // radio/checkbox ที่ซ่อนแบบ visually-hidden (sr-only 1×1, R6C picker) ไม่ใช่เป้าสัมผัสจริง → วัด <label> ที่ครอบ (ช่องที่ผู้ใช้แตะ) แทน · ไม่มี label = ยังวัดตัว input (จะล้มถ้าเล็ก)
      if (el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox') && r.width <= 2 && r.height <= 2) {
        const lab = el.closest('label');
        if (lab) r = lab.getBoundingClientRect();
      }
      count++;
      if (r.width < min || r.height < min) {
        const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('name') || '').trim().slice(0, 30);
        small.push(`<${el.tagName.toLowerCase()}> "${name}" ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
    return {
      lang: de.lang,
      theme: de.dataset.theme,
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      smallTargets: small,
      targetCount: count,
    };
  }, minTarget);
}

export const test = base;
export { expect };
