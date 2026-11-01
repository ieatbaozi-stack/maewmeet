// โมเดลนัด (R4B): form → payload · error → ช่อง · ค่าตั้งต้นจากช่วงว่าง · view-model เตือนนัดทับ · RSVP optimistic
import { describe, expect, it } from 'vitest';
import type { Failure } from '@/components/appointments/api';
import {
  DEFAULT_END,
  DEFAULT_START,
  apptPhase,
  appointmentWhen,
  applyRsvp,
  applyRsvpCounts,
  buildCreatePayload,
  buildPatchPayload,
  coordsText,
  durationMinutes,
  emptyForm,
  formStateOfAppointment,
  mapFormFailure,
  minutesOfClock,
  overlapView,
  parsePlaceResults,
  placeFromResult,
  placeSearchFailure,
  prefillFromSegment,
  resolveEnd,
  rowState,
  rsvpClosedReason,
  textLength,
  type ApptFormState,
} from '@/components/appointments/model';
import { parseLocalDateTime } from '@/lib/calendar';
import type { AppointmentDetailDto, OverlapDto, RsvpDetailDto } from '@/lib/data/serializers/appointments';

const TZ = 'Asia/Bangkok';
const NOW = parseLocalDateTime('2026-10-20', '18:00', TZ);
const ctx = { tz: TZ, nowMs: NOW, checkPast: true };
const form = (over: Partial<ApptFormState> = {}): ApptFormState => ({ ...emptyForm('2026-10-24'), title: 'หมูกระทะ', ...over });

const api = (code: string, values: Record<string, string | number> = {}, fields: Record<string, string> = {}): Failure =>
  ({ ok: false, kind: 'api', status: 400, error: { code, key: `errors.${code}`, values }, fields }) as unknown as Failure;
const network = { ok: false, kind: 'network' } as unknown as Failure;

describe('prefillFromSegment (UX §9.4)', () => {
  it('เริ่ม = เริ่มช่วง · จบ = min(จบช่วง, เริ่ม+3 ชม.)', () => {
    expect(prefillFromSegment({ start: '13:00', end: '19:00' })).toEqual({ startTime: '13:00', endTime: '16:00' });
    expect(prefillFromSegment({ start: '13:00', end: '14:30' })).toEqual({ startTime: '13:00', endTime: '14:30' });
    expect(prefillFromSegment({ start: '08:00', end: '11:00' })).toEqual({ startTime: '08:00', endTime: '11:00' });
  });
  it('ไม่มีช่วง = 18:00–21:00', () => {
    expect(prefillFromSegment(null)).toEqual({ startTime: DEFAULT_START, endTime: DEFAULT_END });
    expect(DEFAULT_START).toBe('18:00');
    expect(DEFAULT_END).toBe('21:00');
  });
  it('ช่วงจบเที่ยงคืน (24:00) → เวลาจบ 00:00 (ข้ามคืนอัตโนมัติ)', () => {
    expect(prefillFromSegment({ start: '22:00', end: '24:00' })).toEqual({ startTime: '22:00', endTime: '00:00' });
    expect(prefillFromSegment({ start: '21:00', end: '24:00' })).toEqual({ startTime: '21:00', endTime: '00:00' });
  });
  it('เวลาไม่ลงตัว 30 นาที → ปัดเข้าในช่วง (เริ่มขึ้น จบลง)', () => {
    expect(prefillFromSegment({ start: '09:10', end: '12:40' })).toEqual({ startTime: '09:30', endTime: '12:30' });
  });
  it('ช่วงสั้นเกินหรือรูปแบบผิด → ค่าตั้งต้น', () => {
    expect(prefillFromSegment({ start: '09:10', end: '09:40' })).toEqual({ startTime: '18:00', endTime: '21:00' });
    expect(prefillFromSegment({ start: 'x', end: '09:40' })).toEqual({ startTime: '18:00', endTime: '21:00' });
    expect(prefillFromSegment({ start: '24:00', end: '24:00' })).toEqual({ startTime: '18:00', endTime: '21:00' });
  });
  it('minutesOfClock', () => {
    expect(minutesOfClock('24:00')).toBe(1440);
    expect(minutesOfClock('24:30')).toBeNull();
    expect(minutesOfClock('7:00')).toBeNull();
  });
});

describe('resolveEnd / durationMinutes (ข้ามคืน)', () => {
  it('จบหลังเริ่ม = วันเดียวกัน', () => {
    expect(resolveEnd({ date: '2026-10-24', startTime: '18:00', endTime: '21:00' })).toEqual({ endDate: '2026-10-24', overnight: false });
  });
  it('จบ ≤ เริ่ม = วันถัดไป (รวมข้ามเดือน/ปี)', () => {
    expect(resolveEnd({ date: '2026-12-31', startTime: '22:00', endTime: '02:00' })).toEqual({ endDate: '2027-01-01', overnight: true });
    expect(resolveEnd({ date: '2026-10-31', startTime: '18:00', endTime: '18:00' })).toEqual({ endDate: '2026-11-01', overnight: true });
    expect(resolveEnd({ date: null, startTime: '18:00', endTime: '19:00' })).toBeNull();
  });
  it('ระยะรวมเป็นนาที', () => {
    expect(durationMinutes(form(), TZ)).toBe(180);
    expect(durationMinutes(form({ startTime: '22:00', endTime: '02:00' }), TZ)).toBe(240);
    expect(durationMinutes(form({ date: null }), TZ)).toBeNull();
  });
});

describe('buildCreatePayload', () => {
  it('ฟอร์มเปล่าไม่มีสถานที่ → ไม่ส่งฟิลด์สถานที่/คำอธิบาย', () => {
    const r = buildCreatePayload(form(), ctx);
    expect(r).toEqual({ ok: true, payload: { title: 'หมูกระทะ', startDate: '2026-10-24', startTime: '18:00', endDate: '2026-10-24', endTime: '21:00' } });
  });
  it('ข้ามคืน: endDate = วันถัดไป · 30 นาทีคงอยู่', () => {
    const r = buildCreatePayload(form({ date: '2026-12-31', startTime: '22:30', endTime: '02:00' }), ctx);
    expect(r.ok && r.payload).toMatchObject({ startDate: '2026-12-31', startTime: '22:30', endDate: '2027-01-01', endTime: '02:00' });
  });
  it('lat/lng ไปเป็นคู่ · ชื่อ+ลิงก์ผ่าน · NFC/trim', () => {
    const r = buildCreatePayload(form({ title: '  กำ  ', place: { name: ' ร้าน ', lat: 13.8, lng: 100.6, mapUrl: 'https://maps.example.com/x' } }), ctx);
    expect(r.ok && r.payload).toMatchObject({ title: 'กำ', placeName: 'ร้าน', lat: 13.8, lng: 100.6, mapUrl: 'https://maps.example.com/x' });
  });
  it('มี lat แต่ไม่มี lng (ข้อมูลครึ่งๆ) → ไม่ส่งทั้งคู่', () => {
    const r = buildCreatePayload(form({ place: { name: 'x', lat: 13.8, lng: null, mapUrl: null } }), ctx);
    expect(r.ok && 'lat' in r.payload).toBe(false);
    expect(r.ok && 'lng' in r.payload).toBe(false);
  });
  it('ลิงก์ล้วน (ไม่มีพิกัด) → ส่ง mapUrl อย่างเดียว', () => {
    const r = buildCreatePayload(form({ place: { name: null, lat: null, lng: null, mapUrl: 'https://maps.app.goo.gl/abc' } }), ctx);
    expect(r.ok && r.payload).toMatchObject({ mapUrl: 'https://maps.app.goo.gl/abc' });
    expect(r.ok && 'placeName' in r.payload).toBe(false);
  });
  it('คำอธิบายขึ้นบรรทัดได้ (\\r\\n → \\n) · ว่าง → ไม่ส่ง', () => {
    expect((buildCreatePayload(form({ description: 'a\r\nb\n' }), ctx) as { payload: { description: string } }).payload.description).toBe('a\nb');
    const r = buildCreatePayload(form({ description: '   \n ' }), ctx);
    expect(r.ok && 'description' in r.payload).toBe(false);
  });
  it('ชื่อว่าง/ยาวเกิน 80 ตามจำนวน code point · ไม่เลือกวัน', () => {
    const empty = buildCreatePayload(form({ title: '   ', date: null }), ctx);
    expect(empty.ok).toBe(false);
    expect(!empty.ok && empty.problems.map((p) => [p.pos, p.ref.key])).toEqual([
      ['title', 'appointments.form.error.title.required'],
      ['date', 'appointments.form.error.date.required'],
    ]);
    expect(buildCreatePayload(form({ title: '😀'.repeat(80) }), ctx).ok).toBe(true); // 80 code point (160 UTF-16)
    const long = buildCreatePayload(form({ title: 'ก'.repeat(81) }), ctx);
    expect(!long.ok && long.problems[0]).toMatchObject({ pos: 'title', ref: { key: 'appointments.form.error.title.tooLong', values: { max: 80 } } });
    expect(textLength('😀😀')).toBe(2);
  });
  it('คำอธิบายเกิน 1000 / ชื่อสถานที่เกิน 120', () => {
    const d = buildCreatePayload(form({ description: 'x'.repeat(1001) }), ctx);
    expect(!d.ok && d.problems[0]!.pos).toBe('description');
    expect(buildCreatePayload(form({ description: 'x'.repeat(1000) }), ctx).ok).toBe(true);
    const p = buildCreatePayload(form({ place: { name: 'x'.repeat(121), lat: null, lng: null, mapUrl: null } }), ctx);
    expect(!p.ok && p.problems[0]!.pos).toBe('place');
  });
  it('เริ่มย้อนหลังเกิน 1 ชม. → ปัญหาที่ช่องเวลา · ภายใน 1 ชม. ผ่าน', () => {
    const past = buildCreatePayload(form({ date: '2026-10-20', startTime: '16:30', endTime: '17:30' }), ctx);
    expect(!past.ok && past.problems[0]).toMatchObject({ pos: 'time', ref: { key: 'appointments.form.error.start.past', values: { hours: 1 } } });
    expect(buildCreatePayload(form({ date: '2026-10-20', startTime: '17:00', endTime: '19:00' }), ctx).ok).toBe(true);
  });
});

const appt = (over: Partial<AppointmentDetailDto> = {}): AppointmentDetailDto =>
  ({
    id: 'a1', groupId: 'g1', groupName: 'กลุ่ม', title: 'หมูกระทะ', description: 'รายละเอียด', placeName: 'ร้าน', lat: 13.8, lng: 100.6, mapUrl: 'https://maps.example.com/x',
    startAt: parseLocalDateTime('2026-10-24', '18:00', TZ), endAt: parseLocalDateTime('2026-10-24', '21:00', TZ), tz: TZ, localDate: '2026-10-24',
    status: 'active', isPast: false, daysUntil: 4, createdBy: null, createdAt: NOW, updatedAt: NOW, cancelledAt: null, cancelledBy: null,
    rsvp: { counts: { going: 0, maybe: 0, not_going: 0, noResponse: 3 }, mine: null, members: { going: [], maybe: [], not_going: [] } },
    permissions: { canEdit: true, canCancel: true, canRsvp: true },
    ...over,
  }) as AppointmentDetailDto;

describe('formStateOfAppointment / buildPatchPayload', () => {
  it('นัดเดิม → ฟอร์ม (วัน/เวลาใน tz ของนัด) · ไม่แก้อะไร = payload null', () => {
    const a = appt();
    const s = formStateOfAppointment(a);
    expect(s).toMatchObject({ title: 'หมูกระทะ', date: '2026-10-24', startTime: '18:00', endTime: '21:00', description: 'รายละเอียด' });
    expect(buildPatchPayload(s, a, { tz: TZ, nowMs: NOW })).toEqual({ ok: true, payload: null });
  });
  it('แก้เฉพาะชื่อ → ส่งแค่ title (เวลาไม่ไป)', () => {
    const a = appt();
    const r = buildPatchPayload({ ...formStateOfAppointment(a), title: 'ใหม่' }, a, { tz: TZ, nowMs: NOW });
    expect(r).toEqual({ ok: true, payload: { title: 'ใหม่' } });
  });
  it('แก้เวลา → ส่งทั้งก้อน 4 ฟิลด์', () => {
    const a = appt();
    const r = buildPatchPayload({ ...formStateOfAppointment(a), startTime: '19:00' }, a, { tz: TZ, nowMs: NOW });
    expect(r).toEqual({ ok: true, payload: { startDate: '2026-10-24', startTime: '19:00', endDate: '2026-10-24', endTime: '21:00' } });
  });
  it('นัดที่เริ่มไปแล้ว แก้คำอธิบายโดยไม่แตะเวลา → ไม่ตรวจ "ย้อนหลัง" และไม่ส่งเวลา', () => {
    const a = appt({ startAt: parseLocalDateTime('2026-10-20', '10:00', TZ), endAt: parseLocalDateTime('2026-10-20', '12:00', TZ), localDate: '2026-10-20' });
    const r = buildPatchPayload({ ...formStateOfAppointment(a), description: 'x' }, a, { tz: TZ, nowMs: NOW });
    expect(r).toEqual({ ok: true, payload: { description: 'x' } });
  });
  it('ล้างสถานที่ → null ทุกฟิลด์ที่เคยมี (lat+lng ไปคู่)', () => {
    const a = appt();
    const r = buildPatchPayload({ ...formStateOfAppointment(a), place: null }, a, { tz: TZ, nowMs: NOW });
    expect(r).toEqual({ ok: true, payload: { placeName: null, lat: null, lng: null, mapUrl: null } });
  });
  it('เปลี่ยนพิกัดอย่างเดียว → lat+lng ไปด้วยกัน · ล้างคำอธิบาย → null', () => {
    const a = appt();
    const s = formStateOfAppointment(a);
    const r = buildPatchPayload({ ...s, description: '', place: { ...s.place!, lat: 14 } }, a, { tz: TZ, nowMs: NOW });
    expect(r).toEqual({ ok: true, payload: { description: null, lat: 14, lng: 100.6 } });
  });
  it('ข้ามคืน (แก้เวลาจบเป็นก่อนเริ่ม) → endDate วันถัดไป', () => {
    const a = appt();
    const r = buildPatchPayload({ ...formStateOfAppointment(a), endTime: '02:00' }, a, { tz: TZ, nowMs: NOW });
    expect(r).toEqual({ ok: true, payload: { startDate: '2026-10-24', startTime: '18:00', endDate: '2026-10-25', endTime: '02:00' } });
  });
  it('ชื่อว่างตอนแก้ → ปัญหาที่ช่องชื่อ', () => {
    const a = appt();
    const r = buildPatchPayload({ ...formStateOfAppointment(a), title: ' ' }, a, { tz: TZ, nowMs: NOW });
    expect(!r.ok && r.problems[0]!.pos).toBe('title');
  });
});

describe('mapFormFailure (error → ช่อง)', () => {
  const pos = (f: Failure, mode: 'create' | 'edit' = 'create') => {
    const r = mapFormFailure(f, mode);
    return r.type === 'gone' ? 'gone' : r.problems.map((p) => `${p.pos}:${p.ref.key}`);
  };
  it('เครือข่าย → banner (ข้อความสร้าง/แก้ต่างกัน)', () => {
    expect(pos(network)).toEqual(['banner:appointments.form.error.save']);
    expect(pos(network, 'edit')).toEqual(['banner:appointments.form.error.saveEdit']);
  });
  it('NOT_FOUND → gone', () => expect(pos(api('NOT_FOUND'))).toBe('gone'));
  it('APPOINTMENT_PAST และ VALIDATION startTime IN_PAST → ช่องเวลา start.past', () => {
    expect(pos(api('APPOINTMENT_PAST'))).toEqual(['time:appointments.form.error.start.past']);
    expect(pos(api('VALIDATION', {}, { startTime: 'IN_PAST' }))).toEqual(['time:appointments.form.error.start.past']);
  });
  it('APPOINTMENT_CANCELLED → banner', () => expect(pos(api('APPOINTMENT_CANCELLED'))).toEqual(['banner:errors.APPOINTMENT_CANCELLED']));
  it('INVALID_MAP_URL / INVALID_COORDINATES → ช่องสถานที่ + เปิดแผงวางลิงก์', () => {
    const r = mapFormFailure(api('INVALID_MAP_URL'), 'create');
    expect(r).toMatchObject({ type: 'problem', openPaste: true });
    expect(pos(api('INVALID_COORDINATES'))).toEqual(['place:errors.INVALID_COORDINATES']);
  });
  it('LIMIT_REACHED: appointmentSpan → ช่องเวลา · appointments → banner', () => {
    expect(pos(api('LIMIT_REACHED', { limit: 'appointmentSpan', max: 62 }))).toEqual(['time:errors.LIMIT_REACHED']);
    expect(pos(api('LIMIT_REACHED', { limit: 'appointments', max: 100 }))).toEqual(['banner:errors.LIMIT_REACHED']);
  });
  it('VALIDATION fields → ช่องที่ตรง', () => {
    expect(pos(api('VALIDATION', {}, { title: 'TOO_SHORT', description: 'TOO_LONG', placeName: 'TOO_LONG' }))).toEqual([
      'title:appointments.form.error.title.required',
      'description:appointments.form.error.description.tooLong',
      'place:appointments.form.error.place.tooLong',
    ]);
    expect(pos(api('VALIDATION', {}, { title: 'TOO_LONG' }))).toEqual(['title:appointments.form.error.title.tooLong']);
    expect(pos(api('VALIDATION'))).toEqual(['banner:errors.VALIDATION']);
    expect(pos(api('VALIDATION', {}, { endTime: 'INVALID' }))).toEqual(['time:errors.VALIDATION']);
  });
  it('เวลา/วันจาก calendar → ช่องที่ตรง', () => {
    expect(pos(api('TIME_NOT_ON_STEP'))).toEqual(['time:errors.TIME_NOT_ON_STEP']);
    expect(pos(api('INVALID_RANGE'))).toEqual(['time:errors.INVALID_RANGE']);
    expect(pos(api('DATE_OUT_OF_RANGE'))).toEqual(['date:errors.DATE_OUT_OF_RANGE']);
  });
  it('FORBIDDEN/RATE_LIMITED/FEATURE_DISABLED → banner · รหัสอื่น → ข้อความทั่วไป', () => {
    expect(pos(api('FORBIDDEN'))).toEqual(['banner:errors.FORBIDDEN']);
    expect(pos(api('RATE_LIMITED'))).toEqual(['banner:errors.RATE_LIMITED']);
    expect(pos(api('UNKNOWN'))).toEqual(['banner:appointments.form.error.save']);
  });
});

describe('ค้นหาสถานที่', () => {
  it('ความล้มเหลว → สถานะ', () => {
    expect(placeSearchFailure(network)).toEqual({ kind: 'error' });
    expect(placeSearchFailure(api('RATE_LIMITED'))).toEqual({ kind: 'rate' });
    expect(placeSearchFailure(api('FEATURE_DISABLED', { feature: 'placeSearch' }))).toEqual({ kind: 'disabled' });
    expect(placeSearchFailure(api('UNKNOWN'))).toEqual({ kind: 'error' });
  });
  it('parsePlaceResults: ≤ 5 · ทิ้งแถวที่รูปผิด', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ name: `ร้าน ${i}`, lat: 13 + i / 100, lng: 100, osmUrl: 'https://www.openstreetmap.org/node/1' }));
    expect(parsePlaceResults({ results: rows })).toHaveLength(5);
    expect(parsePlaceResults({ results: [{ name: 1, lat: 1, lng: 1 }, { name: 'a', lat: 'x', lng: 1 }, null, { name: 'ok', lat: 1, lng: 2, osmUrl: 'x' }] })).toEqual([{ name: 'ok', lat: 1, lng: 2, osmUrl: 'x' }]);
    expect(parsePlaceResults(undefined)).toEqual([]);
    expect(parsePlaceResults({ results: 'x' })).toEqual([]);
  });
  it('placeFromResult: เก็บ osmUrl เฉพาะ https', () => {
    expect(placeFromResult({ name: 'a', lat: 1, lng: 2, osmUrl: 'https://www.openstreetmap.org/node/1' }).mapUrl).toBe('https://www.openstreetmap.org/node/1');
    expect(placeFromResult({ name: 'a', lat: 1, lng: 2, osmUrl: 'http://x' }).mapUrl).toBeNull();
    expect(placeFromResult({ name: 'a', lat: 1, lng: 2, osmUrl: 'javascript:1' }).mapUrl).toBeNull();
  });
  it('coordsText', () => {
    expect(coordsText({ lat: 13.801612345, lng: 100.6 })).toBe('13.80161, 100.6');
    expect(coordsText({ lat: null, lng: 1 })).toBeNull();
  });
});

describe('overlapView (เตือนนัดทับ)', () => {
  const ctxV = { myId: 'me', tz: TZ, locale: 'th' as const };
  const t = (h: number, m = 0) => parseLocalDateTime('2026-10-24', `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, TZ);
  const item = (over: Record<string, unknown>) => ({ id: 'i', userId: 'u', allDay: false, startAt: t(17), endAt: t(19), localStartDate: '2026-10-24', localEndDate: '2026-10-24', tz: TZ, ...over });
  const person = (n: number, items: unknown[], userId = `u${n}`) => ({ userId, displayName: `คน${n}`, colorIndex: n % 10, items });
  const dto = (status: 'ok' | 'unknown', blocked: unknown[]) => ({ status, blocked }) as unknown as OverlapDto;

  it('ok + ไม่มีใครติด = clear', () => expect(overlapView(dto('ok', []), ctxV)).toEqual({ kind: 'clear' }));
  it('unknown + ไม่มีรายชื่อ = unknown (ห้ามเป็น clear)', () => {
    const v = overlapView(dto('unknown', []), ctxV);
    expect(v).toMatchObject({ kind: 'unknown', people: [], total: 0 });
  });
  it('unknown + มีรายชื่อที่พบ = unknown พร้อมรายชื่อ', () => {
    const v = overlapView(dto('unknown', [person(1, [item({})])]), ctxV);
    expect(v.kind).toBe('unknown');
    expect(v.kind === 'unknown' && v.people).toHaveLength(1);
  });
  it('รายการซ่อน (ไม่มี title) → title null = "ไม่ว่าง" · มี title → แสดงชื่อ', () => {
    const v = overlapView(dto('ok', [person(1, [item({ id: 'a' }), item({ id: 'b', title: 'ซ้อมดนตรี' })])]), ctxV);
    expect(v.kind).toBe('warn');
    const rows = v.kind === 'warn' ? v.people[0]!.rows : [];
    expect(rows.map((r) => r.title)).toEqual([null, 'ซ้อมดนตรี']);
    expect(rows[0]!.when).toEqual({ key: 'calendar.day.range', values: { start: '17:00', end: '19:00' } });
  });
  it('ไม่รั่ว note: view ไม่มีฟิลด์ note แม้ข้อมูลดิบจะมี', () => {
    const v = overlapView(dto('ok', [person(1, [item({ title: 't', note: 'ความลับ', hideDetail: true })])]), ctxV);
    expect(JSON.stringify(v)).not.toContain('ความลับ');
  });
  it('ทั้งวัน / หลายวัน', () => {
    const v = overlapView(dto('ok', [person(1, [item({ allDay: true }), item({ id: 'z', startAt: t(22), endAt: parseLocalDateTime('2026-10-25', '02:00', TZ) })])]), ctxV);
    const rows = v.kind === 'warn' ? v.people[0]!.rows : [];
    expect(rows[0]!.when.key).toBe('calendar.day.allDay');
    expect(rows[1]!.when.key).toBe('busy.when.timedSpan');
  });
  it('คนเกิน 5 → แสดง 5 + more · รายการเกิน 2 ต่อคน → moreRows · you', () => {
    const many = Array.from({ length: 7 }, (_, i) => person(i, [item({ id: `x${i}a` }), item({ id: `x${i}b` }), item({ id: `x${i}c` })], i === 0 ? 'me' : `u${i}`));
    const v = overlapView(dto('ok', many), ctxV);
    expect(v.kind === 'warn' && [v.people.length, v.more, v.total]).toEqual([5, 2, 7]);
    expect(v.kind === 'warn' && [v.people[0]!.you, v.people[1]!.you, v.people[0]!.rows.length, v.people[0]!.moreRows]).toEqual([true, false, 2, 1]);
  });
});

describe('RSVP optimistic', () => {
  const me = { userId: 'me', displayName: 'ฉัน', colorIndex: 3, shapeIndex: 3 };
  const other = { userId: 'o', displayName: 'เพื่อน', colorIndex: 1, shapeIndex: 1 };
  const base = (): RsvpDetailDto => ({ counts: { going: 1, maybe: 0, not_going: 0, noResponse: 2 }, mine: null, members: { going: [other], maybe: [], not_going: [] } });

  it('ตอบครั้งแรก: เข้ารายชื่อ · ยังไม่ตอบลด 1', () => {
    const r = applyRsvp(base(), 'going', me);
    expect(r.mine).toBe('going');
    expect(r.members.going.map((p) => p.userId)).toEqual(['o', 'me']);
    expect(r.counts).toEqual({ going: 2, maybe: 0, not_going: 0, noResponse: 1 });
  });
  it('เปลี่ยนคำตอบ: ย้ายรายชื่อ · noResponse คงเดิม · ไม่ซ้ำในสองรายการ', () => {
    const first = applyRsvp(base(), 'going', me);
    const r = applyRsvp(first, 'not_going', me);
    expect(r.members.going.map((p) => p.userId)).toEqual(['o']);
    expect(r.members.not_going.map((p) => p.userId)).toEqual(['me']);
    expect(r.counts).toEqual({ going: 1, maybe: 0, not_going: 1, noResponse: 1 });
  });
  it('คำตอบเดิม = คืนอ็อบเจกต์เดิม (ไม่เปลี่ยน) · ไม่แก้ค่าที่ส่งเข้า (rollback ได้)', () => {
    const b = base();
    const snapshot = JSON.stringify(b);
    expect(applyRsvp({ ...b, mine: 'going' }, 'going', me)).toEqual({ ...b, mine: 'going' });
    applyRsvp(b, 'maybe', me);
    expect(JSON.stringify(b)).toBe(snapshot);
  });
  it('noResponse ไม่ติดลบ', () => {
    const r = applyRsvp({ ...base(), counts: { going: 1, maybe: 0, not_going: 0, noResponse: 0 } }, 'maybe', me);
    expect(r.counts.noResponse).toBe(0);
  });
  it('applyRsvpCounts (มุมมองรายการ)', () => {
    const c = { going: 2, maybe: 1, not_going: 0, noResponse: 3 };
    expect(applyRsvpCounts(c, null, 'going')).toEqual({ going: 3, maybe: 1, not_going: 0, noResponse: 2 });
    expect(applyRsvpCounts(c, 'maybe', 'not_going')).toEqual({ going: 2, maybe: 0, not_going: 1, noResponse: 3 });
    expect(applyRsvpCounts(c, 'going', 'going')).toBe(c);
  });
  it('rsvpClosedReason: ยกเลิก > ผ่านแล้ว > ไม่มีสิทธิ์', () => {
    const a = appt();
    expect(rsvpClosedReason(a)).toBeNull();
    expect(rsvpClosedReason({ ...a, isPast: true })).toBe('past');
    expect(rsvpClosedReason({ ...a, status: 'cancelled', isPast: true })).toBe('cancelled');
    expect(rsvpClosedReason({ ...a, permissions: { ...a.permissions, canRsvp: false } })).toBe('forbidden');
  });
});

describe('สถานะ/เวลาที่แสดง', () => {
  it('apptPhase', () => {
    const a = appt();
    expect(apptPhase(a, NOW)).toBe('upcoming');
    expect(apptPhase(a, a.startAt)).toBe('ongoing');
    expect(apptPhase({ ...a, isPast: true }, NOW)).toBe('past');
    expect(apptPhase({ ...a, status: 'cancelled' }, NOW)).toBe('cancelled');
  });
  it('appointmentWhen: วันเดียว / ข้ามคืน / หลายวัน', () => {
    expect(appointmentWhen(appt(), 'th')).toEqual({ key: 'calendar.day.range', values: { start: '18:00', end: '21:00' } });
    const overnight = appt({ startAt: parseLocalDateTime('2026-12-31', '22:00', TZ), endAt: parseLocalDateTime('2027-01-01', '02:00', TZ) });
    expect(appointmentWhen(overnight, 'th')).toEqual({ key: 'appointments.when.overnight', values: { start: '22:00', end: '02:00' } });
    const multi = appt({ startAt: parseLocalDateTime('2026-10-24', '18:00', TZ), endAt: parseLocalDateTime('2026-10-26', '12:00', TZ) });
    expect(appointmentWhen(multi, 'en').key).toBe('busy.when.timedSpan');
  });
  it('rowState', () => {
    const a = appt();
    expect(rowState(a)).toBe('none');
    expect(rowState({ ...a, rsvp: { ...a.rsvp, mine: 'maybe' } })).toBe('maybe');
    expect(rowState({ ...a, status: 'cancelled' })).toBe('cancelled');
  });
});
