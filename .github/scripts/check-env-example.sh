#!/usr/bin/env bash
# R0-5: .env.example ต้องไม่มีค่าลับจริง — ตัวแปรที่มีค่าได้ต้องอยู่ในรายการค่าสาธารณะด้านล่างเท่านั้น
# ตัวอื่นทุกตัวต้องว่าง (KEY= ตามด้วยช่องว่าง/คอมเมนต์ได้)
# ใช้: bash .github/scripts/check-env-example.sh [path]   (ดีฟอลต์ .env.example)
set -euo pipefail

file="${1:-.env.example}"
[[ -f "$file" ]] || { echo "::error::ไม่พบ $file"; exit 1; }

# ค่าที่ไม่ใช่ความลับ (ARCHITECTURE §7) — เพิ่มตัวใหม่ต้องผ่าน review ของ OPS/Security
allowed='^(PIN_PEPPER_CURRENT_VERSION|LOG_LEVEL)$'

bad=0
lineno=0
while IFS= read -r line || [[ -n "$line" ]]; do
  lineno=$((lineno + 1))
  [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
  if [[ ! "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]]; then
    echo "::error file=$file,line=$lineno::บรรทัดไม่ใช่รูปแบบ KEY=value"
    bad=1
    continue
  fi
  key="${BASH_REMATCH[1]}"
  value="${BASH_REMATCH[2]}"
  value="${value%%#*}"                             # ตัดคอมเมนต์ท้ายบรรทัด
  value="${value#"${value%%[![:space:]]*}"}"       # trim ซ้าย
  value="${value%"${value##*[![:space:]]}"}"       # trim ขวา
  if [[ -n "$value" && ! "$key" =~ $allowed ]]; then
    echo "::error file=$file,line=$lineno::$key มีค่าใน .env.example — ตัวแปรนี้ต้องว่าง (ห้ามใส่ค่าลับ/ค่าจริง)"
    bad=1
  fi
done <"$file"

if [[ $bad -ne 0 ]]; then exit 1; fi
echo "$file: ไม่มีค่าลับ (ตัวแปรที่มีค่าอยู่ในรายการค่าสาธารณะทั้งหมด)"
