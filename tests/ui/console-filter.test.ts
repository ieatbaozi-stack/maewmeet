// R2 review (Low): fixture watchConsole ข้าม 404 ของ /favicon.ico เท่านั้น — CSP/error อื่นต้องยังเป็นความผิด
import { describe, expect, it } from 'vitest';
import { isFaviconNotFound } from '../e2e/support/console-filter';

const err = (text: string, url?: string) => ({ type: 'error', text, url });
const NF = 'Failed to load resource: the server responded with a status of 404 (Not Found)';

describe('isFaviconNotFound', () => {
  it('404 ของ /favicon.ico (ทุก origin) → ข้าม', () => {
    expect(isFaviconNotFound(err(NF, 'http://127.0.0.1:3100/favicon.ico'))).toBe(true);
    expect(isFaviconNotFound(err(NF, 'https://maewmeet.test/favicon.ico'))).toBe(true);
  });
  it('404 ของ path อื่น / ไฟล์ชื่อคล้าย / status อื่น / ไม่มี url → ยังเป็นความผิด', () => {
    expect(isFaviconNotFound(err(NF, 'http://x/api/groups'))).toBe(false);
    expect(isFaviconNotFound(err(NF, 'http://x/brand/favicon.ico'))).toBe(false);
    expect(isFaviconNotFound(err(NF, 'http://x/favicon.ico.map'))).toBe(false);
    expect(isFaviconNotFound(err(NF.replace('404', '500'), 'http://x/favicon.ico'))).toBe(false);
    expect(isFaviconNotFound(err(NF))).toBe(false);
  });
  it('CSP violation และ error อื่นที่ชี้ /favicon.ico ยังไม่ถูกข้าม', () => {
    expect(isFaviconNotFound(err("Refused to load the image because it violates the following Content Security Policy directive: img-src", 'http://x/favicon.ico'))).toBe(false);
    expect(isFaviconNotFound({ type: 'warning', text: NF, url: 'http://x/favicon.ico' })).toBe(false);
  });
});
