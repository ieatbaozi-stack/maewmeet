// โมเดลแผนที่ (R4B · D11): กริด tile OSM 3×3 · ละติจูดสุดขอบ · ข้ามเส้นแบ่งวัน · ตัวสร้างลิงก์เปิดแอปแผนที่
import { describe, expect, it } from 'vitest';
import { MAP_ZOOM, MAX_MERCATOR_LAT, OSM_TILE_ORIGIN, hasCoords, mapOpenLink, tileGrid, tileUrl, worldPoint } from '@/components/places/map-model';

describe('worldPoint / tileGrid', () => {
  it('จุด (0,0) ที่ zoom 1 = มุมกลางของโลก (tile 1,1)', () => {
    const p = worldPoint(0, 0, 1);
    expect(p.x).toBeCloseTo(1, 9);
    expect(p.y).toBeCloseTo(1, 9);
  });

  it('กรุงเทพ zoom 15: tile กลางตรงสูตร slippy-map และหมุดอยู่ในกริด', () => {
    const g = tileGrid(13.7563, 100.5018);
    expect(g.zoom).toBe(MAP_ZOOM);
    expect(g.size).toBe(3);
    expect(g.cells).toHaveLength(9);
    const n = 2 ** 15;
    const x = Math.floor(((100.5018 + 180) / 360) * n);
    const latRad = (13.7563 * Math.PI) / 180;
    const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
    const center = g.cells[4]!;
    expect([center.x, center.y]).toEqual([x, y]);
    expect(center.url).toBe(`${OSM_TILE_ORIGIN}/15/${x}/${y}.png`);
    expect(g.marker.x).toBeGreaterThan(1 / 3);
    expect(g.marker.x).toBeLessThan(2 / 3);
    expect(g.marker.y).toBeGreaterThan(1 / 3);
    expect(g.marker.y).toBeLessThan(2 / 3);
  });

  it('จุดกลาง tile พอดี → หมุดอยู่กลางกริด (0.5, 0.5)', () => {
    const n = 2 ** 15;
    const k = 25000;
    const lng = ((k + 0.5) / n) * 360 - 180;
    const g = tileGrid(0, lng);
    expect(g.marker.x).toBeCloseTo(0.5, 6);
  });

  it('ใช้ origin ของ OSM เท่านั้น (CSP เดิมอนุญาต) และทุก url เป็น https .png', () => {
    for (const c of tileGrid(35.6762, 139.6503).cells) {
      expect(c.url).toMatch(/^https:\/\/tile\.openstreetmap\.org\/15\/\d+\/\d+\.png$/);
    }
    expect(tileUrl(3, 1, 2)).toBe('https://tile.openstreetmap.org/3/1/2.png');
  });

  it('ละติจูดสุดขอบ: ±90 ถูกหนีบเป็น ±85.0511 · แถวนอกโลกไม่มี tile', () => {
    expect(worldPoint(90, 0, 15).y).toBeCloseTo(worldPoint(MAX_MERCATOR_LAT, 0, 15).y, 6);
    const north = tileGrid(90, 10);
    expect(north.cells.slice(0, 3).every((c) => c.url === null)).toBe(true); // แถวบน (y = −1)
    expect(north.cells.slice(3).every((c) => c.url !== null)).toBe(true);
    const south = tileGrid(-90, 10);
    expect(south.cells.slice(6).every((c) => c.url === null)).toBe(true); // แถวล่าง (y = n)
    expect(south.cells.slice(0, 6).every((c) => c.url !== null)).toBe(true);
    const ymax = 2 ** 15 - 1;
    expect(south.cells[4]!.y).toBe(ymax);
  });

  it('ข้ามเส้นแบ่งวัน: lng ≈ 180 → คอลัมน์ขวาวนกลับเป็น tile 0 · lng = −180 → คอลัมน์ซ้ายเป็น n−1', () => {
    const n = 2 ** 15;
    const east = tileGrid(0, 179.9999);
    expect(east.cells.map((c) => c.x).slice(0, 3)).toEqual([n - 2, n - 1, 0]);
    const west = tileGrid(0, -180);
    expect(west.cells.map((c) => c.x).slice(0, 3)).toEqual([n - 1, 0, 1]);
    // lng = 180 พอดี = จุดเดียวกับ −180
    expect(worldPoint(0, 180, 15).x).toBeCloseTo(worldPoint(0, -180, 15).x, 9);
    // ทุก url ยังเป็น tile ที่ถูกต้อง (x ใน [0, n))
    for (const c of east.cells) expect(c.x >= 0 && c.x < n).toBe(true);
  });

  it('ค่า lng เกินช่วงถูกวน (ไม่ให้ tile index ติดลบ)', () => {
    const g = tileGrid(10, 540.5); // = 180.5 = −179.5
    for (const c of g.cells) expect(c.x >= 0 && c.x < 2 ** 15).toBe(true);
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
