// helper อ่านข้อมูลจาก Request (ไม่พึ่ง next/headers → เทสต์เรียก handler ตรงได้) — cookie · IP · UA · ประเทศ
import { isIP } from 'node:net';
import { trustsProxyHeaders, type EnvSource } from '@/lib/shared/env';

/** อ่านค่า cookie ตามชื่อ (ตัวแรกที่เจอชนะ) · ไม่มี = null */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * IP ของ client สำหรับ rate limit — เชื่อ header จาก proxy **เฉพาะ** เมื่อ trustsProxyHeaders() (env VERCEL ถูกตั้ง หรือ TRUST_PROXY_HEADERS=1):
 * บน Vercel แพลตฟอร์มเขียนทับ x-vercel-forwarded-for / x-real-ip / x-forwarded-for เอง ปลอมไม่ได้
 * ลำดับ: x-vercel-forwarded-for → x-real-ip → x-forwarded-for (ตัวแรก)
 * ไม่เชื่อ (เช่น dev/self-host ตรง ๆ) → null → callerId = 'unknown' ถังร่วมที่เพดานสูง (UNKNOWN_CALLER_LIMIT_FACTOR) — ผู้เรียกปลอม header เปลี่ยนถังไม่ได้
 * ใช้เป็นคีย์ rate limit เท่านั้น ไม่ใช่การยืนยันตัวตน
 */
export function clientIp(req: Request, env: EnvSource = process.env): string | null {
  if (!trustsProxyHeaders(env)) return null;
  const h = req.headers;
  const vercel = h.get('x-vercel-forwarded-for')?.split(',')[0]?.trim();
  if (vercel) return vercel;
  const real = h.get('x-real-ip')?.trim();
  if (real) return real;
  const xff = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  return xff || null;
}

function parseHextet(g: string): number | null {
  return /^[0-9a-fA-F]{1,4}$/.test(g) ? parseInt(g, 16) : null;
}

/** กระจาย IPv6 เป็น 8 กลุ่ม (รองรับ `::` และท้ายแบบ IPv4) · ไม่ถูกรูป = null */
function expandIPv6(input: string): number[] | null {
  let s = input;
  const tail4 = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (tail4) {
    const o = tail4[2]!.split('.').map(Number);
    if (o.some((n) => n > 255)) return null;
    s = `${tail4[1]}${((o[0]! << 8) | o[1]!).toString(16)}:${((o[2]! << 8) | o[3]!).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];
  let groups: string[];
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    groups = head;
  } else {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null;
    groups = [...head, ...Array<string>(fill).fill('0'), ...tail];
  }
  const nums = groups.map(parseHextet);
  return nums.every((n): n is number => n !== null) ? nums : null;
}

/**
 * ตัวระบุ "ผู้เรียก" สำหรับ rate limit: IPv4 ตามตัวมันเอง · IPv6 ใช้ prefix /64 (ADR 0002 §3) ·
 * IPv4-mapped (::ffff:a.b.c.d) นับเป็น IPv4 · ไม่มี/ผิดรูป → 'unknown' (ใช้ถังร่วมกัน)
 */
export function callerId(ip: string | null): string {
  if (!ip) return 'unknown';
  let s = ip.trim();
  if (s.startsWith('[') && s.includes(']')) s = s.slice(1, s.indexOf(']'));
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  const kind = isIP(s);
  if (kind === 4) return s;
  if (kind !== 6) return 'unknown';
  const g = expandIPv6(s);
  if (!g) return 'unknown';
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) {
    return `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
  }
  return `v6/${g.slice(0, 4).map((n) => n.toString(16).padStart(4, '0')).join(':')}`;
}

/** ย่อ User-Agent เป็น "อุปกรณ์ · เบราว์เซอร์" สำหรับหน้า admin (ADR 0002 §6) — ไม่เก็บ UA ดิบ */
export function summarizeUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const device = /iPhone/i.test(ua)
    ? 'iPhone'
    : /iPad/i.test(ua)
      ? 'iPad'
      : /Android/i.test(ua)
        ? 'Android'
        : /Windows/i.test(ua)
          ? 'Windows'
          : /Macintosh|Mac OS X/i.test(ua)
            ? 'Mac'
            : /CrOS/i.test(ua)
              ? 'ChromeOS'
              : /Linux/i.test(ua)
                ? 'Linux'
                : 'Unknown';
  const browser = /EdgiOS|EdgA|Edg\//i.test(ua)
    ? 'Edge'
    : /SamsungBrowser/i.test(ua)
      ? 'Samsung Internet'
      : /OPR\/|Opera/i.test(ua)
        ? 'Opera'
        : /FxiOS|Firefox/i.test(ua)
          ? 'Firefox'
          : /CriOS|Chrome\//i.test(ua)
            ? 'Chrome'
            : /Safari\//i.test(ua)
              ? 'Safari'
              : 'Unknown';
  return `${device} · ${browser}`;
}

/** ประเทศจาก IP (Vercel ใส่ให้) — รหัส 2 ตัวอักษรเท่านั้น */
export function countryOf(req: Request): string | null {
  const c = req.headers.get('x-vercel-ip-country')?.trim().toUpperCase();
  return c && /^[A-Z]{2}$/.test(c) ? c : null;
}
