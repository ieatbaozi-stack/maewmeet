// R0-16: security headers ใน next.config.ts — ตรวจ config (unit) · header จริงจาก server ตรวจใน E2E (TEST) + `next start` (Lead)
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NextConfig } from 'next';

type Header = { key: string; value: string };

async function loadConfig(nodeEnv: string): Promise<{ config: NextConfig; headers: Map<string, string>; rules: { source: string }[] }> {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', nodeEnv);
  const config = (await import('../../next.config')).default;
  const rules = (await config.headers!()) as { source: string; headers: Header[] }[];
  const headers = new Map<string, string>();
  for (const r of rules) for (const h of r.headers) headers.set(h.key.toLowerCase(), h.value);
  return { config, headers, rules };
}

function csp(value: string): Map<string, string[]> {
  return new Map(
    value
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...values] = d.split(/\s+/);
        return [name!, values] as const;
      }),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

// R1 TEST: warm-up — cold import ของ next.config.ts ครั้งแรกใน worker ไม่ควรกินงบ 5s ของเทสต์แรก (ดู tests/security/config-hygiene.test.ts)
beforeAll(async () => {
  await loadConfig('production');
}, 30_000);

describe('next.config.ts (production)', () => {
  it('ใช้กับทุก path', async () => {
    const { rules } = await loadConfig('production');
    expect(rules.map((r) => r.source)).toEqual(['/:path*']);
  });

  it('CSP: ไม่มี unsafe-eval · frame-ancestors none · object-src none · tile OSM อยู่ใน img-src เท่านั้น', async () => {
    const { headers } = await loadConfig('production');
    const raw = headers.get('content-security-policy');
    expect(raw).toBeDefined();
    expect(raw).not.toContain('unsafe-eval');
    const d = csp(raw!);
    expect(d.get('default-src')).toEqual(["'self'"]);
    expect(d.get('frame-ancestors')).toEqual(["'none'"]);
    expect(d.get('object-src')).toEqual(["'none'"]);
    expect(d.get('base-uri')).toEqual(["'self'"]);
    expect(d.get('form-action')).toEqual(["'self'"]);
    expect(d.get('img-src')).toContain('https://tile.openstreetmap.org');
    for (const [name, values] of d) {
      if (name !== 'img-src') expect(values.join(' '), name).not.toContain('openstreetmap');
      expect(values, `${name} ไม่อนุญาตทุก origin`).not.toContain('*');
      expect(values, `${name} ไม่อนุญาตทุก https`).not.toContain('https:');
    }
    expect(d.get('connect-src')).toEqual(["'self'"]);
    // script ภายนอกห้าม (R0-11) — มีแค่ self + inline ของ RSC payload (เหตุผลใน next.config.ts)
    expect(d.get('script-src')).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it('header อื่นตาม R0-16', async () => {
    const { headers } = await loadConfig('production');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('x-frame-options')).toBe('DENY');
    const pp = headers.get('permissions-policy')!;
    for (const feature of ['camera', 'microphone', 'geolocation', 'payment']) expect(pp).toContain(`${feature}=()`);
    // ทุกรายการต้องเป็นรูป feature=() และไม่มี feature ที่ Chromium ไม่รู้จัก (ขึ้น console warning ทุกหน้า)
    const features = pp.split(',').map((s) => s.trim());
    for (const f of features) expect(f).toMatch(/^[a-z-]+=\(\)$/);
    const names = features.map((f) => f.split('=')[0]);
    expect(new Set(names).size).toBe(names.length);
    for (const unknown of ['bluetooth']) expect(names).not.toContain(unknown);
  });

  it('agentRules: false (กัน next dev สร้าง AGENTS.md) · poweredByHeader: false', async () => {
    const { config } = await loadConfig('production');
    expect(config.agentRules).toBe(false);
    expect(config.poweredByHeader).toBe(false);
  });
});

describe('next.config.ts (development)', () => {
  it('ผ่อนเฉพาะ dev: unsafe-eval + ws: สำหรับ HMR — ค่าอื่นเหมือน production', async () => {
    const dev = csp((await loadConfig('development')).headers.get('content-security-policy')!);
    const prod = csp((await loadConfig('production')).headers.get('content-security-policy')!);
    expect(dev.get('script-src')).toContain("'unsafe-eval'");
    expect(dev.get('connect-src')).toEqual(expect.arrayContaining(['ws:', 'wss:']));
    for (const name of prod.keys()) {
      if (name === 'script-src' || name === 'connect-src') continue;
      expect(dev.get(name), name).toEqual(prod.get(name));
    }
  });
});
