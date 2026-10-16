// drizzle-kit config — Platform (#5) · ARCHITECTURE §1/§3 · ADR 0001 §4
// generate: `npm run db:generate` (ห้ามเขียน SQL มือ) · check: `npm run db:check`
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
