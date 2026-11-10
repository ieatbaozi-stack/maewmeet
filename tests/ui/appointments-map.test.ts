// โมเดลแผนที่ (R13 · D11): ตัวสร้างลิงก์เปิดแอปแผนที่ · ลิงก์ค้นหาชื่อ Google/Apple · ตรวจชนิดเครื่องจาก user agent
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { linkTextOf } from '@/components/places/PlaceField';
import { parseLocationInput } from '@/lib/shared/location-parse';
import { APPLE_MAPS_HOME, GOOGLE_MAPS_HOME, detectMapApps, hasCoords, mapOpenLink, mapSearchLink } from '@/components/places/map-model';

describe('mapSearchLink (R13-2)', () => {
  it('Google: ?api=1&query=<ชื่อ> · Apple: ?q=<ชื่อ>', () => {
    expect(mapSearchLink('google', 'ร้านหมูกระทะ')).toBe(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('ร้านหมูกระทะ')}`);
    expect(mapSearchLink('apple', 'ร้านหมูกระทะ')).toBe(`https://maps.apple.com/?q=${encodeURIComponent('ร้านหมูกระทะ')}`);
    expect(mapSearchLink('google', 'Siam Paragon')).toBe('https://www.google.com/maps/search/?api=1&query=Siam%20Paragon');
  });
  it('encode & และ # และ ? ไม่ให้หลุดเป็นตัวคั่นของ URL', () => {
    for (const app of ['google', 'apple'] as const) {
      const u = new URL(mapSearchLink(app, 'A&B #1 ?x=y'));
      expect(u.hash).toBe('');
      expect(u.searchParams.get(app === 'google' ? 'query' : 'q')).toBe('A&B #1 ?x=y');
      expect([...u.searchParams.keys()]).toEqual(app === 'google' ? ['api', 'query'] : ['q']);
    }
  });
  it('ชื่อว่าง/เว้นวรรค/null → หน้าแรกของแผนที่', () => {
    for (const v of ['', '   ', '\n\t', null, undefined]) {
      expect(mapSearchLink('google', v)).toBe(GOOGLE_MAPS_HOME);
      expect(mapSearchLink('apple', v)).toBe(APPLE_MAPS_HOME);
    }
    expect(GOOGLE_MAPS_HOME).toBe('https://www.google.com/maps');
    expect(APPLE_MAPS_HOME).toBe('https://maps.apple.com/');
  });
  it('ตัดช่องว่างหัวท้าย/ยุบช่องว่างซ้อน และทำ NFC', () => {
    expect(mapSearchLink('apple', '  ร้าน   ป้าแดง ')).toBe(`https://maps.apple.com/?q=${encodeURIComponent('ร้าน ป้าแดง')}`);
  });
  it('ผลเป็น https เสมอ', () => {
    expect(mapSearchLink('google', 'x').startsWith('https://')).toBe(true);
    expect(mapSearchLink('apple', 'x').startsWith('https://')).toBe(true);
  });
});

describe('detectMapApps (R13-2)', () => {
  const UA = {
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    // iPadOS 13+ ขอเว็บแบบเดสก์ท็อป บอกตัวเป็น Macintosh
    ipadOsMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  };
  it('iPhone / iPad / Mac / iPadOS-Macintosh → Apple ก่อน แล้ว Google', () => {
    for (const k of ['iphone', 'ipad', 'mac', 'ipadOsMac'] as const) expect(detectMapApps(UA[k]), k).toEqual(['apple', 'google']);
  });
  it('Android / Windows / ว่าง / ไม่รู้จัก → Google อย่างเดียว', () => {
    expect(detectMapApps(UA.android)).toEqual(['google']);
    expect(detectMapApps(UA.windows)).toEqual(['google']);
    expect(detectMapApps('')).toEqual(['google']);
    expect(detectMapApps(null)).toEqual(['google']);
    expect(detectMapApps(undefined)).toEqual(['google']);
    expect(detectMapApps('curl/8.0')).toEqual(['google']);
  });
});

describe('R13 ซอร์ส: ไม่มีภาพแผนที่/การค้นหา และไม่มี hydration mismatch', () => {
  const links = readFileSync('src/components/places/MapAppLinks.tsx', 'utf8');
  const field = readFileSync('src/components/places/PlaceField.tsx', 'utf8');
  it('ตรวจเครื่องผ่าน useSyncExternalStore: server snapshot = google อย่างเดียว', () => {
    expect(links).toContain('useSyncExternalStore');
    expect(links).toContain('const serverSnapshot = (): string => "google"');
  });
  it('ปุ่มเป็นลิงก์ https เปิดแท็บใหม่ noopener noreferrer', () => {
    expect(links).toContain('target="_blank"');
    expect(links).toContain('rel="noopener noreferrer"');
  });
  it('PlaceField ไม่เรียก API ค้นหา/ไม่มีปุ่มค้นหา', () => {
    expect(field).not.toMatch(/api.places|callApi|place-search|place-chip/);
  });
});

describe('mapOpenLink', () => {
  it('มีลิงก์ https → ใช้ลิงก์นั้น เปิดแท็บใหม่ noopener noreferrer', () => {
    const l = mapOpenLink({ placeName: 'ร้าน', lat: 13.7, lng: 100.5, mapUrl: 'https://maps.example.com/abc' });
    expect(l).toMatchObject({ kind: 'https', href: 'https://maps.example.com/abc', target: '_blank', rel: 'noopener noreferrer', host: 'maps.example.com' });
  });
  it('มีแต่พิกัด → geo: (ไม่เปิดแท็บใหม่) พร้อมชื่อที่ encode แล้ว', () => {
    const l = mapOpenLink({ placeName: 'ป้าแดง (สาขา) หมูกระทะ', lat: 13.8016, lng: 100.6032, mapUrl: null })!;
    expect(l.kind).toBe('geo');
    expect(l.target).toBeUndefined();
    expect(l.rel).toBeUndefined();
    expect(l.href.startsWith('geo:13.8016,100.6032?q=13.8016,100.6032(')).toBe(true);
    // วงเล็บของชื่อถูกกำจัด ไม่ทำให้ geo: พัง
    expect(l.href.slice(l.href.indexOf('(') + 1, -1)).not.toMatch(/[()]/);
    expect(l.href.endsWith(')')).toBe(true);
  });
  it('ไม่มีชื่อ → geo: ไม่มี label', () => {
    expect(mapOpenLink({ placeName: null, lat: 1, lng: 2, mapUrl: null })!.href).toBe('geo:1,2?q=1,2');
  });
  it('ไม่ไว้ใจ mapUrl ที่ไม่ใช่ https (javascript:, http:, data:) → ตกไปใช้พิกัด/ไม่มี', () => {
    for (const bad of ['javascript:alert(1)', 'http://maps.example.com', 'data:text/html,x', '//evil.example', 'HTTPS-not://x']) {
      expect(mapOpenLink({ placeName: null, lat: null, lng: null, mapUrl: bad })).toBeNull();
      expect(mapOpenLink({ placeName: null, lat: 1, lng: 2, mapUrl: bad })!.kind).toBe('geo');
    }
  });
  it('พิกัดผิดช่วง/ไม่ครบคู่ → null', () => {
    expect(mapOpenLink({ placeName: 'x', lat: 91, lng: 0, mapUrl: null })).toBeNull();
    expect(mapOpenLink({ placeName: 'x', lat: 10, lng: null, mapUrl: null })).toBeNull();
    expect(mapOpenLink({ placeName: 'x', lat: Number.NaN, lng: 5, mapUrl: null })).toBeNull();
  });
  it('hasCoords ต้องครบคู่', () => {
    expect(hasCoords({ lat: 1, lng: 2 })).toBe(true);
    expect(hasCoords({ lat: 1, lng: null })).toBe(false);
  });
});

describe('linkTextOf — แก้นัดเก่า (R13-4)', () => {
  it('มีลิงก์ (รวมลิงก์ OSM ของนัดเก่า) → แสดงลิงก์นั้น', () => {
    const osm = 'https://www.openstreetmap.org/node/123';
    expect(linkTextOf({ name: 'ร้าน', lat: 13.75, lng: 100.5, mapUrl: osm })).toBe(osm);
  });
  it('มีแต่พิกัด → lat,lng และ parse กลับได้ค่าเดิมทุกหลัก', () => {
    const text = linkTextOf({ name: null, lat: 13.756331, lng: 100.501765, mapUrl: null });
    expect(text).toBe('13.756331,100.501765');
    const back = parseLocationInput(text);
    expect(back).toMatchObject({ ok: true, lat: 13.756331, lng: 100.501765, mapUrl: null });
  });
  it('ไม่มีทั้งลิงก์และพิกัด / ไม่มีค่า → ว่าง', () => {
    expect(linkTextOf({ name: 'ร้าน', lat: null, lng: null, mapUrl: null })).toBe('');
    expect(linkTextOf(null)).toBe('');
  });
});
