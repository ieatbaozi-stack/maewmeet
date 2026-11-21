// view-model ของแชร์นัด/แขก (R18 §S · ADR 0016 · UX R18_SHARE_FLOW) — model ล้วน ไม่แตะ DOM/เครือข่าย
import { describe, expect, it } from 'vitest';
import type { Failure } from '@/components/appointments/api';
import { normalizeHomeItem, normalizeHomeItems, isGuestItem } from '@/components/home/model';
import {
  applyGuestAnswer,
  authHref,
  guestAnswerKey,
  guestLimit,
  guestRsvpClosed,
  joinFailure,
  nextFromSearch,
  othersLinks,
  postAuthDestination,
  previewCountParts,
  shareErrorKey,
  withNext,
} from '@/components/share/model';
import { APPOINTMENT_GUESTS_MAX } from '@/lib/shared/limits';
import th from '../../messages/th.json';
import en from '../../messages/en.json';

const TOKEN = 'Xk3_a-B9zQ1mN2pR4sT6uV'; // 22 ตัว [A-Za-z0-9_-]
const api = (code: string, status = 400): Failure => ({ ok: false, kind: 'api', status, error: { code, key: `errors.${code}`, values: {} } as never, fields: {} });
const network: Failure = { ok: false, kind: 'network' };

describe('previewCountParts — ตัวเลขบนการ์ดลิงก์ (ไม่มีชื่อ)', () => {
  it('ศูนย์ทั้งคู่ = none · อย่างใดอย่างหนึ่งเป็น 0 ซ่อนส่วนนั้น', () => {
    expect(previewCountParts({ going: 0, maybe: 0 })).toEqual({ none: true, going: null, maybe: null });
    expect(previewCountParts({ going: 4, maybe: 0 })).toEqual({ none: false, going: 4, maybe: null });
    expect(previewCountParts({ going: 0, maybe: 2 })).toEqual({ none: false, going: null, maybe: 2 });
    expect(previewCountParts({ going: 4, maybe: 2 })).toEqual({ none: false, going: 4, maybe: 2 });
  });
  it('ค่าผิดปกติ (ติดลบ/NaN) นับเป็น 0', () => {
    expect(previewCountParts({ going: -3, maybe: Number.NaN })).toEqual({ none: true, going: null, maybe: null });
  });
});

describe('next หลัง login/สมัคร (ADR 0016 §3 — allowlist เฉพาะ /i/<token>)', () => {
  it('authHref พก next เฉพาะ token รูปถูกต้อง · เพี้ยน → ลิงก์เปล่า', () => {
    expect(authHref('/login', TOKEN)).toBe(`/login?next=${encodeURIComponent(`/i/${TOKEN}`)}`);
    expect(authHref('/signup', TOKEN)).toBe(`/signup?next=%2Fi%2F${TOKEN}`);
    expect(authHref('/login', 'short')).toBe('/login');
    expect(authHref('/login', `${TOKEN}/../x`)).toBe('/login');
  });
  it('nextFromSearch: path ภายในที่ผ่านเท่านั้น · open redirect ทุกแบบ → "/"', () => {
    expect(nextFromSearch(`/i/${TOKEN}`)).toBe(`/i/${TOKEN}`);
    expect(nextFromSearch([`/i/${TOKEN}`, '/x'])).toBe(`/i/${TOKEN}`);
    for (const bad of [undefined, '', '/', '//evil.com', '/\\evil.com', 'https://evil.com', `/i/${TOKEN}/x`, '/groups', '/i/short', `%2Fi%2F${TOKEN}`, 'javascript:alert(1)', [], ['//x']]) {
      expect(nextFromSearch(bad as string | string[] | undefined), String(bad)).toBe('/');
    }
  });
  it('withNext: ไม่มี next → ลิงก์เปล่า · มี → พกต่อ', () => {
    expect(withNext('/signup', '/')).toBe('/signup');
    expect(withNext('/signup', `/i/${TOKEN}`)).toBe(`/signup?next=${encodeURIComponent(`/i/${TOKEN}`)}`);
  });
  it('postAuthDestination: ต้องเปลี่ยน PIN ก่อนเสมอ (ไม่ว่า next คืออะไร) · ไม่งั้นไป next ที่ตรวจซ้ำ', () => {
    expect(postAuthDestination(true, `/i/${TOKEN}`)).toBe('/set-pin');
    expect(postAuthDestination(false, `/i/${TOKEN}`)).toBe(`/i/${TOKEN}`);
    expect(postAuthDestination(false, '/')).toBe('/');
    expect(postAuthDestination(false, '//evil.com')).toBe('/');
  });
});

describe('joinFailure / shareErrorKey', () => {
  it('รหัสของ POST /api/share/join → หน้าสถานะที่ตรง', () => {
    expect(joinFailure(api('SHARE_FULL', 409))).toBe('full');
    expect(joinFailure(api('SHARE_LINK_EXPIRED', 410))).toBe('expired');
    expect(joinFailure(api('SHARE_LINK_INVALID', 404))).toBe('invalid');
    expect(joinFailure(api('RATE_LIMITED', 429))).toBe('rate');
    expect(joinFailure(api('UNKNOWN', 500))).toBe('error');
    expect(joinFailure(network)).toBe('error');
  });
  it('ข้อความผิดพลาดของ sheet ชวน: ยกเลิก/จบแล้ว/ช้าไป/ทั่วไป · ปิดลิงก์ใช้ revoke', () => {
    expect(shareErrorKey(api('APPOINTMENT_CANCELLED', 409))).toBe('share.error.cancelled');
    expect(shareErrorKey(api('APPOINTMENT_PAST', 409))).toBe('share.error.past');
    expect(shareErrorKey(api('RATE_LIMITED', 429))).toBe('share.error.rate');
    expect(shareErrorKey(api('FORBIDDEN', 403))).toBe('share.error.generic');
    expect(shareErrorKey(network)).toBe('share.error.generic');
    expect(shareErrorKey(api('CONFLICT', 409), 'revoke')).toBe('share.error.revoke');
    expect(shareErrorKey(network, 'revoke')).toBe('share.error.revoke');
  });
  it('คีย์ที่ model อ้างถึงมีทั้ง th/en', () => {
    const get = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((x, k) => (x as Record<string, unknown> | undefined)?.[k], o);
    for (const key of ['share.error.cancelled', 'share.error.past', 'share.error.rate', 'share.error.generic', 'share.error.revoke', 'guests.noReply', 'appointments.rsvp.answer.going', 'appointments.rsvp.answer.maybe', 'appointments.rsvp.answer.not_going']) {
      expect(typeof get(th, key), `th ${key}`).toBe('string');
      expect(typeof get(en, key), `en ${key}`).toBe('string');
    }
  });
});

describe('guestLimit / guestAnswerKey / othersLinks', () => {
  it('เต็มเมื่อถึงเพดาน (10) · ไม่ติดลบ', () => {
    expect(guestLimit(3, 10)).toEqual({ count: 3, max: 10, full: false });
    expect(guestLimit(10, 10).full).toBe(true);
    expect(guestLimit(-2, 10).count).toBe(0);
    expect(guestLimit(APPOINTMENT_GUESTS_MAX).full).toBe(true);
  });
  it('ยังไม่ตอบ = guests.noReply · อย่างอื่นใช้ปุ่ม RSVP เดิม', () => {
    expect(guestAnswerKey(null)).toBe('guests.noReply');
    expect(guestAnswerKey('going')).toBe('appointments.rsvp.answer.going');
    expect(guestAnswerKey('not_going')).toBe('appointments.rsvp.answer.not_going');
  });
  it('othersLinks: เฉพาะลิงก์ที่ไม่ใช่ของฉัน', () => {
    const links = [
      { id: 'a', mine: true, createdBy: null, url: 'https://x/i/a' },
      { id: 'b', mine: false, createdBy: { displayName: 'B' } },
    ];
    expect(othersLinks(links).map((l) => l.id)).toEqual(['b']);
    expect(othersLinks(undefined)).toEqual([]);
  });
});

describe('มุมมองแขก: ปิดตอบ + นับใหม่', () => {
  const open = { status: 'active' as const, isPast: false, permissions: { canRsvp: true } };
  it('guestRsvpClosed: ยกเลิก > ผ่านแล้ว > ไม่มีสิทธิ์ > เปิด', () => {
    expect(guestRsvpClosed({ ...open, status: 'cancelled', isPast: true })).toBe('cancelled');
    expect(guestRsvpClosed({ ...open, isPast: true })).toBe('past');
    expect(guestRsvpClosed({ ...open, permissions: { canRsvp: false } })).toBe('forbidden');
    expect(guestRsvpClosed(open)).toBeNull();
  });
  it('applyGuestAnswer: ย้ายคำตอบเดิมออกจากตัวเลข · ไม่ไป ไม่อยู่ในตัวเลข · คำตอบเดิม = ไม่เปลี่ยน · ไม่ติดลบ', () => {
    const a = { myRsvp: null, counts: { going: 2, maybe: 1 } } as { myRsvp: 'going' | 'maybe' | 'not_going' | null; counts: { going: number; maybe: number } };
    const going = applyGuestAnswer(a, 'going');
    expect(going).toEqual({ myRsvp: 'going', counts: { going: 3, maybe: 1 } });
    expect(applyGuestAnswer(going, 'going')).toBe(going);
    expect(applyGuestAnswer(going, 'maybe')).toEqual({ myRsvp: 'maybe', counts: { going: 2, maybe: 2 } });
    expect(applyGuestAnswer(going, 'not_going')).toEqual({ myRsvp: 'not_going', counts: { going: 2, maybe: 1 } });
    expect(applyGuestAnswer({ myRsvp: 'going', counts: { going: 0, maybe: 0 } }, 'maybe').counts).toEqual({ going: 0, maybe: 1 });
    expect(a.counts).toEqual({ going: 2, maybe: 1 }); // ไม่แก้ค่าที่ส่งเข้า
  });
});

describe('home: การ์ดแขกจาก /api/me/appointments → HomeAppointment', () => {
  const base = { id: 'a1', title: 'หมูกระทะ', placeName: null, lat: null, lng: null, mapUrl: null, startAt: 1, endAt: 2, tz: 'Asia/Bangkok', localDate: '2026-12-06', status: 'active', isPast: false, daysUntil: 3, groupName: 'ก๊วน', groupIcon: null };
  it('แขก: rsvp สร้างจาก myRsvp + counts (ไม่ไป/ยังไม่ตอบ = 0) · groupId ว่าง · viewerKind guest', () => {
    const v = normalizeHomeItem({ ...base, viewerKind: 'guest', myRsvp: 'maybe', counts: { going: 4, maybe: 2 }, invitedBy: 'เฟิร์น', permissions: { canRsvp: true, canLeave: true } });
    expect(v).toMatchObject({ id: 'a1', groupId: '', viewerKind: 'guest', rsvp: { mine: 'maybe', counts: { going: 4, maybe: 2, not_going: 0, noResponse: 0 } } });
    expect(v && 'myRsvp' in v).toBe(false);
    expect(v && isGuestItem(v)).toBe(true);
  });
  it('แขกที่ยังไม่ตอบ/ค่านับผิดปกติ → mine null · นับ 0', () => {
    const v = normalizeHomeItem({ ...base, viewerKind: 'guest', myRsvp: null, counts: { going: -1, maybe: Number.NaN } });
    expect(v?.rsvp).toEqual({ mine: null, counts: { going: 0, maybe: 0, not_going: 0, noResponse: 0 } });
  });
  it('สมาชิก (หรือแถวเก่าไม่มี viewerKind) ผ่านตามเดิม · ค่าที่ไม่ใช่อ็อบเจกต์ถูกข้าม', () => {
    const member = { ...base, groupId: 'g1', rsvp: { counts: { going: 1, maybe: 0, not_going: 0, noResponse: 2 }, mine: 'going' }, viewerKind: 'member' };
    expect(normalizeHomeItem(member)).toBe(member);
    expect(isGuestItem(member as never)).toBe(false);
    expect(normalizeHomeItems([member, null, 'x', 3, undefined])).toEqual([member]);
  });
});
