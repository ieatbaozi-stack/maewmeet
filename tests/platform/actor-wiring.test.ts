// R1 Platform: จุดเสียบ getActor ของ route wrapper (Auth เสียบ setActorResolver(getActor) จาก src/lib/auth/session.ts)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveActor, setActorResolver, type GetActor } from '@/app/api/_lib/actor';
import { POST as prefsPOST } from '@/app/api/prefs/route';
import { AppError } from '@/lib/shared/errors';
import type { Actor } from '@/lib/rbac/types';
import { installTestDb, type InstalledTestDb } from '../helpers/db';

const ORIGIN = 'https://maewmeet.test';
let t: InstalledTestDb;
beforeEach(async () => {
  t = await installTestDb({ APP_ORIGIN: ORIGIN });
});
afterEach(async () => {
  await t.cleanup();
});

describe('actor resolver injection', () => {
  it('ค่าเริ่มต้น = anonymous · เสียบแล้วได้ request (อ่าน cookie ได้) · ถอดแล้วกลับค่าเดิม', async () => {
    const req = new Request(`${ORIGIN}/api/prefs`, { headers: { cookie: 'mm_session=abc' } });
    expect(await resolveActor(req)).toEqual({ kind: 'anonymous' });
    const user: Actor = { kind: 'user', id: 'u1', isSuperAdmin: false, status: 'active', mustChangePin: false };
    const seen: (string | null)[] = [];
    const getActor: GetActor = async (r) => {
      seen.push(r.headers.get('cookie'));
      return user;
    };
    const restore = setActorResolver(getActor);
    expect(await resolveActor(req)).toBe(user);
    expect(seen).toEqual(['mm_session=abc']);
    restore();
    expect(await resolveActor(req)).toEqual({ kind: 'anonymous' });
  });

  it('route wrapper เรียก resolver ด้วย Request เดียวกัน (หลัง CSRF/validate) และ AppError จาก resolver กลายเป็น response ตามรหัส', async () => {
    const calls: Request[] = [];
    let restore = setActorResolver(async (r) => {
      calls.push(r);
      return { kind: 'user', id: 'u9', isSuperAdmin: true, status: 'active', mustChangePin: false };
    });
    const mk = (origin: string) =>
      new Request(`${ORIGIN}/api/prefs`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ theme: 'dark' }),
      });
    try {
      expect((await prefsPOST(mk(ORIGIN))).status).toBe(200);
      expect(calls).toHaveLength(1);
      expect(new URL(calls[0]!.url).pathname).toBe('/api/prefs');
      // CSRF ตกก่อนถึงขั้น actor → resolver ไม่ถูกเรียก
      expect((await prefsPOST(mk('https://evil.example'))).status).toBe(403);
      expect(calls).toHaveLength(1);
    } finally {
      restore();
    }
    restore = setActorResolver(async () => {
      throw new AppError('AUTH_MAINTENANCE');
    });
    try {
      const res = await prefsPOST(mk(ORIGIN));
      expect(res.status).toBe(503);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('AUTH_MAINTENANCE');
    } finally {
      restore();
    }
  });
});
