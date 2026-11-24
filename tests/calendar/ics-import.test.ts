// เทสต์ pure ICS parser (ICS_IMPORT_CONTRACT §1 I1–I5 · ADR 0017) — เจ้าของ: platform
import { describe, expect, it } from 'vitest';
import {
  buildAppointmentIcs,
  busyDedupeKey,
  ICS_IMPORT_MAX_BYTES,
  ICS_IMPORT_MAX_EVENTS,
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
        // 6. rrule
        'BEGIN:VEVENT',
        'DTSTART:20261125T090000',
        'DTEND:20261125T100000',
        'RRULE:FREQ=WEEKLY;BYDAY=MO,WE',
        'SUMMARY:Standup',
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
