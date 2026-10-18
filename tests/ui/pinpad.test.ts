// PinPad (แป้น PIN ใช้ร่วม login/signup/set-pin/เปลี่ยน PIN) — เรนเดอร์ฝั่งเซิร์ฟเวอร์ ไม่มี jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { PinPad } from '@/components/auth/PinPad';

// children ผ่านอาร์กิวเมนต์ของ createElement (กฎ eslint react/no-children-prop) — ชนิดของ provider ต้องการ children เป็น prop จึงผ่อนชนิด
const Provider = NextIntlClientProvider as unknown as ComponentType<Record<string, unknown>>;

const messages = (l: 'th' | 'en') =>
  JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../messages', `${l}.json`), 'utf8')) as Record<string, unknown>;

function render(locale: 'th' | 'en', props: Partial<Parameters<typeof PinPad>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(
      Provider,
      { locale, messages: messages(locale), timeZone: 'Asia/Bangkok' },
      createElement(PinPad, { value: '', onChange: () => {}, ...props }),
    ),
  );
}

describe('PinPad', () => {
  it('จุดแสดงความคืบหน้าเป็นข้อความตามภาษา ไม่แสดงตัวเลขที่กด', () => {
    const html = render('en', { value: '135' });
    expect(html).toContain('3 of 6 digits entered');
    expect(html.match(/<span class="on">/g)).toHaveLength(3);
    expect(html).not.toContain('135');
    expect(render('th', { value: '' })).toContain('ใส่แล้ว 0 จาก 6 หลัก');
  });

  it('แป้น 0-9 + ปุ่มลบ · ว่างอยู่ ปุ่มลบปิด', () => {
    const html = render('en');
    for (const d of '0123456789') expect(html).toContain(`>${d}</button>`);
    expect(html).toMatch(/aria-label="Delete last digit"[^>]*disabled/);
  });

  it('ครบ 6 หลักหรือ disabled → ตัวเลขกดไม่ได้ แต่ leftKey ยังกดได้', () => {
    const full = render('en', { value: '135790' });
    expect(full.match(/class="key"[^>]*disabled/g)).toHaveLength(10);
    const locked = render('en', {
      disabled: true,
      leftKey: createElement('button', { type: 'button', className: 'key ghost' }, 'forgot'),
    });
    expect(locked.match(/class="key"[^>]*disabled/g)).toHaveLength(10);
    expect(locked).toContain('<button type="button" class="key ghost">forgot</button>');
  });

  it('ไม่มี leftKey → ช่องว่างซ่อนจากโปรแกรมอ่านจอ', () => {
    expect(render('en')).toContain('class="key blank" aria-hidden="true"');
  });
});
