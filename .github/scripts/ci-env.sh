#!/usr/bin/env bash
# สร้าง env สำหรับ CI แบบสุ่มต่อรอบ (ไม่ใช้ secret จริงใด ๆ) — เขียนลง $GITHUB_ENV ให้ step ถัดไปใน job เดียวกัน
# DB เป็นไฟล์ libSQL ชั่วคราวใน runner (เทสต์ Vitest สร้าง DB/ความลับของตัวเองอีกชั้น — R0_CONTRACT §2)
# ค่าทั้งหมดเป็นของทิ้ง แต่ยัง mask ไว้กันนิสัยพิมพ์ความลับลง log
set -euo pipefail

: "${GITHUB_ENV:?ต้องรันใน GitHub Actions (ไม่มี GITHUB_ENV)}"
: "${RUNNER_TEMP:=/tmp}"

rand_b64() { openssl rand -base64 32; }
rand_hex() { openssl rand -hex 24; }

pepper="$(rand_b64)"
app_secret="$(rand_b64)"
cron_secret="$(rand_hex)"
for v in "$pepper" "$app_secret" "$cron_secret"; do echo "::add-mask::$v"; done

# ไม่ตั้ง TURSO_AUTH_TOKEN เลย (แม้แต่ค่าว่าง): drizzle-kit (dialect turso) ถือว่า authToken: '' คือ "ส่งมาแต่ว่าง"
# แล้ว `drizzle-kit migrate` ล้ม (exit 1) — ทดสอบแล้วกับ drizzle-kit 0.31.11 · แอปเองถือว่าค่าว่าง = ไม่ได้ตั้ง
{
  echo "TURSO_DATABASE_URL=file:${RUNNER_TEMP}/maewmeet-ci.db"
  echo "PIN_PEPPER_CURRENT_VERSION=1"
  echo "PIN_PEPPER_V1=${pepper}"
  echo "APP_SECRET=${app_secret}"
  echo "CRON_SECRET=${cron_secret}"
  echo "APP_ORIGIN=http://localhost:3000"
  echo "PLACE_SEARCH_ENABLED=false"
  echo "NOMINATIM_BASE_URL=https://nominatim.openstreetmap.org"
  echo "NOMINATIM_CONTACT=ci@example.invalid"
  echo "NEXT_PUBLIC_MAP_TILE_URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png"
  echo "NEXT_PUBLIC_MAP_ATTRIBUTION=© OpenStreetMap contributors"
  echo "LOG_LEVEL=warn"
} >>"$GITHUB_ENV"

echo "ตั้ง env ทดสอบแบบสุ่มแล้ว (DB: file:${RUNNER_TEMP}/maewmeet-ci.db)"
