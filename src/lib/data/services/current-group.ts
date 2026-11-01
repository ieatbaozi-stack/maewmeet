// service: จำกลุ่มปัจจุบันของเครื่อง (คุกกี้ mm_group) — R6D G1 · ADR 0009 §5
//  - loadGroupCtx (1 query) → authorize บรรทัดแรก: ต้องเป็น "สมาชิกจริง" ของกลุ่มที่ยังไม่ถูกลบ
//    action = member.setOwnAppearance (กฎเดียวกันทุกช่อง: ค่าตั้งส่วนตัวของสมาชิกในกลุ่ม — สมาชิกทุก role ✅ · SA ที่ไม่ใช่สมาชิก FORBIDDEN ·
//    คนนอก/กลุ่มไม่มี/ลบแล้ว NOT_FOUND เหมือนกันทุกไบต์ · must_change_pin/suspended ถูกตัดใน can()) — ไม่มีการเช็ก role กระจายในไฟล์นี้
//  - ไม่ผ่าน → ไม่ตั้งคุกกี้ (error ออกจาก route wrapper ก่อนถึง Set-Cookie) · ผ่าน → limiter ต่อผู้ใช้ แล้วคืนคุกกี้ให้ route ใส่ใน reply
//  - ไม่ audit (ค่าแสดงผลส่วนตัวของเครื่อง ไม่ใช่ข้อมูลกลุ่ม — แบบเดียวกับ appearance R6C) · ค่า gid ไม่ถูก log
import { z } from 'zod';
import { authorize } from '@/lib/rbac/can';
import type { Actor } from '@/lib/rbac/types';
import { currentGroupCookie, type CurrentGroupCookie } from '@/lib/shared/current-group-cookie';
import { CURRENT_GROUP_RATE_LIMIT } from '@/lib/shared/limits';
import { takeUserSlot } from '../admin-input';
import type { DataCtx } from '../context';
import { loadGroupCtx } from '../policy-context';
import { asUser } from './group-common';

/** body ของ PUT /api/me/current-group — { gid: uuid } เท่านั้น (strict) */
export const currentGroupInputSchema = z.object({ gid: z.uuid() }).strict();
export type CurrentGroupInput = z.output<typeof currentGroupInputSchema>;

export async function rememberCurrentGroup(actor: Actor, input: CurrentGroupInput, ctx: DataCtx): Promise<{ result: { ok: true }; cookies: CurrentGroupCookie[] }> {
  const group = await loadGroupCtx(ctx.db, actor, input.gid);
  authorize(actor, 'member.setOwnAppearance', { type: 'group', group });
  const me = asUser(actor);
  await takeUserSlot(ctx.db, CURRENT_GROUP_RATE_LIMIT, me.id, ctx.now);
  return { result: { ok: true }, cookies: [currentGroupCookie(input.gid)] };
}
