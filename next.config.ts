import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// เจ้าของไฟล์: OPS (#10) · R0_CONTRACT R0-16 · ADR 0001 §1 · ADR 0008 §4
//
// next-intl plugin (ADR 0008 §1): **Front-end (#6) เป็นคนเพิ่ม** พร้อม src/i18n/request.ts ใน R0 ขั้น 3
// (Lead อนุญาตข้อยกเว้นขอบเขตไฟล์นี้ 2026-10-16) — ใส่ก่อนมีไฟล์ request config แล้ว build ล้ม
//   import createNextIntlPlugin from "next-intl/plugin";
//   const withNextIntl = createNextIntlPlugin();   // ค้นพบ src/i18n/request.ts อัตโนมัติ
//   export default withNextIntl(nextConfig);
// เทสต์ tests/ops/headers.test.ts อ่าน default export → ต้องยังเรียก .headers() ได้หลังห่อ (withNextIntl คงฟิลด์เดิม)

const isDev = process.env.NODE_ENV === "development";

// แหล่ง tile แผนที่ (D11 · ADR 0001 §1) — อนุญาตเฉพาะใน img-src
// ต้องตรงกับ NEXT_PUBLIC_MAP_TILE_URL ใน .env.example (ถ้าเปลี่ยนผู้ให้บริการ tile ต้องแก้ที่นี่ด้วย)
const MAP_TILE_ORIGIN = "https://tile.openstreetmap.org";

/**
 * Content-Security-Policy
 *
 * production:
 * - ไม่มี 'unsafe-eval' (Next/React ไม่ใช้ eval ใน production — node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md)
 * - script-src ต้องมี 'unsafe-inline': App Router ส่งข้อมูล RSC เป็น inline <script>self.__next_f.push(...)</script>
 *   ในทุกหน้า ถ้าไม่มี nonce สคริปต์เหล่านี้ถูกบล็อกและ hydrate ไม่ได้ (OPS ทดลองจริงด้วย build ของ R0 — ดูรายงานขั้น 2)
 *   ทางเลือกที่เข้มกว่าคือ nonce ต่อ request ซึ่ง Next 16 ทำได้ผ่าน proxy.ts เท่านั้น (Next อ่าน 'nonce-…' จาก
 *   header CSP ของ request แล้วแปะให้สคริปต์ของ framework เอง) — แต่ ADR 0001 §1 ตัดสินว่า "ไม่ใช้ proxy.ts ใน v1"
 *   → เสนอ Lead แล้ว (รายงาน OPS R0 ขั้น 2) ถ้าอนุมัติ ให้ย้าย CSP ไปที่ proxy.ts และลบ CSP ออกจากไฟล์นี้
 *   (ห้ามมี CSP สองที่พร้อมกัน — เบราว์เซอร์บังคับทุก policy ซ้อนกัน)
 *   แอปไม่มี inline script ของเราเอง (ธีมใช้ data-theme จากเซิร์ฟเวอร์ ไม่มีสคริปต์กันกระพริบ — ADR 0008 §4)
 * - style-src ต้องมี 'unsafe-inline': React เรนเดอร์ prop `style` เป็น attribute style="…" ใน HTML จากเซิร์ฟเวอร์
 *   (เช่น ตำแหน่ง/สีที่คำนวณของ aurora, Leaflet) ซึ่งถูกบล็อกถ้าไม่มี 'unsafe-inline' หรือ nonce
 *   ความเสี่ยงต่ำกว่า script มาก (CSS ไม่รันโค้ด) — ทบทวนพร้อมเรื่อง nonce
 * - img-src: data: สำหรับ noise ของ aurora (SVG data URL ใน tokens.css), blob: สำหรับภาพที่สร้างฝั่ง client
 * - connect-src 'self': ค้นหาสถานที่ผ่าน /api/places/search ฝั่งเซิร์ฟเวอร์เท่านั้น (ไม่ยิง Nominatim จากเบราว์เซอร์)
 *
 * development (`next dev`) ผ่อนเพิ่ม:
 * - 'unsafe-eval' ใน script-src — React ใช้ eval สร้าง stack ของ error ฝั่งเซิร์ฟเวอร์ในเบราว์เซอร์ (เอกสาร Next)
 * - ws: wss: ใน connect-src — HMR ของ dev server
 */
function contentSecurityPolicy(): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", MAP_TILE_ORIGIN],
    "font-src": ["'self'"],
    "connect-src": ["'self'", ...(isDev ? ["ws:", "wss:"] : [])],
    "manifest-src": ["'self'"],
    "worker-src": ["'self'"],
    "frame-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

// Permissions-Policy: ปิดทุกความสามารถที่แอปไม่ใช้ (แผนที่ใช้ค้นหาด้วยข้อความ ไม่ขอพิกัดจากเครื่อง)
// ถ้ารอบไหนต้องใช้ (เช่น geolocation) ให้เปลี่ยนเป็น geolocation=(self) พร้อมเหตุผลใน ADR
const PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "serial=()",
  "hid=()",
  "bluetooth=()",
  "midi=()",
  "magnetometer=()",
  "gyroscope=()",
  "accelerometer=()",
  "display-capture=()",
  "screen-wake-lock=()",
  "xr-spatial-tracking=()",
  "browsing-topics=()",
].join(", ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }, // OSM tile policy ต้องการ Referer (origin พอ)
  { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
  { key: "X-Frame-Options", value: "DENY" }, // เบราว์เซอร์เก่าที่ไม่รู้จัก frame-ancestors
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // เบราว์เซอร์ไม่สนใจ HSTS ที่มาทาง http (localhost) · ไม่ใส่ includeSubDomains/preload เพราะ *.vercel.app ไม่ใช่โดเมนของเรา
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
];

const nextConfig: NextConfig = {
  // ไม่ให้ `next dev` สร้าง/แก้ AGENTS.md เมื่อเจอ AI agent (ชื่อ option ตรวจจาก
  // node_modules/next/dist/server/config-shared.d.ts ของ next 16.4.2: top-level `agentRules?: boolean`, default true)
  agentRules: false,
  // ADR 0001 §1: cacheComponents ปิดใน v1 — ห้ามเปิด (ทุกหน้าอ่าน cookie ธีม/ภาษา/session)
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
