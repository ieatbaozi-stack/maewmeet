// R2-10: โค้ดเชิญเต็มไม่อยู่ใน log / audit / notification / response อื่นนอกตอนสร้าง · ไม่มี hash หลุดออก API
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { del, dumpAllTables, get, makeGroup, patch, person, post, setupHarness, type Harness, type Person } from './harness';

let h: Harness;
beforeEach(async () => {
  h = await setupHarness();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await h.cleanup();
});

describe('โค้ดเชิญเต็มปรากฏได้ครั้งเดียว: response ของ POST …/invites/code', () => {
  it('ไล่ flow ทั้งหมด (สร้าง/ใช้ถูก/ใช้ผิด/ชนลิมิต/เพิกถอน/ลบสมาชิก/ลบกลุ่ม) แล้วค้นโค้ดในทุก response ที่เหลือ + console + ทุกตารางของฐาน', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const a = await person(h, 'alice');
    const b = await person(h, 'bob');
    const c = await person(h, 'cara');
    const gid = await makeGroup(a);

    const responses: { label: string; text: string }[] = [];
    const rec = async <T extends { text: string }>(label: string, p: Promise<T>): Promise<T> => {
      const r = await p;
      responses.push({ label, text: r.text });
      return r;
    };

    const created = await post<{ invite: { id: string; code: string; codeHint: string } }>(a.c, `/api/groups/${gid}/invites/code`);
    const code = created.data.invite.code;
    const plain = code.replace('-', '');
    expect(created.text).toContain(code); // ครั้งเดียว ที่นี่
    const inviteId = created.data.invite.id;

    await rec('redeem ok', post(b.c, '/api/invites/redeem', { code: code.toLowerCase() }));
    await rec('redeem again', post(b.c, '/api/invites/redeem', { code }));
    for (let i = 0; i < 12; i++) await rec(`wrong ${i}`, post(c.c, '/api/invites/redeem', { code: `${plain.slice(0, 7)}${i % 2 ? 'X' : 'Y'}` })); // เดาใกล้เคียง → ติด rate limit ด้วย
    await rec('detail', get(a.c, `/api/groups/${gid}`));
    await rec('list groups', get(b.c, '/api/groups'));
    await rec('list invites (admin)', get(a.c, `/api/groups/${gid}/invites`));
    await rec('list invites (member)', get(b.c, `/api/groups/${gid}/invites`));
    await rec('my invites', get(b.c, '/api/me/invites'));
    await rec('patch group', patch(a.c, `/api/groups/${gid}`, { name: 'ใหม่' }));
    await rec('revoke', del(a.c, `/api/groups/${gid}/invites/${inviteId}`));
    await rec('revoke again', del(a.c, `/api/groups/${gid}/invites/${inviteId}`));
    await rec('redeem revoked', post(c.c, '/api/invites/redeem', { code }));
    await rec('remove member', del(a.c, `/api/groups/${gid}/members/${b.id}`));
    await rec('delete group', del(a.c, `/api/groups/${gid}`));

    for (const r of responses) {
      expect(r.text, r.label).not.toContain(plain);
      expect(r.text, r.label).not.toContain(code);
      expect(r.text, r.label).not.toMatch(/code_?hash/i);
      expect(r.text, r.label).not.toMatch(/\b[0-9a-f]{64}\b/);
    }
    const logged = spies.flatMap((s) => s.mock.calls).map((args) => args.map(String).join(' ')).join('\n');
    expect(logged).not.toContain(plain);
    expect(logged).not.toContain(code);
    const dump = await dumpAllTables(h);
    expect(dump).not.toContain(plain);
    expect(dump).not.toContain(code);
    // audit + notification โดยเฉพาะ (มีแถวจริง ไม่ใช่ว่างจนผ่านเอง)
    expect(await h.count("audit_log WHERE action IN ('invite.code.create','invite.code.redeem','invite.revoke')")).toBeGreaterThanOrEqual(3);
    const auditNotif = JSON.stringify(await h.rows('SELECT meta FROM audit_log')) + JSON.stringify(await h.rows('SELECT params FROM notification'));
    expect(auditNotif).not.toContain(plain);
    // hint คือ 4 ตัวท้ายเท่านั้น และอยู่เฉพาะคอลัมน์ code_hint
    expect(await h.rows('SELECT code_hint FROM group_invite')).toEqual([{ code_hint: plain.slice(-4) }]);
  });

  it('repo ของ audit ปฏิเสธ meta ที่มีคีย์ code/hash (ด่านสุดท้าย)', async () => {
    const { insertAuditLog } = await import('@/lib/data/repos/audit-log');
    await expect(insertAuditLog(h.db, { id: 'x', actorId: null, action: 'a', targetType: 'invite', targetId: 't', meta: { code: 'ABCD-EFGH' } }, 1)).rejects.toThrow(/not allowed/);
    await expect(insertAuditLog(h.db, { id: 'y', actorId: null, action: 'a', targetType: 'invite', targetId: 't', meta: { codeHint: '1234' } }, 1)).rejects.toThrow(/not allowed/);
  });
});

describe('ผลลัพธ์ที่ error ห่อมา', () => {
  it('error body ของ INVITE_INVALID/RATE_LIMITED ไม่สะท้อนโค้ดที่ผู้ใช้พิมพ์', async () => {
    const b: Person = await person(h, 'bob');
    for (let i = 0; i < 12; i++) {
      const r = await post(b.c, '/api/invites/redeem', { code: 'QWER-TYUP' });
      expect(r.text).not.toMatch(/QWER|TYUP/);
    }
  });
});
