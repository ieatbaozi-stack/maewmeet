#!/usr/bin/env bash
# ตัดสินว่า PR แตะโค้ด/คอนฟิก หรือแตะเอกสารล้วน · เขียน code=true|false ลง $GITHUB_OUTPUT
# ใช้: BASE_SHA=<sha> HEAD_SHA=<sha> bash changed-code.sh
# เอกสารล้วน = ทุกไฟล์ที่เปลี่ยนอยู่ใต้ docs/ หรือเป็น *.md ที่ root/ที่ใดก็ได้ · อย่างอื่น (รวมไฟล์ลบ/เปลี่ยนชื่อ) = โค้ด
# ไม่รู้ base (push / รันมือ) หรือ diff ล้ม = code=true เสมอ (ไม่ลดความเข้มงวด)
set -euo pipefail

out="${GITHUB_OUTPUT:-/dev/stdout}"
base="${BASE_SHA:-}"
head="${HEAD_SHA:-HEAD}"

if [ -z "$base" ] || ! files="$(git diff --name-only --no-renames "$base" "$head" 2>/dev/null)" || [ -z "$files" ]; then
  echo "code=true" >> "$out"
  echo "changed-code: ไม่มี base/diff ว่าง/diff ล้ม -> รันครบ"
  exit 0
fi

if printf '%s\n' "$files" | grep -Evq '^(docs/|.*\.md$)'; then
  echo "code=true" >> "$out"
  echo "changed-code: พบไฟล์นอกเอกสาร -> รันครบ"
else
  echo "code=false" >> "$out"
  echo "changed-code: เอกสารล้วน -> ข้าม build + e2e"
fi
