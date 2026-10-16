// R0-9 — messages/th.json กับ en.json ตรงกัน + ครบทุก ErrorCode + ตัวแปร ICU ตรงกัน
// parser/formatter ที่ next-intl ใช้จริง (use-intl → intl-messageformat → @formatjs/icu-messageformat-parser)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { IntlMessageFormat } from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@/lib/shared/errors';

const ROOT = path.resolve(import.meta.dirname, '../..');
const LOCALES = ['th', 'en'] as const;
type Locale = (typeof LOCALES)[number];

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else throw new Error(`ค่าที่ ${key} ต้องเป็น string หรือ object (ได้ ${JSON.stringify(v)})`);
  }
  return out;
}

const load = (l: Locale) => flatten(JSON.parse(readFileSync(path.join(ROOT, 'messages', `${l}.json`), 'utf8')) as Tree);
const M: Record<Locale, Record<string, string>> = { th: load('th'), en: load('en') };

/** ชื่อตัวแปร ICU ทั้งหมดในข้อความ (รวมที่ซ้อนใน plural/select/tag) */
function icuArgs(message: string): string[] {
  const names = new Set<string>();
  const walk = (els: MessageFormatElement[]) => {
    for (const el of els) {
      if (el.type === TYPE.literal || el.type === TYPE.pound) continue;
      names.add(el.value);
      if ('options' in el) for (const opt of Object.values(el.options)) walk(opt.value);
      if (el.type === TYPE.tag) walk(el.children);
    }
  };
  walk(parse(message));
  return [...names].sort();
}

describe('R0-9 คีย์ th/en', () => {
  it('มีข้อความทั้งสองภาษา และไม่ว่าง', () => {
    for (const l of LOCALES) {
      expect(Object.keys(M[l]).length).toBeGreaterThan(0);
      const empty = Object.entries(M[l]).filter(([, v]) => v.trim() === '').map(([k]) => k);
      expect(empty, `${l} มีข้อความว่าง`).toEqual([]);
    }
  });

  it('ทุกคีย์ใน th มีใน en', () => {
    expect(Object.keys(M.th).filter((k) => !(k in M.en))).toEqual([]);
  });

  it('ทุกคีย์ใน en มีใน th', () => {
    expect(Object.keys(M.en).filter((k) => !(k in M.th))).toEqual([]);
  });
});

describe('R0-9 errors.<CODE> ครบทุก ErrorCode', () => {
  it.each(LOCALES)('%s มี errors.<CODE> ทุกรหัสใน src/lib/shared/errors.ts', (l) => {
    const missing = ERROR_CODES.filter((c) => !M[l][`errors.${c}`]);
    expect(missing).toEqual([]);
  });

  it.each(LOCALES)('%s ไม่มี errors.* ที่ไม่ใช่ ErrorCode (คีย์ค้าง/สะกดผิด)', (l) => {
    const codes = new Set<string>(ERROR_CODES);
    const extra = Object.keys(M[l]).filter((k) => k.startsWith('errors.') && !codes.has(k.slice('errors.'.length)));
    expect(extra).toEqual([]);
  });
});

describe('R0-9 ICU', () => {
  const keys = Object.keys(M.th).filter((k) => k in M.en);

  it('ทุกข้อความ parse ได้ทั้งสองภาษา', () => {
    const bad: string[] = [];
    for (const l of LOCALES) for (const k of keys) {
      try {
        parse(M[l][k]!);
      } catch (e) {
        bad.push(`${l}:${k} — ${(e as Error).message}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('ตัวแปร ICU ของแต่ละคีย์ตรงกันทั้งสองภาษา', () => {
    const mismatch = keys
      .map((k) => ({ k, th: icuArgs(M.th[k]!), en: icuArgs(M.en[k]!) }))
      .filter((x) => x.th.join() !== x.en.join())
      .map((x) => `${x.k}: th=[${x.th}] en=[${x.en}]`);
    expect(mismatch).toEqual([]);
  });

  it('format ได้จริงด้วยค่าตัวอย่าง (ตัวแปรทุกตัวเป็นตัวเลข 3)', () => {
    const bad: string[] = [];
    for (const l of LOCALES) for (const k of keys) {
      const values = Object.fromEntries(icuArgs(M[l][k]!).map((n) => [n, 3]));
      try {
        const out = new IntlMessageFormat(M[l][k]!, l).format(values);
        if (typeof out === 'string' && out.includes('{')) bad.push(`${l}:${k} เหลือ { หลัง format`);
      } catch (e) {
        bad.push(`${l}:${k} — ${(e as Error).message}`);
      }
    }
    expect(bad).toEqual([]);
  });

  // พิสูจน์ว่าตัวตรวจจับความต่างได้ (กันเทสต์ผ่านแบบหลอกเพราะ icuArgs คืน [] เสมอ)
  it('icuArgs จับตัวแปรใน plural/select ซ้อนได้', () => {
    expect(icuArgs('{n, plural, one {# day for {name}} other {# days}}')).toEqual(['n', 'name']);
    expect(icuArgs('ลองใหม่ใน {retryAfterMin} นาที')).toEqual(['retryAfterMin']);
    expect(icuArgs('<b>{x}</b>')).toEqual(['b', 'x']);
    expect(icuArgs('no args')).toEqual([]);
  });
});
