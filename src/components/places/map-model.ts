// โมเดลแผนที่ (R4B · D11) — ล้วน ไม่แตะ DOM/เครือข่าย · ทดสอบที่ tests/ui/appointments-map.test.ts
//  - tileGrid: คำนวณกริด tile OSM 3×3 (zoom 15) รอบพิกัด — ไม่เพิ่มไลบรารีแผนที่ · tile มาจาก tile.openstreetmap.org (CSP เดิมอนุญาต)
//  - mapOpenLink: ลิงก์ "เปิดในแอปแผนที่" (https ของผู้ใช้ก่อน ไม่งั้น geo:) + target/rel ตามชนิด
//  - lat คลิปที่ ±85.0511 (ขอบ Web Mercator) · lng วนข้ามเส้นแบ่งวัน (antimeridian) · แถว y นอกโลก = ไม่มี tile

export const MAP_ZOOM = 15;
export const MAP_RADIUS = 1;
export const OSM_TILE_ORIGIN = "https://tile.openstreetmap.org";
export const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";
export const MAX_MERCATOR_LAT = 85.0511287798066;

export interface TileCell {
  key: string;
  row: number;
  col: number;
  /** null = นอกขอบโลก (ไม่มี tile) */
  url: string | null;
  x: number;
  y: number;
}

export interface TileGrid {
  zoom: number;
  size: number;
  cells: TileCell[];
  /** ตำแหน่งหมุดในกริด 0..1 (ซ้าย/บน) */
  marker: { x: number; y: number };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** พิกัด tile แบบเศษส่วน (Web Mercator · slippy map) · lng ถูกวนให้อยู่ใน [0, 2^z) */
export function worldPoint(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const la = (clamp(lat, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT) * Math.PI) / 180;
  const rawX = ((lng + 180) / 360) * n;
  const x = ((rawX % n) + n) % n;
  const y = ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n;
  return { x, y: clamp(y, 0, n - 1e-9) };
}

export function tileUrl(z: number, x: number, y: number): string {
  return `${OSM_TILE_ORIGIN}/${z}/${x}/${y}.png`;
}

/** กริด (2r+1)² ของ tile รอบพิกัด · x วนข้ามเส้นแบ่งวัน · y นอกช่วง = ไม่มี tile */
export function tileGrid(lat: number, lng: number, zoom: number = MAP_ZOOM, radius: number = MAP_RADIUS): TileGrid {
  const n = 2 ** zoom;
  const p = worldPoint(lat, lng, zoom);
  const cx = Math.floor(p.x);
  const cy = Math.floor(p.y);
  const size = radius * 2 + 1;
  const cells: TileCell[] = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const rawX = cx - radius + col;
      const rawY = cy - radius + row;
      const x = ((rawX % n) + n) % n;
      const inWorld = rawY >= 0 && rawY < n;
      cells.push({ key: `${zoom}/${x}/${rawY}/${row}${col}`, row, col, x, y: rawY, url: inWorld ? tileUrl(zoom, x, rawY) : null });
    }
  }
  return { zoom, size, cells, marker: { x: (p.x - (cx - radius)) / size, y: (p.y - (cy - radius)) / size } };
}

export interface MapTarget {
  placeName: string | null;
  lat: number | null;
  lng: number | null;
  mapUrl: string | null;
}

export interface MapLink {
  href: string;
  kind: "https" | "geo";
  /** เปิดแท็บใหม่เฉพาะ https · geo: ให้ระบบเลือกแอป */
  target: "_blank" | undefined;
  rel: "noopener noreferrer" | undefined;
  host: string | null;
}

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

/** ตัดอักขระที่ทำให้ geo:...(label) พัง · จำกัดความยาว */
const geoLabel = (name: string): string => encodeURIComponent(name.replace(/[()\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80));

/**
 * ลิงก์เปิดแอปแผนที่: มีลิงก์ https ที่ผู้ใช้ให้ → ใช้ลิงก์นั้น (ใช้ได้ทุกอุปกรณ์) · มีแต่พิกัด → geo: · ไม่มีอะไร → null
 * mapUrl ถูกตรวจ scheme ซ้ำที่นี่ (เซิร์ฟเวอร์ตรวจแล้ว แต่ไม่ไว้ใจข้อมูลที่ผ่านมา): ไม่ใช่ https → ข้าม
 */
export function mapOpenLink(t: MapTarget): MapLink | null {
  if (t.mapUrl !== null && /^https:\/\//i.test(t.mapUrl)) {
    return { href: t.mapUrl, kind: "https", target: "_blank", rel: "noopener noreferrer", host: hostOf(t.mapUrl) };
  }
  if (t.lat !== null && t.lng !== null && Number.isFinite(t.lat) && Number.isFinite(t.lng) && Math.abs(t.lat) <= 90 && Math.abs(t.lng) <= 180) {
    const label = t.placeName ? `(${geoLabel(t.placeName)})` : "";
    return { href: `geo:${t.lat},${t.lng}?q=${t.lat},${t.lng}${label}`, kind: "geo", target: undefined, rel: undefined, host: null };
  }
  return null;
}

export const hasCoords = (t: Pick<MapTarget, "lat" | "lng">): t is { lat: number; lng: number } => t.lat !== null && t.lng !== null;
