// R5 — กันทางรั่วของหน้า admin/บัญชีแบบสถิต + unit ของตัวช่วย (R5_CONTRACT §5 R5-5/6/7, §6)
//  A. route R5 ผูก action ถูกต้อง · /api/admin/* = SUPER_ADMIN_ONLY ทั้งหมด · service R5 ใช้ action literal เฉพาะตระกูลของตัวเอง
//  B. serializer/repo ของ admin ไม่แตะคอลัมน์อ่อนไหว (pin_hash, note, busy, ชื่อ/รายละเอียด/พิกัดนัด, locale/theme)
//  C. ทุก action ที่ระบบเขียนลง audit_log มีแถวใน AUDIT_META_WHITELIST (ไม่งั้น meta ของ action ใหม่ถูกตัดเงียบ ๆ — ต้องตัดสินใจทีละคีย์)
//  D. unit: escapeLike · filterAuditMeta · cursor · parseSearchTerm
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTE_MANIFEST } from '@/app/api/_lib/manifest';
import { decodeKeysetCursor, encodeKeysetCursor, page, parseSearchTerm } from '@/lib/data/admin-input';
import { escapeLike } from '@/lib/data/repos/admin-users';
import { AUDIT_META_WHITELIST, filterAuditMeta } from '@/lib/data/serializers/admin';
import { SUPER_ADMIN_AUDITED, isSuperAdminOnly } from '@/lib/rbac/actions';
import { isAppError } from '@/lib/shared/errors';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });

describe('A. route R5 → action', () => {
  const EXPECTED: Record<string, string> = {
    'PATCH /api/me': 'self.update',
    'POST /api/me/delete': 'self.delete',
    'GET /api/admin/users': 'admin.user.list',
    'POST /api/admin/users/:id/suspend': 'admin.user.suspend',
    'POST /api/admin/users/:id/unsuspend': 'admin.user.suspend',
    'POST /api/admin/users/:id/unlock': 'admin.user.unlock',
    'GET /api/admin/groups': 'admin.group.list',
    'GET /api/admin/groups/:gid': 'admin.group.view',
    'GET /api/admin/audit': 'admin.audit.view',
  };
  it.each(Object.entries(EXPECTED))('%s → %s', (key, action) => {
    const e = ROUTE_MANIFEST.find((x) => `${x.method} ${x.path}` === key);
    expect(e, key).toBeDefined();
    expect(e!.auth).toBe('actor');
    expect(e!.action).toBe(action);
  });

  it('ทุก route ใต้ /api/admin/ ใช้ action ที่เป็น SUPER_ADMIN_ONLY (ไม่มีทางเข้าของผู้ใช้ทั่วไป)', () => {
    const admin = ROUTE_MANIFEST.filter((e) => e.path.startsWith('/api/admin/'));
    expect(admin.length).toBeGreaterThanOrEqual(7);
    for (const e of admin) expect(e.action && isSuperAdminOnly(e.action), `${e.method} ${e.path}`).toBe(true);
  });

  it('action SA ที่ติดธง audit มี admin.group.view และ admin.audit.view', () => {
    expect(SUPER_ADMIN_AUDITED).toEqual(expect.arrayContaining(['admin.group.view', 'admin.audit.view', 'admin.user.suspend', 'admin.user.unlock']));
  });

  const ACTION_LITERAL = /\b(?:authorize|authorizeInGroup|can|canInGroup)\s*\(\s*[A-Za-z_.]+\s*,\s*['"]([a-zA-Z.]+)['"]/g;
  it.each([
    ['src/lib/data/services/account.ts', /^self\.(update|delete)$/],
    ['src/lib/data/services/admin-users.ts', /^admin\.user\.(list|suspend|unlock)$/],
    ['src/lib/data/services/admin-groups.ts', /^admin\.group\.(list|view)$/],
    ['src/lib/data/services/admin-audit.ts', /^admin\.audit\.view$/],
  ] as const)('%s ใช้เฉพาะ action ในตระกูลของตัวเอง', (file, re) => {
    const used = [...strip(read(file)).matchAll(ACTION_LITERAL)].map((m) => m[1]!);
    expect(used.length).toBeGreaterThan(0);
    for (const a of used) expect(a, file).toMatch(re);
  });
});

describe('B. admin serializer/repo ไม่แตะคอลัมน์อ่อนไหว', () => {
  it('serializers/admin.ts ไม่อ้าง pinHash/note/busy/title/description/lat/lng/placeName/mapUrl/locale/theme', () => {
    const code = strip(read('src/lib/data/serializers/admin.ts'));
    for (const re of [/pinHash|pin_hash|pepper/i, /\bnote\b/, /\bbusy/i, /\btitle\b/, /\bdescription\b/, /\blat\b|\blng\b/, /placeName|mapUrl/, /\blocale\b|\btheme\b/]) {
      expect(re.test(code), String(re)).toBe(false);
    }
  });

  it('repos/admin-*.ts ไม่ SELECT ตาราง busy_block และคอลัมน์รายละเอียดนัด/PIN', () => {
    for (const f of ['src/lib/data/repos/admin-users.ts', 'src/lib/data/repos/admin-groups.ts', 'src/lib/data/repos/admin-audit.ts']) {
      const code = strip(read(f));
      for (const re of [/busy_block|busyBlock/, /pin_hash|pinHash|pin_pepper/, /\.title\b|\btitle\b,/, /description|place_name|map_url|\blat\b|\blng\b/, /\bnote\b/]) {
        expect(re.test(code), `${f}: ${re}`).toBe(false);
      }
    }
  });
});

describe('C. ทุก action ที่เขียนลง audit_log มีแถวใน whitelist', () => {
  it('literal ใน src/lib/** + scripts/**', () => {
    const files = [...walk(join(ROOT, 'src/lib')), ...walk(join(ROOT, 'scripts'))].filter((f) => !f.includes('/rbac/'));
    const found = new Set<string>();
    for (const f of files) {
      const code = strip(readFileSync(f, 'utf8'));
      if (!/insertAuditLog|audit\(|auditRead\(|auditAppt\(|auditUser\(|AUDIT_ACTION|AUDIT_VIEW_ACTION/.test(code)) continue;
      for (const m of code.matchAll(/\baction:\s*'([a-zA-Z.]+)'/g)) found.add(m[1]!);
      for (const m of code.matchAll(/auditAppt\([^)]*?'([a-z]+\.[a-zA-Z.]+)'/g)) found.add(m[1]!);
      for (const m of code.matchAll(/auditUser\([^)]*?'([a-z]+\.[a-zA-Z.]+)'/g)) found.add(m[1]!);
      for (const m of code.matchAll(/AUDIT_(?:VIEW_)?ACTION\s*=\s*'([a-zA-Z.]+)'/g)) found.add(m[1]!);
    }
    expect(found.size).toBeGreaterThan(15);
    const missing = [...found].filter((a) => !Object.prototype.hasOwnProperty.call(AUDIT_META_WHITELIST, a));
    expect(missing, 'action ที่เขียน audit แต่ไม่มีใน AUDIT_META_WHITELIST').toEqual([]);
  });

  it('whitelist ไม่มีคีย์ต้องห้าม (ตรงกับที่ repo ปฏิเสธตอนเขียน)', () => {
    for (const [a, keys] of Object.entries(AUDIT_META_WHITELIST)) {
      for (const k of keys) expect(/pin|token|hash|secret|pepper|code|password|note|title|name/i.test(k), `${a}.${k}`).toBe(false);
    }
  });
});

describe('D. unit', () => {
  it('escapeLike: \\ ก่อน แล้ว % _', () => {
    expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
    expect(escapeLike('ธรรมดา')).toBe('ธรรมดา');
  });

  it('filterAuditMeta: whitelist + ค่าพื้นฐานเท่านั้น · ไม่ใช้ prototype', () => {
    expect(filterAuditMeta('member.remove', { targetUserId: 'u', x: 1, targetRole: 'member' })).toEqual({ targetUserId: 'u', targetRole: 'member' });
    expect(filterAuditMeta('group.update', { fields: ['name', 3] })).toEqual({});
    expect(filterAuditMeta('group.update', { fields: ['a‮b'] })).toEqual({ fields: ['ab'] });
    expect(filterAuditMeta('toString', { a: 1 })).toEqual({});
    expect(filterAuditMeta('__proto__', { a: 1 })).toEqual({});
    expect(filterAuditMeta('member.remove', null)).toEqual({});
    expect(filterAuditMeta('member.remove', ['targetUserId'])).toEqual({});
    expect(filterAuditMeta('member.remove', { targetUserId: 'x'.repeat(500) }).targetUserId).toHaveLength(64);
    expect(filterAuditMeta('admin.user.unlock', { wasLocked: Infinity })).toEqual({});
  });

  it('cursor: เข้ารหัส/ถอดกลับได้ · ผิดรูป → AppError VALIDATION', () => {
    const c = { createdAt: 1_700_000_000_000, id: '00000000-0000-4000-8000-000000000001' };
    expect(decodeKeysetCursor(encodeKeysetCursor(c))).toEqual(c);
    expect(decodeKeysetCursor(undefined)).toBeNull();
    expect(decodeKeysetCursor('')).toBeNull();
    for (const bad of ['!!', 'x'.repeat(300), Buffer.from('null').toString('base64url'), Buffer.from('{"c":1.5,"i":"00000000-0000-4000-8000-000000000001"}').toString('base64url')]) {
      let err: unknown;
      try {
        decodeKeysetCursor(bad, 'before');
      } catch (e) {
        err = e;
      }
      expect(isAppError(err) && err.code === 'VALIDATION' && JSON.stringify(err.params) === '{"fields":{"before":"INVALID"}}', bad).toBe(true);
    }
    const rows = [1, 2, 3].map((i) => ({ createdAt: 10 - i, id: `00000000-0000-4000-8000-00000000000${i}` }));
    expect(page(rows, 2).items).toHaveLength(2);
    expect(decodeKeysetCursor(page(rows, 2).nextCursor!)).toEqual(rows[1]);
    expect(page(rows, 3).nextCursor).toBeNull();
  });

  it('parseSearchTerm: ว่าง → null · NFKC lower สำหรับ username · NFC สำหรับชื่อ · escape', () => {
    expect(parseSearchTerm(undefined)).toBeNull();
    expect(parseSearchTerm('   ')).toBeNull();
    expect(parseSearchTerm(' ＣＡＴ_% ')).toEqual({ usernamePrefix: 'cat\\_\\%', contains: 'ＣＡＴ\\_%'.replace('%', '\\%') });
    expect(() => parseSearchTerm('a'.repeat(41))).toThrow();
    expect(() => parseSearchTerm('a​b')).toThrow();
  });
});
