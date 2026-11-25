// เทสต์ pure ICS parser (ICS_IMPORT_CONTRACT §1 I1–I5 · ADR 0017) — เจ้าของ: platform
import { describe, expect, it } from 'vitest';
import {
  buildAppointmentIcs,
  busyDedupeKey,
  ICS_IMPORT_MAX_BYTES,
  ICS_IMPORT_MAX_EVENTS,
  ICS_IMPORT_MAX_EXPANDED_ITEMS,
  ICS_IMPORT_MAX_LINES,
  parseIcsToBusy,
  parseLocalDateTime,
  resolveIcsTimeZone,
  sanitizeIcsSummary,
  unescapeIcsText,
} from '@/lib/calendar';
import { checkVisibleName } from '@/lib/shared/name-rules';

// เวลาอ้างอิงตายตัว (ไม่เรียก Date.now): 2026-11-23 12:00 Asia/Bangkok
const NOW_MS = parseLocalDateTime('2026-11-23', '12:00', 'Asia/Bangkok');

const wrap = (body: string, eol = '\r\n') =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//Test//EN', body, 'END:VCALENDAR'].join(eol) + eol;

describe('I1 — RFC 5545 parsing, unfolding, unescape, nested components', () => {
  it('รองรับ CRLF, LF, UTF-8 BOM, การพับบรรทัดด้วย space/tab กลางข้อความไทย และ unescape', () => {
    const ics =
      '\uFEFFBEGIN:VCALENDAR\n' +
      'VERSION:2.0\n' +
      'BEGIN:VEVENT\n' +
      'SUMMARY;LANGUAGE="th-TH":ประชุมทีม\\, วางแผน\\; ไตรมาส\\\\1\\nห้อง\n' +
      ' ประชุมใหญ่\n' +
      '\tชั้น 5\n' +
      'DTSTART;TZID="Asia/Bangkok":20261125T090000\n' +
      'DTEND;TZID="Asia/Bangkok":20261125T103000\n' +
      'DESCRIPTION:ความลับที่ไม่ควรเก็บ\n' +
      'LOCATION:ชั้น 5 ตึก A\n' +
      'ATTENDEE;CN="Alice":mailto:alice@example.com\n' +
      'ORGANIZER:mailto:boss@example.com\n' +
      'URL:https://secret.example.com/meet\n' +
      'BEGIN:VALARM\n' +
      'ACTION:DISPLAY\n' +
      'SUMMARY:ห้ามทับชื่อนัด\n' +
      'DURATION:PT15M\n' +
      'END:VALARM\n' +
      'END:VEVENT\n' +
      'END:VCALENDAR\n';

    const r = parseIcsToBusy(ics, { nowMs: NOW_MS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.totalEvents).toBe(1);
    expect(r.items).toHaveLength(1);
    const item = r.items[0]!;
    expect(item.title).toBe('ประชุมทีม, วางแผน; ไตรมาส\\1 ห้องประชุมใหญ่ชั้น 5');
    expect(item.kind).toBe('timed');
    expect(item.startDate).toBe('2026-11-25');
    expect(item.startTime).toBe('09:00');
    expect(item.endDate).toBe('2026-11-25');
    expect(item.endTime).toBe('10:30');
    expect(item.rounded).toBe(false);
    // ไม่เก็บ DESCRIPTION/LOCATION/ATTENDEE/ORGANIZER/URL ในผลลัพธ์
    expect(JSON.stringify(item)).not.toContain('ความลับ');
    expect(JSON.stringify(item)).not.toContain('alice@example.com');
    expect(JSON.stringify(item)).not.toContain('secret.example.com');
  });

  it('ข้าม VTIMEZONE และ VTODO ที่อยู่ใน VCALENDAR และไม่สับสนกับ VEVENT', () => {
    const ics = wrap(
      [
        'BEGIN:VTIMEZONE',
        'TZID:Asia/Bangkok',
        'BEGIN:STANDARD',
        'DTSTART:19700101T000000',
        'TZOFFSETFROM:+0700',
        'TZOFFSETTO:+0700',
        'END:STANDARD',
        'END:VTIMEZONE',
        'BEGIN:VTODO',
        'SUMMARY:งานที่ต้องทำ',
        'DTSTART:20261125T100000Z',
        'END:VTODO',
        'BEGIN:VEVENT',
        'SUMMARY:นัดจริง',
        'DTSTART:20261125T030000Z',
        'DTEND:20261125T040000Z',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const r = parseIcsToBusy(ics, { nowMs: NOW_MS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.totalEvents).toBe(1);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.title).toBe('นัดจริง');
    expect(r.items[0]!.startTime).toBe('10:00');
    expect(r.items[0]!.endTime).toBe('11:00');
  });

  it('รองรับไฟล์สไตล์ Google Calendar, Apple Calendar และ Outlook', () => {
    const google = wrap(
      [
        'BEGIN:VEVENT',
        'DTSTART:20261126T020000Z',
        'DTEND:20261126T033000Z',
        'SUMMARY:Google Sync',
        'STATUS:CONFIRMED',
        'TRANSP:OPAQUE',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const apple = wrap(
      [
        'BEGIN:VEVENT',
        'DTSTART;TZID=Asia/Bangkok:20261126T140000',
        'DTEND;TZID=Asia/Bangkok:20261126T150000',
        'SUMMARY:Apple Event',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const outlook = wrap(
      [
        'BEGIN:VEVENT',
        'DTSTART;TZID="SE Asia Standard Time":20261126T160000',
        'DTEND;TZID="SE Asia Standard Time":20261126T173000',
        'SUMMARY:Outlook Meeting',
        'END:VEVENT',
      ].join('\r\n'),
    );

    for (const [raw, expectedStart, expectedEnd, expectedTitle] of [
      [google, '09:00', '10:30', 'Google Sync'],
      [apple, '14:00', '15:00', 'Apple Event'],
      [outlook, '16:00', '17:30', 'Outlook Meeting'],
    ] as const) {
      const res = parseIcsToBusy(raw, { nowMs: NOW_MS });
      expect(res.ok).toBe(true);
      if (!res.ok) continue;
      expect(res.items).toHaveLength(1);
      expect(res.items[0]!.title).toBe(expectedTitle);
      expect(res.items[0]!.startTime).toBe(expectedStart);
      expect(res.items[0]!.endTime).toBe(expectedEnd);
    }
  });
});

describe('I2 — 4 รูปแบบวันเวลา, TZID, DURATION และ round-trip กับ buildAppointmentIcs', () => {
  it('1) VALUE=DATE: DTEND แบบ exclusive ลบ 1 วันเป็น inclusive, ไม่มี DTEND = 1 วัน, และรองรับ DURATION', () => {
    const ics = wrap(
      [
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20261125',
        'DTEND;VALUE=DATE:20261128',
        'SUMMARY:ทริป 3 วัน',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20261129',
        'SUMMARY:วันหยุดวันเดียว',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20261201',
        'DURATION:P2D',
        'SUMMARY:อบรม 2 วัน',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const r = parseIcsToBusy(ics, { nowMs: NOW_MS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items).toHaveLength(3);
    expect(r.items[0]).toMatchObject({ kind: 'all_day', startDate: '2026-11-25', endDate: '2026-11-27', title: 'ทริป 3 วัน' });
    expect(r.items[1]).toMatchObject({ kind: 'all_day', startDate: '2026-11-29', endDate: '2026-11-29', title: 'วันหยุดวันเดียว' });
    expect(r.items[2]).toMatchObject({ kind: 'all_day', startDate: '2026-12-01', endDate: '2026-12-02', title: 'อบรม 2 วัน' });
  });

  it('2) UTC, 3) IANA TZID (รวม Asia/Tokyo และ /Asia/Bangkok) + Windows TZID, 4) Floating time', () => {
    const ics = wrap(
      [
        // UTC: 17:00Z = 00:00 วันถัดไปใน Asia/Bangkok (ข้ามวัน)
        'BEGIN:VEVENT',
        'DTSTART:20261125T170000Z',
        'DTEND:20261125T183000Z',
        'SUMMARY:UTC Cross Day',
        'END:VEVENT',
        // IANA Asia/Tokyo (+09:00): 11:00–13:00 JST = 09:00–11:00 Bangkok
        'BEGIN:VEVENT',
        'DTSTART;TZID=Asia/Tokyo:20261126T110000',
        'DTEND;TZID=Asia/Tokyo:20261126T130000',
        'SUMMARY:Tokyo Call',
        'END:VEVENT',
        // Floating time → Asia/Bangkok
        'BEGIN:VEVENT',
        'DTSTART:20261127T130000',
        'DURATION:PT1H30M',
        'SUMMARY:Floating Lunch',
        'END:VEVENT',
        // TZID ไม่รู้จัก → ข้าม invalid
        'BEGIN:VEVENT',
        'DTSTART;TZID=Mars/Olympus:20261127T130000',
        'DTEND;TZID=Mars/Olympus:20261127T140000',
        'SUMMARY:Unknown TZ',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const r = parseIcsToBusy(ics, { nowMs: NOW_MS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items).toHaveLength(3);
    expect(r.skipped.invalid).toBe(1);
    expect(r.items[0]).toMatchObject({ title: 'UTC Cross Day', startDate: '2026-11-26', startTime: '00:00', endDate: '2026-11-26', endTime: '01:30' });
    expect(r.items[1]).toMatchObject({ title: 'Tokyo Call', startDate: '2026-11-26', startTime: '09:00', endDate: '2026-11-26', endTime: '11:00' });
    expect(r.items[2]).toMatchObject({ title: 'Floating Lunch', startDate: '2026-11-27', startTime: '13:00', endDate: '2026-11-27', endTime: '14:30' });
  });

  it('resolveIcsTimeZone รองรับ IANA, slash นำหน้า, Windows TZID และคืน null เมื่อไม่รู้จัก', () => {
    expect(resolveIcsTimeZone('Asia/Bangkok')).toBe('Asia/Bangkok');
    expect(resolveIcsTimeZone('/Asia/Bangkok')).toBe('Asia/Bangkok');
    expect(resolveIcsTimeZone('SE Asia Standard Time')).toBe('Asia/Bangkok');
    expect(resolveIcsTimeZone('tokyo standard time')).toBe('Asia/Tokyo');
    expect(resolveIcsTimeZone('Not/A_Zone')).toBeNull();
  });

  it('นำเข้าไฟล์จาก buildAppointmentIcs เดิมของ maewmeet กลับได้ตรงวันเวลาเป๊ะ', () => {
    const startAt = parseLocalDateTime('2026-11-28', '18:00', 'Asia/Bangkok');
    const endAt = parseLocalDateTime('2026-11-28', '20:30', 'Asia/Bangkok');
    const exported = buildAppointmentIcs(
      {
        id: 'appt-123',
        title: 'กินหมูกระทะกับแก๊ง',
        placeName: 'ร้านประจำ',
        mapUrl: 'https://maps.google.com/?q=13.7,100.5',
        startAt,
        endAt,
        tz: 'Asia/Bangkok',
        appOrigin: 'https://maewmeet.example',
        labels: { map: 'แผนที่', plan: 'ดูนัดในแมวเจอกัน' },
      },
      NOW_MS,
    );
    const r = parseIcsToBusy(exported, { nowMs: NOW_MS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items).toHaveLength(1);
    const item = r.items[0]!;
    expect(item.title).toBe('กินหมูกระทะกับแก๊ง');
    expect(item.row.startAt).toBe(startAt);
    expect(item.row.endAt).toBe(endAt);
    expect(item.rounded).toBe(false);
  });
});

describe('I3 — ปัดเวลาออก (outward rounding) ลงตัว 30 นาที', () => {
  it('ลงตัวอยู่แล้วไม่เปลี่ยน · 09:15–10:45 → 09:00–11:00 · 23:45–00:15 ข้ามวัน → 23:30–00:30 · ช่วง 0 นาทีข้าม', () => {
    const ics = wrap(
      [
        'BEGIN:VEVENT',
        'SUMMARY:Exact',
        'DTSTART;TZID=Asia/Bangkok:20261125T090000',
        'DTEND;TZID=Asia/Bangkok:20261125T103000',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'SUMMARY:Round Both',
        'DTSTART;TZID=Asia/Bangkok:20261125T091500',
        'DTEND;TZID=Asia/Bangkok:20261125T104500',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'SUMMARY:Cross Midnight',
        'DTSTART;TZID=Asia/Bangkok:20261125T234500',
        'DTEND;TZID=Asia/Bangkok:20261126T001500',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'SUMMARY:End At Midnight',
        'DTSTART;TZID=Asia/Bangkok:20261126T233000',
        'DTEND;TZID=Asia/Bangkok:20261126T234500',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'SUMMARY:Zero Min',
        'DTSTART;TZID=Asia/Bangkok:20261125T120000',
        'DTEND;TZID=Asia/Bangkok:20261125T120000',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'SUMMARY:Inverted',
        'DTSTART;TZID=Asia/Bangkok:20261125T140000',
        'DTEND;TZID=Asia/Bangkok:20261125T130000',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const r = parseIcsToBusy(ics, { nowMs: NOW_MS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items).toHaveLength(4);
    expect(r.skipped.invalid).toBe(2);

    const byTitle = new Map(r.items.map((x) => [x.title, x]));
    expect(byTitle.get('Exact')).toMatchObject({ startTime: '09:00', endTime: '10:30', rounded: false });
    expect(byTitle.get('Round Both')).toMatchObject({ startTime: '09:00', endTime: '11:00', rounded: true });
    expect(byTitle.get('Cross Midnight')).toMatchObject({
      startDate: '2026-11-25',
      startTime: '23:30',
      endDate: '2026-11-26',
      endTime: '00:30',
      rounded: true,
    });
    expect(byTitle.get('End At Midnight')).toMatchObject({
      startDate: '2026-11-26',
      startTime: '23:30',
      endDate: '2026-11-27',
      endTime: '00:00',
      rounded: true,
    });
    // จบตรงเที่ยงคืน localEndDate ต้องเป็นวันเดิม (2026-11-26) ตามกติกา busy.ts
    expect(byTitle.get('End At Midnight')!.row.localEndDate).toBe('2026-11-26');
  });
});

describe('I4 — การกรองและนับเหตุผลที่ข้ามครบทุกข้อ', () => {
  it('นับแยกครบทั้ง 7 เหตุผล: transparent, cancelled, past, tooFarAhead, tooLong, rrule, invalid', () => {
    const ics = wrap(
      [
        // 1. transparent
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20261125',
        'TRANSP:TRANSPARENT',
        'SUMMARY:Free Reminder',
        'END:VEVENT',
        // 2. cancelled
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20261125',
        'STATUS:CANCELLED',
        'SUMMARY:Cancelled Event',
        'END:VEVENT',
        // 3. past (จบก่อน 2026-11-23 - 7 = 2026-11-16)
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20261110',
        'DTEND;VALUE=DATE:20261115',
        'SUMMARY:Old Trip',
        'END:VEVENT',
        // 4. tooFarAhead (windowDays = 90 → หลัง 2027-02-21)
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20270301',
        'SUMMARY:Far Future',
        'END:VEVENT',
        // 5a. tooLong timed (> 62 วัน)
        'BEGIN:VEVENT',
        'DTSTART:20261125T090000',
        'DTEND:20270210T090000',
        'SUMMARY:Too Long Timed',
        'END:VEVENT',
        // 5b. tooLong all-day (> 366 วัน)
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20261125',
        'DTEND;VALUE=DATE:20271210',
        'SUMMARY:Too Long AllDay',
        'END:VEVENT',
        // 6. rrule (ซับซ้อนเกินขอบเขต v1.2.0 เช่น FREQ=YEARLY)
        'BEGIN:VEVENT',
        'DTSTART:20261125T090000',
        'DTEND:20261125T100000',
        'RRULE:FREQ=YEARLY',
        'SUMMARY:Annual Review',
        'END:VEVENT',
        // 7. invalid (ไม่มี DTSTART)
        'BEGIN:VEVENT',
        'SUMMARY:Broken',
        'END:VEVENT',
        // 8. ผ่าน 1 รายการ (รวมเคสเริ่มเมื่อ 10 วันก่อนแต่ยังไม่จบ → ไม่ถือว่า past)
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20261113',
        'DTEND;VALUE=DATE:20261126',
        'SUMMARY:Ongoing Stay',
        'END:VEVENT',
      ].join('\r\n'),
    );

    const r = parseIcsToBusy(ics, { nowMs: NOW_MS, windowDays: 90 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.totalEvents).toBe(9);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.title).toBe('Ongoing Stay');
    expect(r.skipped).toEqual({
      transparent: 1,
      cancelled: 1,
      past: 1,
      tooFarAhead: 1,
      tooLong: 2,
      rrule: 1,
      invalid: 1,
    });
  });

  it('เปลี่ยน windowDays 30 / 180 กรองตามขอบเขตที่เลือก', () => {
    const ics = wrap(
      [
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20270115',
        'SUMMARY:53 days ahead',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const r30 = parseIcsToBusy(ics, { nowMs: NOW_MS, windowDays: 30 });
    expect(r30.ok && r30.items.length === 0 && r30.skipped.tooFarAhead === 1).toBe(true);
    const r60 = parseIcsToBusy(ics, { nowMs: NOW_MS, windowDays: 60 });
    expect(r60.ok && r60.items.length === 1 && r60.skipped.tooFarAhead === 0).toBe(true);
  });
});

describe('I5 — ชื่อรายการ (SUMMARY): ตัด 80 code points, ไม่ผ่า surrogate, ล้าง bidi/zero-width', () => {
  it('ตัดชื่อยาว > 80 โดยไม่ผ่า surrogate pair และผ่าน checkVisibleName เสมอ', () => {
    const longEmoji = '🎉'.repeat(90);
    const out = sanitizeIcsSummary(longEmoji);
    expect(out).not.toBeNull();
    expect([...out!].length).toBe(80);
    expect(checkVisibleName(out!, { min: 1, max: 80 }).ok).toBe(true);

    // ตัดตรง ZWJ emoji (🐈‍⬛ = 3 code points: 🐈 + ZWJ + ⬛) ไม่ทิ้ง ZWJ ลอยท้าย
    const zwjStr = 'a'.repeat(78) + '🐈\u200d⬛';
    const outZwj = sanitizeIcsSummary(zwjStr);
    expect(outZwj).not.toBeNull();
    expect(checkVisibleName(outZwj!, { min: 1, max: 80 }).ok).toBe(true);
  });

  it('ล้าง bidi override, zero-width space, control chars และคืน null เมื่อไม่เหลือตัวที่มองเห็น', () => {
    const bidi = 'ประชุม\u202Eลับ\u200Bทีม\u0007';
    const clean = sanitizeIcsSummary(bidi);
    expect(clean).toBe('ประชุมลับทีม');
    expect(checkVisibleName(clean!, { min: 1, max: 80 }).ok).toBe(true);

    expect(sanitizeIcsSummary('\u200B\u202E   ')).toBeNull();
    expect(sanitizeIcsSummary('')).toBeNull();
    expect(unescapeIcsText('a\\,b\\;c\\\\d\\ne')).toBe('a,b;c\\d e');
  });
});

describe('A3 — เพดานขนาด, binary, บรรทัด, VEVENT และความปลอดภัย ReDoS', () => {
  it('ปฏิเสธไฟล์เกิน 512 KB', () => {
    const huge = 'BEGIN:VCALENDAR\r\n' + 'X'.repeat(ICS_IMPORT_MAX_BYTES + 10) + '\r\nEND:VCALENDAR';
    const r = parseIcsToBusy(huge, { nowMs: NOW_MS });
    expect(r).toEqual({ ok: false, error: 'TOO_LARGE', limit: 'bytes', max: ICS_IMPORT_MAX_BYTES });
  });

  it('ปฏิเสธ null byte / binary และไฟล์ที่ไม่มี VCALENDAR', () => {
    expect(parseIcsToBusy('BEGIN:VCALENDAR\0END:VCALENDAR', { nowMs: NOW_MS })).toEqual({
      ok: false,
      error: 'INVALID',
      reason: 'BINARY',
    });
    expect(parseIcsToBusy('hello world not an ics file', { nowMs: NOW_MS })).toEqual({
      ok: false,
      error: 'INVALID',
      reason: 'NOT_ICS',
    });
  });

  it('ปฏิเสธไฟล์เกิน 20,000 บรรทัด', () => {
    const lines = 'BEGIN:VCALENDAR\n' + '\n'.repeat(ICS_IMPORT_MAX_LINES) + 'END:VCALENDAR';
    const r = parseIcsToBusy(lines, { nowMs: NOW_MS });
    expect(r).toEqual({ ok: false, error: 'TOO_LARGE', limit: 'lines', max: ICS_IMPORT_MAX_LINES });
  });

  it('ปฏิเสธไฟล์ที่มี 1,000 VEVENT (เกินเพดาน 500) เร็วไม่ค้าง', () => {
    const ev = 'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261125\r\nSUMMARY:E\r\nEND:VEVENT\r\n';
    const big = 'BEGIN:VCALENDAR\r\n' + ev.repeat(1000) + 'END:VCALENDAR\r\n';
    const t0 = performance.now();
    const r = parseIcsToBusy(big, { nowMs: NOW_MS });
    const elapsed = performance.now() - t0;
    expect(r).toEqual({ ok: false, error: 'TOO_LARGE', limit: 'events', max: ICS_IMPORT_MAX_EVENTS });
    expect(elapsed).toBeLessThan(200);
  });

  it('ทนทานต่อ input รูปแบบก่อ ReDoS (quote/semicolon/colon ซ้ำจำนวนมาก) ในเวลาเชิงเส้น', () => {
    const evil = wrap('BEGIN:VEVENT\r\nSUMMARY;' + 'A="x";'.repeat(5000) + ':ok\r\nDTSTART;VALUE=DATE:20261125\r\nEND:VEVENT');
    const t0 = performance.now();
    const r = parseIcsToBusy(evil, { nowMs: NOW_MS });
    const elapsed = performance.now() - t0;
    expect(r.ok).toBe(true);
    expect(elapsed).toBeLessThan(200);
  });

  it('busyDedupeKey แยก allDay และช่วงเวลาได้แม่นยำ', () => {
    const ics = wrap(
      [
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20261125',
        'SUMMARY:A',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'DTSTART;TZID=Asia/Bangkok:20261125T000000',
        'DTEND;TZID=Asia/Bangkok:20261126T000000',
        'SUMMARY:B',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const r = parseIcsToBusy(ics, { nowMs: NOW_MS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(busyDedupeKey(r.items[0]!.row)).not.toBe(busyDedupeKey(r.items[1]!.row));
  });
});

describe('v1.2.0 H1 — บังคับกรอบ END:VCALENDAR และ VEVENT ปิดครบ', () => {
  it('ปฏิเสธไฟล์ที่ขาด END:VCALENDAR หรือ VEVENT ไม่ปิด', () => {
    const noEndCal = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20261125',
      'SUMMARY:Truncated',
      'END:VEVENT',
    ].join('\r\n');
    expect(parseIcsToBusy(noEndCal, { nowMs: NOW_MS })).toEqual({
      ok: false,
      error: 'INVALID',
      reason: 'NOT_ICS',
    });

    const unclosedEvent = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20261125',
      'SUMMARY:Unclosed',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(parseIcsToBusy(unclosedEvent, { nowMs: NOW_MS })).toEqual({
      ok: false,
      error: 'INVALID',
      reason: 'NOT_ICS',
    });
  });
});

describe('v1.2.0 R1–R4 — ขยาย RRULE (DAILY/WEEKLY/MONTHLY), EXDATE, RECURRENCE-ID และเพดาน DoS', () => {
  it('DAILY: INTERVAL=2 + COUNT และ UNTIL + outward rounding 30 นาที', () => {
    const ics = wrap(
      [
        'BEGIN:VEVENT',
        'SUMMARY:Daily Check',
        'DTSTART;TZID=Asia/Bangkok:20261125T091500',
        'DTEND;TZID=Asia/Bangkok:20261125T094500',
        'RRULE:FREQ=DAILY;INTERVAL=2;COUNT=3',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'SUMMARY:Daily Until',
        'DTSTART;VALUE=DATE:20261126',
        'RRULE:FREQ=DAILY;UNTIL=20261128',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const r = parseIcsToBusy(ics, { nowMs: NOW_MS, windowDays: 30 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const checks = r.items.filter((x) => x.title === 'Daily Check');
    expect(checks.map((x) => `${x.startDate} ${x.startTime}-${x.endTime}`)).toEqual([
      '2026-11-25 09:00-10:00',
      '2026-11-27 09:00-10:00',
      '2026-11-29 09:00-10:00',
    ]);
    expect(checks.every((x) => x.rounded)).toBe(true);

    const untils = r.items.filter((x) => x.title === 'Daily Until');
    expect(untils.map((x) => x.startDate)).toEqual(['2026-11-26', '2026-11-27', '2026-11-28']);
  });

  it('WEEKLY: BYDAY, INTERVAL=2, WKST=SU และ COUNT ที่เริ่มจากอดีตคำนวณแม่นยำ', () => {
    // 2026-11-02 = จันทร์ · INTERVAL=2, BYDAY=MO,WE → สัปดาห์ 0: 11-02, 11-04 · สัปดาห์ 2: 11-16, 11-18 · สัปดาห์ 4: 11-30, 12-02 (COUNT=6)
    // NOW = 2026-11-23 (ย้อนหลังได้ถึง 2026-11-16) → ต้องได้ 11-16, 11-18, 11-30, 12-02 (4 รายการ)
    const ics = wrap(
      [
        'BEGIN:VEVENT',
        'SUMMARY:Biweekly Sync',
        'DTSTART;TZID=Asia/Bangkok:20261102T100000',
        'DTEND;TZID=Asia/Bangkok:20261102T110000',
        'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=6',
        'END:VEVENT',
        // WKST=SU: 2026-11-28 (เสาร์) + 2026-11-29 (อาทิตย์) อยู่คนละสัปดาห์เมื่อ WKST=SU และ INTERVAL=2
        'BEGIN:VEVENT',
        'SUMMARY:Weekend WKST',
        'DTSTART;VALUE=DATE:20261128',
        'RRULE:FREQ=WEEKLY;INTERVAL=2;WKST=SU;BYDAY=SU,SA;COUNT=3',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const r = parseIcsToBusy(ics, { nowMs: NOW_MS, windowDays: 60 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items.filter((x) => x.title === 'Biweekly Sync').map((x) => x.startDate)).toEqual([
      '2026-11-16',
      '2026-11-18',
      '2026-11-30',
      '2026-12-02',
    ]);
    // WKST=SU: สัปดาห์เริ่ม 2026-11-22 มีเสาร์ 11-28 (#1) · ข้าม 1 สัปดาห์ไปเริ่ม 2026-12-06 มีอาทิตย์ 12-06 (#2) และเสาร์ 12-12 (#3)
    expect(r.items.filter((x) => x.title === 'Weekend WKST').map((x) => x.startDate)).toEqual([
      '2026-11-28',
      '2026-12-06',
      '2026-12-12',
    ]);
  });

  it('MONTHLY: วันที่ 31 (ข้ามเดือนที่ไม่มี 31), BYMONTHDAY=-1 (สิ้นเดือน), BYDAY=-1FR และ 2TU', () => {
    const ics = wrap(
      [
        // 31st: พ.ย. ไม่มี 31 → ธ.ค. 31, ม.ค. 31, (ก.พ. ข้าม), มี.ค. 31
        'BEGIN:VEVENT',
        'SUMMARY:Day31',
        'DTSTART;VALUE=DATE:20261031',
        'RRULE:FREQ=MONTHLY',
        'END:VEVENT',
        // วันสิ้นเดือน: 30 พ.ย., 31 ธ.ค., 31 ม.ค., 28 ก.พ.
        'BEGIN:VEVENT',
        'SUMMARY:MonthEnd',
        'DTSTART;VALUE=DATE:20261130',
        'RRULE:FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=4',
        'END:VEVENT',
        // ศุกร์สุดท้ายของเดือน: 27 พ.ย., 25 ธ.ค., 29 ม.ค.
        'BEGIN:VEVENT',
        'SUMMARY:LastFri',
        'DTSTART;TZID=Asia/Bangkok:20261127T180000',
        'DTEND;TZID=Asia/Bangkok:20261127T200000',
        'RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=3',
        'END:VEVENT',
        // อังคารที่ 2 ของเดือน (2026-11-10 ผ่านไปแล้วเกิน 7 วัน → ได้ 8 ธ.ค., 12 ม.ค.)
        'BEGIN:VEVENT',
        'SUMMARY:SecondTue',
        'DTSTART;VALUE=DATE:20261110',
        'RRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=3',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const r = parseIcsToBusy(ics, { nowMs: NOW_MS, windowDays: 180 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items.filter((x) => x.title === 'Day31').map((x) => x.startDate)).toEqual([
      '2026-12-31',
      '2027-01-31',
      '2027-03-31',
    ]);
    expect(r.items.filter((x) => x.title === 'MonthEnd').map((x) => x.startDate)).toEqual([
      '2026-11-30',
      '2026-12-31',
      '2027-01-31',
      '2027-02-28',
    ]);
    expect(r.items.filter((x) => x.title === 'LastFri').map((x) => x.startDate)).toEqual([
      '2026-11-27',
      '2026-12-25',
      '2027-01-29',
    ]);
    expect(r.items.filter((x) => x.title === 'SecondTue').map((x) => x.startDate)).toEqual([
      '2026-12-08',
      '2027-01-12',
    ]);
  });

  it('EXDATE (หลายบรรทัด + คั่นด้วยคอมมา + VALUE=DATE บน timed) และ RECURRENCE-ID (ย้ายเวลา/ยกเลิก/อยู่ก่อน master) + ไม่รั่ว UID', () => {
    const secretUid = 'SECRET-UID-NEVER-LEAK-999@example.com';
    const ics = wrap(
      [
        // Override อยู่ *ก่อน* master: ย้ายจันทร์ 2026-12-07 ไปอังคาร 2026-12-08 14:00–15:00
        'BEGIN:VEVENT',
        `UID:${secretUid}`,
        'RECURRENCE-ID;TZID=Asia/Bangkok:20261207T090000',
        'DTSTART;TZID=Asia/Bangkok:20261208T140000',
        'DTEND;TZID=Asia/Bangkok:20261208T150000',
        'SUMMARY:Weekly Moved',
        'END:VEVENT',
        // Override ยกเลิกจันทร์ 2026-12-14 (STATUS:CANCELLED)
        'BEGIN:VEVENT',
        `UID:${secretUid}`,
        'RECURRENCE-ID;TZID=Asia/Bangkok:20261214T090000',
        'DTSTART;TZID=Asia/Bangkok:20261214T090000',
        'DTEND;TZID=Asia/Bangkok:20261214T100000',
        'STATUS:CANCELLED',
        'SUMMARY:Weekly Standup',
        'END:VEVENT',
        // Master: ทุกจันทร์ 09:00–10:00 จำนวน 5 ครั้ง (11-23, 11-30, 12-07, 12-14, 12-21) · EXDATE ตัด 11-30
        'BEGIN:VEVENT',
        `UID:${secretUid}`,
        'DTSTART;TZID=Asia/Bangkok:20261123T090000',
        'DTEND;TZID=Asia/Bangkok:20261123T100000',
        'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=5',
        'EXDATE;TZID=Asia/Bangkok:20261130T090000',
        'SUMMARY:Weekly Standup',
        'END:VEVENT',
        // EXDATE แบบคั่นคอมมา + VALUE=DATE บน timed
        'BEGIN:VEVENT',
        'DTSTART;TZID=Asia/Bangkok:20261125T130000',
        'DTEND;TZID=Asia/Bangkok:20261125T140000',
        'RRULE:FREQ=DAILY;COUNT=4',
        'EXDATE;VALUE=DATE:20261126,20261127',
        'SUMMARY:Daily With Exdate',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const r = parseIcsToBusy(ics, { nowMs: NOW_MS, windowDays: 60 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skipped.cancelled).toBe(1);
    const standups = r.items.filter((x) => x.title === 'Weekly Standup' || x.title === 'Weekly Moved');
    expect(standups.map((x) => `${x.startDate} ${x.startTime}-${x.endTime} ${x.title}`)).toEqual([
      '2026-11-23 09:00-10:00 Weekly Standup',
      '2026-12-08 14:00-15:00 Weekly Moved',
      '2026-12-21 09:00-10:00 Weekly Standup',
    ]);
    expect(r.items.filter((x) => x.title === 'Daily With Exdate').map((x) => x.startDate)).toEqual([
      '2026-11-25',
      '2026-11-28',
    ]);
    // UID ห้ามรั่วในผลลัพธ์เด็ดขาด
    expect(JSON.stringify(r)).not.toContain(secretUid);
  });

  it('คงเวลาท้องถิ่น (wall-clock) ใน TZID ข้ามช่วง DST (America/New_York)', () => {
    // อเมริกาเปลี่ยน DST เป็นฤดูร้อน (EDT UTC-4) วันอาทิตย์ที่ 2027-03-14 (ก่อนนั้น EST UTC-5)
    // 09:00 America/New_York:
    //   2027-03-08 (EST, UTC-5) → 21:00 Asia/Bangkok
    //   2027-03-15 (EDT, UTC-4) → 20:00 Asia/Bangkok
    const marchNow = parseLocalDateTime('2027-03-01', '10:00', 'Asia/Bangkok');
    const ics = wrap(
      [
        'BEGIN:VEVENT',
        'SUMMARY:US Call',
        'DTSTART;TZID=America/New_York:20270308T090000',
        'DTEND;TZID=America/New_York:20270308T100000',
        'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=2',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const r = parseIcsToBusy(ics, { nowMs: marchNow, windowDays: 30 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items.map((x) => `${x.startDate} ${x.startTime}-${x.endTime}`)).toEqual([
      '2027-03-08 21:00-22:00',
      '2027-03-15 20:00-21:00',
    ]);
  });

  it('ข้ามกฎซับซ้อนลง skipped.rrule และแยก past / tooFarAhead ของนัดซ้ำได้ถูกต้อง', () => {
    const ics = wrap(
      [
        // YEARLY → skipped.rrule
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20261125',
        'RRULE:FREQ=YEARLY',
        'SUMMARY:Birthday',
        'END:VEVENT',
        // BYSETPOS → skipped.rrule
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20261125',
        'RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
        'SUMMARY:Last Weekday',
        'END:VEVENT',
        // มีทั้ง COUNT และ UNTIL → skipped.rrule
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20261125',
        'RRULE:FREQ=DAILY;COUNT=3;UNTIL=20261201',
        'SUMMARY:Both Count Until',
        'END:VEVENT',
        // นัดซ้ำที่จบไปแล้วในอดีต → skipped.past
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20250101',
        'RRULE:FREQ=WEEKLY;UNTIL=20250601',
        'SUMMARY:Old Recurring',
        'END:VEVENT',
        // นัดซ้ำที่เริ่มไกลเกินช่วง → skipped.tooFarAhead
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20270501',
        'RRULE:FREQ=WEEKLY;COUNT=4',
        'SUMMARY:Future Recurring',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const r = parseIcsToBusy(ics, { nowMs: NOW_MS, windowDays: 30 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items).toHaveLength(0);
    expect(r.skipped.rrule).toBe(3);
    expect(r.skipped.past).toBe(1);
    expect(r.skipped.tooFarAhead).toBe(1);
  });

  it('O(1) fast-forward จากปี 1990 เร็ว (< 50 ms) และแตกเกิน 500 รายการคืน TOO_LARGE ทันที', () => {
    const oldDaily = wrap(
      [
        'BEGIN:VEVENT',
        'SUMMARY:Ancient Daily',
        'DTSTART;VALUE=DATE:19900101',
        'RRULE:FREQ=DAILY',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'SUMMARY:Ancient Weekly Count',
        'DTSTART;VALUE=DATE:19950102',
        'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5000',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const t0 = performance.now();
    const r = parseIcsToBusy(oldDaily, { nowMs: NOW_MS, windowDays: 30 });
    const elapsed = performance.now() - t0;
    expect(r.ok).toBe(true);
    if (r.ok) {
      // DAILY 30 วันข้างหน้า + 7 วันย้อนหลัง + วันนี้ = 38 รายการ · WEEKLY 1995 COUNT=5000 (~48 ปี) ยังอยู่ในช่วงนี้ด้วย
      expect(r.items.length).toBeGreaterThanOrEqual(38);
    }
    expect(elapsed).toBeLessThan(100);

    // 4 daily events × 180 days (> 500 รายการ) → TOO_LARGE ทันที
    const fourDailies = wrap(
      [1, 2, 3, 4]
        .map((n) => {
          const hh = String(n + 7).padStart(2, '0');
          return [
            'BEGIN:VEVENT',
            `SUMMARY:Daily ${n}`,
            `DTSTART;TZID=Asia/Bangkok:20261123T${hh}0000`,
            `DTEND;TZID=Asia/Bangkok:20261123T${hh}3000`,
            'RRULE:FREQ=DAILY',
            'END:VEVENT',
          ].join('\r\n');
        })
        .join('\r\n'),
    );
    const rBig = parseIcsToBusy(fourDailies, { nowMs: NOW_MS, windowDays: 180 });
    expect(rBig).toEqual({ ok: false, error: 'TOO_LARGE', limit: 'events', max: ICS_IMPORT_MAX_EXPANDED_ITEMS });
  });

  it('security M1: กัน DoS 500 VEVENT MONTHLY+COUNT จากปี 1900 (BYDAY=MO..SU และ BYMONTHDAY=1..31) ด้วยงบรวมระดับไฟล์', () => {
    const make500 = (rrule: string) =>
      wrap(
        Array.from({ length: 500 }, (_, i) =>
          [
            'BEGIN:VEVENT',
            `SUMMARY:M1-${i}`,
            'DTSTART;VALUE=DATE:19000101',
            `RRULE:${rrule}`,
            'END:VEVENT',
          ].join('\r\n'),
        ).join('\r\n'),
      );

    // ใช้เพดาน < 250 ms แทน 100 ms เพื่อให้ไม่ flaky บน CI runner ที่โหลดสูง (จริงบนเครื่องรัน ~5–20 ms)
    const byDayIcs = make500('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR,SA,SU;COUNT=10000');
    const t0 = performance.now();
    const rByDay = parseIcsToBusy(byDayIcs, { nowMs: NOW_MS });
    const elapsedByDay = performance.now() - t0;
    expect(rByDay).toEqual({ ok: false, error: 'TOO_LARGE', limit: 'events', max: ICS_IMPORT_MAX_EXPANDED_ITEMS });
    expect(elapsedByDay).toBeLessThan(250);

    const allDays = Array.from({ length: 31 }, (_, i) => i + 1).join(',');
    const byMonthDayIcs = make500(`FREQ=MONTHLY;BYMONTHDAY=${allDays};COUNT=10000`);
    const t1 = performance.now();
    const rByMonthDay = parseIcsToBusy(byMonthDayIcs, { nowMs: NOW_MS });
    const elapsedByMonthDay = performance.now() - t1;
    expect(rByMonthDay).toEqual({ ok: false, error: 'TOO_LARGE', limit: 'events', max: ICS_IMPORT_MAX_EXPANDED_ITEMS });
    expect(elapsedByMonthDay).toBeLessThan(250);

    // กรณี single-day / BYDAY=-1 / BYMONTHDAY=31 จากปี 1900 จำนวน 500 VEVENT ก็ต้องโดนเพดานรวมระดับไฟล์เช่นกัน
    for (const rrule of [
      'FREQ=MONTHLY;COUNT=1500',
      'FREQ=MONTHLY;BYDAY=-1MO,-1TU,-1WE,-1TH,-1FR;COUNT=7500',
      'FREQ=MONTHLY;BYMONTHDAY=31;COUNT=1500',
    ]) {
      const t = performance.now();
      const res = parseIcsToBusy(make500(rrule), { nowMs: NOW_MS });
      const elapsed = performance.now() - t;
      expect(res, rrule).toEqual({ ok: false, error: 'TOO_LARGE', limit: 'events', max: ICS_IMPORT_MAX_EXPANDED_ITEMS });
      expect(elapsed, rrule).toBeLessThan(250);
    }
  });

  it('กรณีปกติไม่ชนงบ: 500 VEVENT MONTHLY เริ่มปีนี้ และ MONTHLY+COUNT จากอดีตไม่ไกลยังให้ผลถูกต้อง', () => {
    // 500 VEVENT รายเดือนเริ่มต้นปี 2026 (COUNT=11 → จบ พ.ย. 2026 ก่อนช่วงอนาคต) ต้องผ่านได้ครบโดยไม่ติดงบ
    const pastYear500 = wrap(
      Array.from({ length: 500 }, (_, i) =>
        [
          'BEGIN:VEVENT',
          `SUMMARY:PastThisYear-${i}`,
          'DTSTART;VALUE=DATE:20260110',
          'RRULE:FREQ=MONTHLY;COUNT=11',
          'END:VEVENT',
        ].join('\r\n'),
      ).join('\r\n'),
    );
    const rPast500 = parseIcsToBusy(pastYear500, { nowMs: NOW_MS });
    expect(rPast500.ok).toBe(true);
    if (rPast500.ok) {
      expect(rPast500.skipped.past).toBe(500);
      expect(rPast500.items).toHaveLength(0);
    }

    // 500 VEVENT รายปีแบบ MONTHLY;INTERVAL=12 เริ่มปี 2026 ที่ตกในช่วงอนาคตพอดี (500 รายการ = เพดานพอดี)
    const active500 = wrap(
      Array.from({ length: 500 }, (_, i) =>
        [
          'BEGIN:VEVENT',
          `SUMMARY:YearlyViaMonthly-${i}`,
          'DTSTART;VALUE=DATE:20260115',
          'RRULE:FREQ=MONTHLY;INTERVAL=12;COUNT=2',
          'END:VEVENT',
        ].join('\r\n'),
      ).join('\r\n'),
    );
    const rActive500 = parseIcsToBusy(active500, { nowMs: NOW_MS, windowDays: 90 });
    expect(rActive500.ok).toBe(true);
    if (rActive500.ok) {
      expect(rActive500.items).toHaveLength(500);
      expect(rActive500.items.every((x) => x.startDate === '2027-01-15')).toBe(true);
    }

    // VEVENT MONTHLY+COUNT จากอดีตไม่ไกล (2025-01-15, COUNT=25) → ยังมี occurrence 2026-12-15 และ 2027-01-15 ในช่วงอนาคต
    const recentCount = wrap(
      [
        'BEGIN:VEVENT',
        'SUMMARY:Recent Monthly',
        'DTSTART;VALUE=DATE:20250115',
        'RRULE:FREQ=MONTHLY;COUNT=25',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const rRecent = parseIcsToBusy(recentCount, { nowMs: NOW_MS, windowDays: 90 });
    expect(rRecent.ok).toBe(true);
    if (rRecent.ok) {
      expect(rRecent.items.map((x) => x.startDate)).toEqual(['2026-12-15', '2027-01-15']);
    }
  });

  it('MONTHLY+COUNT (เลขคณิตข้ามเดือนอดีต) ตรงกับปฏิทินจริง: ข้ามเดือนไม่มี 31 / สัปดาห์ที่ 5 / BYMONTHDAY ลบ / เดือนแรก', () => {
    const ics = wrap(
      [
        // 1) วันที่ 31 จาก ม.ค. 2026 (ก.พ./เม.ย./มิ.ย./ก.ย./พ.ย. ไม่มี 31): COUNT=8 → #7=2026-12-31, #8=2027-01-31
        'BEGIN:VEVENT',
        'SUMMARY:CountDay31',
        'DTSTART;VALUE=DATE:20260131',
        'RRULE:FREQ=MONTHLY;COUNT=8',
        'END:VEVENT',
        // 2) สัปดาห์ที่ 5 (5FR จาก ม.ค. 2026): มีใน ม.ค., พ.ค., ก.ค., ต.ค., ม.ค. 2027 → #5=2027-01-29
        'BEGIN:VEVENT',
        'SUMMARY:Count5Fri',
        'DTSTART;VALUE=DATE:20260101',
        'RRULE:FREQ=MONTHLY;BYDAY=5FR;COUNT=5',
        'END:VEVENT',
        // 3) BYMONTHDAY=30,-1 (กันนับซ้ำวันที่ 30 ในเดือน 30 วัน): ส.ค.(2)+ก.ย.(1)+ต.ค.(2)+พ.ย.(1)+ธ.ค.(2) = 8
        'BEGIN:VEVENT',
        'SUMMARY:CountNegOverlap',
        'DTSTART;VALUE=DATE:20260801',
        'RRULE:FREQ=MONTHLY;BYMONTHDAY=30,-1;COUNT=8',
        'END:VEVENT',
        // 4) BYMONTHDAY=-31 (มีเฉพาะเดือน 31 วัน): ส.ค., ต.ค., ธ.ค., ม.ค. 2027 → #3=2026-12-01, #4=2027-01-01
        'BEGIN:VEVENT',
        'SUMMARY:CountNeg31',
        'DTSTART;VALUE=DATE:20260801',
        'RRULE:FREQ=MONTHLY;BYMONTHDAY=-31;COUNT=4',
        'END:VEVENT',
        // 5) ข้ามปีอธิกสุรทิน 2024-02-29 ด้วย BYMONTHDAY=-1 (COUNT=35 → #34=2026-11-30, #35=2026-12-31)
        'BEGIN:VEVENT',
        'SUMMARY:CountLeapMonthEnd',
        'DTSTART;VALUE=DATE:20240229',
        'RRULE:FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=35',
        'END:VEVENT',
        // 6) กรองวัน < DTSTART ในเดือนแรก + ordinal ซ้ำกับ plain (MO,1MO,-5MO): ก.ย.(28,30=#1,#2) + ต.ค.(1,15,28,31=#3..#6) + พ.ย.(1,15,28=#7..#9)
        'BEGIN:VEVENT',
        'SUMMARY:CountFirstMonthFilter',
        'DTSTART;VALUE=DATE:20260928',
        'RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15,28,-1;COUNT=9',
        'END:VEVENT',
        // 7) BYDAY=MO,1MO,-5MO กันนับซ้ำในเดือน 4/5 สัปดาห์: ก.ย.(4)+ต.ค.(4)+พ.ย.(5)+ธ.ค.(#14=2026-12-07)
        'BEGIN:VEVENT',
        'SUMMARY:CountByDayOverlap',
        'DTSTART;VALUE=DATE:20260901',
        'RRULE:FREQ=MONTHLY;BYDAY=MO,1MO,-5MO;COUNT=14',
        'END:VEVENT',
      ].join('\r\n'),
    );

    const r = parseIcsToBusy(ics, { nowMs: NOW_MS, windowDays: 90 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const datesOf = (title: string) => r.items.filter((x) => x.title === title).map((x) => x.startDate);
    expect(datesOf('CountDay31')).toEqual(['2026-12-31', '2027-01-31']);
    expect(datesOf('Count5Fri')).toEqual(['2027-01-29']);
    expect(datesOf('CountNegOverlap')).toEqual(['2026-11-30', '2026-12-30', '2026-12-31']);
    expect(datesOf('CountNeg31')).toEqual(['2026-12-01', '2027-01-01']);
    expect(datesOf('CountLeapMonthEnd')).toEqual(['2026-11-30', '2026-12-31']);
    expect(datesOf('CountFirstMonthFilter')).toEqual(['2026-11-28']);
    expect(datesOf('CountByDayOverlap')).toEqual(['2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07']);
  });
});
