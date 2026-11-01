// drizzle-kit config — Platform (#5) · ARCHITECTURE §1/§3 · ADR 0001 §4
// generate: `npm run db:generate` · check: `npm run db:check`
// ห้ามเขียน SQL มือ ยกเว้น drizzle-kit generate SQL ที่รันไม่ได้/ไม่ปลอดภัย (เช่น 0002: rebuild ตาราง
// ที่ INSERT…SELECT คอลัมน์ที่ยังไม่มี) — ต้องครบ: (1) snapshot/journal มาจาก drizzle-kit ไม่แก้มือ
// (2) `npm run db:check` ผ่าน + generate ซ้ำไม่มี drift (3) เหตุผลอยู่ในคอมเมนต์หัวไฟล์ SQL (4) security ตรวจ
// ห้าม generate migration ที่เขียนมือแล้ว (เช่น 0002) ใหม่ทับ
// generate/check ไม่ต่อฐานข้อมูล — url ใช้เฉพาะคำสั่งที่ต่อฐาน (เช่น drizzle-kit studio) และไม่มีค่าลับในไฟล์นี้
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'turso',
  schema: './src/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL || 'file:./local.db',
    // '' จาก .env.example (`TURSO_AUTH_TOKEN=`) ทำให้ drizzle-kit migrate ล้มกับ file: — ค่าว่าง = ไม่ส่ง token
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  },
});
