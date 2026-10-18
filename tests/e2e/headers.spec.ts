// R0-16 — security headers จริงจาก `next start` (ไม่ใช่แค่อ่าน next.config.ts)
import { signupViaApi, test, uniqueUsername } from './support/auth';
import { expect, watchConsole } from './support/fixtures';

const PATHS = ['/', '/login', '/signup', '/forgot', '/me', '/no-such-page-r0', '/api/health'];
const TILE_ORIGIN = 'https://tile.openstreetmap.org';

function parseCsp(header: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of header.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out.set(name.toLowerCase(), values);
  }
  return out;
}

for (const path of PATHS) {
  test(`${path}: CSP + nosniff + Referrer-Policy + Permissions-Policy`, async ({ request }) => {
    const res = await request.get(path);
    expect(res.status()).toBeLessThan(600);
    const h = res.headers();

    const cspRaw = h['content-security-policy'];
    expect(cspRaw, 'มี Content-Security-Policy').toBeTruthy();
    expect(cspRaw).not.toContain('unsafe-eval');
    const csp = parseCsp(cspRaw!);
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
    expect(csp.get('default-src')).toEqual(["'self'"]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('script-src')).not.toContain('*');
    expect(csp.get('script-src')?.some((v) => v.startsWith('http'))).toBe(false);
    // tile แผนที่อนุญาตเฉพาะ img-src
    expect(csp.get('img-src')).toContain(TILE_ORIGIN);
    for (const [name, values] of csp) if (name !== 'img-src') expect(values, name).not.toContain(TILE_ORIGIN);

    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBeTruthy();
    expect(['no-referrer', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin']).toContain(h['referrer-policy']);
    const pp = h['permissions-policy'] ?? '';
    for (const feature of ['camera', 'microphone', 'geolocation', 'payment']) expect(pp).toContain(`${feature}=()`);
    expect(h['x-powered-by']).toBeUndefined();
  });
}

// R1: หน้าที่ต้องล็อกอินตอบ header ชุดเดียวกันเมื่อล็อกอินแล้ว (ไม่ใช่แค่ redirect ของผู้ไม่ได้ล็อกอิน)
test('ล็อกอินแล้ว: / /me /admin/pin-resets (404 สำหรับผู้ใช้ทั่วไป) ได้ CSP + nosniff ครบ และไม่ถูก cache', async ({ context }) => {
  await signupViaApi(context.request, { username: uniqueUsername() });
  for (const path of ['/', '/me', '/admin/pin-resets']) {
    const res = await context.request.get(path);
    const h = res.headers();
    expect(h['content-security-policy'], path).toBeTruthy();
    expect(h['content-security-policy'], path).not.toContain('unsafe-eval');
    expect(h['x-content-type-options'], path).toBe('nosniff');
    expect(h['cache-control'] ?? '', path).not.toMatch(/public|s-maxage/);
  }
});

test('/api/health ตอบ 200 บน DB ที่ migrate แล้ว (env ของ E2E ครบ)', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.data?.ok ?? body.ok).toBe(true);
});

// พิสูจน์สองอย่างพร้อมกัน: เบราว์เซอร์บังคับ CSP จริง และ watchConsole (ที่ shell.spec ใช้) จับ CSP violation ได้
test('CSP บล็อกสคริปต์จากโดเมนภายนอกจริง และตัวเก็บ console จับได้', async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    const s = document.createElement('script');
    s.src = 'https://cdn.example.invalid/evil.js';
    document.head.appendChild(s);
  });
  await expect.poll(() => problems.some((p) => /Content Security Policy/i.test(p.text))).toBe(true);
});
