// สร้างค่า Set-Cookie แบบไม่พึ่ง next/headers (เทสต์เรียก handler ตรงได้)
export type CookieSpec = {
  name: string;
  value: string;
  maxAgeSec?: number;
  path?: string;
  sameSite?: 'Lax' | 'Strict' | 'None';
  secure?: boolean;
  httpOnly?: boolean;
};

const TOKEN_RE = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;
const VALUE_RE = /^[A-Za-z0-9!#$%&'()*+\-./:<=>?@[\]^_`{|}~]*$/;

export function serializeCookie(c: CookieSpec): string {
  if (!TOKEN_RE.test(c.name)) throw new Error('invalid cookie name');
  if (!VALUE_RE.test(c.value)) throw new Error('invalid cookie value');
  const parts = [`${c.name}=${c.value}`, `Path=${c.path ?? '/'}`];
  if (c.maxAgeSec !== undefined) parts.push(`Max-Age=${Math.floor(c.maxAgeSec)}`);
  if (c.sameSite) parts.push(`SameSite=${c.sameSite}`);
  if (c.secure) parts.push('Secure');
  if (c.httpOnly) parts.push('HttpOnly');
  return parts.join('; ');
}
