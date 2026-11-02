// R6D — unit: SQL ของ going/คำมั่นของฉัน (ADR 0009 Security ข้อ 3) · serializer ต่อชนิด (ข้อ 4) · รวมช่วงกลุ่มอื่น · เลือกกลุ่มจากคุกกี้ (R6D-2)
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { afterAll, describe, expect, expectTypeOf, it } from 'vitest';
import { createDb } from '@/db/client';
import { goingBusyInGroupQuery, type GoingBusyRow } from '@/lib/data/repos/busy';
import { myCommitmentsSql } from '@/lib/data/repos/appointment';
import {
  BUSY_VIEW_FIELDS,
  compareBusyViews,
  mergeOtherGroupViews,
  toBusyForViewers,
  toGoingForViewers,
  type MemberBusyView,
  type OtherGroupBusyView,
} from '@/lib/data/serializers/busy';
import {
  CURRENT_GROUP_COOKIE,
  chooseCalendarGroup,
  clearCurrentGroupCookie,
  currentGroupCookie,
  parseCurrentGroupCookie,
} from '@/lib/shared/current-group-cookie';
import { serializeCookie } from '@/app/api/_lib/cookies';

const db = createDb({ url: ':memory:' });
afterAll(() => db.$client.close());

const G = '11111111-1111-4111-8111-111111111111';
const G2 = '22222222-2222-4222-8222-222222222222';
const G3 = '33333333-3333-4333-8333-333333333333';
const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('ADR 0009 ข้อ 3 — SQL', () => {
  const q = goingBusyInGroupQuery(db, G, 0, 1000, 11, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee').toSQL();
  const text = q.sql.toLowerCase();

  it('going query: title/id ของนัดอยู่ใน CASE WHEN group_id = ? เท่านั้น · ไม่ SELECT place/lat/lng/map_url/description/group_id/tz ของนัด', () => {
    expect(text).toMatch(/case when "appointment"\."group_id" = \? then "appointment"\."id" else null end/);
    expect(text).toMatch(/case when "appointment"\."group_id" = \? then "appointment"\."title" else null end/);
    const select = text.slice(0, text.indexOf(' from '));
    for (const col of ['place_name', 'lat', 'lng', 'map_url', 'description', '"tz"']) expect(select.includes(col), col).toBe(false);
    // group_id ปรากฏใน SELECT เฉพาะในนิพจน์เปรียบเทียบ (ไม่ใช่คอลัมน์ผลลัพธ์)
    expect(select.replace(/"appointment"\."group_id" = \?/g, '')).not.toContain('group_id');
    expect(text).not.toContain('note');
  });

  it('going query: กติกา §1 ครบ (going · active · กลุ่มไม่ลบ · สมาชิกกลุ่มนัด + updated_at >= joined_at · ครึ่งเปิด) + exclude ผูกกลุ่มที่ดู', () => {
    expect(text).toContain(`"appointment_rsvp"."response" = ?`);
    expect(text).toContain(`"appointment"."status" = ?`);
    expect(text).toContain(`"groups"."deleted_at" is null`);
    expect(text).toContain(`"appointment_rsvp"."updated_at" >= "am"."joined_at"`);
    expect(text).toContain(`"appointment"."start_at" < ?`);
    expect(text).toContain(`"appointment"."end_at" > ?`);
    expect(text).toMatch(/not \("appointment"\."id" = \? and "appointment"\."group_id" = \?\)/);
    expect(q.params).toContain('going');
    expect(q.params).toContain('active');
  });

  it('คำมั่นของฉัน (UNION ALL): ไม่มี note · ทั้งสองฝั่งผูก user_id ของฉัน · ครึ่งเปิด', () => {
    const s = new SQLiteSyncDialect().sqlToQuery(myCommitmentsSql(U, 10, 20, null, 6));
    expect(s.sql.toLowerCase()).not.toContain('note');
    expect(s.sql).toContain('UNION ALL');
    expect(s.sql).toMatch(/r\.user_id = \?/);
    expect(s.sql).toMatch(/b\.user_id = \?/);
    expect(s.sql).toMatch(/a\.start_at < \? AND a\.end_at > \?/);
    expect(s.sql).toMatch(/b\.start_at < \? AND b\.end_at > \?/);
    expect(s.sql).toContain('r.updated_at >= am.joined_at');
    expect(s.params.filter((p) => p === U)).toHaveLength(2);
    const ex = new SQLiteSyncDialect().sqlToQuery(myCommitmentsSql(U, 10, 20, G2, 6));
    expect(ex.sql).toContain('a.id <> ?');
  });
});

describe('ADR 0009 ข้อ 4 — serializer ต่อชนิด', () => {
  const row = (o: Partial<GoingBusyRow>): GoingBusyRow => ({ userId: U, startAt: 0, endAt: 10, sameGroup: false, appointmentId: null, title: null, ...o });

  it('นัดกลุ่มอื่น: key ครบตาม allowlist เท่านั้น — ไม่มี id/title แม้แถวจะแฝงมา (ตัดซ้ำชั้นที่สอง)', () => {
    const v = toGoingForViewers({ ...row({ appointmentId: 'LEAK-ID', title: 'LEAK-TITLE' }), placeName: 'LEAK-P', groupId: G2 } as never);
    expect(Object.keys(v).sort()).toEqual([...BUSY_VIEW_FIELDS.other_group_appointment].sort());
    expect(JSON.stringify(v)).not.toMatch(/LEAK/);
  });

  it('นัดกลุ่มเดียวกัน: appointment + title (ทำความสะอาด) · key ตาม allowlist', () => {
    const v = toGoingForViewers(row({ sameGroup: true, appointmentId: 'id1', title: 'กิน​ข้าว' }));
    expect(v).toEqual({ kind: 'appointment', appointmentId: 'id1', userId: U, title: 'กินข้าว', startAt: 0, endAt: 10 });
    expect(Object.keys(v).sort()).toEqual([...BUSY_VIEW_FIELDS.appointment].sort());
  });

  it('type-level: OtherGroupBusyView ไม่มี title/appointmentId/tz · busy มี kind', () => {
    expectTypeOf<OtherGroupBusyView>().not.toHaveProperty('title');
    expectTypeOf<OtherGroupBusyView>().not.toHaveProperty('appointmentId');
    expectTypeOf<OtherGroupBusyView>().not.toHaveProperty('tz');
    const b = toBusyForViewers({ id: 'x', userId: U, allDay: false, startAt: 0, endAt: 1, localStartDate: '2026-10-01', localEndDate: '2026-10-01', tz: 'Asia/Bangkok', hideDetail: true, title: null });
    expect(b.kind).toBe('busy');
  });

  it('รวมช่วงกลุ่มอื่นของคนเดียวกันที่ทับ/ชนขอบ (ไม่บอกจำนวนนัด) · คนละคนไม่รวม · appointment ไม่รวม', () => {
    const other = (userId: string, s: number, e: number) => toGoingForViewers(row({ userId, startAt: s, endAt: e }));
    const appt = toGoingForViewers(row({ sameGroup: true, appointmentId: 'a', title: 't', startAt: 5, endAt: 7 }));
    const merged = mergeOtherGroupViews([other(U, 0, 10), other(U, 10, 20), other(U, 15, 18), other(U, 30, 40), other(U2, 5, 12), appt]);
    expect(merged).toEqual([
      { kind: 'other_group_appointment', userId: U, startAt: 0, endAt: 20 },
      { kind: 'appointment', appointmentId: 'a', userId: U, title: 't', startAt: 5, endAt: 7 },
      { kind: 'other_group_appointment', userId: U2, startAt: 5, endAt: 12 },
      { kind: 'other_group_appointment', userId: U, startAt: 30, endAt: 40 },
    ]);
  });

  it('ลำดับ busy[]: startAt, endAt, kind (busy < appointment < other), id', () => {
    const v: MemberBusyView[] = [
      { kind: 'other_group_appointment', userId: U, startAt: 0, endAt: 5 },
      { kind: 'appointment', appointmentId: 'z', userId: U, title: 't', startAt: 0, endAt: 5 },
      { kind: 'busy', id: 'b', userId: U, allDay: false, startAt: 0, endAt: 5, localStartDate: '', localEndDate: '', tz: '' },
      { kind: 'busy', id: 'a', userId: U, allDay: false, startAt: 0, endAt: 9, localStartDate: '', localEndDate: '', tz: '' },
    ];
    expect([...v].sort(compareBusyViews).map((x) => x.kind + (x.kind === 'busy' ? x.id : ''))).toEqual(['busyb', 'appointment', 'other_group_appointment', 'busya']);
  });
});

describe('R6D-2 — คุกกี้ mm_group (pure)', () => {
  const mine = [G, G2];

  it('ไม่มี ?g= + คุกกี้เป็นกลุ่มของฉัน → ใช้คุกกี้', () => {
    expect(chooseCalendarGroup(mine, undefined, G2)).toEqual({ gid: G2, groupMissing: false, rememberGid: null });
  });

  it.each([
    ['ไม่มีคุกกี้', null],
    ['ว่าง', ''],
    ['id มั่ว', 'not-a-uuid'],
    ['injection', `${G2}; Path=/`],
    ['กลุ่มที่ออกแล้ว/ถูกลบ/ไม่ใช่สมาชิก (ไม่อยู่ในรายชื่อกลุ่มของฉัน)', G3],
  ])('คุกกี้ใช้ไม่ได้ (%s) → กลุ่มแรก · groupMissing=false (ไม่รั่วว่ากลุ่มมีอยู่) · ไม่ error', (_n, raw) => {
    expect(chooseCalendarGroup(mine, undefined, raw)).toEqual({ gid: G, groupMissing: false, rememberGid: null });
  });

  it('?g= ที่เป็นกลุ่มของฉันชนะคุกกี้ และขอให้จำ (rememberGid) เมื่อต่างจากคุกกี้ · เท่ากันแล้วไม่ต้องจำซ้ำ', () => {
    expect(chooseCalendarGroup(mine, G2, G)).toEqual({ gid: G2, groupMissing: false, rememberGid: G2 });
    expect(chooseCalendarGroup(mine, G2, G2)).toEqual({ gid: G2, groupMissing: false, rememberGid: null });
    expect(chooseCalendarGroup(mine, G2, 'junk')).toEqual({ gid: G2, groupMissing: false, rememberGid: G2 });
  });

  it('?g= ที่ไม่ใช่กลุ่มของฉัน → groupMissing=true แล้วใช้คุกกี้ (ถ้าใช้ได้) หรือกลุ่มแรก · ไม่จำ', () => {
    expect(chooseCalendarGroup(mine, G3, G2)).toEqual({ gid: G2, groupMissing: true, rememberGid: null });
    expect(chooseCalendarGroup(mine, G3, null)).toEqual({ gid: G, groupMissing: true, rememberGid: null });
    expect(chooseCalendarGroup(mine, '', G2)).toEqual({ gid: G2, groupMissing: false, rememberGid: null });
  });

  it('parse: uuid เท่านั้น', () => {
    expect(parseCurrentGroupCookie(G)).toBe(G);
    expect(parseCurrentGroupCookie('x')).toBeNull();
    expect(parseCurrentGroupCookie(undefined)).toBeNull();
  });

  it('Set-Cookie: ตั้ง = HttpOnly; Secure; SameSite=Lax; Max-Age 1 ปี · ลบ = ค่าว่าง Max-Age=0', () => {
    expect(serializeCookie(currentGroupCookie(G))).toBe(`${CURRENT_GROUP_COOKIE}=${G}; Path=/; Max-Age=31536000; SameSite=Lax; Secure; HttpOnly`);
    expect(serializeCookie(clearCurrentGroupCookie())).toBe(`${CURRENT_GROUP_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly`);
  });
});
