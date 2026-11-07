// R7 B-5 — เพิ่ม busy แล้วใช้ผลของ POST ต่อเข้าข้อมูลปฏิทิน (แทน GET ใหม่): ต้องได้ผลเท่ากับที่เซิร์ฟเวอร์จะส่ง
import { describe, expect, it } from 'vitest';
import { addCreatedBusy, compareApiBusy, type ApiBusyItem, type OwnBusy } from '@/components/calendar/model';
import { startOfDay } from '@/lib/calendar';

const TZ = 'Asia/Bangkok';
const RANGE = { from: '2026-11-01', to: '2026-11-30' } as const;
const at = (date: string, h: number) => startOfDay(date as never, TZ) + h * 3_600_000;

const own = (id: string, startAt: number, endAt: number, extra: Partial<OwnBusy> = {}): OwnBusy => ({
  id,
  allDay: false,
  startAt,
  endAt,
  localStartDate: '2026-11-10',
  localEndDate: '2026-11-10',
  tz: TZ,
  title: 'หมอฟัน',
  note: 'ความลับ',
  hidden: false,
  seriesId: null,
  ...extra,
});

const existing: ApiBusyItem = { kind: 'busy', id: 'b-0', userId: 'u-2', allDay: false, startAt: at('2026-11-10', 9), endAt: at('2026-11-10', 10), localStartDate: '2026-11-10', localEndDate: '2026-11-10', tz: TZ };
const data = { group: { tz: TZ }, busy: [existing] as ApiBusyItem[], truncated: false };

describe('addCreatedBusy', () => {
  it('ใส่ในรูปที่เพื่อนเห็น: ไม่มี note/hidden/seriesId · มี title · เรียงตามเวลา', () => {
    const r = addCreatedBusy(data, [own('b-1', at('2026-11-10', 8), at('2026-11-10', 9))], 'u-1', RANGE)!;
    expect(r.busy.map((b) => (b.kind === 'busy' ? b.id : ''))).toEqual(['b-1', 'b-0']);
    const mine = r.busy[0]!;
    expect(mine).toMatchObject({ kind: 'busy', userId: 'u-1', title: 'หมอฟัน' });
    expect(Object.keys(mine).sort()).toEqual(['allDay', 'endAt', 'id', 'kind', 'localEndDate', 'localStartDate', 'startAt', 'title', 'tz', 'userId']);
    expect(data.busy).toHaveLength(1); // ไม่แก้ของเดิม
  });

  it('ซ่อนรายละเอียด/ไม่มี title → ไม่มีฟิลด์ title เลย', () => {
    const r = addCreatedBusy(data, [own('h', at('2026-11-11', 8), at('2026-11-11', 9), { hidden: true }), own('n', at('2026-11-12', 8), at('2026-11-12', 9), { title: null })], 'u-1', RANGE)!;
    for (const id of ['h', 'n']) expect('title' in r.busy.find((b) => b.kind === 'busy' && b.id === id)!).toBe(false);
  });

  it('นอกช่วงที่แสดง (ตาม tz กลุ่ม, ครึ่งเปิด) ไม่ถูกใส่ · ชนขอบวันแรกถูกใส่', () => {
    const outside = own('o', at('2026-12-01', 1), at('2026-12-01', 2));
    const endsAtStart = own('e', at('2026-10-31', 22), startOfDay('2026-11-01', TZ));
    const crossesIn = own('c', at('2026-10-31', 22), at('2026-11-01', 1));
    const r = addCreatedBusy(data, [outside, endsAtStart, crossesIn], 'u-1', RANGE)!;
    expect(r.busy.map((b) => (b.kind === 'busy' ? b.id : ''))).toEqual(['c', 'b-0']);
  });

  it('ข้อมูลถูกตัด (truncated) → null ให้โหลดใหม่ · id ซ้ำไม่ซ้อน', () => {
    expect(addCreatedBusy({ ...data, truncated: true }, [own('x', at('2026-11-10', 1), at('2026-11-10', 2))], 'u-1', RANGE)).toBeNull();
    const r = addCreatedBusy(data, [own('b-0', existing.startAt, existing.endAt)], 'u-1', RANGE)!;
    expect(r.busy).toHaveLength(1);
  });
});

describe('compareApiBusy (= compareBusyViews ฝั่งเซิร์ฟเวอร์)', () => {
  it('startAt → endAt → kind → id', () => {
    const b = (id: string, s: number, e: number): ApiBusyItem => ({ kind: 'busy', id, userId: 'u', allDay: false, startAt: s, endAt: e, localStartDate: '2026-11-10', localEndDate: '2026-11-10', tz: TZ });
    const appt: ApiBusyItem = { kind: 'appointment', appointmentId: 'a', userId: 'u', title: 't', startAt: 5, endAt: 9 };
    const sorted = [appt, b('z', 5, 9), b('a', 5, 9), b('q', 5, 7), b('p', 1, 2)].sort(compareApiBusy);
    expect(sorted.map((x) => (x.kind === 'busy' ? x.id : 'APPT'))).toEqual(['p', 'q', 'a', 'z', 'APPT']);
  });
});
