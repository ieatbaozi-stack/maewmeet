// เทสต์ของ scripts/release.ts — Release engineer (#15) · R0-17
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { removeTempDir } from "../helpers/fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyRelease,
  bangkokDate,
  bumpJsonVersion,
  bumpLockVersion,
  checkPreconditions,
  compareSemver,
  DOC_VERSION_TARGETS,
  getUnreleasedBody,
  hasUnreleasedContent,
  latestVersionFromTags,
  parseArgs,
  parseSemver,
  readDocVersion,
  replaceDocVersion,
  runRelease,
  unifiedDiff,
  type PreconditionInput,
} from "../../scripts/release";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCRIPT = join(ROOT, "scripts/release.ts");
const TSX = join(ROOT, "node_modules/.bin/tsx");

const sv = (s: string) => {
  const v = parseSemver(s);
  if (!v) throw new Error(`bad semver in test: ${s}`);
  return v;
};

const CHANGELOG = `# Changelog

intro

## [Unreleased]

> หมายเหตุร่าง: เสนอ v0.2.0

### Added
- ของใหม่ A

### Fixed

### Upgrade notes
1. ตั้ง env X

## [0.1.0] - 2026-10-20

### Added
- รุ่นแรก
`;

const EMPTY_UNRELEASED = `# Changelog

## [Unreleased]

> หมายเหตุ

### Added

<!-- ยังไม่มี -->

## [0.1.0] - 2026-10-20
- x
`;

describe("SemVer", () => {
  it("parse รูปแบบถูก/ผิด", () => {
    expect(parseSemver("0.1.0")).toEqual({ major: 0, minor: 1, patch: 0, prerelease: [] });
    expect(parseSemver("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
    expect(parseSemver("1.0.0-rc.1")?.prerelease).toEqual(["rc", "1"]);
    for (const bad of ["1.0", "01.0.0", "1.0.0.0", "x1.0.0", "1.0.0+build", "", "v", "1.0.0-", "1.0.0-01"]) {
      expect(parseSemver(bad), bad).toBeNull();
    }
  });

  it("เทียบลำดับตาม SemVer §11", () => {
    const order = [
      "0.0.0",
      "0.1.0-alpha",
      "0.1.0-alpha.1",
      "0.1.0-alpha.beta",
      "0.1.0-beta.2",
      "0.1.0-beta.11",
      "0.1.0-rc.1",
      "0.1.0",
      "0.1.1",
      "0.2.0",
      "0.10.0",
      "1.0.0",
    ];
    for (let i = 0; i < order.length - 1; i++) {
      expect(compareSemver(sv(order[i]!), sv(order[i + 1]!)), `${order[i]} < ${order[i + 1]}`).toBe(-1);
      expect(compareSemver(sv(order[i + 1]!), sv(order[i]!))).toBe(1);
    }
    expect(compareSemver(sv("v0.1.0"), sv("0.1.0"))).toBe(0);
  });

  it("tag ล่าสุด: เลือกค่าสูงสุดตาม SemVer ไม่ใช่ตามตัวอักษร และข้าม tag ที่ไม่ใช่เวอร์ชัน", () => {
    expect(latestVersionFromTags([])).toBeNull();
    expect(latestVersionFromTags(["release-1", "1.0.0", "vfoo"])).toBeNull();
    expect(latestVersionFromTags(["v0.9.0", "v0.10.0", "v0.2.1", "nightly"])?.tag).toBe("v0.10.0");
    expect(latestVersionFromTags(["v0.2.0-rc.1", "v0.1.0"])?.tag).toBe("v0.2.0-rc.1");
  });
});

describe("CHANGELOG", () => {
  it("อ่านเนื้อหาใต้ [Unreleased] จนถึงหัวข้อรุ่นถัดไป", () => {
    const body = getUnreleasedBody(CHANGELOG);
    expect(body).toContain("- ของใหม่ A");
    expect(body).not.toContain("รุ่นแรก");
    expect(getUnreleasedBody("# Changelog\n\n## [0.1.0] - 2026-01-01\n")).toBeNull();
  });

  it("หยุดที่ link reference ท้ายไฟล์", () => {
    const text = "## [Unreleased]\n- a\n\n[Unreleased]: https://example.com/compare/v0.1.0...HEAD\n";
    expect(getUnreleasedBody(text)).toBe("- a\n");
  });

  it("[Unreleased] ที่มีแต่หัวข้อ/หมายเหตุ/คอมเมนต์ ถือว่าว่าง", () => {
    expect(hasUnreleasedContent(CHANGELOG)).toBe(true);
    expect(hasUnreleasedContent(EMPTY_UNRELEASED)).toBe(false);
    expect(hasUnreleasedContent("# Changelog\n")).toBe(false);
  });

  it("applyRelease: ย้ายเป็นรุ่นใหม่ + [Unreleased] ว่าง + ตัดหัวข้อว่าง/หมายเหตุร่าง + รุ่นเก่าคงเดิม", () => {
    const out = applyRelease(CHANGELOG, "0.2.0", "2026-11-01");
    expect(out).toBe(`# Changelog

intro

## [Unreleased]

## [0.2.0] - 2026-11-01

### Added
- ของใหม่ A

### Upgrade notes
1. ตั้ง env X

## [0.1.0] - 2026-10-20

### Added
- รุ่นแรก
`);
    // หลังออกรุ่น [Unreleased] ว่าง → ออกซ้ำไม่ได้
    expect(hasUnreleasedContent(out)).toBe(false);
    expect(() => applyRelease(out, "0.2.1", "2026-11-02")).toThrow(/ว่าง/);
  });

  it("applyRelease: รับ CRLF (ไฟล์จาก Windows) และ 'v' นำหน้า", () => {
    const out = applyRelease(CHANGELOG.replace(/\n/g, "\r\n"), "v0.2.0", "2026-11-01");
    expect(out).toContain("## [0.2.0] - 2026-11-01");
    expect(out).not.toContain("\r");
  });

  it("applyRelease: ปฏิเสธเวอร์ชัน/วันที่ผิด และไฟล์ที่ไม่มี [Unreleased]", () => {
    expect(() => applyRelease(CHANGELOG, "0.2", "2026-11-01")).toThrow(/SemVer/);
    expect(() => applyRelease(CHANGELOG, "0.2.0", "1/11/2026")).toThrow(/YYYY-MM-DD/);
    expect(() => applyRelease("# x\n", "0.2.0", "2026-11-01")).toThrow(/Unreleased/);
  });
});

describe("package.json / package-lock.json", () => {
  it("bump version โดยไม่แตะส่วนอื่น", () => {
    const pkg = '{\n  "name": "maewmeet",\n  "version": "0.0.0",\n  "dependencies": {\n    "x": {\n      "version": "9.9.9"\n    }\n  }\n}\n';
    const out = bumpJsonVersion(pkg, "0.1.0");
    expect(out).toBe(pkg.replace('"version": "0.0.0"', '"version": "0.1.0"'));
    expect(() => bumpJsonVersion('{"name":"x"}', "0.1.0")).toThrow(/version/);
  });

  it("bump lockfile ทั้งระดับบนและ packages[\"\"] แต่ไม่แตะ dependency", () => {
    const lock = JSON.stringify(
      {
        name: "maewmeet",
        version: "0.0.0",
        lockfileVersion: 3,
        requires: true,
        packages: { "": { name: "maewmeet", version: "0.0.0" }, "node_modules/a": { version: "0.0.0" } },
      },
      null,
      2,
    ) + "\n";
    const out = JSON.parse(bumpLockVersion(lock, "0.1.0")) as {
      version: string;
      packages: Record<string, { version: string }>;
    };
    expect(out.version).toBe("0.1.0");
    expect(out.packages[""]?.version).toBe("0.1.0");
    expect(out.packages["node_modules/a"]?.version).toBe("0.0.0");
  });

  it("lockfile ของ repo จริง bump ได้ถูก", () => {
    const real = readFileSync(join(ROOT, "package-lock.json"), "utf8");
    const out = bumpLockVersion(real, "9.8.7");
    const parsed = JSON.parse(out) as { version: string; packages: Record<string, { version?: string }> };
    expect(parsed.version).toBe("9.8.7");
    expect(parsed.packages[""]?.version).toBe("9.8.7");
    expect(out.split("\n").length).toBe(real.split("\n").length);
  });
});

describe("bangkokDate", () => {
  it("ใช้วันที่ตามเวลา Asia/Bangkok (UTC+7) ข้ามเที่ยงคืน/ปี", () => {
    expect(bangkokDate(new Date("2026-10-16T16:59:59Z"))).toBe("2026-10-16");
    expect(bangkokDate(new Date("2026-10-16T17:00:00Z"))).toBe("2026-10-17");
    expect(bangkokDate(new Date("2026-12-31T17:30:00Z"))).toBe("2027-01-01");
    expect(bangkokDate(new Date("2028-02-28T17:00:00Z"))).toBe("2028-02-29");
  });
});

describe("checkPreconditions", () => {
  const base: PreconditionInput = {
    version: "0.2.0",
    branch: "main",
    dirty: [],
    tags: ["v0.1.0"],
    changelog: CHANGELOG,
    packageVersion: "0.1.0",
  };
  const failed = (inp: Partial<PreconditionInput>) =>
    checkPreconditions({ ...base, ...inp })
      .checks.filter((c) => !c.ok)
      .map((c) => c.id);

  it("ผ่านทุกข้อเมื่อครบ", () => {
    expect(checkPreconditions(base).ok).toBe(true);
    expect(checkPreconditions({ ...base, tags: [], packageVersion: "0.0.0" }).ok).toBe(true);
  });

  it("แจ้งแต่ละเงื่อนไขแยกกัน", () => {
    expect(failed({ version: "0.2" })).toEqual(["version"]);
    expect(failed({ version: "0.1.0" })).toEqual(["newer-than-tag", "tag-free", "newer-than-package"]);
    expect(failed({ version: "0.0.9" })).toEqual(["newer-than-tag", "newer-than-package"]);
    expect(failed({ branch: "r0" })).toEqual(["branch"]);
    expect(failed({ branch: null })).toEqual(["branch"]);
    expect(failed({ dirty: ["?? x.ts"] })).toEqual(["clean"]);
    expect(failed({ changelog: null })).toEqual(["unreleased"]);
    expect(failed({ changelog: EMPTY_UNRELEASED })).toEqual(["unreleased"]);
    expect(failed({ changelog: "# x\n" })).toEqual(["unreleased"]);
    expect(failed({ packageVersion: null })).toEqual(["newer-than-package"]);
  });

  it("MAJOR bump 0.15.0 -> 1.0.0 ผ่านเงื่อนไขทุกข้อ (R18 §6)", () => {
    const major = { ...base, version: "1.0.0", tags: ["v0.9.0", "v0.15.0"], packageVersion: "0.15.0" };
    expect(checkPreconditions(major).ok).toBe(true);
    expect(failed({ ...major, version: "0.16.0", tags: ["v0.15.0", "v1.0.0"], packageVersion: "1.0.0" })).toEqual([
      "newer-than-tag",
      "newer-than-package",
    ]);
  });

  it("ข้อความ error บอกสิ่งที่ต้องแก้", () => {
    const r = checkPreconditions({ ...base, branch: "r0", dirty: [" M a.ts"] });
    const msgs = r.checks.filter((c) => !c.ok).map((c) => c.message).join("\n");
    expect(msgs).toContain("ต้องอยู่บน branch main (ตอนนี้: r0)");
    expect(msgs).toContain("working tree ไม่สะอาด");
    expect(msgs).toContain(" M a.ts");
  });
});

describe("unifiedDiff / parseArgs", () => {
  it("diff แสดงบรรทัดที่ลบ/เพิ่ม และว่างเมื่อเหมือนกัน", () => {
    expect(unifiedDiff("a\nb\n", "a\nb\n", "x", "y")).toBe("");
    const d = unifiedDiff("a\nb\nc\n", "a\nB\nc\n", "a/f", "b/f");
    expect(d).toBe(["--- a/f", "+++ b/f", "@@ -1,4 +1,4 @@", " a", "-b", "+B", " c", " "].join("\n"));
  });

  it("parseArgs", () => {
    expect(parseArgs(["0.1.0", "--dry-run"])).toEqual({ version: "0.1.0", dryRun: true, skipGates: false });
    expect(parseArgs(["--skip-gates", "0.1.0"])).toEqual({ version: "0.1.0", dryRun: false, skipGates: true });
    expect(parseArgs([])).toMatch(/missing version/);
    expect(parseArgs(["0.1.0", "--push"])).toMatch(/unknown option/);
    expect(parseArgs(["0.1.0", "0.2.0"])).toMatch(/only one version/);
  });
});

// ───────────── git repo ชั่วคราวใน tmp (ไม่แตะ repo จริง) ─────────────

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) removeTempDir(d);
});

function g(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd();
}

const PKG = '{\n  "name": "demo",\n  "version": "0.0.0",\n  "private": true\n}\n';
const LOCK =
  '{\n  "name": "demo",\n  "version": "0.0.0",\n  "lockfileVersion": 3,\n  "requires": true,\n  "packages": {\n    "": {\n      "name": "demo",\n      "version": "0.0.0"\n    }\n  }\n}\n';

// เอกสารจำลอง 5 ไฟล์ที่ release.ts ต้องเปลี่ยนเลขรุ่นให้ (PRD ใช้ CRLF · มีเลขรุ่นอื่นในไฟล์เดียวกันที่ห้ามแตะ)
const DOCS: Record<string, string> = {
  "docs/guides/quickstart-th.html":
    "<footer>\n  <span>app v0.0.0</span>\n</footer>\n<!-- เดิมเคยเป็น app v9.9.9 -->\n<span>app v0.0.0</span>\n",
  "docs/prd/PRD.md":
    "# PRD\r\n\r\n> **สถานะปัจจุบัน (2026-01-01):** แอปอยู่ที่ **v0.0.0** (รอบ R0 ออกแล้ว) · ดู v1.0.0 ในแผนเดิม\r\n\r\nเนื้อหา v0.0.0 ที่ไม่ใช่หมายเหตุ\r\n",
  "docs/team/PROGRESS.md":
    '# PROGRESS\n\n> อัปเดตล่าสุด: 2026-01-01 · ออกรุ่น v0.0.0 แล้ว · ก่อนหน้า v0.0.0\n\nบรรทัดอื่นที่ไม่เกี่ยวกับ "อัปเดตล่าสุด" v0.0.0\n',
  "README.md":
    "# README\n\n**สถานะ:** v0.0.0 ออกแล้ว (2026-01-01) · ก่อนหน้า v0.0.0\n\nอ้างอิงอื่น v0.0.0\n",
  "docs/team/HANDOFF.md":
    "# HANDOFF\n\n- เวอร์ชันล่าสุดที่ออกแล้ว: **v0.0.0** · tag `v0.0.0`\n\nอ้างอิงอื่น v0.0.0\n",
};

function writeDocs(dir: string, docs: Record<string, string>): void {
  for (const [rel, text] of Object.entries(docs)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
}

function makeRepo(
  changelog = CHANGELOG.replace(/## \[0\.1\.0\][\s\S]*$/, ""),
  docs: Record<string, string> = DOCS,
): string {
  const dir = mkdtempSync(join(tmpdir(), "mm-release-"));
  tmpDirs.push(dir);
  g(dir, "init", "-q", "-b", "main");
  g(dir, "config", "user.name", "test");
  g(dir, "config", "user.email", "test@example.invalid");
  g(dir, "config", "commit.gpgsign", "false");
  g(dir, "config", "tag.gpgsign", "false");
  writeFileSync(join(dir, "CHANGELOG.md"), changelog);
  writeFileSync(join(dir, "package.json"), PKG);
  writeFileSync(join(dir, "package-lock.json"), LOCK);
  writeDocs(dir, docs);
  g(dir, "add", "-A");
  g(dir, "commit", "-q", "-m", "init");
  return dir;
}

function snapshot(dir: string) {
  return {
    status: g(dir, "status", "--porcelain", "--untracked-files=all"),
    head: g(dir, "rev-parse", "HEAD"),
    tags: g(dir, "tag", "--list"),
    changelog: readFileSync(join(dir, "CHANGELOG.md"), "utf8"),
    pkg: readFileSync(join(dir, "package.json"), "utf8"),
    lock: readFileSync(join(dir, "package-lock.json"), "utf8"),
  };
}

const NOW = new Date("2026-10-16T18:00:00Z"); // = 2026-10-17 01:00 เวลาไทย

describe("runRelease บน git repo ชั่วคราว", () => {
  it("--dry-run: แสดงแผน+diff, exit 0, ไม่แก้ไฟล์/ไม่สร้าง commit/tag, ไม่รันเกต", () => {
    const dir = makeRepo();
    const before = snapshot(dir);
    const lines: string[] = [];
    let gates = 0;
    const code = runRelease({
      version: "0.1.0",
      dryRun: true,
      cwd: dir,
      now: NOW,
      log: (l) => lines.push(l),
      runGate: () => {
        gates++;
      },
    });
    const out = lines.join("\n");
    expect(code).toBe(0);
    expect(gates).toBe(0);
    expect(snapshot(dir)).toEqual(before);
    expect(out).toContain("DRY-RUN");
    expect(out).toContain("+## [0.1.0] - 2026-10-17");
    expect(out).toContain('-  "version": "0.0.0",');
    expect(out).toContain('+  "version": "0.1.0",');
    expect(out).toContain('git tag -a v0.1.0 -m "maewmeet v0.1.0"');
  });

  it("--dry-run: แจ้งว่าไม่อยู่บน main และ tree ไม่สะอาด (exit 1) โดยไม่แก้ไฟล์", () => {
    const dir = makeRepo();
    g(dir, "switch", "-q", "-c", "r0");
    writeFileSync(join(dir, "extra.txt"), "x");
    const before = snapshot(dir);
    const lines: string[] = [];
    const code = runRelease({ version: "0.1.0", dryRun: true, cwd: dir, now: NOW, log: (l) => lines.push(l) });
    const out = lines.join("\n");
    expect(code).toBe(1);
    expect(snapshot(dir)).toEqual(before);
    expect(out).toContain("✗ ต้องอยู่บน branch main (ตอนนี้: r0)");
    expect(out).toContain("✗ working tree ไม่สะอาด (1 รายการ)");
    expect(out).toContain("?? extra.txt");
    expect(out).toContain("+## [0.1.0] - 2026-10-17"); // แผนยังแสดง
  });

  it("CLI จริงผ่าน tsx: --dry-run ไม่แก้ไฟล์", () => {
    const dir = makeRepo();
    const before = snapshot(dir);
    const out = execFileSync(TSX, [SCRIPT, "0.1.0", "--dry-run"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(out).toContain("✓ DRY-RUN: เงื่อนไขครบ");
    expect(snapshot(dir)).toEqual(before);
  }, 30_000);

  it("CLI: ใส่อาร์กิวเมนต์ผิด → exit 2 พร้อมวิธีใช้", () => {
    let status = 0;
    let stderr = "";
    try {
      execFileSync(TSX, [SCRIPT], { encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      const err = e as { status: number; stderr: string };
      status = err.status;
      stderr = err.stderr;
    }
    expect(status).toBe(2);
    expect(stderr).toContain("usage");
  }, 30_000);

  it("ออกรุ่นจริง: รันเกตครบตามลำดับ → commit + annotated tag, ไม่ push, รุ่นถัดไปต้องใหม่กว่า", () => {
    const dir = makeRepo();
    const gates: string[] = [];
    const lines: string[] = [];
    const code = runRelease({
      version: "0.1.0",
      dryRun: false,
      cwd: dir,
      now: NOW,
      log: (l) => lines.push(l),
      runGate: (gate) => {
        gates.push(gate);
      },
    });
    expect(code).toBe(0);
    expect(gates).toEqual(["lint", "typecheck", "test", "build"]);
    expect(g(dir, "log", "-1", "--format=%s")).toBe("chore(release): v0.1.0");
    expect(g(dir, "cat-file", "-t", "v0.1.0")).toBe("tag"); // annotated
    expect(g(dir, "status", "--porcelain")).toBe("");
    expect(g(dir, "show", "--name-only", "--format=", "HEAD").split("\n").sort()).toEqual([
      "CHANGELOG.md",
      "README.md",
      "docs/guides/quickstart-th.html",
      "docs/prd/PRD.md",
      "docs/team/HANDOFF.md",
      "docs/team/PROGRESS.md",
      "package-lock.json",
      "package.json",
    ]);
    const s = snapshot(dir);
    expect(s.changelog).toContain("## [Unreleased]\n\n## [0.1.0] - 2026-10-17");
    expect(JSON.parse(s.pkg).version).toBe("0.1.0");
    expect(JSON.parse(s.lock).packages[""].version).toBe("0.1.0");
    expect(g(dir, "remote")).toBe("");
    expect(lines.join("\n")).toContain("git push origin v0.1.0");

    // รอบถัดไป: [Unreleased] ว่าง + เวอร์ชันซ้ำ → หยุด
    const again: string[] = [];
    expect(runRelease({ version: "0.1.0", dryRun: true, cwd: dir, now: NOW, log: (l) => again.push(l) })).toBe(1);
    const txt = again.join("\n");
    expect(txt).toContain("✗ เวอร์ชันต้องมากกว่า tag ล่าสุด v0.1.0");
    expect(txt).toContain("✗ tag v0.1.0 มีอยู่แล้ว");
    expect(txt).toContain("✗ [Unreleased] ว่าง");
  });

  it("ออกรุ่นจริง: เกตล้ม → หยุด ไม่แก้ไฟล์ ไม่มี commit/tag", () => {
    const dir = makeRepo();
    const before = snapshot(dir);
    const lines: string[] = [];
    const code = runRelease({
      version: "0.1.0",
      dryRun: false,
      cwd: dir,
      now: NOW,
      log: (l) => lines.push(l),
      runGate: (gate) => {
        if (gate === "test") throw new Error("boom");
      },
    });
    expect(code).toBe(1);
    expect(snapshot(dir)).toEqual(before);
    expect(lines.join("\n")).toContain('เกต "npm run test" ล้ม');
  });

  it("ออกรุ่นจริง: เงื่อนไขไม่ผ่าน → ไม่รันเกต ไม่แก้ไฟล์", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "extra.txt"), "x");
    const before = snapshot(dir);
    let gates = 0;
    const code = runRelease({
      version: "0.1.0",
      dryRun: false,
      cwd: dir,
      now: NOW,
      log: () => {},
      runGate: () => {
        gates++;
      },
    });
    expect(code).toBe(1);
    expect(gates).toBe(0);
    expect(snapshot(dir)).toEqual(before);
  });

  it("ไม่ใช่ git repo → exit 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-release-nogit-"));
    tmpDirs.push(dir);
    const lines: string[] = [];
    expect(runRelease({ version: "0.1.0", dryRun: true, cwd: dir, now: NOW, log: (l) => lines.push(l) })).toBe(1);
    expect(lines.join("\n")).toContain("ไม่ใช่ git repository");
  });
});

describe("เลขรุ่นในเอกสาร (DOCS_SYNC §7 · V1_2_CONTRACT O1)", () => {
  const [quickstart, prd, progress, readme, handoff] = DOC_VERSION_TARGETS;
  const NEW = "0.2.0";

  it("replaceDocVersion เปลี่ยนเฉพาะเลขรุ่นในตำแหน่งที่ docs-sync อ่าน ไม่แตะอย่างอื่น (รวม CRLF)", () => {
    const qOld = DOCS[quickstart!.file]!;
    const q = replaceDocVersion(qOld, quickstart!, NEW)!;
    expect(q).toBe(qOld.slice(0, qOld.lastIndexOf("app v0.0.0")) + "app v0.2.0" + qOld.slice(qOld.lastIndexOf("app v0.0.0") + 10));
    expect(q).toContain("app v9.9.9");
    expect(q.match(/app v0\.0\.0/g)).toHaveLength(1);

    const pOld = DOCS[prd!.file]!;
    expect(replaceDocVersion(pOld, prd!, NEW)).toBe(pOld.replace("**v0.0.0**", "**v0.2.0**"));

    const rOld = DOCS[progress!.file]!;
    expect(replaceDocVersion(rOld, progress!, NEW)).toBe(rOld.replace("ออกรุ่น v0.0.0", "ออกรุ่น v0.2.0"));

    const rmOld = DOCS[readme!.file]!;
    expect(replaceDocVersion(rmOld, readme!, NEW)).toBe(rmOld.replace("**สถานะ:** v0.0.0", "**สถานะ:** v0.2.0"));

    const hOld = DOCS[handoff!.file]!;
    expect(replaceDocVersion(hOld, handoff!, NEW)).toBe(hOld.replace("**v0.0.0**", "**v0.2.0**"));
  });

  it("หาตำแหน่งไม่เจอ → null · รองรับ prerelease", () => {
    expect(replaceDocVersion("ไม่มีอะไร", quickstart!, NEW)).toBeNull();
    expect(replaceDocVersion("> สถานะปัจจุบัน ไม่มีเลข", prd!, NEW)).toBeNull();
    expect(replaceDocVersion("ไม่มีคำนั้น v1.0.0", progress!, NEW)).toBeNull();
    expect(replaceDocVersion("ไม่มีสถานะ v1.0.0", readme!, NEW)).toBeNull();
    expect(replaceDocVersion("ไม่มีเวอร์ชัน v1.0.0", handoff!, NEW)).toBeNull();
    const pre = replaceDocVersion("> อัปเดตล่าสุด v1.0.0-rc.1 จบ", progress!, "1.0.0-rc.2")!;
    expect(pre).toBe("> อัปเดตล่าสุด v1.0.0-rc.2 จบ");
    expect(readDocVersion(pre, progress!)).toBe("1.0.0-rc.2");
  });

  it("ออกรุ่นจริงบน temp copy: commit เดียวกันเปลี่ยนเลขใน 5 ไฟล์ และ diff เป็นแค่เลขรุ่น", () => {
    const dir = makeRepo();
    expect(runRelease({ version: NEW, dryRun: false, skipGates: true, cwd: dir, now: NOW, log: () => {} })).toBe(0);
    for (const t of DOC_VERSION_TARGETS) {
      const text = readFileSync(join(dir, t.file), "utf8");
      expect(readDocVersion(text, t), t.file).toBe(NEW);
      expect(text.length).toBe(DOCS[t.file]!.length); // 0.0.0 → 0.2.0 ยาวเท่าเดิม และ CRLF คงเดิม
    }
    expect(g(dir, "diff", "--numstat", "HEAD~1", "HEAD", "--", ...DOC_VERSION_TARGETS.map((t) => t.file)).split("\n").sort()).toEqual([
      "1\t1\tREADME.md",
      "1\t1\tdocs/guides/quickstart-th.html",
      "1\t1\tdocs/prd/PRD.md",
      "1\t1\tdocs/team/HANDOFF.md",
      "1\t1\tdocs/team/PROGRESS.md",
    ]);
    expect(g(dir, "status", "--porcelain")).toBe("");
    expect(g(dir, "log", "-1", "--format=%s")).toBe("chore(release): v0.2.0");
  });

  it("ตรรกะเทียบของ docs-sync (package.json = 5 ไฟล์เอกสารหลัก) ผ่านหลังออกรุ่น", () => {
    const dir = makeRepo();
    const mismatched = (): string[] => {
      const pkg = (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version: string }).version;
      return DOC_VERSION_TARGETS.filter((t) => readDocVersion(readFileSync(join(dir, t.file), "utf8"), t) !== pkg).map((t) => t.file);
    };
    expect(mismatched()).toEqual([]);
    writeFileSync(join(dir, "package.json"), PKG.replace("0.0.0", "0.1.0")); // จำลอง release.ts เดิม: ขยับแค่ package.json
    expect(mismatched()).toHaveLength(5);
    g(dir, "checkout", "-q", "--", "package.json");
    expect(runRelease({ version: NEW, dryRun: false, skipGates: true, cwd: dir, now: NOW, log: () => {} })).toBe(0);
    expect(mismatched()).toEqual([]);
  });

  it("--dry-run แสดง diff เลขรุ่นของเอกสาร และไม่แก้ไฟล์", () => {
    const dir = makeRepo();
    const before = snapshot(dir);
    const lines: string[] = [];
    expect(runRelease({ version: NEW, dryRun: true, cwd: dir, now: NOW, log: (l) => lines.push(l) })).toBe(0);
    const out = lines.join("\n");
    expect(out).toContain("+++ b/docs/prd/PRD.md");
    expect(out).toContain("+++ b/docs/team/PROGRESS.md");
    expect(out).toContain("+++ b/docs/guides/quickstart-th.html");
    expect(out).toContain("+++ b/README.md");
    expect(out).toContain("+++ b/docs/team/HANDOFF.md");
    expect(snapshot(dir)).toEqual(before);
  });

  it("บรรทัดใดบรรทัดหนึ่งหาไม่เจอ → หยุดก่อนแก้ไฟล์ พร้อมบอกว่าไฟล์ไหน (dry-run และของจริง)", () => {
    const dir = makeRepo(undefined, { ...DOCS, "docs/prd/PRD.md": "# PRD\n\nไม่มีหมายเหตุ\n" });
    const before = snapshot(dir);
    const dry: string[] = [];
    expect(runRelease({ version: NEW, dryRun: true, cwd: dir, now: NOW, log: (l) => dry.push(l) })).toBe(1);
    expect(dry.join("\n")).toContain('✗ หาตำแหน่งเลขรุ่นไม่เจอ: docs/prd/PRD.md บรรทัด "สถานะปัจจุบัน"');
    const lines: string[] = [];
    let gates = 0;
    const code = runRelease({
      version: NEW,
      dryRun: false,
      cwd: dir,
      now: NOW,
      log: (l) => lines.push(l),
      runGate: () => {
        gates++;
      },
    });
    expect(code).toBe(1);
    expect(gates).toBe(0);
    expect(lines.join("\n")).toContain("หยุด: เงื่อนไขไม่ผ่าน");
    expect(snapshot(dir)).toEqual(before);
    expect(g(dir, "tag", "--list")).toBe("");
  });

  it("ไม่มีไฟล์เอกสาร → หยุดเช่นกัน", () => {
    const dir = makeRepo(undefined, {});
    const lines: string[] = [];
    expect(runRelease({ version: NEW, dryRun: true, cwd: dir, now: NOW, log: (l) => lines.push(l) })).toBe(1);
    expect(lines.join("\n")).toContain("docs/team/PROGRESS.md (ไม่พบไฟล์)");
  });
});
