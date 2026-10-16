// R0-9 — ไม่มีข้อความ hard-code ใน src/app/**, src/components/** (ยกเว้น src/components/brand/**)
// ข้อความผู้ใช้ทุกจุดต้องมาจาก messages/*.json ผ่าน next-intl (CLAUDE.md · ADR 0008)
//
// heuristic (อ่าน AST ด้วย TypeScript compiler — คอมเมนต์เป็น trivia จึงไม่ถูกนับ):
//  1. อักษรไทยในโค้ดนอกคอมเมนต์ (string, template, JSX text, ฯลฯ) → ผิดทุกกรณี
//  2. JSX text ที่มีคำภาษาอังกฤษ (ตัวอักษรละติน ≥ 2 ตัวติดกัน) → ผิด
//  3. attribute ที่ผู้ใช้เห็น/ได้ยิน (aria-label, aria-description, aria-placeholder, aria-roledescription,
//     aria-valuetext, title, placeholder, alt, label) เป็นข้อความดิบที่มีคำ → ผิด
//     (ทั้ง "…", {'…'}, {`…`} และนิพจน์ที่ประกอบด้วย string ดิบ เช่น {cond ? 'Open' : 'Close'})
// ไม่ครอบ: ข้อความที่ส่งผ่าน prop ชื่ออื่น (เช่น title=… ของคอมโพเนนต์เราเองถูกนับ แต่ heading=… ไม่นับ) — ผู้ตรวจอ่านเพิ่ม
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SCAN_DIRS = ['src/app', 'src/components'];
const EXCLUDE = [/^src\/components\/brand\//, /^src\/app\/api\//];
const THAI = /[฀-๿]/;
const WORD = /[A-Za-z]{2,}/;
const TEXT_ATTRS = new Set([
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'title',
  'placeholder',
  'alt',
  'label',
]);

type Finding = { line: number; rule: 'thai' | 'jsx-text' | 'attr'; text: string };

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walkFiles(full, out);
    else if (/\.(tsx?|jsx?|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

/** string ดิบทั้งหมดในนิพจน์ (ไม่ลงไปใน call เช่น t('…') — อาร์กิวเมนต์ของ t เป็นคีย์ ไม่ใช่ข้อความ) */
function rawStrings(expr: ts.Node): string[] {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return [expr.text];
  if (ts.isTemplateExpression(expr)) return [expr.head.text, ...expr.templateSpans.map((s) => s.literal.text)];
  if (ts.isCallExpression(expr) || ts.isTaggedTemplateExpression(expr)) return [];
  if (ts.isElementAccessExpression(expr)) return rawStrings(expr.expression);
  const out: string[] = [];
  expr.forEachChild((c) => {
    out.push(...rawStrings(c));
  });
  return out;
}

function findHardcodedText(code: string, fileName = 'x.tsx'): Finding[] {
  const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const findings: Finding[] = [];
  const add = (node: ts.Node, rule: Finding['rule'], text: string) =>
    findings.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, rule, text: text.trim().slice(0, 60) });

  const visit = (node: ts.Node) => {
    // JSDoc (/** … */) ถูก parser แนบเป็นโหนดลูก — เป็นคอมเมนต์ ข้าม
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    // 1) ไทยในโทเคนใดๆ (getText ไม่รวม trivia → คอมเมนต์ไม่ถูกนับ)
    const children = node.getChildren(sf);
    if (children.length === 0) {
      const text = node.getText(sf);
      if (THAI.test(text)) add(node, 'thai', text);
    }
    // 2) JSX text ภาษาอังกฤษ
    if (ts.isJsxText(node) && !node.containsOnlyTriviaWhiteSpaces && WORD.test(node.text)) add(node, 'jsx-text', node.text);
    // 3) attribute ข้อความ
    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(sf);
      if (TEXT_ATTRS.has(name)) {
        const init = node.initializer;
        const strings = ts.isStringLiteral(init) ? [init.text] : ts.isJsxExpression(init) && init.expression ? rawStrings(init.expression) : [];
        for (const s of strings) if (WORD.test(s)) add(node, 'attr', `${name}="${s}"`);
      }
    }
    for (const c of children) visit(c);
  };
  visit(sf);
  return findings;
}

const files = SCAN_DIRS.flatMap((d) => walkFiles(path.join(ROOT, d)))
  .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
  .filter((f) => !EXCLUDE.some((re) => re.test(f)))
  .sort();

describe('R0-9 heuristic จับข้อความ hard-code ได้จริง (เคสด้านลบ)', () => {
  const rules = (code: string, file?: string) => findHardcodedText(code, file).map((f) => f.rule);

  it('ไทยใน JSX text', () => expect(rules('const A = () => <p>สวัสดี</p>;')).toEqual(['thai']));
  it('ไทยใน string literal', () => expect(rules("export const x = 'ปฏิทิน';", 'x.ts')).toEqual(['thai']));
  it('ไทยใน template literal', () => expect(rules('export const x = (n: number) => `เหลือ ${n} ครั้ง`;', 'x.ts')).toContain('thai'));
  it('ไทยใน attribute', () => expect(rules('const A = () => <button aria-label="ลบ" />;')).toContain('thai'));
  it('อังกฤษเป็น JSX text', () => expect(rules('const A = () => <h1>Sign in</h1>;')).toEqual(['jsx-text']));
  it('อังกฤษใน aria-label', () => expect(rules('const A = () => <button aria-label="Delete last digit" />;')).toEqual(['attr']));
  it('อังกฤษใน title={"…"}', () => expect(rules("const A = () => <span title={'Close'} />;")).toEqual(['attr']));
  it('อังกฤษใน placeholder={`…`}', () => expect(rules('const A = () => <input placeholder={`Your name`} />;')).toEqual(['attr']));
  it('อังกฤษใน alt แบบมีเงื่อนไข', () => expect(rules("const A = ({o}: {o: boolean}) => <img alt={o ? 'Open cat' : 'Closed cat'} />;")).toEqual(['attr', 'attr']));

  it('ไม่นับ: คอมเมนต์ไทย/อังกฤษ ทั้ง // /* */ และ {/* */} ใน JSX', () => {
    const code = [
      '// หน้าหลัก Sign in',
      '/** ฟอร์ม เข้าสู่ระบบ */',
      'const A = () => (',
      '  <div>',
      '    {/* ปุ่มลบ Delete */}',
      '    <p>{t("title")}</p>',
      '  </div>',
      ');',
    ].join('\n');
    expect(findHardcodedText(code)).toEqual([]);
  });
  it('ไม่นับ: t("key"), className, ตัวเลข/สัญลักษณ์, alt=""', () => {
    const code = `const A = () => <><button className="key ghost" aria-label={t('keypad.delete')}>0</button><img alt="" /><span>{n} · {"·"}</span><p title={t(\`x.\${k}\`)}>{"…"}</p></>;`;
    expect(findHardcodedText(code)).toEqual([]);
  });
});

describe('R0-9 ไม่มีข้อความ hard-code ใน src/app/**, src/components/** (ยกเว้น brand/**)', () => {
  it('พบไฟล์ให้สแกน', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((f) => f.startsWith('src/components/brand/'))).toBe(false);
  });

  it.each(files)('%s', (file) => {
    const findings = findHardcodedText(readFileSync(path.join(ROOT, file), 'utf8'), file);
    expect(findings.map((f) => `${file}:${f.line} [${f.rule}] ${f.text}`)).toEqual([]);
  });
});
