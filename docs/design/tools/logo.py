#!/usr/bin/env python3
"""สร้างโลโก้ maewmeet: เครื่องหมายหัวแมว + wordmark (ตัวอักษรแปลงเป็น path จาก IBM Plex Sans Thai SemiBold)
ใช้: python3 docs/design/tools/logo.py <โฟลเดอร์ files ของ @fontsource/ibm-plex-sans-thai>
ต้องมี: fonttools, uharfbuzz, brotli (pip)  → เขียน public/brand/logo-mark.svg, logo-th.svg, logo-en.svg
"""
import sys, io, os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import uharfbuzz as hb

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
FILES = sys.argv[1]
OUT = os.path.join(ROOT, 'public/brand')

def outline(text, subset, size=40):
    tt = TTFont(os.path.join(FILES, f'ibm-plex-sans-thai-{subset}-600-normal.woff'))
    tt.flavor = None
    buf = io.BytesIO(); tt.save(buf); data = buf.getvalue()
    font = hb.Font(hb.Face(data))
    b = hb.Buffer(); b.add_str(text); b.guess_segment_properties()
    hb.shape(font, b, {})
    upem = tt['head'].unitsPerEm; s = size / upem
    gs = tt.getGlyphSet(); order = tt.getGlyphOrder()
    pen = SVGPathPen(gs); x = 0
    for info, pos in zip(b.glyph_infos, b.glyph_positions):
        name = order[info.codepoint]
        tp = TransformPen(pen, (s, 0, 0, -s, (x + pos.x_offset) * s, -pos.y_offset * s))
        gs[name].draw(tp)
        x += pos.x_advance
    return pen.getCommands(), x * s

HEAD = ('<path d="M40 50 C38 40 39 30 42 19 L54 27 C58 26 62 26 66 27 L78 19 C81 30 82 40 80 50 '
        'C78 60 70 65 60 65 C50 65 42 60 40 50 Z" fill="var(--cat-coat, #FFFFFF)"/>'
        '<path d="M44.5 25 L45.5 33 L51 28.5 Z" fill="var(--cat-fill, #F4D9A8)" stroke="none"/>'
        '<path d="M75.5 25 L74.5 33 L69 28.5 Z" fill="var(--cat-fill, #F4D9A8)" stroke="none"/>'
        '<circle cx="52" cy="46" r="2.3" fill="currentColor" stroke="none"/>'
        '<circle cx="68" cy="46" r="2.3" fill="currentColor" stroke="none"/>'
        '<path d="M58.3 51.5 L61.7 51.5 L60 53.3 Z" fill="currentColor" stroke="none"/>'
        '<path d="M60 53.5 Q58 56.5 55.8 55" fill="none"/><path d="M60 53.5 Q62 56.5 64.2 55" fill="none"/>')
STROKE = 'fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"'

def mark(tx=0, ty=0):
    # หัวแมวอยู่ในกรอบ x 37..83, y 16..67 → ตัดให้พอดีกรอบ 52×52
    return f'<g transform="translate({tx - 34} {ty - 15})" {STROKE}>{HEAD}</g>'

with open(os.path.join(OUT, 'logo-mark.svg'), 'w') as f:
    f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 54" role="img" aria-label="แมวเจอกัน"><title>แมวเจอกัน</title>{mark()}</svg>\n')

for key, text, subset, label in (('th', 'แมวเจอกัน', 'thai', 'แมวเจอกัน'), ('en', 'maewmeet', 'latin', 'maewmeet')):
    d, w = outline(text, subset, 34)
    W = 52 + 10 + w + 2
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.1f} 54" role="img" aria-label="{label}"><title>{label}</title>'
           f'{mark()}<path transform="translate(62 38)" fill="currentColor" d="{d}"/></svg>\n')
    with open(os.path.join(OUT, f'logo-{key}.svg'), 'w') as f:
        f.write(svg)
    print(f'logo-{key}.svg width {W:.1f}')
