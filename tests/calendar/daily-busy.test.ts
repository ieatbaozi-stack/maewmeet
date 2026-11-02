// R6F (ADR 0010 §2): expandDailyBusyInput — ชุดรายวัน "เวลาเดิมทุกวัน" · เทสต์ขอบเวลา
// BKK 28 แถว (R6F-2) · 62/63 วัน · ย้อนหลัง 7/8 วัน · end ≤ start · ข้ามเดือน/ปี/29 ก.พ. · DST (New_York gap/fold, Lord_Howe 30 นาที)
import { describe, expect, it } from 'vitest';
import { eachDate, expandDailyBusyInput, type BusyRow, type DailyBusyInput } from '@/lib/calendar';

const H = 3_600_000;
const NOW = Date.UTC(2026, 10, 2, 3, 0); // 2026-11-02 10:00 Asia/Bangkok
const LIMITS = { now: NOW, maxDays: 62, maxBackdateDays: 7 };

const daily = (over: Partial<DailyBusyInput> = {}): DailyBusyInput => ({
  kind: 'daily',
  startDate: '2026-11-03',
  endDate: '2026-11-30',
  startTime: '17:00',
  endTime: '20:00',
  ...over,
});

function rows(input: DailyBusyInput, opts = LIMITS): BusyRow[] {
  const r = expandDailyBusyInput(input, opts);
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code} ${r.error.field ?? ''}`);
  return r.value;
}
function err(input: DailyBusyInput, opts = LIMITS): [string, string | undefined] {
  const r = expandDailyBusyInput(input, opts);
  if (r.ok) throw new Error(`expected error, got ${r.value.length} rows`);
  return [r.error.code, r.error.field];
}

describe('R6F-2 — 3–30 พ.ย. 2026 17:00–20:00 Asia/Bangkok', () => {
  it('ได้ 28 แถว วันละแถว 17:00–20:00 เวลาไทย (UTC 10:00–13:00) · วันท้องถิ่นเริ่ม = จบ = วันนั้น · tz ดีฟอลต์', () => {
    const out = rows(daily());
    expect(out).toHaveLength(28);
    expect(out[0]).toEqual({
      allDay: false,
      startAt: Date.UTC(2026, 10, 3, 10),
      endAt: Date.UTC(2026, 10, 3, 13),
      localStartDate: '2026-11-03',
      localEndDate: '2026-11-03',
      tz: 'Asia/Bangkok',
    });
    const dates = eachDate('2026-11-03', '2026-11-30');
    out.forEach((r, i) => {
      expect(r.startAt).toBe(Date.UTC(2026, 10, 3 + i, 10));
      expect(r.endAt - r.startAt).toBe(3 * H);
      expect([r.localStartDate, r.localEndDate]).toEqual([dates[i], dates[i]]);
      expect(r.allDay).toBe(false);
    });
    expect(out[27]!.localStartDate).toBe('2026-11-30');
  });

  it('ไม่ใช่ช่วงต่อเนื่อง: เวลาระหว่างแถว (20:00 → 17:00 วันถัดไป) ไม่ถูกครอบ', () => {
    const out = rows(daily());
    for (let i = 1; i < out.length; i++) expect(out[i]!.startAt - out[i - 1]!.endAt).toBe(21 * H);
  });

  it('pure: ผลซ้ำได้ ไม่แก้อินพุต', () => {
    const input = daily();
    const copy = JSON.parse(JSON.stringify(input));
    expect(rows(input)).toEqual(rows(input));
    expect(input).toEqual(copy);
  });
});

describe('ขอบช่วงวัน', () => {
  it('วันเดียว (startDate = endDate) = 1 แถว', () => {
    expect(rows(daily({ startDate: '2026-11-10', endDate: '2026-11-10' }))).toHaveLength(1);
  });

  it('62 วันพอดีผ่าน (62 แถว) · 63 วัน → SPAN_TOO_LONG field endDate', () => {
    expect(rows(daily({ startDate: '2026-11-03', endDate: '2027-01-03' }))).toHaveLength(62);
    expect(err(daily({ startDate: '2026-11-03', endDate: '2027-01-04' }))).toEqual(['SPAN_TOO_LONG', 'endDate']);
  });

  it('ไม่ส่ง maxDays = ไม่ตรวจจำนวนวัน', () => {
    expect(rows(daily({ startDate: '2026-11-03', endDate: '2027-02-03' }), { now: NOW, maxBackdateDays: 7 } as typeof LIMITS)).toHaveLength(93);
  });

  it('endDate < startDate → INVALID_RANGE field endDate', () => {
    expect(err(daily({ startDate: '2026-11-10', endDate: '2026-11-09' }))).toEqual(['INVALID_RANGE', 'endDate']);
  });

  it('ข้ามเดือน · ข้ามปี', () => {
    expect(rows(daily({ startDate: '2026-11-29', endDate: '2026-12-02' })).map((r) => r.localStartDate)).toEqual(['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']);
    const y = rows(daily({ startDate: '2026-12-30', endDate: '2027-01-02' }));
    expect(y.map((r) => r.localStartDate)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
    expect(y[2]!.startAt).toBe(Date.UTC(2027, 0, 1, 10));
  });

  it('ปีอธิกสุรทิน: 27 ก.พ.–1 มี.ค. 2028 = 4 แถว (มี 29 ก.พ.) · 2027 = 3 แถว · 29 ก.พ. 2027 → INVALID_DATE', () => {
    expect(rows(daily({ startDate: '2028-02-27', endDate: '2028-03-01' })).map((r) => r.localStartDate)).toEqual(['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01']);
    expect(rows(daily({ startDate: '2027-02-27', endDate: '2027-03-01' }))).toHaveLength(3);
    expect(err(daily({ startDate: '2027-02-29', endDate: '2027-03-01' }))).toEqual(['INVALID_DATE', 'startDate']);
    expect(err(daily({ startDate: '2027-02-27', endDate: '2027-02-29' }))).toEqual(['INVALID_DATE', 'endDate']);
  });

  it('ปีนอก 2000–2100 (เช่น พ.ศ.) → DATE_OUT_OF_RANGE', () => {
    expect(err(daily({ startDate: '2569-11-03', endDate: '2569-11-04' }))).toEqual(['DATE_OUT_OF_RANGE', 'startDate']);
  });
});

describe('ขอบเวลาในวัน', () => {
  it('end = start → INVALID_RANGE field endTime · end < start (ข้ามเที่ยงคืน ไม่รองรับ) → INVALID_RANGE field endTime', () => {
    expect(err(daily({ startTime: '17:00', endTime: '17:00' }))).toEqual(['INVALID_RANGE', 'endTime']);
    expect(err(daily({ startTime: '22:00', endTime: '01:00' }))).toEqual(['INVALID_RANGE', 'endTime']);
    expect(err(daily({ startTime: '00:30', endTime: '00:00' }))).toEqual(['INVALID_RANGE', 'endTime']);
  });

  it('ขอบวัน: 00:00–00:30 และ 23:00–23:30 ผ่าน · 24:00 ไม่รับ (INVALID_TIME)', () => {
    const early = rows(daily({ startDate: '2026-11-10', endDate: '2026-11-10', startTime: '00:00', endTime: '00:30' }));
    expect(early[0]).toMatchObject({ startAt: Date.UTC(2026, 10, 9, 17), localStartDate: '2026-11-10', localEndDate: '2026-11-10' });
    const late = rows(daily({ startDate: '2026-11-10', endDate: '2026-11-10', startTime: '23:00', endTime: '23:30' }));
    expect(late[0]).toMatchObject({ endAt: Date.UTC(2026, 10, 10, 16, 30), localStartDate: '2026-11-10', localEndDate: '2026-11-10' });
    expect(err(daily({ endTime: '24:00' }))).toEqual(['INVALID_TIME', 'endTime']);
  });

  it('ไม่ลงตัว 30 นาที → TIME_NOT_ON_STEP · รูปแบบผิด → INVALID_TIME (ชี้ช่องถูก)', () => {
    expect(err(daily({ startTime: '17:15' }))).toEqual(['TIME_NOT_ON_STEP', 'startTime']);
    expect(err(daily({ endTime: '20:10' }))).toEqual(['TIME_NOT_ON_STEP', 'endTime']);
    expect(err(daily({ startTime: '5pm' }))).toEqual(['INVALID_TIME', 'startTime']);
    expect(err(daily({ endTime: '8:00' }))).toEqual(['INVALID_TIME', 'endTime']);
  });

  it('tz ผิด → INVALID_TZ field tz', () => {
    expect(err(daily({ tz: 'Mars/Olympus' }))).toEqual(['INVALID_TZ', 'tz']);
    expect(err(daily({ tz: '+07:00' }))).toEqual(['INVALID_TZ', 'tz']);
  });

  it('ลำดับตรวจ: tz → วันที่ → ช่วงวัน → เวลา → end ≤ start → จำนวนวัน → ย้อนหลัง', () => {
    expect(err(daily({ tz: 'Nope/Nope', startDate: 'x' }))[0]).toBe('INVALID_TZ');
    expect(err(daily({ startDate: 'x', startTime: 'y' }))[0]).toBe('INVALID_DATE');
    expect(err(daily({ startDate: '2026-11-10', endDate: '2026-11-01', startTime: 'y' }))).toEqual(['INVALID_RANGE', 'endDate']);
    expect(err(daily({ startTime: '17:15', endTime: '17:00' }))[0]).toBe('TIME_NOT_ON_STEP');
    expect(err(daily({ endDate: '2027-06-01', endTime: '17:00' }))).toEqual(['INVALID_RANGE', 'endTime']);
    expect(err(daily({ startDate: '2026-01-01', endDate: '2026-12-31' }))).toEqual(['SPAN_TOO_LONG', 'endDate']);
  });
});

describe('ย้อนหลัง (ตัดสินจากวันแรกของชุด)', () => {
  it('วันแรก = วันนี้ − 7 ผ่าน · วันนี้ − 8 → TOO_FAR_BACK field startDate (ทั้งชุด แม้วันอื่นอยู่ในอนาคต)', () => {
    expect(rows(daily({ startDate: '2026-10-26', endDate: '2026-11-05' }))).toHaveLength(11);
    expect(err(daily({ startDate: '2026-10-25', endDate: '2026-11-05' }))).toEqual(['TOO_FAR_BACK', 'startDate']);
  });

  it('"วันนี้" ตาม tz ของคำขอ: 2026-11-02 03:00Z = 2026-11-01 ใน New_York → 2026-10-25 ยังผ่าน', () => {
    expect(rows(daily({ tz: 'America/New_York', startDate: '2026-10-25', endDate: '2026-10-25' }))).toHaveLength(1);
    expect(err(daily({ tz: 'America/New_York', startDate: '2026-10-24', endDate: '2026-10-25' }))).toEqual(['TOO_FAR_BACK', 'startDate']);
  });

  it('maxBackdateDays โดยไม่มี now → TypeError (ความผิดของผู้เรียก ไม่ใช่ Result)', () => {
    expect(() => expandDailyBusyInput(daily(), { maxBackdateDays: 7 })).toThrow(TypeError);
  });
});

describe('DST — คำนวณทีละวันจากเวลาผนัง', () => {
  const NY = 'America/New_York';

  it('New_York 2026-03-08 (spring forward 02:00→03:00): 17:00–20:00 ผ่าน · UTC offset วันก่อน/หลังต่างกัน 1 ชม.', () => {
    const out = rows(daily({ tz: NY, startDate: '2026-03-07', endDate: '2026-03-09' }), { maxDays: 62 } as typeof LIMITS);
    expect(out.map((r) => r.startAt)).toEqual([Date.UTC(2026, 2, 7, 22), Date.UTC(2026, 2, 8, 21), Date.UTC(2026, 2, 9, 21)]);
    expect(out.every((r) => r.endAt - r.startAt === 3 * H)).toBe(true);
    expect(out[1]!.startAt - out[0]!.startAt).toBe(23 * H);
    expect(out.map((r) => r.localStartDate)).toEqual(['2026-03-07', '2026-03-08', '2026-03-09']);
  });

  it('New_York gap: 02:30–03:30 → INVALID_LOCAL_TIME field startTime ทั้งคำขอ · 01:00–02:30 → field endTime', () => {
    const opts = { maxDays: 62 } as typeof LIMITS;
    expect(err(daily({ tz: NY, startDate: '2026-03-07', endDate: '2026-03-09', startTime: '02:30', endTime: '03:30' }), opts)).toEqual(['INVALID_LOCAL_TIME', 'startTime']);
    expect(err(daily({ tz: NY, startDate: '2026-03-07', endDate: '2026-03-09', startTime: '01:00', endTime: '02:30' }), opts)).toEqual(['INVALID_LOCAL_TIME', 'endTime']);
    // ช่วงที่ไม่ครอบวันเปลี่ยนเวลา ใช้เวลาเดียวกันได้
    expect(rows(daily({ tz: NY, startDate: '2026-03-09', endDate: '2026-03-10', startTime: '02:30', endTime: '03:30' }), opts)).toHaveLength(2);
  });

  it('New_York 2026-11-01 (fall back): 01:00–02:00 ในวัน fold ใช้ครั้งแรก (EDT) → ยาว 2 ชม.จริง · วันอื่น 1 ชม.', () => {
    const out = rows(daily({ tz: NY, startDate: '2026-10-31', endDate: '2026-11-02', startTime: '01:00', endTime: '02:00' }));
    expect(out.map((r) => [r.startAt, r.endAt])).toEqual([
      [Date.UTC(2026, 9, 31, 5), Date.UTC(2026, 9, 31, 6)],
      [Date.UTC(2026, 10, 1, 5), Date.UTC(2026, 10, 1, 7)],
      [Date.UTC(2026, 10, 2, 6), Date.UTC(2026, 10, 2, 7)],
    ]);
    expect(out.map((r) => r.localEndDate)).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
    const evening = rows(daily({ tz: NY, startDate: '2026-10-31', endDate: '2026-11-01' }));
    expect(evening.map((r) => r.startAt)).toEqual([Date.UTC(2026, 9, 31, 21), Date.UTC(2026, 10, 1, 22)]);
  });

  it('Australia/Lord_Howe (DST 30 นาที · 2026-10-04 02:00→02:30): 17:00 เป็น 17:00 ทุกวัน · offset ต่างกัน 30 นาที · 02:00 ในวันนั้น → INVALID_LOCAL_TIME', () => {
    const LH = 'Australia/Lord_Howe';
    const out = rows(daily({ tz: LH, startDate: '2026-10-03', endDate: '2026-10-05' }), { maxDays: 62 } as typeof LIMITS);
    expect(out.map((r) => r.startAt)).toEqual([Date.UTC(2026, 9, 3, 6, 30), Date.UTC(2026, 9, 4, 6), Date.UTC(2026, 9, 5, 6)]);
    expect(out.every((r) => r.endAt - r.startAt === 3 * H)).toBe(true);
    expect(err(daily({ tz: LH, startDate: '2026-10-03', endDate: '2026-10-05', startTime: '02:00', endTime: '03:00' }), { maxDays: 62 } as typeof LIMITS)).toEqual([
      'INVALID_LOCAL_TIME',
      'startTime',
    ]);
  });

  it('Asia/Bangkok ไม่มี DST: ทุกแถวยาวเท่ากัน และห่างกัน 24 ชม.พอดีตลอด 62 วัน', () => {
    const out = rows(daily({ startDate: '2026-11-03', endDate: '2027-01-03', startTime: '06:00', endTime: '07:30' }));
    expect(out).toHaveLength(62);
    for (let i = 1; i < out.length; i++) expect(out[i]!.startAt - out[i - 1]!.startAt).toBe(24 * H);
    expect(out.every((r) => r.endAt - r.startAt === 1.5 * H)).toBe(true);
  });
});
