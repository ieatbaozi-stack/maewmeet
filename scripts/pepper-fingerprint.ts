/**
 * scripts/pepper-fingerprint.ts — โครง (R0) · เจ้าของ: OPS (#10) · ADR 0002 §7.2, §7.4
 *
 * จุดประสงค์ (เติม logic ใน R1 พร้อม src/lib/auth/pin.ts):
 *   boss ใช้ซ้อมกู้คืน pepper — อ่านค่า pepper จาก **stdin เท่านั้น** (ห้ามรับเป็น argument เพราะค้างใน
 *   history ของ shell / รายการ process) แล้วพิมพ์ fingerprint 8 ตัวแรกให้เทียบกับหน้า super admin
 *
 *   fingerprint = hex(HMAC-SHA256(key = pepper (ถอด base64 แล้ว), msg = "maewmeet/pepper-fingerprint/v1"))
 *   — ต้องใช้ฟังก์ชันเดียวกับที่แอปใช้เขียนตาราง pepper_fingerprint (R1 จะ import จาก src/lib/auth/** ไม่เขียนซ้ำ)
 *
 * วิธีใช้ที่ R1 จะรองรับ (PowerShell บน Windows — docs/OPERATIONS.md ส่วน D):
 *   Get-Clipboard | npx tsx scripts/pepper-fingerprint.ts
 *
 * กติกาที่ R1 ต้องคงไว้:
 *   - ห้ามสร้าง/สุ่ม pepper ในสคริปต์นี้หรือที่ใดในโค้ด (ADR 0002 §7.1, §7.4 — boss สร้างเองบนเครื่อง)
 *   - ห้ามพิมพ์ค่า pepper ออกทาง stdout/stderr/log · พิมพ์ได้แค่ fingerprint 8 ตัวแรก
 *   - ค่าที่ถอด base64 ได้ < 32 ไบต์ → แจ้งผิดรูปแบบ (เกณฑ์เดียวกับ src/lib/shared/env.ts)
 */

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function main(): Promise<number> {
  if (process.argv.length > 2) {
    console.error("สคริปต์นี้รับ pepper ทาง stdin เท่านั้น — ห้ามส่งเป็น argument");
    return 2;
  }
  if (process.stdin.isTTY) {
    console.error("ส่ง pepper ทาง stdin เช่น: Get-Clipboard | npx tsx scripts/pepper-fingerprint.ts");
    return 2;
  }
  const input = await readStdin();
  if (input.length === 0) {
    console.error("ไม่ได้รับค่าจาก stdin");
    return 2;
  }
  // TODO(R1): ถอด base64 → ตรวจ ≥ 32 ไบต์ → คำนวณ fingerprint ด้วยฟังก์ชันกลางใน src/lib/auth/** → พิมพ์ 8 ตัวแรก
  console.error("ยังไม่พร้อมใช้: การคำนวณ fingerprint จะเพิ่มใน R1 (ADR 0002 §7.2)");
  return 3;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    // ไม่พิมพ์รายละเอียด error — อาจมีค่าจาก stdin ปนอยู่
    console.error("ผิดพลาดระหว่างอ่าน stdin");
    process.exitCode = 1;
  },
);
