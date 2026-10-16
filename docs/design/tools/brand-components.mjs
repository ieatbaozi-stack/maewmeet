#!/usr/bin/env node
// แปลง public/brand/{cats/*.svg, logo-*.svg} → src/components/brand/brand-svg.generated.ts
// ให้ <Cat>/<Logo> ฝัง SVG inline ได้โดยไม่ fetch ตอน runtime และไม่ใช้ dangerouslySetInnerHTML
// - ตัด fallback hex ใน var(--cat-*, #xxx) ออก (inline รับ token จาก tokens.css เสมอ) → src/components/brand ไม่มี hex
// - ชื่อ attribute แบบ kebab → camelCase ของ React
// ใช้: node docs/design/tools/brand-components.mjs   (รันใหม่ทุกครั้งหลัง cats.mjs / logo.py)
//      node docs/design/tools/brand-components.mjs --check   (exit 1 ถ้าไฟล์ที่ commit ไม่ตรงกับ SVG ปัจจุบัน)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const brand = resolve(root, 'public/brand');
const outFile = resolve(root, 'src/components/brand/brand-svg.generated.ts');

const ALLOWED_TAGS = new Set(['g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon']);
const DROP_ATTRS = new Set(['xmlns', 'role', 'aria-label']);
const camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const cleanValue = (v) => v.replace(/var\((--[a-z0-9-]+),\s*#[0-9A-Fa-f]{3,8}\)/g, 'var($1)');

function attrs(src) {
  const out = {};
  for (const m of src.matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)) {
    if (DROP_ATTRS.has(m[1])) continue;
    out[camel(m[1])] = cleanValue(m[2]);
  }
  return out;
}

// parser เล็กสำหรับ SVG ที่เราสร้างเอง (ไม่มี text node นอก <title>, ไม่มี CDATA)
function parse(svg) {
  const body = svg.replace(/<title>[\s\S]*?<\/title>/g, '').replace(/<\?xml[^>]*>/, '');
  const rootM = body.match(/<svg\b([^>]*)>([\s\S]*)<\/svg>/);
  if (!rootM) throw new Error('ไม่ใช่ SVG');
  const rootAttrs = attrs(rootM[1]);
  const stack = [{ children: [] }];
  for (const m of rootM[2].matchAll(/<(\/?)([a-zA-Z]+)\b([^>]*?)(\/?)>/g)) {
    const [, close, tag, a, self] = m;
    if (close) { const n = stack.pop(); stack.at(-1).children.push(n.node); continue; }
    if (!ALLOWED_TAGS.has(tag)) throw new Error(`แท็กที่ไม่รองรับ: <${tag}>`);
    const node = [tag, attrs(a)];
    if (self) stack.at(-1).children.push(node);
    else { node.push([]); stack.push({ node, children: node[2] }); }
  }
  if (stack.length !== 1) throw new Error('แท็กเปิด/ปิดไม่ครบ');
  const { viewBox, ...rest } = rootAttrs;
  return { viewBox, rootAttrs: rest, nodes: stack[0].children };
}

const manifest = JSON.parse(readFileSync(resolve(brand, 'cats/manifest.json'), 'utf8'));
const cats = {};
for (const c of manifest) cats[c.key] = parse(readFileSync(resolve(brand, 'cats', c.file), 'utf8'));
const logos = {};
for (const k of ['mark', 'th', 'en']) logos[k] = parse(readFileSync(resolve(brand, `logo-${k}.svg`), 'utf8'));

const json = (v) => JSON.stringify(v);
const src = `// ไฟล์สร้างอัตโนมัติจาก public/brand/**/*.svg ด้วย docs/design/tools/brand-components.mjs — ห้ามแก้ด้วยมือ
// เจ้าของ: UX & Brand

export type SvgNode = readonly [tag: string, attrs: Readonly<Record<string, string>>, children?: readonly SvgNode[]];
export interface SvgArt {
  readonly viewBox: string;
  readonly rootAttrs: Readonly<Record<string, string>>;
  readonly nodes: readonly SvgNode[];
}

/** ท่าแมวทั้งหมด (ลำดับเดียวกับ public/brand/cats/manifest.json) */
export const CAT_POSES = ${json(manifest.map((c) => c.key))} as const;
export type CatPose = (typeof CAT_POSES)[number];

export const CAT_ART: Readonly<Record<CatPose, SvgArt>> = {
${Object.entries(cats).map(([k, v]) => `  ${k}: ${json(v)},`).join('\n')}
};

export type LogoVariant = 'mark' | 'th' | 'en';
export const LOGO_ART: Readonly<Record<LogoVariant, SvgArt>> = {
${Object.entries(logos).map(([k, v]) => `  ${k}: ${json(v)},`).join('\n')}
};
`;

if (process.argv.includes('--check')) {
  const cur = existsSync(outFile) ? readFileSync(outFile, 'utf8') : '';
  if (cur !== src) { console.error('brand-svg.generated.ts ไม่ตรงกับ SVG ใน public/brand — รัน node docs/design/tools/brand-components.mjs'); process.exit(1); }
  console.log('brand-svg.generated.ts ตรงกับ public/brand');
} else {
  writeFileSync(outFile, src);
  console.log(`เขียน ${outFile} · แมว ${Object.keys(cats).length} ท่า · โลโก้ ${Object.keys(logos).length} แบบ`);
}
if (/#[0-9A-Fa-f]{3,8}\b/.test(src)) { console.error('ยังมี hex หลงในไฟล์ที่สร้าง'); process.exit(1); }
