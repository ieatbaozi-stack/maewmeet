// R6D — ฟังก์ชันล้วนฝั่ง UI: popup ยืนยัน RSVP · ป้ายชน · เวลาของสิ่งที่ชน/นัดที่ตอบไป · แถวเตือนนัดทับ 3 ชนิด · แปลง busy[] 3 kind
import { describe, expect, it } from 'vitest';
import {
  conflictWhen,
  goingWhen,
  overlapView,
  rsvpConfirmKind,
  showConflictBadge,
  type MyConflict,
  type Rsvp,
} from '@/components/appointments/model';
import { busyKindOf, itemApptHref, toSharedBusy, type ApiBusyItem } from '@/components/calendar/model';
import { parseLocalDateTime } from '@/lib/calendar';
import type { AppointmentDetailDto, OverlapDto } from '@/lib/data/serializers/appointments';

const TZ = 'Asia/Bangkok';
const at = (date: string, time: string) => parseLocalDateTime(date, time, TZ);

describe('rsvpConfirmKind — เมื่อไรต้องมี popup (R6D-5)', () => {
  const ANS: (Rsvp | null)[] = [null, 'going', 'maybe', 'not_going'];
  const NEXT: Rsvp[] = ['going', 'maybe', 'not_going'];
  // ตารางเต็ม 4 × 3: (ก่อน → หลัง) = ผลที่คาด
  const EXPECT: Record<string, 'to' | 'from' | null> = {
    'null>going': 'to',
    'null>maybe': null,
    'null>not_going': null,
    'going>going': null,
    'going>maybe': 'from',
    'going>not_going': 'from',
    'maybe>going': 'to',
    'maybe>maybe': null,
    'maybe>not_going': null,
    'not_going>going': 'to',
    'not_going>maybe': null,
    'not_going>not_going': null,
  };
  for (const prev of ANS) {
    for (const next of NEXT) {
      const key = `${prev}>${next}`;
      it(`${key} → ${EXPECT[key]}`, () => expect(rsvpConfirmKind(prev, next)).toBe(EXPECT[key]));
    }
  }
  it('ครอบทุกช่องของตาราง (กันลืมเพิ่มคำตอบ)', () => expect(Object.keys(EXPECT)).toHaveLength(ANS.length * NEXT.length));
});

describe('showConflictBadge — ป้ายชนกับนัดอื่น (เจ้าตัวเท่านั้น)', () => {
  const conflict: MyConflict = { kind: 'busy', busyId: 'b1', title: null, allDay: false, startAt: 1, endAt: 2, localStartDate: '2026-10-07', localEndDate: '2026-10-07', tz: TZ };
  const a = (over: Partial<Pick<AppointmentDetailDto, 'rsvp' | 'myConflicts' | 'status' | 'isPast'>> = {}) =>
    ({ rsvp: { mine: 'going' }, myConflicts: [conflict], status: 'active', isPast: false, ...over }) as Pick<AppointmentDetailDto, 'rsvp' | 'myConflicts' | 'status' | 'isPast'>;

  it('ไป + มีรายการชน + นัดเปิดอยู่ = แสดง', () => expect(showConflictBadge(a())).toBe(true));
  it('ไม่มีรายการชน = ไม่แสดง', () => expect(showConflictBadge(a({ myConflicts: [] }))).toBe(false));
  for (const mine of ['maybe', 'not_going', null] as const) {
    it(`ตอบ ${mine} = ไม่แสดง (ชนได้เฉพาะคนที่ตอบ "ไป")`, () => expect(showConflictBadge(a({ rsvp: { mine } as never }))).toBe(false));
  }
  it('นัดยกเลิก = ไม่แสดง', () => expect(showConflictBadge(a({ status: 'cancelled' }))).toBe(false));
  it('นัดจบแล้ว = ไม่แสดง', () => expect(showConflictBadge(a({ isPast: true }))).toBe(false));
});

describe('conflictWhen / goingWhen — ข้อความเวลา (ผ่าน src/lib/calendar)', () => {
  it('นัดที่ชน (วันเดียว) → calendar.day.range HH:MM–HH:MM', () => {
    const c: MyConflict = { kind: 'appointment', appointmentId: 'a', title: 'หมูกระทะ', groupId: 'g', groupName: 'ลั้ลลา', startAt: at('2026-10-07', '18:00'), endAt: at('2026-10-07', '20:00'), tz: TZ };
    expect(conflictWhen(c, 'th')).toEqual({ key: 'calendar.day.range', values: { start: '18:00', end: '20:00' } });
  });
  it('นัดที่ชน ข้ามคืน → appointments.when.overnight', () => {
    const c: MyConflict = { kind: 'appointment', appointmentId: 'a', title: 'x', groupId: 'g', groupName: 'y', startAt: at('2026-10-07', '22:00'), endAt: at('2026-10-08', '02:00'), tz: TZ };
    expect(conflictWhen(c, 'th')).toEqual({ key: 'appointments.when.overnight', values: { start: '22:00', end: '02:00' } });
  });
  it('busy ทั้งวัน → ข้อความวัน (busy.when.allDay) ไม่ใช่ช่วงเวลา', () => {
    const c: MyConflict = { kind: 'busy', busyId: 'b', title: null, allDay: true, startAt: at('2026-10-07', '00:00'), endAt: at('2026-10-08', '00:00'), localStartDate: '2026-10-07', localEndDate: '2026-10-07', tz: TZ };
    expect(conflictWhen(c, 'th').key).toBe('busy.when.allDay');
  });
  it('busy ตามเวลา → ช่วงเวลาใน tz ของมันเอง (ไม่ใช่เวลาเครื่อง)', () => {
    const c: MyConflict = { kind: 'busy', busyId: 'b', title: 'ซ้อมดนตรี', allDay: false, startAt: at('2026-10-07', '10:00'), endAt: at('2026-10-07', '11:30'), localStartDate: '2026-10-07', localEndDate: '2026-10-07', tz: TZ };
    expect(conflictWhen(c, 'en')).toEqual({ key: 'calendar.day.range', values: { start: '10:00', end: '11:30' } });
  });
  it('goingWhen: นัดวันเดียว → busy.when.timed (วัน + เวลา) ใน tz ของนัด', () => {
    const w = goingWhen({ startAt: at('2026-10-07', '12:00'), endAt: at('2026-10-07', '15:00'), tz: TZ }, 'en');
    expect(w.key).toBe('busy.when.timed');
    expect(w.values).toMatchObject({ start: '12:00', end: '15:00' });
  });
  it('goingWhen: เวลาของนัดใน tz อื่นแสดงตาม tz ของนัด (ไม่เลื่อนตามเครื่อง)', () => {
    const start = parseLocalDateTime('2026-10-07', '12:00', 'Asia/Tokyo');
    const w = goingWhen({ startAt: start, endAt: start + 3 * 3_600_000, tz: 'Asia/Tokyo' }, 'en');
    expect(w.values).toMatchObject({ start: '12:00', end: '15:00' });
  });
  it('goingWhen: ข้ามคืน → busy.when.timedSpan', () => {
    const w = goingWhen({ startAt: at('2026-10-07', '22:00'), endAt: at('2026-10-08', '02:00'), tz: TZ }, 'th');
    expect(w.key).toBe('busy.when.timedSpan');
  });
});

describe('overlapView — kind ของแถว (busy | appointment | other_group_appointment)', () => {
  const ctxV = { myId: 'me', tz: TZ, locale: 'th' as const };
  const dto = (items: unknown[]) => ({ status: 'ok', blocked: [{ userId: 'u1', displayName: 'คน1', colorIndex: 1, shapeIndex: 1, items }] }) as unknown as OverlapDto;
  const rowsOf = (items: unknown[]) => {
    const v = overlapView(dto(items), ctxV);
    return v.kind === 'warn' ? v.people[0]!.rows : [];
  };
  const s = at('2026-10-07', '12:00');
  const e = at('2026-10-07', '15:00');

  it('ไม่มี kind (ข้อมูลเดิม) = busy', () => {
    const [r] = rowsOf([{ id: 'i1', userId: 'u1', allDay: false, startAt: s, endAt: e, localStartDate: '2026-10-07', localEndDate: '2026-10-07', tz: TZ, title: 'ซ้อม' }]);
    expect(r).toMatchObject({ kind: 'busy', title: 'ซ้อม' });
  });
  it('kind appointment = นัดของกลุ่มนี้ (มี title)', () => {
    const [r] = rowsOf([{ kind: 'appointment', appointmentId: 'ap1', userId: 'u1', title: 'กินข้าว', startAt: s, endAt: e }]);
    expect(r).toMatchObject({ kind: 'appointment', title: 'กินข้าว', when: { key: 'calendar.day.range', values: { start: '12:00', end: '15:00' } } });
  });
  it('kind other_group_appointment = ไม่มีชื่อ (title null) และแถวไม่มีข้อมูลอื่นนอกจากเวลา', () => {
    const [r] = rowsOf([{ kind: 'other_group_appointment', userId: 'u1', startAt: s, endAt: e }]);
    expect(r).toMatchObject({ kind: 'other_group_appointment', title: null });
    expect(Object.keys(r!).sort()).toEqual(['key', 'kind', 'title', 'when']);
  });
  it('key ของแถวไม่ซ้ำกันเมื่อมีนัด/นัดกลุ่มอื่นหลายรายการ (ไม่มี id ของ busy)', () => {
    const rows = rowsOf([
      { kind: 'other_group_appointment', userId: 'u1', startAt: s, endAt: e },
      { kind: 'other_group_appointment', userId: 'u1', startAt: e, endAt: e + 3_600_000 },
    ]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });
});

describe('toSharedBusy / busyKindOf / itemApptHref — busy[] 3 kind → รูปเดิมของ UI', () => {
  const s = at('2026-10-07', '12:00');
  const e = at('2026-10-07', '15:00');

  it('kind busy ผ่านตรง ๆ (ไม่แตะ)', () => {
    const b: ApiBusyItem = { kind: 'busy', id: 'b1', userId: 'u1', allDay: false, startAt: s, endAt: e, localStartDate: '2026-10-07', localEndDate: '2026-10-07', tz: TZ, title: 'ซ้อม' };
    expect(toSharedBusy(b, TZ)).toBe(b);
  });
  it('appointment → timed ใน tz กลุ่ม · มี kind/appointmentId/title · id สังเคราะห์ไม่ใช่ id busy', () => {
    const r = toSharedBusy({ kind: 'appointment', appointmentId: 'ap1', userId: 'u1', title: 'กินข้าว', startAt: s, endAt: e }, TZ);
    expect(r).toMatchObject({ kind: 'appointment', appointmentId: 'ap1', title: 'กินข้าว', userId: 'u1', allDay: false, tz: TZ, localStartDate: '2026-10-07', localEndDate: '2026-10-07' });
    expect(r.id).toBe('appt:ap1:u1');
  });
  it('other_group_appointment → ไม่มี title และไม่มี appointmentId ในผลลัพธ์', () => {
    const r = toSharedBusy({ kind: 'other_group_appointment', userId: 'u1', startAt: s, endAt: e }, TZ);
    expect(r.kind).toBe('other_group_appointment');
    expect('title' in r).toBe(false);
    expect('appointmentId' in r).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/appt:|appointmentId|groupName|"title"/);
  });
  it('นัดจบตรงเที่ยงคืน → วันจบ (ท้องถิ่น) เป็นวันเดียวกับวันเริ่ม (end เป็นขอบเปิด)', () => {
    const r = toSharedBusy({ kind: 'other_group_appointment', userId: 'u1', startAt: at('2026-10-07', '21:00'), endAt: at('2026-10-08', '00:00') }, TZ);
    expect(r.localStartDate).toBe('2026-10-07');
    expect(r.localEndDate).toBe('2026-10-07');
  });
  it('นัดข้ามคืน → วันจบเป็นวันถัดไป', () => {
    const r = toSharedBusy({ kind: 'other_group_appointment', userId: 'u1', startAt: at('2026-10-07', '22:00'), endAt: at('2026-10-08', '02:00') }, TZ);
    expect(r.localEndDate).toBe('2026-10-08');
  });
  it('busyKindOf: ไม่มี kind = busy', () => {
    expect(busyKindOf({})).toBe('busy');
    expect(busyKindOf({ kind: 'appointment' })).toBe('appointment');
    expect(busyKindOf({ kind: 'other_group_appointment' })).toBe('other_group_appointment');
  });
  it('itemApptHref: เฉพาะ appointment ที่มี id (encode) · ที่เหลือ null (นัดกลุ่มอื่นแตะไม่ได้)', () => {
    expect(itemApptHref({ kind: 'appointment', appointmentId: 'ap 1' })).toBe('/appointments/ap%201');
    expect(itemApptHref({ kind: 'appointment' })).toBeNull();
    expect(itemApptHref({ kind: 'other_group_appointment' })).toBeNull();
    expect(itemApptHref({})).toBeNull();
  });
});
