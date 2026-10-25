// R4B-6 ตัวแยกสถานที่ที่วาง (pure) — พิกัด/geo:/ลิงก์ OSM-Google-Apple + อินพุตอันตราย
import { describe, expect, it } from 'vitest';
import { LOCATION_INPUT_MAX, parseLocationInput, parseMapUrl } from '@/lib/shared/location-parse';

const ok = (raw: string) => {
  const r = parseLocationInput(raw);
  if (!r.ok) throw new Error(`expected ok for ${raw} got ${r.reason}`);
  return r;
};
const reason = (raw: unknown) => {
  const r = parseLocationInput(raw);
  if (r.ok) throw new Error(`expected failure for ${String(raw)}`);
  return r.reason;
};

describe('พิกัดล้วน / geo:', () => {
  it.each([
    ['13.7563,100.5018', 13.7563, 100.5018],
    ['13.7563, 100.5018', 13.7563, 100.5018],
    ['  -33.8688 151.2093 ', -33.8688, 151.2093],
    ['0,0', 0, 0],
    ['90,180', 90, 180],
    ['-90,-180', -90, -180],
  ])('%s', (raw, lat, lng) => {
    expect(ok(raw)).toEqual({ ok: true, source: 'coords', lat, lng, mapUrl: null });
  });

  it('geo: URI (มีความสูง/พารามิเตอร์ได้)', () => {
    expect(ok('geo:13.7563,100.5018')).toMatchObject({ source: 'geo', lat: 13.7563, lng: 100.5018, mapUrl: null });
    expect(ok('GEO:13.75,100.50,12;u=35?q=x')).toMatchObject({ source: 'geo', lat: 13.75, lng: 100.5 });
  });

  it.each(['91,0', '-91,0', '0,181', '0,-181', '999,999', 'geo:91,0'])('นอกช่วง %s → INVALID_COORDINATES', (raw) => {
    expect(reason(raw)).toBe('INVALID_COORDINATES');
  });

  it.each(['13.7', 'NaN,NaN', 'Infinity,0', '1e2,1e2', '13.7,,100.5', 'a,b', '13.7;100.5', 'geo:abc', '0x10,0x10'])('ไม่ใช่พิกัด %s → ไม่ผ่าน', (raw) => {
    expect(parseLocationInput(raw).ok).toBe(false);
  });
});

describe('ลิงก์แผนที่ที่รู้จัก', () => {
  it('OpenStreetMap: mlat/mlon · #map= · lat/lon', () => {
    expect(ok('https://www.openstreetmap.org/?mlat=13.7563&mlon=100.5018#map=17/13.7/100.5')).toMatchObject({ source: 'osm', lat: 13.7563, lng: 100.5018 });
    expect(ok('https://www.openstreetmap.org/#map=15/13.7563/100.5018')).toMatchObject({ source: 'osm', lat: 13.7563, lng: 100.5018 });
    expect(ok('https://osm.org/?lat=1.5&lon=2.5')).toMatchObject({ source: 'osm', lat: 1.5, lng: 2.5 });
  });

  it('Google Maps: !3d!4d (หมุดจริง) มาก่อน @ · ?q= · /@lat,lng', () => {
    expect(ok('https://www.google.com/maps/place/X/@13.70,100.50,17z/data=!3m1!4b1!4m5!3m4!1s0x0!8m2!3d13.7563!4d100.5018')).toMatchObject({ source: 'google', lat: 13.7563, lng: 100.5018 });
    expect(ok('https://www.google.com/maps?q=13.7563,100.5018')).toMatchObject({ lat: 13.7563, lng: 100.5018 });
    expect(ok('https://www.google.com/maps/@13.7563,100.5018,15z')).toMatchObject({ lat: 13.7563, lng: 100.5018 });
    expect(ok('https://maps.google.co.th/?ll=13.7,100.5')).toMatchObject({ source: 'google', lat: 13.7, lng: 100.5 });
  });

  it('Apple Maps: ll= / q=', () => {
    expect(ok('https://maps.apple.com/?ll=13.7563,100.5018&q=x')).toMatchObject({ source: 'apple', lat: 13.7563, lng: 100.5018 });
  });

  it('https อื่น ๆ และลิงก์ย่อ = เก็บเป็นลิงก์ล้วนไม่มีพิกัด (ไม่ออกเครือข่ายไปขยาย)', () => {
    expect(ok('https://maps.app.goo.gl/AbCdEf')).toEqual({ ok: true, source: 'link', lat: null, lng: null, mapUrl: 'https://maps.app.goo.gl/AbCdEf' });
    expect(ok('https://example.com/place?lat=1&lon=2')).toMatchObject({ source: 'link', lat: null, lng: null });
    // โฮสต์หลอก: openstreetmap.org.evil.com ไม่ใช่ OSM → ไม่ดึงพิกัดจาก query
    expect(ok('https://openstreetmap.org.evil.com/?mlat=1&mlon=2')).toMatchObject({ source: 'link', lat: null });
    expect(ok('https://evil.com/maps/@1,2,3z')).toMatchObject({ source: 'link', lat: null });
  });

  it('พิกัดในลิงก์นอกช่วง → INVALID_COORDINATES', () => {
    expect(reason('https://www.openstreetmap.org/?mlat=95&mlon=10')).toBe('INVALID_COORDINATES');
  });
});

describe('อินพุตอันตราย', () => {
  it.each([
    ['javascript:alert(1)', 'UNSUPPORTED_SCHEME'],
    ['JaVaScRiPt:alert(1)', 'UNSUPPORTED_SCHEME'],
    ['data:text/html,<script>alert(1)</script>', 'UNSUPPORTED_SCHEME'],
    ['vbscript:msgbox(1)', 'UNSUPPORTED_SCHEME'],
    ['file:///etc/passwd', 'UNSUPPORTED_SCHEME'],
    ['blob:https://example.com/uuid', 'UNSUPPORTED_SCHEME'],
    ['ftp://example.com/x', 'UNSUPPORTED_SCHEME'],
    ['intent://x#Intent;scheme=http;end', 'UNSUPPORTED_SCHEME'],
    ['//example.com/x', 'UNSUPPORTED_SCHEME'],
    ['http://example.com/x', 'NOT_HTTPS'],
    ['HTTP://example.com/x', 'NOT_HTTPS'],
    ['https://user:pass@example.com/', 'CREDENTIALS'],
    ['https://user@example.com/', 'CREDENTIALS'],
    ['https://www.google.com@evil.com/maps', 'CREDENTIALS'],
  ])('%s → %s', (raw, why) => {
    expect(reason(raw)).toBe(why);
  });

  it.each([
    ['ช่องว่างกลางสตริง', 'https://example.com/a b'],
    ['ขึ้นบรรทัด', 'https://example.com/a\nb'],
    ['แท็บ', 'https://example.com/a\tb'],
    ['null byte', 'https://example.com/a\u0000b'],
    ['zero-width', 'https://example.com/a​b'],
    ['bidi override', 'https://example.com/‮/gpj'],
    ['BOM', '﻿https://example.com/x'.replace('﻿', 'https://example.com/﻿')],
    ['backslash', 'https://example.com\\@evil.com/'],
    ['C1 control', 'https://example.com/\u0085'],
    ['ตัวคั่นบรรทัด U+2028', 'https://example.com/ x'],
  ])('ตัวอักษรอันตราย (%s) → INVALID_CHARS', (_n, raw) => {
    expect(reason(raw)).toBe('INVALID_CHARS');
    expect(parseMapUrl(raw)).toBeNull();
  });

  it('ยาวเกิน → TOO_LONG (อินพุต > 2000, ลิงก์ > 500)', () => {
    expect(reason('x'.repeat(LOCATION_INPUT_MAX + 1))).toBe('TOO_LONG');
    expect(reason(`https://example.com/${'a'.repeat(490)}`)).toBe('TOO_LONG');
    expect(parseLocationInput(`https://example.com/${'a'.repeat(400)}`).ok).toBe(true);
  });

  it('ว่าง/ไม่ใช่สตริง → EMPTY · ข้อความทั่วไปไม่ใช่ลิงก์ → UNPARSEABLE', () => {
    for (const v of ['', '   ', null, undefined, 42, {}, []]) expect(reason(v)).toBe('EMPTY');
    expect(reason('สยามพารากอน')).toBe('UNPARSEABLE');
    expect(reason('https://')).toBe('UNPARSEABLE');
    // WHATWG URL ยุบ https:///x เป็น https://x/ — ยังเป็น https ที่มี host จึงปลอดภัย และเก็บค่าที่ normalize แล้ว
    expect(ok('https:///x')).toMatchObject({ source: 'link', mapUrl: 'https://x/' });
  });

  it('parseMapUrl: ผ่านเฉพาะ https ที่ปลอดภัย · คืน URL ที่ normalize แล้ว', () => {
    expect(parseMapUrl('https://Example.COM/a?b=1#c')).toBe('https://example.com/a?b=1#c');
    for (const bad of ['javascript:1', 'data:x', 'http://a.com', 'https://u:p@a.com', '', '  ', 'https://a.com/ x', 5, null, undefined]) expect(parseMapUrl(bad)).toBeNull();
  });

  it('ไม่ throw กับอินพุตแปลก ๆ (fuzz เล็ก)', () => {
    const junk = ['%', '%%%', 'https://%', 'https://[::1', 'https://a.com/%zz', '\ud800', 'https://a.com/\ud800', ':', 'https:', 'geo:', 'geo:,', '@', '#', '?', 'a'.repeat(5000)];
    for (const j of junk) expect(() => parseLocationInput(j)).not.toThrow();
  });
});
