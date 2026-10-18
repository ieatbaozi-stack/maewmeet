#!/usr/bin/env bash
# R0_CONTRACT §2: ห้ามค่าสี hex และหน่วย px นอก src/styles/tokens* — ทุกค่าต้องมาจาก tokens (UI_DIRECTION)
# สแกน .css/.ts/.tsx/.js/.jsx/.mjs ใต้ src/ (หรือโฟลเดอร์ที่ส่งมา) · ไม่สแกน src/styles/tokens*
# ใช้: bash .github/scripts/check-style-literals.sh [dir]   (ดีฟอลต์ src) · exit 1 ถ้าพบ
set -euo pipefail

dir="${1:-src}"
[[ -d "$dir" ]] || { echo "::error::ไม่พบโฟลเดอร์ $dir"; exit 1; }

# hex: #abc #abcd #aabbcc #aabbccdd
#   CSS: ที่ไม่ได้อยู่ต่อจากตัวอักษร/& · TS/JS: ต้องอยู่ต่อจาก ' " ` ( , : (ค่าในสตริง/อาร์กิวเมนต์) — กัน private field `#add` / `this.#abc`
hexbody='#([[:xdigit:]]{3}|[[:xdigit:]]{4}|[[:xdigit:]]{6}|[[:xdigit:]]{8})([^[:alnum:]_]|$)'
hex_css="(^|[^&[:alnum:]_])${hexbody}"
hex_code="[\"'\`(,:]${hexbody}"
# px: ตัวเลข (มีทศนิยมได้) ตามด้วย px เป็นคำ
px='(^|[^[:alnum:]_.])[0-9]*\.?[0-9]+px([^[:alnum:]_]|$)'

found="$(
  {
    grep -rnE --include='*.css' -e "$hex_css" -e "$px" "$dir" || true
    grep -rnE --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' --include='*.mjs' -e "$hex_code" -e "$px" "$dir" || true
  } | grep -vE '(^|/)src/styles/tokens[^/]*:' || true
)"

if [[ -n "$found" ]]; then
  while IFS= read -r hit; do
    file="${hit%%:*}"
    rest="${hit#*:}"
    line="${rest%%:*}"
    echo "::error file=$file,line=$line::ค่าสี hex หรือ px นอก src/styles/tokens* — ใช้ CSS variable จาก tokens แทน"
  done <<<"$found"
  exit 1
fi
echo "$dir: ไม่มีค่าสี hex / px นอก tokens"
