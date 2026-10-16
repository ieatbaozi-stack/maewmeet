/**
 * scripts/release.ts — ออกรุ่น maewmeet (boss เป็นคนรันเท่านั้น · CLAUDE.md กฎ 10 · docs/VERSIONING.md)
 *
 *   npx tsx scripts/release.ts <version> [--dry-run] [--skip-gates]
 *
 * ขั้นตอน: ตรวจเงื่อนไข → (ไม่ใช่ dry-run) เกต lint/typecheck/test/build → ย้าย [Unreleased] ใน CHANGELOG
 * → bump package.json (+ package-lock.json) → commit "chore(release): vX.Y.Z" → git tag -a vX.Y.Z
 * ไม่ push — พิมพ์คำสั่ง push ให้ boss
 *
 * --dry-run: แสดงแผน + diff โดยไม่แก้ไฟล์ ไม่รันคำสั่ง git ที่เขียน ไม่รันเกต npm
 * exit code: 0 = สำเร็จ/พร้อม · 1 = เงื่อนไขไม่ผ่านหรือขั้นตอนล้ม · 2 = ใช้คำสั่งผิด
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// ───────────────────────────── SemVer ─────────────────────────────

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

const SEMVER_RE =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/;

/** แปลง "1.2.3", "v1.2.3", "1.2.3-rc.1" → SemVer · รูปแบบผิด (รวม build metadata "+x") → null */
export function parseSemver(input: string): SemVer | null {
  const m = SEMVER_RE.exec(input.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split(".") : [],
  };
}

export function formatSemver(v: SemVer): string {
  const core = `${v.major}.${v.minor}.${v.patch}`;
  return v.prerelease.length ? `${core}-${v.prerelease.join(".")}` : core;
}

/** เทียบตามลำดับความสำคัญของ SemVer 2.0.0 §11 → -1 | 0 | 1 */
export function compareSemver(a: SemVer, b: SemVer): -1 | 0 | 1 {
  for (const k of ["major", "minor", "patch"] as const) {
    if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  }
  const pa = a.prerelease;
  const pb = b.prerelease;
  if (pa.length === 0 && pb.length === 0) return 0;
  if (pa.length === 0) return 1; // รุ่นจริง > pre-release
  if (pb.length === 0) return -1;
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) < Number(y) ? -1 : 1;
    if (xn) return -1;
    if (yn) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** หา tag เวอร์ชันสูงสุดจากรายชื่อ tag (สนใจเฉพาะรูปแบบ vX.Y.Z[-pre]) */
export function latestVersionFromTags(tags: readonly string[]): { tag: string; version: SemVer } | null {
  let best: { tag: string; version: SemVer } | null = null;
  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag.startsWith("v")) continue;
    const version = parseSemver(tag);
    if (!version) continue;
    if (!best || compareSemver(version, best.version) > 0) best = { tag, version };
  }
  return best;
}

// ───────────────────────────── CHANGELOG ─────────────────────────────

const LINK_REF_RE = /^\[[^\]]+\]:\s/;

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n");
}

/** ตำแหน่ง (index บรรทัด) ของหัวข้อ [Unreleased] และบรรทัดแรกที่พ้นส่วนนั้น */
function locateUnreleased(lines: readonly string[]): { start: number; end: number } | null {
  const start = lines.findIndex((l) => /^## \[Unreleased\][ \t]*$/.test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i] ?? "";
    if (/^## /.test(l) || LINK_REF_RE.test(l)) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/** เนื้อหาใต้ ## [Unreleased] (ไม่รวมหัวข้อ) · ไม่มีหัวข้อนี้ → null */
export function getUnreleasedBody(changelog: string): string | null {
  const lines = splitLines(changelog);
  const loc = locateUnreleased(lines);
  if (!loc) return null;
  return lines.slice(loc.start + 1, loc.end).join("\n");
}

/** บรรทัดที่นับเป็น "เนื้อหา": ไม่ว่าง ไม่ใช่หัวข้อ ### ไม่ใช่หมายเหตุ > และไม่ใช่ HTML comment */
function isContentLine(line: string): boolean {
  const t = line.trim();
  if (t === "") return false;
  if (/^#{3,6}\s/.test(t) || /^#{3,6}$/.test(t)) return false;
  if (t.startsWith(">")) return false;
  return true;
}

function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

export function hasUnreleasedContent(changelog: string): boolean {
  const body = getUnreleasedBody(changelog);
  if (body === null) return false;
  return splitLines(stripComments(body)).some(isContentLine);
}

/** ตัดหมายเหตุร่าง (บรรทัด ">") + หัวข้อ ### ที่ไม่มีเนื้อหาออก และตัดบรรทัดว่างหัว/ท้าย */
function tidySection(rawLines: readonly string[]): string[] {
  const bodyLines = rawLines.filter((l) => !l.trim().startsWith(">"));
  const out: string[] = [];
  let i = 0;
  while (i < bodyLines.length) {
    const line = bodyLines[i] ?? "";
    if (/^#{3,6}\s/.test(line.trim())) {
      let j = i + 1;
      while (j < bodyLines.length && !/^#{3,6}\s/.test((bodyLines[j] ?? "").trim())) j++;
      const section = bodyLines.slice(i + 1, j);
      if (section.some(isContentLine)) out.push(line, ...section);
      i = j;
    } else {
      out.push(line);
      i++;
    }
  }
  while (out.length && (out[0] ?? "").trim() === "") out.shift();
  while (out.length && (out[out.length - 1] ?? "").trim() === "") out.pop();
  return out;
}

/**
 * ย้าย [Unreleased] → ## [X.Y.Z] - YYYY-MM-DD แล้วใส่ ## [Unreleased] ว่างไว้บนสุด
 * หัวข้อย่อยที่ว่างถูกตัดออกจากรุ่นที่ออก · ส่วนอื่นของไฟล์คงเดิม (ขึ้นบรรทัดแบบ \n)
 */
export function applyRelease(changelog: string, version: string, date: string): string {
  const v = parseSemver(version);
  if (!v) throw new Error(`เวอร์ชันไม่ใช่ SemVer / not SemVer: ${version}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`วันที่ต้องเป็น YYYY-MM-DD: ${date}`);
  const lines = splitLines(changelog);
  const loc = locateUnreleased(lines);
  if (!loc) throw new Error("CHANGELOG ไม่มีหัวข้อ ## [Unreleased]");
  const body = tidySection(splitLines(stripComments(lines.slice(loc.start + 1, loc.end).join("\n"))));
  if (!body.some(isContentLine)) throw new Error("[Unreleased] ว่าง — ไม่มีอะไรให้ออกรุ่น");
  const before = lines.slice(0, loc.start);
  const after = lines.slice(loc.end);
  const released = ["## [Unreleased]", "", `## [${formatSemver(v)}] - ${date}`, "", ...body, ""];
  return [...before, ...released, ...after].join("\n");
}

// ───────────────────────────── package.json / lock ─────────────────────────────

/** แก้ "version" ระดับบนสุดของ package.json โดยคงรูปแบบไฟล์เดิม */
export function bumpJsonVersion(text: string, version: string): string {
  const parsed = JSON.parse(text) as { version?: unknown };
  if (typeof parsed.version !== "string") throw new Error('package.json ไม่มีฟิลด์ "version"');
  const re = /^(\s*"version"\s*:\s*")[^"]*(")/m;
  const next = text.replace(re, `$1${version}$2`);
  const check = JSON.parse(next) as { version?: unknown };
  if (check.version !== version) {
    return JSON.stringify({ ...parsed, version }, null, 2) + "\n";
  }
  return next;
}

/** แก้ version ใน package-lock.json ทั้งระดับบนสุดและ packages[""] โดยคงรูปแบบไฟล์เดิม */
export function bumpLockVersion(text: string, version: string): string {
  type Lock = { version?: string; packages?: Record<string, { version?: string }> };
  const parsed = JSON.parse(text) as Lock;
  let next = text.replace(/^(  "version"\s*:\s*")[^"]*(")/m, `$1${version}$2`);
  next = next.replace(/^(    ""\s*:\s*\{[^{}]*?\n      "version"\s*:\s*")[^"]*(")/m, `$1${version}$2`);
  const check = JSON.parse(next) as Lock;
  const rootOk = check.packages?.[""] === undefined || check.packages[""].version === version;
  if (check.version === version && rootOk) return next;
  // รูปแบบไม่ตรงที่คาด → เขียนใหม่ทั้งไฟล์ (ยังเป็น JSON ที่ถูกต้อง)
  parsed.version = version;
  if (parsed.packages?.[""]) parsed.packages[""].version = version;
  return JSON.stringify(parsed, null, 2) + "\n";
}

// ───────────────────────────── วันที่ ─────────────────────────────

/** YYYY-MM-DD ตามเวลา Asia/Bangkok */
export function bangkokDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// ───────────────────────────── ตรวจเงื่อนไข ─────────────────────────────

export interface Check {
  id: "version" | "newer-than-tag" | "tag-free" | "newer-than-package" | "branch" | "clean" | "unreleased";
  ok: boolean;
  message: string;
}

export interface PreconditionInput {
  version: string;
  /** branch ปัจจุบัน · null = detached HEAD / อ่านไม่ได้ */
  branch: string | null;
  /** บรรทัดจาก git status --porcelain */
  dirty: readonly string[];
  tags: readonly string[];
  /** เนื้อหา CHANGELOG.md · null = ไม่มีไฟล์ */
  changelog: string | null;
  /** version ใน package.json ปัจจุบัน */
  packageVersion: string | null;
}

export function checkPreconditions(input: PreconditionInput): { ok: boolean; checks: Check[] } {
  const checks: Check[] = [];
  const v = parseSemver(input.version);
  const plain = v ? formatSemver(v) : input.version;

  checks.push(
    v
      ? { id: "version", ok: true, message: `เวอร์ชัน ${plain} เป็น SemVer` }
      : {
          id: "version",
          ok: false,
          message: `"${input.version}" ไม่ใช่ SemVer (ตัวอย่าง 0.1.0) / not a valid SemVer`,
        },
  );

  const latest = latestVersionFromTags(input.tags);
  if (v) {
    if (!latest) {
      checks.push({ id: "newer-than-tag", ok: true, message: "ยังไม่มี tag เวอร์ชัน — นี่คือรุ่นแรก" });
    } else {
      const newer = compareSemver(v, latest.version) > 0;
      checks.push({
        id: "newer-than-tag",
        ok: newer,
        message: newer
          ? `${plain} > tag ล่าสุด ${latest.tag}`
          : `เวอร์ชันต้องมากกว่า tag ล่าสุด ${latest.tag} / must be greater than latest tag`,
      });
    }
    const exists = input.tags.some((t) => t.trim() === `v${plain}`);
    checks.push({
      id: "tag-free",
      ok: !exists,
      message: exists ? `tag v${plain} มีอยู่แล้ว / tag already exists` : `tag v${plain} ยังไม่มี`,
    });
    const pv = input.packageVersion ? parseSemver(input.packageVersion) : null;
    if (pv) {
      const newer = compareSemver(v, pv) > 0;
      checks.push({
        id: "newer-than-package",
        ok: newer,
        message: newer
          ? `${plain} > package.json ${formatSemver(pv)}`
          : `เวอร์ชันต้องมากกว่า package.json (${formatSemver(pv)}) / must be greater than package.json`,
      });
    } else {
      checks.push({ id: "newer-than-package", ok: false, message: "อ่าน version ใน package.json ไม่ได้" });
    }
  }

  checks.push(
    input.branch === "main"
      ? { id: "branch", ok: true, message: "อยู่บน branch main" }
      : {
          id: "branch",
          ok: false,
          message: `ต้องอยู่บน branch main (ตอนนี้: ${input.branch ?? "detached HEAD"}) / must be on main`,
        },
  );

  checks.push(
    input.dirty.length === 0
      ? { id: "clean", ok: true, message: "working tree สะอาด" }
      : {
          id: "clean",
          ok: false,
          message:
            `working tree ไม่สะอาด (${input.dirty.length} รายการ) / working tree not clean:\n` +
            input.dirty
              .slice(0, 10)
              .map((l) => `      ${l}`)
              .join("\n") +
            (input.dirty.length > 10 ? `\n      … อีก ${input.dirty.length - 10} รายการ` : ""),
        },
  );

  if (input.changelog === null) {
    checks.push({ id: "unreleased", ok: false, message: "ไม่พบ CHANGELOG.md / CHANGELOG.md not found" });
  } else if (getUnreleasedBody(input.changelog) === null) {
    checks.push({ id: "unreleased", ok: false, message: "CHANGELOG.md ไม่มีหัวข้อ ## [Unreleased]" });
  } else if (!hasUnreleasedContent(input.changelog)) {
    checks.push({ id: "unreleased", ok: false, message: "[Unreleased] ว่าง — ไม่มีอะไรให้ออกรุ่น / nothing to release" });
  } else {
    checks.push({ id: "unreleased", ok: true, message: "[Unreleased] มีเนื้อหา" });
  }

  return { ok: checks.every((c) => c.ok), checks };
}

// ───────────────────────────── diff ─────────────────────────────

/** unified diff แบบบรรทัด (LCS) พร้อม context 3 บรรทัด · ไม่ต่างกัน → "" */
export function unifiedDiff(a: string, b: string, labelA: string, labelB: string, context = 3): string {
  const x = splitLines(a);
  const y = splitLines(b);
  const n = x.length;
  const m = y.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i]!;
    const below = dp[i + 1]!;
    for (let j = m - 1; j >= 0; j--) {
      row[j] = x[i] === y[j] ? below[j + 1]! + 1 : Math.max(below[j]!, row[j + 1]!);
    }
  }
  type Op = { t: " " | "-" | "+"; line: string; ai: number; bi: number };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) {
      ops.push({ t: " ", line: x[i]!, ai: i, bi: j });
      i++;
      j++;
    } else if (i < n && (j >= m || dp[i + 1]![j]! >= dp[i]![j + 1]!)) {
      ops.push({ t: "-", line: x[i]!, ai: i, bi: j });
      i++;
    } else {
      ops.push({ t: "+", line: y[j]!, ai: i, bi: j });
      j++;
    }
  }
  const changed = ops.map((o, k) => (o.t !== " " ? k : -1)).filter((k) => k >= 0);
  if (changed.length === 0) return "";
  const out: string[] = [`--- ${labelA}`, `+++ ${labelB}`];
  let k = 0;
  while (k < changed.length) {
    let from = Math.max(0, changed[k]! - context);
    let to = Math.min(ops.length - 1, changed[k]! + context);
    while (k + 1 < changed.length && changed[k + 1]! - context <= to + 1) {
      k++;
      to = Math.min(ops.length - 1, changed[k]! + context);
    }
    from = Math.max(0, from);
    const hunk = ops.slice(from, to + 1);
    const first = hunk[0]!;
    const aLen = hunk.filter((o) => o.t !== "+").length;
    const bLen = hunk.filter((o) => o.t !== "-").length;
    out.push(`@@ -${first.ai + 1},${aLen} +${first.bi + 1},${bLen} @@`);
    for (const o of hunk) out.push(`${o.t}${o.line}`);
    k++;
  }
  return out.join("\n");
}

// ───────────────────────────── ส่วนที่แตะระบบ ─────────────────────────────

export const GATES = ["lint", "typecheck", "test", "build"] as const;

export interface RunOptions {
  version: string;
  dryRun: boolean;
  skipGates?: boolean;
  cwd: string;
  now: Date;
  log?: (line: string) => void;
  /** สำหรับเทสต์: แทนการรัน `npm run <gate>` */
  runGate?: (gate: (typeof GATES)[number], cwd: string) => void;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd();
}

function tryGit(cwd: string, args: string[]): string | null {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
}

function defaultRunGate(gate: string, cwd: string): void {
  execSync(`npm run ${gate}`, { cwd, stdio: "inherit" });
}

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** ทำงานทั้งหมด คืน exit code (ไม่ throw สำหรับความผิดพลาดที่คาดได้) */
export function runRelease(opts: RunOptions): number {
  const log = opts.log ?? ((l: string) => console.log(l));
  const cwd = resolve(opts.cwd);
  const mode = opts.dryRun ? "DRY-RUN (ไม่แก้ไฟล์ ไม่สร้าง commit/tag)" : "RELEASE";
  log(`maewmeet release · ${mode}`);
  log(`repo: ${cwd}`);

  if (tryGit(cwd, ["rev-parse", "--is-inside-work-tree"]) !== "true") {
    log("✗ ไม่ใช่ git repository / not a git repository");
    return 1;
  }

  const changelogPath = join(cwd, "CHANGELOG.md");
  const pkgPath = join(cwd, "package.json");
  const lockPath = join(cwd, "package-lock.json");
  const changelog = readIfExists(changelogPath);
  const pkgText = readIfExists(pkgPath);
  const lockText = readIfExists(lockPath);

  let packageVersion: string | null = null;
  if (pkgText !== null) {
    try {
      const v = (JSON.parse(pkgText) as { version?: unknown }).version;
      packageVersion = typeof v === "string" ? v : null;
    } catch {
      packageVersion = null;
    }
  }

  const branch = tryGit(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const statusOut = tryGit(cwd, ["status", "--porcelain", "--untracked-files=all"]) ?? "";
  const dirty = statusOut.split("\n").filter((l) => l.trim() !== "");
  const tags = (tryGit(cwd, ["tag", "--list", "v*"]) ?? "").split("\n").filter((t) => t.trim() !== "");

  const pre = checkPreconditions({ version: opts.version, branch, dirty, tags, changelog, packageVersion });
  log("");
  log("ผลการตรวจ / checks:");
  for (const c of pre.checks) log(`  ${c.ok ? "✓" : "✗"} ${c.message}`);

  const sv = parseSemver(opts.version);
  if (!sv) return 1;
  const version = formatSemver(sv);
  const tag = `v${version}`;
  const date = bangkokDate(opts.now);

  // เตรียมเนื้อหาใหม่ (ใช้ได้ทั้ง dry-run และของจริง)
  let nextChangelog: string | null = null;
  if (changelog !== null && hasUnreleasedContent(changelog)) nextChangelog = applyRelease(changelog, version, date);
  const nextPkg = pkgText !== null && packageVersion !== null ? bumpJsonVersion(pkgText, version) : null;
  const nextLock = lockText !== null ? bumpLockVersion(lockText, version) : null;

  const files: { name: string; path: string; before: string; after: string }[] = [];
  if (changelog !== null && nextChangelog !== null)
    files.push({ name: "CHANGELOG.md", path: changelogPath, before: changelog, after: nextChangelog });
  if (pkgText !== null && nextPkg !== null) files.push({ name: "package.json", path: pkgPath, before: pkgText, after: nextPkg });
  if (lockText !== null && nextLock !== null && nextLock !== lockText)
    files.push({ name: "package-lock.json", path: lockPath, before: lockText, after: nextLock });

  log("");
  log(`แผน / plan (${tag}, วันที่ ${date} Asia/Bangkok):`);
  let step = 1;
  if (opts.skipGates) log(`  ${step++}. (ข้าม) เกต npm — --skip-gates`);
  else for (const g of GATES) log(`  ${step++}. npm run ${g}`);
  log(`  ${step++}. CHANGELOG.md: ## [Unreleased] → ## [${version}] - ${date} + [Unreleased] ว่างใหม่`);
  log(`  ${step++}. package.json version: ${packageVersion ?? "?"} → ${version}` + (lockText !== null ? " (+ package-lock.json)" : ""));
  log(`  ${step++}. git commit -m "chore(release): ${tag}" -- ${files.map((f) => f.name).join(" ")}`);
  log(`  ${step++}. git tag -a ${tag} -m "maewmeet ${tag}"`);
  log(`  ${step++}. (ไม่ push) พิมพ์คำสั่ง push ให้ boss`);

  if (opts.dryRun) {
    log("");
    log("diff ที่จะเกิด / pending changes:");
    if (files.length === 0) log("  (สร้าง diff ไม่ได้ — ดูข้อที่ไม่ผ่านด้านบน)");
    for (const f of files) {
      const d = unifiedDiff(f.before, f.after, `a/${f.name}`, `b/${f.name}`);
      log(d === "" ? `  ${f.name}: ไม่เปลี่ยน` : d);
    }
    log("");
    if (pre.ok) {
      log(`✓ DRY-RUN: เงื่อนไขครบ — รันจริงด้วย: npx tsx scripts/release.ts ${version}`);
      return 0;
    }
    const failed = pre.checks.filter((c) => !c.ok).length;
    log(`✗ DRY-RUN: เงื่อนไขไม่ผ่าน ${failed} ข้อ — รันจริงตอนนี้จะหยุดก่อนแก้ไฟล์ (ไม่มีไฟล์ใดถูกแก้)`);
    return 1;
  }

  if (!pre.ok) {
    log("");
    log("✗ หยุด: เงื่อนไขไม่ผ่าน — ไม่มีไฟล์ใดถูกแก้ / aborted, nothing changed");
    return 1;
  }

  // เกต
  if (opts.skipGates) {
    log("");
    log("! ข้ามเกต npm ตาม --skip-gates — ใช้เมื่อ CI เขียวบน commit นี้แล้วเท่านั้น");
  } else {
    const runGate = opts.runGate ?? defaultRunGate;
    for (const g of GATES) {
      log("");
      log(`▶ npm run ${g}`);
      try {
        runGate(g, cwd);
      } catch {
        log(`✗ เกต "npm run ${g}" ล้ม — หยุด ไม่มีไฟล์ใดถูกแก้ / gate failed, nothing changed`);
        return 1;
      }
    }
  }

  // เขียนไฟล์ → commit → tag (ล้มก่อน commit = คืนไฟล์เดิม)
  let committed = false;
  try {
    for (const f of files) writeFileSync(f.path, f.after, "utf8");
    git(cwd, ["add", "--", ...files.map((f) => f.name)]);
    git(cwd, ["commit", "-m", `chore(release): ${tag}`, "--", ...files.map((f) => f.name)]);
    committed = true;
    git(cwd, ["tag", "-a", tag, "-m", `maewmeet ${tag}`]);
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    if (!committed) {
      for (const f of files) writeFileSync(f.path, f.before, "utf8");
      tryGit(cwd, ["reset", "-q", "--", ...files.map((f) => f.name)]);
      log(`✗ ล้มก่อน commit (${msg}) — คืนไฟล์เดิมแล้ว ไม่มี commit/tag`);
    } else {
      log(`✗ commit แล้วแต่สร้าง tag ไม่ได้ (${msg})`);
      log("  แก้: git reset --hard HEAD~1   (ยกเลิก commit release) แล้วรันใหม่");
    }
    return 1;
  }

  log("");
  log(`✓ สร้าง commit "chore(release): ${tag}" และ tag ${tag} ในเครื่องแล้ว (ยังไม่ push)`);
  log("");
  log("ตรวจแล้ว push เอง (PowerShell):");
  log("  git show --stat HEAD");
  log("  git push origin main");
  log(`  git push origin ${tag}`);
  log("");
  log("ยกเลิกก่อน push:");
  log(`  git tag -d ${tag}`);
  log("  git reset --hard HEAD~1");
  return 0;
}

// ───────────────────────────── CLI ─────────────────────────────

const USAGE = "ใช้ / usage: npx tsx scripts/release.ts <version> [--dry-run] [--skip-gates]   เช่น 0.1.0 --dry-run";

export function parseArgs(argv: readonly string[]): { version: string; dryRun: boolean; skipGates: boolean } | string {
  let version: string | null = null;
  let dryRun = false;
  let skipGates = false;
  for (const a of argv) {
    if (a === "--dry-run") dryRun = true;
    else if (a === "--skip-gates") skipGates = true;
    else if (a.startsWith("-")) return `ไม่รู้จักตัวเลือก "${a}" / unknown option\n${USAGE}`;
    else if (version === null) version = a;
    else return `ใส่เวอร์ชันได้ค่าเดียว / only one version allowed\n${USAGE}`;
  }
  if (version === null) return `ไม่ได้ใส่เวอร์ชัน / missing version\n${USAGE}`;
  return { version, dryRun, skipGates };
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isMain()) {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === "string") {
    console.error(args);
    process.exit(2);
  }
  const code = runRelease({ ...args, cwd: process.cwd(), now: new Date() });
  process.exit(code);
}
