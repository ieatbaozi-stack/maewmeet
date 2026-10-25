// service: ค้นหาสถานที่ (proxy Nominatim ฝั่งเซิร์ฟเวอร์) — D11 · ADR 0001 · R4B-6 · action `place.search`
//  ลำดับ: authorize → kill switch (PLACE_SEARCH_ENABLED) → ตรวจ q → rate limit ต่อผู้ใช้ → แคช 30 วัน → ช่องห่าง 1 req/s ทั้งระบบ (DB) → fetch (timeout + เพดานขนาด)
//  - ผลลัพธ์ sanitize และสร้างลิงก์ OSM เองจาก osm_type/osm_id (ไม่เชื่อ URL ที่ต้นทางส่งมา) · ≤ 5 รายการ · ผลที่ล้มเหลวไม่ถูกแคช
//  - User-Agent / อีเมลติดต่อมาจาก env NOMINATIM_CONTACT (ห้าม hard-code) — ใช้ nominatim สาธารณะโดยไม่มีผู้ติดต่อ = ปิดบริการ (นโยบาย Nominatim บังคับให้ระบุตัวตน)
//  - ไม่ autocomplete: ผู้ใช้กด "ค้นหา" เอง · ไม่ log ข้อความค้นหา
import { z } from 'zod';
import { findUserById } from '@/lib/data/repos/user';
import { findFreshPlaceCache, putPlaceCache, reserveCallSlot, type PlaceResult } from '@/lib/data/repos/place-search';
import { refundBucket, reserveBucket } from '@/lib/data/repos/rate-limit-bucket';
import { rateKey, type RateSpec } from '@/lib/auth/throttle';
import { authorize } from '@/lib/rbac/can';
import type { Actor } from '@/lib/rbac/types';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/lib/shared/clock';
import { getEnv } from '@/lib/shared/env';
import { AppError } from '@/lib/shared/errors';
import { hasForbiddenChars, sanitizeDisplayText } from '@/lib/shared/name-rules';
import type { DataCtx } from '../context';
import { getPlaceFetch } from '../place-fetch';
import { serialized } from '../tx';
import { asUser } from './group-common';

export const PLACE_SEARCH_LIMITS = {
  queryMin: 2,
  queryMax: 100,
  maxResults: 5,
  nameMax: 160,
  cacheTtlMs: 30 * DAY_MS,
  /** ช่องห่างขั้นต่ำระหว่างการเรียก Nominatim ทั้งระบบ (นโยบาย: ≤ 1 req/s) */
  globalGapMs: 1000,
  fetchTimeoutMs: 4000,
  maxResponseBytes: 256 * 1024,
} as const;

export const PLACE_RATE_LIMITS = {
  perMinute: { prefix: 'place:u:m', limit: 10, windowMs: MINUTE_MS },
  perHour: { prefix: 'place:u:h', limit: 60, windowMs: HOUR_MS },
} as const satisfies Record<string, RateSpec>;

/** คีย์แถวช่องห่างกลางใน rate_limit_bucket */
export const PLACE_GLOBAL_SLOT_KEY = 'place:nominatim:last';

/** รูปร่างเท่านั้น — ความหมายของ q ตรวจใน service หลังด่านสิทธิ์ (anonymous ได้ 401 ก่อน 400) */
export const placeSearchQuerySchema = z.object({ q: z.string().max(1000).optional() }).strict();
export type PlaceSearchQuery = z.output<typeof placeSearchQuerySchema>;

/** lowercase + trim + ยุบช่องว่าง (NFKC) — คีย์แคช */
export function normalizePlaceQuery(raw: string): string {
  return raw.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

const limited = (retryAfterSec: number): AppError => new AppError('RATE_LIMITED', undefined, { retryAfterSec: Math.max(1, Math.ceil(retryAfterSec)) });
const unavailable = (reason: 'disabled' | 'not_configured' | 'upstream'): AppError => new AppError('FEATURE_DISABLED', { feature: 'placeSearch', reason });

const round7 = (n: number): number => Math.round(n * 1e7) / 1e7;
const coordNum = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d{1,3}(?:\.\d{1,15})?$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * ผลจากต้นทาง (ไม่น่าเชื่อถือ) → รายการที่ปลอดภัย ≤ 5: ชื่อผ่าน sanitize + ตัด · พิกัดต้องอยู่ในช่วง · osmUrl สร้างเอง (https เท่านั้น)
 * ไม่ใช่อาร์เรย์/รายการเสีย → ข้าม (ไม่โยน)
 */
export function sanitizePlaceResults(raw: unknown): PlaceResult[] {
  if (!Array.isArray(raw)) return [];
  const out: PlaceResult[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= PLACE_SEARCH_LIMITS.maxResults) break;
    if (item === null || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const lat = coordNum(o.lat);
    const lng = coordNum(o.lon ?? o.lng);
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const label = typeof o.display_name === 'string' && o.display_name.trim() !== '' ? o.display_name : typeof o.name === 'string' ? o.name : '';
    const name = [...sanitizeDisplayText(label)].slice(0, PLACE_SEARCH_LIMITS.nameMax).join('').trim();
    if (name === '') continue;
    const osmId = typeof o.osm_id === 'number' ? o.osm_id : typeof o.osm_id === 'string' && /^\d{1,15}$/.test(o.osm_id) ? Number(o.osm_id) : NaN;
    const osmType = o.osm_type === 'node' || o.osm_type === 'way' || o.osm_type === 'relation' ? o.osm_type : null;
    const la = round7(lat);
    const ln = round7(lng);
    const osmUrl =
      osmType !== null && Number.isSafeInteger(osmId) && osmId > 0
        ? `https://www.openstreetmap.org/${osmType}/${osmId}`
        : `https://www.openstreetmap.org/?mlat=${la}&mlon=${ln}#map=17/${la}/${ln}`;
    const key = `${la},${ln},${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, lat: la, lng: ln, osmUrl });
  }
  return out;
}

/** แถวแคช (เขียนโดยเราเอง แต่ตรวจซ้ำตอนอ่าน — แถวเสีย/ถูกแก้ใน DB ไม่ไหลออก) */
export function parseCachedPlaces(raw: unknown): PlaceResult[] {
  if (!Array.isArray(raw)) return [];
  const out: PlaceResult[] = [];
  for (const item of raw.slice(0, PLACE_SEARCH_LIMITS.maxResults)) {
    if (item === null || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.name !== 'string' || typeof o.lat !== 'number' || typeof o.lng !== 'number' || typeof o.osmUrl !== 'string') continue;
    if (!Number.isFinite(o.lat) || !Number.isFinite(o.lng) || Math.abs(o.lat) > 90 || Math.abs(o.lng) > 180) continue;
    if (!o.osmUrl.startsWith('https://www.openstreetmap.org/')) continue;
    const name = sanitizeDisplayText(o.name);
    if (name !== '') out.push({ name, lat: o.lat, lng: o.lng, osmUrl: o.osmUrl });
  }
  return out;
}

/** อ่าน body แบบ stream ไม่เกิน maxBytes · เกิน/อ่านไม่ได้ → null */
async function readCapped(res: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** อีเมลสำหรับพารามิเตอร์ `email=` (ถ้า NOMINATIM_CONTACT เป็นอีเมล) — ไม่ใช่อีเมล = ใส่เฉพาะใน User-Agent */
const contactEmail = (contact: string): string | null => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) ? contact : null);

async function fetchFromNominatim(query: string, locale: 'th' | 'en', baseUrl: string, contact: string): Promise<PlaceResult[]> {
  const url = new URL('/search', baseUrl);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', String(PLACE_SEARCH_LIMITS.maxResults));
  url.searchParams.set('accept-language', locale);
  const email = contactEmail(contact);
  if (email) url.searchParams.set('email', email);
  let res: Response;
  try {
    res = await getPlaceFetch()(url.toString(), {
      method: 'GET',
      headers: { 'user-agent': `maewmeet (${contact})`, accept: 'application/json', 'accept-language': locale },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(PLACE_SEARCH_LIMITS.fetchTimeoutMs),
    });
  } catch {
    throw unavailable('upstream');
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw unavailable('upstream');
  }
  let text: string | null;
  try {
    text = await readCapped(res, PLACE_SEARCH_LIMITS.maxResponseBytes);
  } catch {
    throw unavailable('upstream');
  }
  if (text === null) throw unavailable('upstream');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw unavailable('upstream');
  }
  return sanitizePlaceResults(parsed);
}

export type PlaceSearchResponse = { results: PlaceResult[] };

export async function searchPlaces(actor: Actor, input: PlaceSearchQuery, ctx: DataCtx): Promise<PlaceSearchResponse> {
  authorize(actor, 'place.search', { type: 'none' });
  const me = asUser(actor);
  const { db, now } = ctx;
  const env = getEnv();
  if (!env.PLACE_SEARCH_ENABLED) throw unavailable('disabled');
  const contact = env.NOMINATIM_CONTACT?.trim() ?? '';
  const baseUrl = env.NOMINATIM_BASE_URL.replace(/\/+$/, '');
  if (contact === '' && new URL(baseUrl).hostname.endsWith('openstreetmap.org')) throw unavailable('not_configured');

  if (input.q === undefined) throw new AppError('VALIDATION', { fields: { q: 'REQUIRED' } });
  const q = normalizePlaceQuery(input.q);
  const len = [...q].length;
  if (hasForbiddenChars(q)) throw new AppError('VALIDATION', { fields: { q: 'INVALID' } });
  if (len < PLACE_SEARCH_LIMITS.queryMin) throw new AppError('VALIDATION', { fields: { q: 'TOO_SHORT' } });
  if (len > PLACE_SEARCH_LIMITS.queryMax) throw new AppError('VALIDATION', { fields: { q: 'TOO_LONG' } });

  // 1) rate limit ต่อผู้ใช้ (นับทุกครั้งรวมที่ตอบจากแคช — กันกวาดแคช/ยิงรัว) : นาที แล้วชั่วโมง
  const minute = PLACE_RATE_LIMITS.perMinute;
  const hour = PLACE_RATE_LIMITS.perHour;
  const mSlot = await serialized(db, () => reserveBucket(db, rateKey(minute, me.id), minute.windowMs, minute.limit, now));
  if (!mSlot.admitted) throw limited((mSlot.windowEnd - now) / 1000);
  const hSlot = await serialized(db, () => reserveBucket(db, rateKey(hour, me.id), hour.windowMs, hour.limit, now));
  if (!hSlot.admitted) {
    await serialized(db, () => refundBucket(db, rateKey(minute, me.id), minute.windowMs, now));
    throw limited((hSlot.windowEnd - now) / 1000);
  }

  // 2) แคช (คีย์รวมภาษาของผู้ใช้ — ผลแปลตาม accept-language)
  const locale = (await findUserById(db, me.id))?.locale ?? 'th';
  const key = `${locale}:${q}`;
  const hit = await findFreshPlaceCache(db, key, now, PLACE_SEARCH_LIMITS.cacheTtlMs);
  if (hit !== null) return { results: parseCachedPlaces(hit) };

  // 3) ช่องห่างทั้งระบบ ≥ 1 วินาที ต่อการเรียก Nominatim
  const slot = await serialized(db, () => reserveCallSlot(db, PLACE_GLOBAL_SLOT_KEY, PLACE_SEARCH_LIMITS.globalGapMs, now));
  if (!slot.admitted) throw limited(slot.retryAfterMs / 1000);

  const results = await fetchFromNominatim(q, locale, baseUrl, contact);
  await serialized(db, () => putPlaceCache(db, key, results, now));
  return { results };
}
