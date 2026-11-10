// R12 §5 — GET /api/appointments/:id/calendar.ics (R12-2 ตารางสถานะ, R12-3 สิทธิ์ระดับ integration, R12-4 header, R12-6 UID ข้ามผู้ใช้)
// เรียก handler จริงตรง ๆ เพราะ Client.call ของ harness แปลง body เป็น JSON เสมอ
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handlerFor, ORIGIN, SESSION_COOKIE } from '../auth/harness';
import { resetEnvCache } from '@/lib/shared/env';
import { Client, DAY, call, join, mustCreate, person, post, setupHarness, world, type ApptDto, type Harness, type Person, type World } from '../appointments/util';

const GHOST = '00000000-0000-4000-8000-000000000000';
const TITLE = 'CANARY-TITLE กินข้าว';
const PLACE = 'CANARY-PLACE สยาม';
const FULL = {
  title: TITLE,
  placeName: PLACE,
  description: 'CANARY-DESC รายละเอียด',
  lat: 13.1234,
  lng: 100.5678,
  mapUrl: 'https://www.openstreetmap.org/?mlat=13.1234&mlon=100.5678',
};

type Got = { status: number; text: string; headers: Headers };

async function ics(c: Client, id: string, opts: { navigate?: boolean; base?: string; site?: string } = {}): Promise<Got> {
  const handler = await handlerFor({ method: 'GET', path: '/api/appointments/:id/calendar.ics' });
  const headers = new Headers({ 'x-real-ip': c.ip, 'user-agent': c.ua });
  if (c.jar.size) headers.set('cookie', c.cookieHeader());
  if (opts.navigate) headers.set('sec-fetch-mode', 'navigate');
  if (opts.site) headers.set('sec-fetch-site', opts.site);
  const res = await handler(new Request(`${opts.base ?? ORIGIN}/api/appointments/${id}/calendar.ics`, { headers }), { params: Promise.resolve({ id }) });
  return { status: res.status, text: await res.text(), headers: res.headers };
}

const expectApi = (r: Got, status: number, code: string) => {
  expect(r.status).toBe(status);
  expect((JSON.parse(r.text) as { error: { code: string } }).error.code).toBe(code);
  expect(r.headers.get('content-type')).toBe('application/json; charset=utf-8');
  expect(r.headers.get('cache-control')).toBe('private, no-store');
};

const expectRedirect = (r: Got, location: string) => {
  expect(r.status).toBe(303);
  expect(r.headers.get('location')).toBe(location);
  expect(r.headers.get('cache-control')).toBe('private, no-store');
  expect(r.text).toBe('');
};

const expectFile = (r: Got) => {
  expect(r.status).toBe(200);
  expect(r.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
  expect(r.text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
};

const unfolded = (text: string) => text.replace(/\r\n /g, '');

let h: Harness;
let w: World;
let ap: ApptDto;
const page = () => `/appointments/${ap.id}`;

async function memberThen(name: string, act: (x: Person) => Promise<void>): Promise<Client> {
  const x = await person(h, name);
  await join(w.a, x, w.gid);
  await act(x);
  return x.c;
}

beforeEach(async () => {
  h = await setupHarness();
  w = await world(h);
  ap = await mustCreate(w.b, w.gid, FULL);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await h.cleanup();
});

describe('R12-2 ตารางสถานะ §5', () => {
  it('สมาชิก นัด active ยังไม่จบ → 200 ไฟล์ ทั้งสองแบบ', async () => {
    expectFile(await ics(w.c.c, ap.id));
    expectFile(await ics(w.c.c, ap.id, { navigate: true }));
  });

  it('ไม่บังคับว่าต้องตอบ "ไป" (§4.1)', async () => {
    expect(ap.rsvp.mine).toBeNull();
    expectFile(await ics(w.c.c, ap.id));
  });

  it('ไม่ได้ล็อกอิน → 401 / 303 หน้านัด', async () => {
    expectApi(await ics(new Client(), ap.id), 401, 'AUTH_REQUIRED');
    expectRedirect(await ics(new Client(), ap.id, { navigate: true }), page());
  });

  it('must_change_pin → 403 / 303 หน้านัด', async () => {
    const c = await memberThen('pin', async (x) => {
      await h.rows('UPDATE user SET must_change_pin = 1 WHERE id = ?', [x.id]);
    });
    expectApi(await ics(c, ap.id), 403, 'PIN_CHANGE_REQUIRED');
    expectRedirect(await ics(c, ap.id, { navigate: true }), page());
  });

  it('ไม่ใช่สมาชิก → 404 / 303 หน้านัด', async () => {
    expectApi(await ics(w.o.c, ap.id), 404, 'NOT_FOUND');
    expectRedirect(await ics(w.o.c, ap.id, { navigate: true }), page());
  });

  it('ถูกนำออก → 404 / 303 หน้านัด', async () => {
    const c = await memberThen('rex', async (x) => {
      expect((await call(w.a.c, 'DELETE', `/api/groups/${w.gid}/members/${x.id}`)).status).toBe(200);
    });
    expectApi(await ics(c, ap.id), 404, 'NOT_FOUND');
    expectRedirect(await ics(c, ap.id, { navigate: true }), page());
  });

  it('ไม่มีนัด → 404 / 303 หน้านัดของ id นั้น', async () => {
    expectApi(await ics(w.c.c, GHOST), 404, 'NOT_FOUND');
    expectRedirect(await ics(w.c.c, GHOST, { navigate: true }), `/appointments/${GHOST}`);
  });

  it.each(['not-a-uuid', '..%2F..%2Fadmin', '//evil.example'])('id ผิดรูป %j → 400 VALIDATION / 303 ไป /', async (id) => {
    expectApi(await ics(w.c.c, id), 400, 'VALIDATION');
    expectRedirect(await ics(w.c.c, id, { navigate: true }), '/');
  });

  it('ยกเลิกแล้ว → 409 APPOINTMENT_CANCELLED / 303 หน้านัด', async () => {
    expect((await post(w.b.c, `/api/appointments/${ap.id}/cancel`)).status).toBe(200);
    expectApi(await ics(w.c.c, ap.id), 409, 'APPOINTMENT_CANCELLED');
    expectRedirect(await ics(w.c.c, ap.id, { navigate: true }), page());
  });

  it('จบแล้ว → 409 APPOINTMENT_PAST / 303 หน้านัด · ขอบ endAt = now นับว่าจบ · ก่อนหน้า 1 ms ยังได้', async () => {
    h.clock.set(ap.endAt - 1);
    expectFile(await ics(w.c.c, ap.id));
    h.clock.set(ap.endAt);
    expectApi(await ics(w.c.c, ap.id), 409, 'APPOINTMENT_PAST');
    expectRedirect(await ics(w.c.c, ap.id, { navigate: true }), page());
  });

  it('กำลังเกิดขึ้น (เริ่มแล้วแต่ยังไม่จบ) ยังได้ไฟล์', async () => {
    h.clock.set(ap.startAt + 1);
    expectFile(await ics(w.c.c, ap.id));
  });
});

describe('R12-3 สิทธิ์', () => {
  it('ผู้สร้าง / admin / moderator / member / super admin นอกกลุ่ม → 200', async () => {
    for (const p of [w.b, w.a, w.m, w.c, w.boss]) expectFile(await ics(p.c, ap.id));
  });

  it('super admin นอกกลุ่ม: เขียน audit appointment.view · สมาชิกไม่เขียน', async () => {
    const count = () => h.count("audit_log WHERE action = 'appointment.view' AND target_id = ?", [ap.id]);
    await ics(w.c.c, ap.id);
    expect(await count()).toBe(0);
    await ics(w.boss.c, ap.id);
    expect(await count()).toBe(1);
  });

  describe('security R12 Low 1: super admin นอกกลุ่มที่ได้ 409 ถูกบันทึกด้วย', () => {
    const count = () => h.count("audit_log WHERE action = 'appointment.view' AND target_id = ?", [ap.id]);

    it('นัดยกเลิกแล้ว: audit +1', async () => {
      expect((await post(w.b.c, `/api/appointments/${ap.id}/cancel`)).status).toBe(200);
      const before = await count();
      expectApi(await ics(w.boss.c, ap.id), 409, 'APPOINTMENT_CANCELLED');
      expect(await count()).toBe(before + 1);
    });

    it('นัดจบแล้ว: audit +1', async () => {
      h.clock.set(ap.endAt);
      const before = await count();
      expectApi(await ics(w.boss.c, ap.id), 409, 'APPOINTMENT_PAST');
      expect(await count()).toBe(before + 1);
    });

    it('สมาชิกที่ได้ 409: ไม่เขียน audit', async () => {
      h.clock.set(ap.endAt);
      expectApi(await ics(w.c.c, ap.id), 409, 'APPOINTMENT_PAST');
      expect(await count()).toBe(0);
    });
  });

  describe('security R12 Low 2: Sec-Fetch-Site', () => {
    const count = () => h.count("audit_log WHERE action = 'appointment.view' AND target_id = ?", [ap.id]);
    const cross = { navigate: true, site: 'cross-site' };

    it('cross-site + navigate: สมาชิก นัด active → 303 หน้านัด ไม่ส่งไฟล์', async () => {
      const r = await ics(w.c.c, ap.id, cross);
      expectRedirect(r, page());
      expect(r.headers.get('content-disposition')).toBeNull();
    });

    it('cross-site + navigate: super admin นอกกลุ่ม → 303 และไม่เกิด audit', async () => {
      expectRedirect(await ics(w.boss.c, ap.id, cross), page());
      expect(await count()).toBe(0);
    });

    it('cross-site + navigate: สมาชิก / คนนอก / ไม่ล็อกอิน / นัดยกเลิก ตอบเหมือนกันทุกไบต์ (เดาสถานะสมาชิกไม่ได้)', async () => {
      const snapshot = (r: Got) => ({ status: r.status, text: r.text, headers: [...r.headers.entries()] });
      const member = snapshot(await ics(w.c.c, ap.id, cross));
      expect(snapshot(await ics(w.o.c, ap.id, cross))).toEqual(member);
      expect(snapshot(await ics(new Client(), ap.id, cross))).toEqual(member);
      expect((await post(w.b.c, `/api/appointments/${ap.id}/cancel`)).status).toBe(200);
      expect(snapshot(await ics(w.c.c, ap.id, cross))).toEqual(member);
      expect(member.text + JSON.stringify(member.headers)).not.toMatch(/CANARY|13\.1234|100\.5678/);
    });

    it('cross-site + navigate + id ผิดรูป → 303 ไป / ตามแถว id ผิดรูป (ไม่มี id ให้พาไป)', async () => {
      expectRedirect(await ics(w.c.c, 'not-a-uuid', cross), '/');
    });

    it.each(['same-origin', 'same-site', 'none', undefined])('Sec-Fetch-Site = %s + navigate: เหมือนเดิม (สมาชิกได้ไฟล์ · คนนอก 303)', async (site) => {
      expectFile(await ics(w.c.c, ap.id, { navigate: true, site }));
      expectRedirect(await ics(w.o.c, ap.id, { navigate: true, site }), page());
    });

    it('super admin แบบ same-origin ยังเกิด audit', async () => {
      expectFile(await ics(w.boss.c, ap.id, { navigate: true, site: 'same-origin' }));
      expect(await count()).toBe(1);
    });

    it.each(['cross-site', 'same-origin', 'same-site', 'none', undefined])('Sec-Fetch-Site = %s แบบไม่ navigate: เหมือนเดิม', async (site) => {
      expectFile(await ics(w.c.c, ap.id, { site }));
      expectApi(await ics(w.o.c, ap.id, { site }), 404, 'NOT_FOUND');
    });
  });

  it('suspended → 401 ACCOUNT_SUSPENDED / 303', async () => {
    const c = await memberThen('sue', async (x) => {
      await h.rows("UPDATE user SET status = 'suspended' WHERE id = ?", [x.id]);
    });
    const api = await ics(c, ap.id);
    expect(api.status).toBe(401);
    expectRedirect(await ics(c, ap.id, { navigate: true }), page());
  });

  it('404 ของคนนอกกับนัดที่ไม่มี เหมือนกันทุกไบต์รวม header', async () => {
    const outsider = await ics(w.o.c, ap.id);
    const missing = await ics(w.o.c, GHOST);
    expect(outsider.status).toBe(404);
    expect(outsider.text).toBe(missing.text);
    expect([...outsider.headers.entries()]).toEqual([...missing.headers.entries()]);
  });

  it('404 ของคนนอกต่อนัดที่ยกเลิก/จบแล้ว เหมือนนัดที่ไม่มี (ไม่รั่วสถานะด้วย 409)', async () => {
    const missing = await ics(w.o.c, GHOST);
    expect((await post(w.b.c, `/api/appointments/${ap.id}/cancel`)).status).toBe(200);
    const cancelled = await ics(w.o.c, ap.id);
    expect(cancelled.status).toBe(404);
    expect(cancelled.text).toBe(missing.text);
    const other = await mustCreate(w.b, w.gid, { startDate: '2026-10-25', endDate: '2026-10-25' });
    h.clock.set(other.endAt + DAY);
    const past = await ics(w.o.c, other.id);
    expect(past.status).toBe(404);
    expect(past.text).toBe((await ics(w.o.c, GHOST)).text);
  });

  it('redirect ของคนนอกต่างจากนัดที่ไม่มีแค่ id ใน Location', async () => {
    const strip = (r: Got) => ({ status: r.status, text: r.text, headers: [...r.headers.entries()].map(([k, v]) => [k, v.replace(/[0-9a-f-]{36}/, '<id>')]) });
    expect(strip(await ics(w.o.c, ap.id, { navigate: true }))).toEqual(strip(await ics(w.o.c, GHOST, { navigate: true })));
  });

  it('response ที่ไม่สำเร็จไม่มีข้อมูลนัด ทั้งแบบ API และ navigate', async () => {
    const pin = await memberThen('pin', async (x) => {
      await h.rows('UPDATE user SET must_change_pin = 1 WHERE id = ?', [x.id]);
    });
    const attempts: Got[] = [];
    for (const navigate of [false, true]) {
      attempts.push(await ics(new Client(), ap.id, { navigate }), await ics(pin, ap.id, { navigate }), await ics(w.o.c, ap.id, { navigate }));
    }
    expect((await post(w.b.c, `/api/appointments/${ap.id}/cancel`)).status).toBe(200);
    attempts.push(await ics(w.c.c, ap.id), await ics(w.c.c, ap.id, { navigate: true }));
    for (const r of attempts) {
      expect(r.status).toBeGreaterThanOrEqual(303);
      expect(r.text + JSON.stringify([...r.headers.entries()])).not.toMatch(/CANARY|13\.1234|100\.5678/);
    }
  });

  it('เปิดจากลิงก์ด้วย Sec-Fetch-Mode อื่น = แบบ API (ไม่ redirect)', async () => {
    const handler = await handlerFor({ method: 'GET', path: '/api/appointments/:id/calendar.ics' });
    const res = await handler(new Request(`${ORIGIN}/api/appointments/${ap.id}/calendar.ics`, { headers: { 'sec-fetch-mode': 'cors' } }), { params: Promise.resolve({ id: ap.id }) });
    expect(res.status).toBe(401);
  });
});

describe('R12-4 header', () => {
  const expectHeaders = (r: Got) => {
    expect(r.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="maewmeet-plan.ics"');
    expect(r.headers.get('cache-control')).toBe('private, no-store');
  };

  it('ตรง §5', async () => {
    expectHeaders(await ics(w.c.c, ap.id));
  });

  it.each([
    ['อัญประกาศ', 'a"b'],
    ['ขึ้นบรรทัด', 'x\r\nX-Evil: 1'],
    ['ภาษาไทย', 'นัดกินข้าวกับแก๊ง'],
    ['path', '../../etc/passwd'],
  ])('ชื่อไฟล์คงที่แม้ชื่อนัดมี %s', async (_name, title) => {
    await h.rows('UPDATE appointment SET title = ? WHERE id = ?', [title, ap.id]);
    const r = await ics(w.c.c, ap.id);
    expectHeaders(r);
    expect(r.headers.get('x-evil')).toBeNull();
    expect(unfolded(r.text).split('\r\n').filter((l) => l.startsWith('X-Evil'))).toEqual([]);
  });

  it('body เป็น UTF-8 ไม่มี BOM · CRLF ทุกบรรทัด', async () => {
    const handler = await handlerFor({ method: 'GET', path: '/api/appointments/:id/calendar.ics' });
    const res = await handler(new Request(`${ORIGIN}/api/appointments/${ap.id}/calendar.ics`, { headers: { cookie: w.c.c.cookieHeader() } }), { params: Promise.resolve({ id: ap.id }) });
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.subarray(0, 5))).toEqual([0x42, 0x45, 0x47, 0x49, 0x4e]); // BEGIN
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
});

describe('เนื้อหาไฟล์', () => {
  it('มีเวลา/ชื่อ/สถานที่/ลิงก์นัด/ลิงก์แผนที่ · ไม่มีรายละเอียด/lat-lng แยก/ชื่อกลุ่ม/ชื่อสมาชิก', async () => {
    const text = unfolded((await ics(w.c.c, ap.id)).text);
    expect(text).toContain(`UID:${ap.id}@maewmeet\r\n`);
    expect(text).toContain('DTSTART;TZID=Asia/Bangkok:20261024T100000\r\n'); // tz ของนัด
    expect(text).toContain('DTEND;TZID=Asia/Bangkok:20261024T110000\r\n');
    expect(text).toContain('TZID:Asia/Bangkok\r\n');
    expect(text).toContain('TZOFFSETTO:+0700\r\n');
    expect(text).toContain('DTSTAMP:20261018T030000Z\r\n'); // now ของ request จาก clock
    expect(text).toContain(`SUMMARY:${TITLE}\r\n`);
    expect(text).toContain(`LOCATION:${PLACE}\r\n`);
    // R13 §1.4: URL = ลิงก์แผนที่ · DESCRIPTION มีป้ายตามภาษาในบัญชี (ดีฟอลต์ไทย)
    expect(text).toContain(`DESCRIPTION:แผนที่: ${FULL.mapUrl}\\nดูนัดในแมวเจอกัน: ${ORIGIN}/appointments/${ap.id}\r\n`);
    expect(text).toContain(`URL:${FULL.mapUrl}\r\n`);
    expect(text).not.toMatch(/^GEO/m);
    // พิกัดมีได้เฉพาะในลิงก์แผนที่ · ตัดลิงก์ออกแล้วต้องไม่เหลือ
    expect(text.split(FULL.mapUrl).join('')).not.toMatch(/CANARY-DESC|13\.1234|100\.5678|openstreetmap|ก๊วนแมว|ชื่อ bob|ชื่อ alice/);
  });

  it('R13-5: นัดไม่มีลิงก์แผนที่ DESCRIPTION มีแค่บรรทัดลิงก์นัด (มีป้าย) · URL = ลิงก์นัด', async () => {
    const other = await mustCreate(w.b, w.gid);
    const text = unfolded((await ics(w.c.c, other.id)).text);
    expect(text).toContain(`DESCRIPTION:ดูนัดในแมวเจอกัน: ${ORIGIN}/appointments/${other.id}\r\n`);
    expect(text).toContain(`URL:${ORIGIN}/appointments/${other.id}\r\n`);
  });

  it('R13-5: ป้ายตามภาษาในบัญชีของผู้ดาวน์โหลด (en) ไม่ใช่ของผู้สร้างนัด', async () => {
    await h.rows("UPDATE user SET locale = 'en' WHERE id = ?", [w.c.id]);
    const en = unfolded((await ics(w.c.c, ap.id)).text);
    expect(en).toContain(`DESCRIPTION:Map: ${FULL.mapUrl}\\nSee the plan in maewmeet: ${ORIGIN}/appointments/${ap.id}\r\n`);
    expect(en).toContain(`URL:${FULL.mapUrl}\r\n`);
    // ผู้ใช้อื่นที่ยังเป็น th ได้ป้ายไทย
    expect(unfolded((await ics(w.a.c, ap.id)).text)).toContain(`DESCRIPTION:แผนที่: ${FULL.mapUrl}\\nดูนัดในแมวเจอกัน: `);
  });

  it('R12.1-4: แถวเก่าใน DB ที่ mapUrl ไม่ใช่ https ไม่ถูกใส่ (ทั้ง DESCRIPTION และ URL)', async () => {
    await h.rows('UPDATE appointment SET map_url = ? WHERE id = ?', ['javascript:alert(1)', ap.id]);
    const text = unfolded((await ics(w.c.c, ap.id)).text);
    expect(text).toContain(`DESCRIPTION:ดูนัดในแมวเจอกัน: ${ORIGIN}/appointments/${ap.id}\r\n`);
    expect(text).toContain(`URL:${ORIGIN}/appointments/${ap.id}\r\n`);
    expect(text).not.toContain('javascript');
  });

  it('R13-5: แถวเก่าใน DB ที่ mapUrl เป็น https แต่มี CRLF → URL ใช้ลิงก์นัด ไม่แทรกบรรทัด', async () => {
    await h.rows('UPDATE appointment SET map_url = ? WHERE id = ?', ['https://maps.example/x\r\nATTENDEE:mailto:a@b.test', ap.id]);
    const text = unfolded((await ics(w.c.c, ap.id)).text);
    expect(text).toContain(`URL:${ORIGIN}/appointments/${ap.id}\r\n`);
    expect(text.split('\r\n').filter((l) => l.startsWith('ATTENDEE'))).toEqual([]);
  });

  it('R12.1-6: ใช้ tz ของแถวนัด ไม่ใช่ค่าตายตัว', async () => {
    await h.rows('UPDATE appointment SET tz = ? WHERE id = ?', ['Asia/Tokyo', ap.id]);
    const text = unfolded((await ics(w.c.c, ap.id)).text);
    expect(text).toContain('DTSTART;TZID=Asia/Tokyo:20261024T120000\r\n');
    expect(text).toContain('TZOFFSETTO:+0900\r\n');
  });

  it('ไม่มีสถานที่ = ไม่มีบรรทัด LOCATION', async () => {
    const other = await mustCreate(w.b, w.gid);
    expect(unfolded((await ics(w.c.c, other.id)).text)).not.toMatch(/^LOCATION/m);
  });

  it('R12-6: UID เดียวกันข้ามผู้ใช้ และหลังแก้เวลานัด', async () => {
    const uid = (t: string) => unfolded(t).split('\r\n').find((l) => l.startsWith('UID:'));
    const a = uid((await ics(w.a.c, ap.id)).text);
    const c = uid((await ics(w.c.c, ap.id)).text);
    expect(a).toBe(`UID:${ap.id}@maewmeet`);
    expect(c).toBe(a);
    const moved = await call(w.b.c, 'PATCH', `/api/appointments/${ap.id}`, { startDate: '2026-10-25', startTime: '10:00', endDate: '2026-10-25', endTime: '11:00' });
    expect(moved.status).toBe(200);
    expect(uid((await ics(w.a.c, ap.id)).text)).toBe(a);
  });

  it('ชื่อที่มี CRLF ในฐาน ไม่แทรกบรรทัดใหม่ และถูกทำความสะอาดเหมือน DTO', async () => {
    await h.rows('UPDATE appointment SET title = ?, place_name = ? WHERE id = ?', ['x\r\nATTENDEE:mailto:a@b.test', 'y\r\nORGANIZER:z', ap.id]);
    const text = unfolded((await ics(w.c.c, ap.id)).text);
    expect(text.split('\r\n').filter((l) => /^(ATTENDEE|ORGANIZER)/.test(l))).toEqual([]);
  });

  it('dev ที่ไม่มี APP_ORIGIN ใช้ origin ของ request', async () => {
    const saved = process.env.APP_ORIGIN;
    delete process.env.APP_ORIGIN;
    resetEnvCache();
    try {
      const text = unfolded((await ics(w.c.c, ap.id, { base: 'http://localhost:3000' })).text);
      // R13: URL เป็นลิงก์แผนที่ ลิงก์นัดอยู่ใน DESCRIPTION
      expect(text).toContain(`ดูนัดในแมวเจอกัน: http://localhost:3000/appointments/${ap.id}\r\n`);
    } finally {
      process.env.APP_ORIGIN = saved;
      resetEnvCache();
    }
  });
});

describe('ขั้นตอนเดิมของ route() ยังครบ', () => {
  it('ต่ออายุคุกกี้ session บนคำตอบที่เป็นไฟล์', async () => {
    const far = await mustCreate(w.c, w.gid, { startDate: '2026-12-20', endDate: '2026-12-20' });
    h.clock.advance(31 * DAY);
    const r = await ics(w.c.c, far.id);
    expectFile(r);
    const cookies = r.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(true);
  });

  it('ไม่ log ชื่อนัด/สถานที่ ทั้งกรณีสำเร็จและไม่สำเร็จ', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    await ics(w.c.c, ap.id);
    await ics(w.o.c, ap.id);
    await ics(new Client(), ap.id, { navigate: true });
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(logged).not.toMatch(/CANARY|กินข้าว|สยาม/);
  });
});
