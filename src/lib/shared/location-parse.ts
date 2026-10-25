// ตัวแยกสถานที่ที่ผู้ใช้วาง (R4B · D11) — pure: ไม่เรียกเครือข่าย ไม่เรียก Google API · ใช้ทั้งฝั่ง client (ช่วยกรอกฟอร์ม) และ server (ตรวจซ้ำ)
//  - parseMapUrl(raw)        : ตรวจ "ลิงก์ที่จะเก็บ/ให้คนกด" → คืน URL ที่ normalize แล้ว หรือ null · https เท่านั้น ≤ 500 ไม่มี credentials ไม่มีตัวควบคุม
//  - parseLocationInput(raw) : รับข้อความที่วาง (lat,lng · geo: · ลิงก์ OSM / Google Maps / Apple Maps) → { lat, lng, mapUrl }
//    ดึงพิกัดจากลิงก์เฉพาะโฮสต์แผนที่ที่รู้จัก; โฮสต์อื่นที่เป็น https เก็บเป็นลิงก์ล้วน (ไม่มีพิกัด) · ลิงก์ย่อ (maps.app.goo.gl) ขยายไม่ได้เพราะไม่ออกเครือข่าย
// กติกาความปลอดภัย: ปฏิเสธ scheme อื่นทุกชนิด (javascript:, data:, vbscript:, file:, blob:, http:, protocol-relative) · ตัวควบคุม/ช่องว่างกลางสตริง/backslash · credentials ใน URL
import { APPOINTMENT_MAP_URL_MAX } from './limits';

/** อินพุตดิบที่ยอมรับได้ (ยาวกว่านี้ไม่ใช่ลิงก์แผนที่ปกติ) */
export const LOCATION_INPUT_MAX = 2000;

// ตัวควบคุม C0/C1, ช่องว่างทุกชนิดกลางสตริง, soft hyphen, zero-width, bidi, line/paragraph separator, BOM
const BAD_CHARS = /[\u0000-\u0020\u007f-\u009f\u00ad\u061c\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\ufeff\\]/u;

/**
 * ลิงก์แผนที่ที่เก็บได้: https เท่านั้น · ไม่มี credentials · ไม่มี host ว่าง · ≤ 500 ตัวอักษร (ทั้งที่รับมาและหลัง normalize)
 * คืน URL แบบ normalize (href) หรือ null ถ้าไม่ผ่าน — ไม่โยน
 */
export function parseMapUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s === '' || s.length > APPOINTMENT_MAP_URL_MAX || BAD_CHARS.test(s)) return null;
  if (!/^https:\/\//i.test(s)) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || u.hostname === '') return null;
  const href = u.href;
  return href.length > APPOINTMENT_MAP_URL_MAX ? null : href;
}

export type LocationSource = 'coords' | 'geo' | 'osm' | 'google' | 'apple' | 'link';
export type LocationProblem =
  | 'EMPTY'
  | 'TOO_LONG'
  | 'INVALID_CHARS'
  | 'UNSUPPORTED_SCHEME'
  | 'NOT_HTTPS'
  | 'CREDENTIALS'
  | 'INVALID_COORDINATES'
  | 'UNPARSEABLE';

export type ParsedLocation =
  | { ok: true; source: LocationSource; lat: number | null; lng: number | null; mapUrl: string | null }
  | { ok: false; reason: LocationProblem };

const NUM = String.raw`-?\d{1,3}(?:\.\d{1,15})?`;
const PLAIN_COORDS = new RegExp(String.raw`^(${NUM})\s*[,\s]\s*(${NUM})$`);
const GEO_URI = new RegExp(String.raw`^geo:(${NUM}),(${NUM})(?:,-?\d+(?:\.\d+)?)?(?:;[^?]*)?(?:\?.*)?$`, 'i');
const PAIR = new RegExp(String.raw`^(${NUM})\s*,\s*(${NUM})$`);
const PIN_3D4D = /!3d(-?\d{1,3}(?:\.\d{1,15})?)!4d(-?\d{1,3}(?:\.\d{1,15})?)/;
const AT_PAIR = new RegExp(String.raw`/@(${NUM}),(${NUM})(?:,|/|$)`);
const OSM_MAP_HASH = new RegExp(String.raw`^#map=\d{1,2}/(${NUM})/(${NUM})`);

const inRange = (lat: number, lng: number): boolean =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

type Coords = { lat: number; lng: number } | 'invalid' | null;

function coords(latS: string | undefined, lngS: string | undefined): Coords {
  if (latS === undefined || lngS === undefined) return null;
  const lat = Number(latS);
  const lng = Number(lngS);
  return inRange(lat, lng) ? { lat, lng } : 'invalid';
}

const pairFrom = (value: string | null): Coords => {
  if (value === null) return null;
  const m = PAIR.exec(value.trim());
  return m ? coords(m[1], m[2]) : null;
};

/** พิกัดจาก query/hash/path ของลิงก์แผนที่ที่รู้จัก — ลำดับ: ปักหมุดจริง → พารามิเตอร์ → ศูนย์กลางจอ */
function osmCoords(u: URL): Coords {
  const mlat = u.searchParams.get('mlat');
  const mlon = u.searchParams.get('mlon');
  if (mlat !== null && mlon !== null && /^-?\d{1,3}(\.\d{1,15})?$/.test(mlat) && /^-?\d{1,3}(\.\d{1,15})?$/.test(mlon)) return coords(mlat, mlon);
  const lat = u.searchParams.get('lat');
  const lon = u.searchParams.get('lon');
  if (lat !== null && lon !== null && /^-?\d{1,3}(\.\d{1,15})?$/.test(lat) && /^-?\d{1,3}(\.\d{1,15})?$/.test(lon)) return coords(lat, lon);
  const h = OSM_MAP_HASH.exec(u.hash);
  return h ? coords(h[1], h[2]) : null;
}

function googleCoords(u: URL): Coords {
  const pin = PIN_3D4D.exec(decodeSafe(u.pathname) + decodeSafe(u.search));
  if (pin) return coords(pin[1], pin[2]);
  for (const key of ['q', 'query', 'll', 'destination', 'center']) {
    const c = pairFrom(u.searchParams.get(key));
    if (c) return c;
  }
  const at = AT_PAIR.exec(decodeSafe(u.pathname));
  return at ? coords(at[1], at[2]) : null;
}

function appleCoords(u: URL): Coords {
  for (const key of ['ll', 'q', 'coordinate', 'sll']) {
    const c = pairFrom(u.searchParams.get(key));
    if (c) return c;
  }
  return null;
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const OSM_HOST = /^(?:www\.)?openstreetmap\.org$|^osm\.org$/;
const GOOGLE_HOST = /^(?:(?:www|maps)\.)?google\.(?:com|co\.[a-z]{2}|[a-z]{2,3})$/;
const APPLE_HOST = /^maps\.apple\.com$/;

/**
 * วิเคราะห์ข้อความที่ผู้ใช้วางในช่อง "สถานที่": พิกัด `13.75,100.50` · `geo:13.75,100.50` · ลิงก์ https ของ OSM / Google Maps / Apple Maps
 * (`@lat,lng` · `?q=lat,lng` · `?mlat&mlon` · `#map=z/lat/lng` · `!3dLAT!4dLNG`) · https อื่น ๆ = ลิงก์ล้วนไม่มีพิกัด
 * ไม่โยน — คืน { ok:false, reason } เมื่อไม่ผ่าน
 */
export function parseLocationInput(raw: unknown): ParsedLocation {
  if (typeof raw !== 'string') return { ok: false, reason: 'EMPTY' };
  const s = raw.trim();
  if (s === '') return { ok: false, reason: 'EMPTY' };
  if (s.length > LOCATION_INPUT_MAX) return { ok: false, reason: 'TOO_LONG' };

  const plain = PLAIN_COORDS.exec(s);
  if (plain) {
    const c = coords(plain[1], plain[2]);
    return c === null || c === 'invalid' ? { ok: false, reason: 'INVALID_COORDINATES' } : { ok: true, source: 'coords', lat: c.lat, lng: c.lng, mapUrl: null };
  }

  if (/^geo:/i.test(s)) {
    const g = GEO_URI.exec(s);
    const c = g ? coords(g[1], g[2]) : null;
    return c === null ? { ok: false, reason: 'UNPARSEABLE' } : c === 'invalid' ? { ok: false, reason: 'INVALID_COORDINATES' } : { ok: true, source: 'geo', lat: c.lat, lng: c.lng, mapUrl: null };
  }

  // ต่อจากนี้ต้องเป็น URL: scheme อื่นทุกชนิดตกที่นี่
  if (BAD_CHARS.test(s)) return { ok: false, reason: 'INVALID_CHARS' };
  const scheme = /^([a-z][a-z0-9+.\-]*):/i.exec(s);
  if (!scheme) return { ok: false, reason: /^\/\//.test(s) ? 'UNSUPPORTED_SCHEME' : 'UNPARSEABLE' };
  const proto = scheme[1]!.toLowerCase();
  if (proto === 'http') return { ok: false, reason: 'NOT_HTTPS' };
  if (proto !== 'https' || !/^https:\/\//i.test(s)) return { ok: false, reason: 'UNSUPPORTED_SCHEME' };

  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, reason: 'UNPARSEABLE' };
  }
  if (u.username !== '' || u.password !== '') return { ok: false, reason: 'CREDENTIALS' };
  const mapUrl = parseMapUrl(s);
  if (mapUrl === null) return { ok: false, reason: s.length > APPOINTMENT_MAP_URL_MAX ? 'TOO_LONG' : 'UNPARSEABLE' };

  const host = u.hostname.toLowerCase();
  let source: LocationSource = 'link';
  let c: Coords = null;
  if (OSM_HOST.test(host)) {
    source = 'osm';
    c = osmCoords(u);
  } else if (GOOGLE_HOST.test(host) && (host.startsWith('maps.') || u.pathname.startsWith('/maps'))) {
    source = 'google';
    c = googleCoords(u);
  } else if (APPLE_HOST.test(host)) {
    source = 'apple';
    c = appleCoords(u);
  }
  if (c === 'invalid') return { ok: false, reason: 'INVALID_COORDINATES' };
  return { ok: true, source, lat: c?.lat ?? null, lng: c?.lng ?? null, mapUrl };
}
