// R18 G1 — ตรรกะแสดง/ซ่อนแบนเนอร์ "เพิ่มไปหน้าจอโฮม" (iOS Safari) · V1_UI_AUDIT §6
import { describe, expect, it } from 'vitest';
import { INSTALL_HINT_KEY, isIosSafari, shouldShowInstallHint, type InstallHintEnv } from '@/components/home/install-hint';

const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const CHROME_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1';
const FIREFOX_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15';
const EDGE_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/126.0 Mobile/15E148 Safari/605.1.15';
const LINE_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari Line/14.9.0';
const FB_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0]';
const IPADOS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const CHROME_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

const env = (over: Partial<InstallHintEnv> = {}): InstallHintEnv => ({
  userAgent: SAFARI_IPHONE,
  maxTouchPoints: 5,
  navigatorStandalone: false,
  displayStandalone: false,
  dismissed: false,
  introDismissed: true,
  ...over,
});

describe('isIosSafari', () => {
  it('Safari บน iPhone/iPad/iPadOS (UA เป็น Mac + จอสัมผัส) = ใช่', () => {
    expect(isIosSafari(SAFARI_IPHONE, 5)).toBe(true);
    expect(isIosSafari(IPAD, 5)).toBe(true);
    expect(isIosSafari(IPADOS_MAC, 5)).toBe(true);
  });
  it('Mac จริง (ไม่มีจอสัมผัส) / Chrome Desktop / Android = ไม่ใช่', () => {
    expect(isIosSafari(IPADOS_MAC, 0)).toBe(false);
    expect(isIosSafari(CHROME_DESKTOP, 0)).toBe(false);
    expect(isIosSafari(ANDROID, 5)).toBe(false);
  });
  it('เบราว์เซอร์อื่นบน iOS / in-app (Chrome, Firefox, Edge, LINE, Facebook) = ไม่ใช่ (เพิ่มไปหน้าจอโฮมไม่ได้)', () => {
    for (const ua of [CHROME_IOS, FIREFOX_IOS, EDGE_IOS, LINE_IOS, FB_IOS]) expect(isIosSafari(ua, 5), ua).toBe(false);
  });
});

describe('shouldShowInstallHint', () => {
  it('ครบเงื่อนไข = แสดง', () => {
    expect(shouldShowInstallHint(env())).toBe(true);
    expect(shouldShowInstallHint(env({ userAgent: IPAD }))).toBe(true);
    expect(shouldShowInstallHint(env({ navigatorStandalone: undefined }))).toBe(true);
  });
  it('เป็นแอปอยู่แล้ว (navigator.standalone หรือ display-mode standalone) = ซ่อน', () => {
    expect(shouldShowInstallHint(env({ navigatorStandalone: true }))).toBe(false);
    expect(shouldShowInstallHint(env({ displayStandalone: true }))).toBe(false);
  });
  it('เคยปิดแล้ว = ซ่อน · การ์ดแนะนำหน้าหลักยังเปิดอยู่ = ซ่อน (รอก่อน)', () => {
    expect(shouldShowInstallHint(env({ dismissed: true }))).toBe(false);
    expect(shouldShowInstallHint(env({ introDismissed: false }))).toBe(false);
  });
  it('ไม่ใช่ iOS Safari = ซ่อน', () => {
    for (const userAgent of [CHROME_IOS, LINE_IOS, CHROME_DESKTOP, ANDROID]) expect(shouldShowInstallHint(env({ userAgent })), userAgent).toBe(false);
  });
  it('key ของธงไม่ชนกับ mm_intro_seen', () => {
    expect(INSTALL_HINT_KEY).toBe('mm_install_hint_dismissed');
  });
});
