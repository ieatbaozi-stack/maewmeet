import type { MetadataRoute } from "next";
import th from "../../messages/th.json";
import { THEME_COLOR } from "@/styles/tokens.meta";

/**
 * web app manifest (R15a §1.3 · R15_FEEDBACK §2.1 · ARCHITECTURE §10) — static: ห้ามอ่าน cookie/locale ที่นี่ (ไม่งั้น route กลายเป็น dynamic)
 * ชื่อ/คำอธิบายเป็นภาษาไทยค่าเดียวจาก messages/th.json (ไม่ hard-code) · สี = THEME_COLOR.light (manifest รองรับค่าเดียว — ธีมมืดใช้ <meta theme-color> ตามสื่อจาก viewport)
 * ไอคอน: PNG ใต้ public/brand/app · แยก any กับ maskable เป็นสองรายการ (ห้ามรวม "any maskable")
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: th.app.name,
    short_name: th.app.name,
    description: th.app.description,
    lang: "th",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: THEME_COLOR.light,
    theme_color: THEME_COLOR.light,
    icons: [
      { src: "/brand/app/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/app/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/app/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
