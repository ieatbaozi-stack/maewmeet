// ตัวกรอง console ของ fixture watchConsole — แยกไฟล์ไม่พึ่ง Playwright เพื่อให้ vitest ทดสอบได้
export type ConsoleProblem = { type: string; text: string; url?: string };

/**
 * 404 ของ /favicon.ico (เบราว์เซอร์ขอเองเมื่อไม่มี route) ไม่ใช่ความผิดของแอป — ไม่นับ
 * เจาะจงเฉพาะ path นี้ (ไม่ใช่ 404 ทุกอย่าง) และเฉพาะ console error ระดับ resource load · CSP/error อื่นยังนับเป็นความผิด
 */
export function isFaviconNotFound(p: ConsoleProblem): boolean {
  if (p.type !== 'error') return false;
  let path: string;
  try {
    path = new URL(p.url ?? '').pathname;
  } catch {
    return false;
  }
  return path === '/favicon.ico' && /status of 404/.test(p.text);
}
