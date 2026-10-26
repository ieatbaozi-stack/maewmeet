// reducer RSVP แบบ optimistic + rollback + กันผลตอบช้า (หน้าหลัก R4B)
import { describe, expect, it } from 'vitest';
import { rsvpFromResponse } from '@/components/home/api';
import { applyChoice, displayRsvp, isCurrentRequest, rsvpErrorKey, rsvpReducer, type RsvpState, type RsvpSummary } from '@/components/home/model';

const base: RsvpSummary = { counts: { going: 4, maybe: 1, not_going: 0, noResponse: 2 }, mine: null };
const going: RsvpSummary = { counts: { going: 5, maybe: 1, not_going: 0, noResponse: 1 }, mine: 'going' };

describe('applyChoice', () => {
  it('ยังไม่ตอบ → ไป: ลด "ยังไม่ตอบ" เพิ่ม "ไป"', () => {
    expect(applyChoice(base, 'going')).toEqual(going);
  });
  it('เปลี่ยนคำตอบ: ถอนอันเดิม ไม่ลด "ยังไม่ตอบ"', () => {
    const r = applyChoice(going, 'maybe');
    expect(r).toEqual({ counts: { going: 4, maybe: 2, not_going: 0, noResponse: 1 }, mine: 'maybe' });
  });
  it('กดคำตอบเดิม = ไม่เปลี่ยน (คืนอ็อบเจ็กต์เดิม)', () => {
    expect(applyChoice(going, 'going')).toBe(going);
  });
  it('ไม่ติดลบแม้ข้อมูลเพี้ยน', () => {
    const odd: RsvpSummary = { counts: { going: 0, maybe: 0, not_going: 0, noResponse: 0 }, mine: 'going' };
    expect(applyChoice(odd, 'maybe').counts).toEqual({ going: 0, maybe: 1, not_going: 0, noResponse: 0 });
    expect(applyChoice({ ...odd, mine: null }, 'going').counts.noResponse).toBe(0);
  });
});

describe('rsvpReducer', () => {
  const choose = (s: RsvpState, c: 'going' | 'maybe' | 'not_going', seq: number) => rsvpReducer(s, { type: 'choose', id: 'a', base, choice: c, seq });

  it('choose → optimistic ทันที + saving + เก็บค่าก่อนกด', () => {
    const s = choose({}, 'going', 1);
    expect(s.a).toMatchObject({ summary: going, saving: 'going', before: base, seq: 1, error: null });
  });
  it('saved → ใช้ค่าจากเซิร์ฟเวอร์ (แทนค่าคาดการณ์) และเลิก saving', () => {
    const server: RsvpSummary = { counts: { going: 6, maybe: 1, not_going: 0, noResponse: 0 }, mine: 'going' };
    const s = rsvpReducer(choose({}, 'going', 1), { type: 'saved', id: 'a', seq: 1, summary: server });
    expect(s.a).toMatchObject({ summary: server, saving: null, before: null, error: null });
  });
  it('failed → ย้อนกลับคำตอบเดิม + ข้อความผิดพลาด', () => {
    const s = rsvpReducer(choose({}, 'going', 1), { type: 'failed', id: 'a', seq: 1, error: 'generic' });
    expect(s.a).toMatchObject({ summary: base, saving: null, error: 'generic' });
    expect(displayRsvp({ id: 'a', rsvp: base }, s).mine).toBeNull();
  });
  it('กดซ้ำระหว่างบันทึก ถูกเมิน (ไม่ซ้อนคำขอ)', () => {
    const s1 = choose({}, 'going', 1);
    expect(choose(s1, 'maybe', 2)).toBe(s1);
  });
  it('ผลของคำขอเก่า (seq ไม่ตรง) ถูกทิ้ง ทั้ง saved และ failed', () => {
    const s1 = choose({}, 'going', 2);
    expect(rsvpReducer(s1, { type: 'saved', id: 'a', seq: 1, summary: base })).toBe(s1);
    expect(rsvpReducer(s1, { type: 'failed', id: 'a', seq: 1, error: 'generic' })).toBe(s1);
  });
  it('ลองใหม่หลังล้มเหลว: ล้างข้อความผิดพลาดตอนกดอีกครั้ง', () => {
    const failed = rsvpReducer(choose({}, 'going', 1), { type: 'failed', id: 'a', seq: 1, error: 'generic' });
    const again = rsvpReducer(failed, { type: 'choose', id: 'a', base, choice: 'going', seq: 2 });
    expect(again.a).toMatchObject({ saving: 'going', error: null, seq: 2 });
  });
  it('forget ลบรายการแก้ในเครื่องเมื่อไม่ได้กำลังบันทึก (หลังรีเฟรชจากเซิร์ฟเวอร์) · ระหว่างบันทึกต้องคงไว้', () => {
    const saving = choose({}, 'going', 1);
    expect(rsvpReducer(saving, { type: 'forget', id: 'a' })).toBe(saving);
    const done = rsvpReducer(saving, { type: 'saved', id: 'a', seq: 1, summary: going });
    expect(rsvpReducer(done, { type: 'forget', id: 'a' })).toEqual({});
  });
  it('เปลี่ยนจากค่าที่บันทึกแล้วเป็นฐานของครั้งถัดไป', () => {
    const done = rsvpReducer(choose({}, 'going', 1), { type: 'saved', id: 'a', seq: 1, summary: going });
    const next = rsvpReducer(done, { type: 'choose', id: 'a', base, choice: 'maybe', seq: 2 });
    expect(next.a?.before).toEqual(going);
    expect(next.a?.summary.counts).toEqual({ going: 4, maybe: 2, not_going: 0, noResponse: 1 });
  });
});

describe('rsvpFromResponse / rsvpErrorKey / isCurrentRequest', () => {
  it('อ่าน counts + mine จากคำตอบ PUT', () => {
    const data = { appointment: { rsvp: { counts: { going: 3, maybe: 1, not_going: 2, noResponse: 0 }, mine: 'maybe', members: {} } } };
    expect(rsvpFromResponse(data)).toEqual({ counts: { going: 3, maybe: 1, not_going: 2, noResponse: 0 }, mine: 'maybe' });
  });
  it('รูปร่างผิด/mine แปลก → null / mine null', () => {
    expect(rsvpFromResponse(undefined)).toBeNull();
    expect(rsvpFromResponse({ appointment: {} })).toBeNull();
    expect(rsvpFromResponse({ appointment: { rsvp: { counts: {}, mine: 'x' } } })?.mine).toBeNull();
  });
  it('รหัสที่นัดปิดแล้ว/ไม่มีสิทธิ์ใช้ข้อความ errors.* · อื่นๆ ใช้ข้อความทั่วไป', () => {
    expect(rsvpErrorKey('APPOINTMENT_CANCELLED')).toBe('errors.APPOINTMENT_CANCELLED');
    expect(rsvpErrorKey('APPOINTMENT_PAST')).toBe('errors.APPOINTMENT_PAST');
    expect(rsvpErrorKey('NOT_FOUND')).toBe('errors.NOT_FOUND');
    expect(rsvpErrorKey('UNKNOWN')).toBe('generic');
    expect(rsvpErrorKey('RATE_LIMITED')).toBe('generic');
  });
  it('คำขอโหลดที่ตามหลัง/หลังถอดคอมโพเนนต์ถูกทิ้ง', () => {
    expect(isCurrentRequest(3, 3, true)).toBe(true);
    expect(isCurrentRequest(2, 3, true)).toBe(false);
    expect(isCurrentRequest(3, 3, false)).toBe(false);
  });
});
