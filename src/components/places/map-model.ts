// โมเดลแผนที่ (R13 · D11) — ล้วน ไม่แตะ DOM/เครือข่าย · ทดสอบที่ tests/ui/appointments-map.test.ts
//  - mapOpenLink: ลิงก์ "เปิดในแอปแผนที่" (https ของผู้ใช้ก่อน ไม่งั้น geo:) + target/rel ตามชนิด
//  - mapSearchLink / detectMapApps: ลิงก์ค้นหาชื่อใน Google/Apple Maps (ส่งชื่อไปเฉพาะตอนผู้ใช้กดเอง) + ชนิดเครื่องจาก user agent

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

// ───────── ปุ่มเปิดแอปแผนที่ (R13) ─────────
export type MapApp = "google" | "apple";

export const GOOGLE_MAPS_HOME = "https://www.google.com/maps";
export const APPLE_MAPS_HOME = "https://maps.apple.com/";

/** ลิงก์ค้นหาชื่อสถานที่ · ชื่อว่าง = หน้าแรกของแผนที่ · encode ด้วย encodeURIComponent เสมอ (ไทย, &, #) */
export function mapSearchLink(app: MapApp, name: string | null | undefined): string {
  const q = (name ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  if (q === "") return app === "google" ? GOOGLE_MAPS_HOME : APPLE_MAPS_HOME;
  const enc = encodeURIComponent(q);
  return app === "google" ? `https://www.google.com/maps/search/?api=1&query=${enc}` : `https://maps.apple.com/?q=${enc}`;
}

/**
 * แอปแผนที่ที่ควรแสดงตามชนิดเครื่อง (ดูจาก user agent ที่ client เท่านั้น ไม่ส่งไปเซิร์ฟเวอร์)
 * iPhone/iPad/iPod/Mac (รวม iPadOS ที่บอกตัวเป็น Macintosh) → Apple ก่อน แล้ว Google · อื่นๆ/ไม่รู้ → Google อย่างเดียว
 */
export function detectMapApps(userAgent: string | null | undefined): MapApp[] {
  const ua = userAgent ?? "";
  return /iPhone|iPad|iPod|Macintosh|Mac OS X/i.test(ua) ? ["apple", "google"] : ["google"];
}
