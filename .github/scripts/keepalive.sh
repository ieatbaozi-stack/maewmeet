#!/usr/bin/env bash
# keep-alive ชั้นที่ 2 + สัญญาณเตือน (ADR 0001 §3.1 · ARCHITECTURE §8 · R0-15) — เรียกจาก .github/workflows/keepalive.yml
#
# 1) POST $APP_ORIGIN/api/cron/heartbeat (Authorization: Bearer $CRON_SECRET) → เขียน system_heartbeat('github-actions')
# 2) GET  $APP_ORIGIN/api/health
# ล้ม (exit 1) เมื่อ: status ≠ 2xx ข้อใดข้อหนึ่ง · health ไม่ใช่ JSON ที่อ่านได้ ·
#                   heartbeatAgeHours.vercelCron ไม่มีค่า (cron ยังไม่เคยรัน) หรือเกิน MAX_VERCEL_CRON_AGE_HOURS (ดีฟอลต์ 48)
# ข้าม (exit 0 + ::warning::) เมื่อยังไม่ได้ตั้ง secret APP_ORIGIN / CRON_SECRET (ก่อน boss deploy ครั้งแรก)
#
# ต้องมี: bash, curl, jq (มีใน ubuntu runner ของ GitHub)
# ไม่ตาม redirect (เหมือน Vercel cron) — APP_ORIGIN ต้องเป็น origin จริงของแอป
# ห้ามพิมพ์ค่า CRON_SECRET — ส่ง header ผ่าน stdin (`-H @-`) จึงไม่โผล่ใน argv/ps ด้วย
set -euo pipefail

MAX_AGE="${MAX_VERCEL_CRON_AGE_HOURS:-48}"
# KEEPALIVE_RETRY_DELAY: วินาทีระหว่าง retry (ดีฟอลต์ 5) — เทสต์ tests/ops/keepalive.test.ts ตั้ง 1 ให้เร็ว (0 = curl ใช้ backoff ดีฟอลต์ ไม่ใช่ไม่รอ)
RETRY_DELAY="${KEEPALIVE_RETRY_DELAY:-5}"
[[ "$RETRY_DELAY" =~ ^[1-9][0-9]*$ ]] || RETRY_DELAY=5
CURL_OPTS=(--silent --show-error --max-time 30 --retry 2 --retry-delay "$RETRY_DELAY" --retry-connrefused)

summary() {
  # เขียนลงหน้าสรุปของ run ถ้าอยู่ใน GitHub Actions
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then printf '%s\n' "$*" >>"$GITHUB_STEP_SUMMARY"; fi
}
fail() {
  echo "::error title=keepalive ล้ม::$*"
  summary "❌ $*"
  exit 1
}

if [[ -z "${APP_ORIGIN:-}" || -z "${CRON_SECRET:-}" ]]; then
  missing=()
  [[ -z "${APP_ORIGIN:-}" ]] && missing+=("APP_ORIGIN")
  [[ -z "${CRON_SECRET:-}" ]] && missing+=("CRON_SECRET")
  msg="ข้าม keepalive: ยังไม่ได้ตั้ง GitHub Secret ${missing[*]} — Turso ยังไม่มีชั้นสำรองกันหลับ และจะไม่มีอีเมลเตือน ตั้งตาม docs/OPERATIONS.md ส่วน E"
  echo "::warning title=keepalive ยังไม่ได้ตั้งค่า::${msg}"
  summary "⚠️ ${msg}"
  exit 0
fi

origin="${APP_ORIGIN%/}"
if [[ ! "$origin" =~ ^https?://[^/[:space:]]+$ ]]; then
  fail "APP_ORIGIN ต้องเป็น origin ล้วน เช่น https://maewmeet.vercel.app (ไม่มี path)"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# ── 1) heartbeat ─────────────────────────────────────────
hb_status="$(printf 'Authorization: Bearer %s\n' "$CRON_SECRET" |
  curl "${CURL_OPTS[@]}" -X POST -H @- -o "$tmp/hb.json" -w '%{http_code}' "$origin/api/cron/heartbeat" || true)"
echo "POST /api/cron/heartbeat → HTTP ${hb_status:-000}"
if [[ ! "$hb_status" =~ ^2[0-9][0-9]$ ]]; then
  fail "POST /api/cron/heartbeat ตอบ HTTP ${hb_status:-000} (401 = CRON_SECRET ใน GitHub ไม่ตรงกับ Vercel · 5xx/000 = แอปหรือ DB มีปัญหา — ดู OPERATIONS.md ส่วน G)"
fi

# ── 2) health ────────────────────────────────────────────
h_status="$(curl "${CURL_OPTS[@]}" -o "$tmp/health.json" -w '%{http_code}' "$origin/api/health" || true)"
echo "GET /api/health → HTTP ${h_status:-000}"
if [[ ! "$h_status" =~ ^2[0-9][0-9]$ ]]; then
  fail "GET /api/health ตอบ HTTP ${h_status:-000} (503 = DB ต่อไม่ได้/env ต้องมีหาย/pepper ไม่ผ่าน — ดู OPERATIONS.md ส่วน G)"
fi

# รองรับทั้ง {heartbeatAgeHours:…} และแบบห่อ {data:{heartbeatAgeHours:…}} (ADR 0008 §5)
if ! age="$(jq -er '(.data // .) | .heartbeatAgeHours.vercelCron | if type == "number" then . else error("not a number") end' "$tmp/health.json" 2>/dev/null)"; then
  if jq -e '(.data // .) | .heartbeatAgeHours | has("vercelCron")' "$tmp/health.json" >/dev/null 2>&1; then
    fail "Vercel cron ยังไม่เคยเขียน heartbeat (vercelCron = null) — ถ้าเพิ่ง deploy ให้สั่ง cron รอบแรกด้วยมือตาม OPERATIONS.md ส่วน F"
  fi
  fail "อ่าน heartbeatAgeHours.vercelCron จาก /api/health ไม่ได้ (response ไม่ใช่ JSON ตามสัญญา R0_CONTRACT §3)"
fi
gh_age="$(jq -r '(.data // .) | .heartbeatAgeHours.githubActions // "null"' "$tmp/health.json" 2>/dev/null || echo null)"
echo "heartbeatAgeHours: vercelCron=${age} githubActions=${gh_age} (เกณฑ์ ≤ ${MAX_AGE})"

if ! awk -v a="$age" -v m="$MAX_AGE" 'BEGIN { exit !(a >= -1 && a <= m) }'; then
  fail "heartbeat ของ Vercel cron เก่า ${age} ชม. (เกิน ${MAX_AGE}) — cron รายวันไม่ทำงาน ตรวจหน้า Cron Jobs ใน Vercel (OPERATIONS.md ส่วน G)"
fi

summary "✅ keepalive ผ่าน — heartbeat ส่งแล้ว · health HTTP ${h_status} · vercelCron ${age} ชม."
echo "OK"
