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

/** R0-12: ไม่มี horizontal scroll + a/button/input ที่มองเห็นทุกตัว ≥ 44×44 CSS px */
export async function measureLayout(page: Page, minTarget = 44): Promise<Layout> {
  return page.evaluate((min) => {
    const de = document.documentElement;
    const small: string[] = [];
    let count = 0;
    for (const el of document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [role="button"], [role="link"]')) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
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
