// service: แชร์นัดให้คนนอกกลุ่ม — R18 §S1–S6 · ADR 0016 §3–§8
//  - authorize() ก่อนแตะข้อมูลทุกฟังก์ชัน (โหลดบริบทผ่าน helper ในไฟล์นี้ → policy-context เท่านั้น)
//  - ความถูกต้องของลิงก์/หมดอายุ/เต็ม/แขกที่ถูกนำออก ไม่ใช่งานของ can() — ตัดสินที่นี่:
//      404 SHARE_LINK_INVALID (body เดียวกันทุกเหตุ: ผิดรูป/ไม่มี/ยกเลิก/ผู้สร้างออก/แขกที่ถูกนำออก) · 410 SHARE_LINK_EXPIRED (ไม่บอกเหตุผล) · 409 SHARE_FULL { max }
//  - การเขียนที่แข่งกันได้ = คำสั่ง SQL เดียวมีเงื่อนไขในตัว (repos/share-link.ts, repos/appointment-guest.ts) ใน inTx
//  - ห้าม log/คืน/บันทึก token หรือ hash: token สร้างจาก id ตอนตอบเท่านั้น · audit meta มีแค่ id
import { z } from 'zod';
import { ipHashOf, ipRateSpec, rateKey, SHARE_RATE_LIMITS, type RateCheck } from '@/lib/auth/throttle';
import { takeResolvedSessionUser } from '@/lib/auth/session';
import { deleteGuestSelf, findActiveGuest, markGuestRemovedGuarded, setGuestResponseIfOpen } from '@/lib/data/repos/appointment-guest';
import { findActiveShareLinkOf, findShareByTokenHash, findShareLinkAccess, insertGuestIfAllowed, insertShareLinkIfAllowed, revokeShareLinkGuarded } from '@/lib/data/repos/share-link';
import { findUserById } from '@/lib/data/repos/user';
import { authorize, can } from '@/lib/rbac/can';
import type { Actor, AppointmentGuestResource, UserActor } from '@/lib/rbac/types';
import { AppError, isAppError } from '@/lib/shared/errors';
import { newId } from '@/lib/shared/id';
import { APPOINTMENT_GUESTS_MAX, APPOINTMENT_WRITE_RATE_LIMITS } from '@/lib/shared/limits';
import { sanitizeDisplayText } from '@/lib/shared/name-rules';
import type { DbOrTx } from '@/db/client';
import type { DataCtx } from '../context';
import { notify } from '../notifications/notify';
import { loadAppointmentCtx, loadGuestTargetCtx, loadShareLinkCtx, type AppointmentCtx, type GuestTargetCtx, type ShareLinkCtx } from '../policy-context';
import { takeSlots } from '../rate-slots';
import { toSharePreviewDto, type GuestAppointmentDto, type SharePreviewDto } from '../serializers/share';
import { hashShareToken, parseShareToken, shareTokenFor } from '../share-token';
import { inTx } from '../tx';
import { appointmentIcsText } from './appointments';
import { asUser, audit } from './group-common';
import { guestDetailDto, shareUrlOf } from './share-views';

const idField = z.uuid();
export const shareAppointmentParamsSchema = z.object({ id: idField });
export const shareLinkParamsSchema = z.object({ id: idField, lid: idField });
export const guestTargetParamsSchema = z.object({ id: idField, uid: idField });
/** token อยู่ใน body (ไม่อยู่ใน path ของ API) · รูปจริงตรวจด้วย parseShareToken หลังจองช่อง rate limit */
export const joinShareInputSchema = z.object({ token: z.string().max(64) }).strict();
export type JoinShareInput = z.output<typeof joinShareInputSchema>;
export const guestRsvpInputSchema = z.object({ response: z.enum(['going', 'maybe', 'not_going']) }).strict();
export type GuestRsvpInput = z.output<typeof guestRsvpInputSchema>;

const NONE = { type: 'none' } as const;
const userSlot = (spec: RateCheck['spec'], userId: string): RateCheck => ({ spec, key: rateKey(spec, userId) });

// ───────── บริบท (อ่านอย่างเดียวก่อน authorize — สร้าง resource ให้ can()) ─────────
const appointmentFor = (actor: Actor, id: string, ctx: DataCtx): Promise<AppointmentCtx> => loadAppointmentCtx(ctx.db, actor, id);
const shareLinkFor = (actor: Actor, id: string, lid: string, ctx: DataCtx): Promise<ShareLinkCtx> => loadShareLinkCtx(ctx.db, actor, id, lid);
const guestTargetFor = (actor: Actor, id: string, uid: string, ctx: DataCtx): Promise<GuestTargetCtx> => loadGuestTargetCtx(ctx.db, actor, id, uid);
const apptRes = (c: AppointmentCtx) => ({ type: 'appointment', group: c.group, createdBy: c.appointment?.createdBy ?? '' }) as const;
const guestRes = (c: AppointmentCtx): AppointmentGuestResource => ({ type: 'appointmentGuest', group: c.group, isGuest: c.isGuest });

/** ไม่ได้แถวทั้งที่ผ่านด่านแล้ว — วินิจฉัยด้วยการอ่านใหม่ (การเขียนถูกปฏิเสธไปแล้ว ไม่มีผลต่อความปลอดภัย) */
async function whyMemberWriteRejected(db: DbOrTx, me: UserActor, id: string, now: number): Promise<AppError> {
  const again = await loadAppointmentCtx(db, me, id);
  if (!again.appointment || again.group.deleted || again.group.actorRole === null) return new AppError('NOT_FOUND');
  if (again.appointment.status === 'cancelled') return new AppError('APPOINTMENT_CANCELLED');
  if (again.appointment.endAt <= now) return new AppError('APPOINTMENT_PAST');
  return new AppError('CONFLICT');
}

// ───────── S1: สร้างลิงก์ (get-or-create) ─────────
export type CreatedShareLinkDto = { url: string; linkId: string; createdAt: number; reused: boolean };

export async function createShareLink(actor: Actor, appointmentId: string, ctx: DataCtx): Promise<CreatedShareLinkDto> {
  const c = await appointmentFor(actor, appointmentId, ctx);
  const allow = authorize(actor, 'appointment.share.create', apptRes(c));
  const me = asUser(actor);
  const row = c.appointment!;
  const { db, now } = ctx;
  if (row.status === 'cancelled') throw new AppError('APPOINTMENT_CANCELLED');
  if (row.endAt <= now) throw new AppError('APPOINTMENT_PAST');
  await takeSlots(db, [userSlot(SHARE_RATE_LIMITS.createUser, me.id)], now);
  const candidate = newId();
  const { link, created } = await inTx(db, async (tx) => {
    const made = await insertShareLinkIfAllowed(
      tx,
      { id: candidate, appointmentId, createdBy: me.id, tokenHash: hashShareToken(shareTokenFor(candidate, ctx.appSecret), ctx.appSecret) },
      now,
    );
    const active = await findActiveShareLinkOf(tx, appointmentId, me.id);
    if (!active) throw await whyMemberWriteRejected(tx, me, appointmentId, now);
    if (made) {
      await audit(tx, me, allow, { action: 'appointment.share.create', targetType: 'appointment', targetId: appointmentId, groupId: row.groupId, meta: { linkId: active.id } }, now);
    }
    return { link: active, created: made };
  });
  return { url: shareUrlOf(ctx, link.id), linkId: link.id, createdAt: link.createdAt, reused: !created };
}

// ───────── S2: ยกเลิกลิงก์ ─────────
export async function revokeShareLink(actor: Actor, appointmentId: string, linkId: string, ctx: DataCtx): Promise<{ revoked: true }> {
  const l = await shareLinkFor(actor, appointmentId, linkId, ctx);
  const allow = authorize(actor, 'appointment.share.revoke', l.resource);
  const me = asUser(actor);
  const { db, now } = ctx;
  const group = l.resource.group;
  await takeSlots(db, [userSlot(SHARE_RATE_LIMITS.revokeUser, me.id)], now);
  await inTx(db, async (tx) => {
    const ok = await revokeShareLinkGuarded(tx, { linkId, appointmentId, groupId: group.id, revokedBy: me.id }, { actorId: me.id, actorRole: group.actorRole }, now);
    if (!ok) {
      const again = await findShareLinkAccess(tx, appointmentId, linkId, me.id);
      throw new AppError(again && !again.groupDeleted ? 'CONFLICT' : 'NOT_FOUND');
    }
    await audit(tx, me, allow, { action: 'appointment.share.revoke', targetType: 'appointment', targetId: appointmentId, groupId: group.id, meta: { linkId, reason: 'manual' } }, now);
  });
  return { revoked: true };
}

// ───────── S3: หน้าเปิดลิงก์ /i/<token> (เรียกจาก server component — ไม่มี API route) ─────────
/**
 * - `preview`      : การ์ดนัด (state ok | full) · signedIn = ผู้เปิดล็อกอินอยู่ (แสดงปุ่ม "เพิ่มนัดนี้" แทน login/สมัคร)
 * - `member|guest` : ผู้เปิดเป็นสมาชิก/แขกของนัดอยู่แล้ว → หน้าควร redirect('/appointments/<id>')
 * - `invalid`      : 404 เดียวกันทุกเหตุ · `expired`: 410 ไม่บอกเหตุผล — ทั้งสองไม่มีรายละเอียดนัด/กลุ่ม/เวลา
 * - `rateLimited`  : เกิน share:view:ip — ไม่มีข้อมูลนัด · `pinChangeRequired`: ผู้ใช้ต้องเปลี่ยน PIN ก่อน (หน้าพาไป /set-pin)
 * GET ไม่สร้างแถวใด ๆ (นอกจากถัง rate limit) · ไม่ audit
 */
export type SharePageDto =
  | { kind: 'preview'; preview: SharePreviewDto; signedIn: boolean }
  | { kind: 'member' | 'guest'; appointmentId: string }
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | { kind: 'rateLimited'; retryAfterSec: number }
  | { kind: 'pinChangeRequired' };

export async function getSharePage(actor: Actor, rawToken: unknown, ctx: DataCtx): Promise<SharePageDto> {
  // PUBLIC: บัญชีที่ถูกระงับ/ไม่ active ดูได้เท่าคนไม่ล็อกอิน · ติดเปลี่ยน PIN → ไปเปลี่ยนก่อน
  const d = can(actor, 'appointment.share.preview', NONE);
  if (!d.allow && d.code === 'PIN_CHANGE_REQUIRED') return { kind: 'pinChangeRequired' };
  const viewer: Actor = d.allow ? actor : { kind: 'anonymous' };
  authorize(viewer, 'appointment.share.preview', NONE);
  const { db, now } = ctx;
  const ipSpec = ipRateSpec(SHARE_RATE_LIMITS.viewIp, ctx.req);
  try {
    await takeSlots(db, [{ spec: ipSpec, key: rateKey(ipSpec, ipHashOf(ctx.req, ctx.appSecret)) }], now);
  } catch (e) {
    if (isAppError(e) && e.code === 'RATE_LIMITED') return { kind: 'rateLimited', retryAfterSec: e.retryAfterSec ?? 60 };
    throw e;
  }
  const token = parseShareToken(rawToken);
  if (!token) return { kind: 'invalid' };
  const viewerId = viewer.kind === 'user' ? viewer.id : null;
  const s = await findShareByTokenHash(db, hashShareToken(token, ctx.appSecret), viewerId, now);
  if (!s || !s.intact) return { kind: 'invalid' };
  if (!s.viewerIsMember && s.viewerGuest === 'removed') return { kind: 'invalid' };
  if (!s.open) return { kind: 'expired' };
  if (s.viewerIsMember) return { kind: 'member', appointmentId: s.appointmentId };
  if (s.viewerGuest === 'active') return { kind: 'guest', appointmentId: s.appointmentId };
  return {
    kind: 'preview',
    signedIn: viewerId !== null,
    preview: toSharePreviewDto({ ...s, full: s.activeGuests >= APPOINTMENT_GUESTS_MAX, inviterName: s.inviterName }),
  };
}

// ───────── S4/S5: เข้าเป็นแขก ─────────
export type JoinShareResultDto = { status: 'guest' | 'member'; appointmentId: string; joined: boolean };

export async function joinShare(actor: Actor, input: JoinShareInput, ctx: DataCtx): Promise<JoinShareResultDto> {
  const allow = authorize(actor, 'appointment.guest.join', NONE);
  const me = asUser(actor);
  const { db, now } = ctx;
  // จองก่อนแตะ token (IP แล้วผู้ใช้) — นับเฉพาะ token ใช้ไม่ได้ (404/410): สำเร็จ/สมาชิก/แขกอยู่แล้ว/เต็ม คืนช่อง
  const ipSpec = ipRateSpec(SHARE_RATE_LIMITS.joinIp, ctx.req);
  const refundJoin = await takeSlots(db, [{ spec: ipSpec, key: rateKey(ipSpec, ipHashOf(ctx.req, ctx.appSecret)) }, userSlot(SHARE_RATE_LIMITS.joinUser, me.id)], now);
  const token = parseShareToken(input.token);
  if (!token) throw new AppError('SHARE_LINK_INVALID');
  const tokenHash = hashShareToken(token, ctx.appSecret);
  // ถังเข้า/ออก (share:guest:u) — นับเฉพาะครั้งที่เข้าได้จริง
  let refundGuest: () => Promise<void>;
  try {
    refundGuest = await takeSlots(db, [userSlot(SHARE_RATE_LIMITS.guestUser, me.id)], now);
  } catch (e) {
    await refundJoin();
    throw e;
  }
  let result: JoinShareResultDto;
  try {
    result = await inTx(db, async (tx): Promise<JoinShareResultDto> => {
      const joined = await insertGuestIfAllowed(tx, { tokenHash, userId: me.id, max: APPOINTMENT_GUESTS_MAX }, now);
      if (joined) {
        await audit(
          tx,
          me,
          allow,
          { action: 'appointment.guest.join', targetType: 'appointment', targetId: joined.appointmentId, groupId: joined.groupId, meta: { linkId: joined.linkId, invitedBy: joined.invitedBy } },
          now,
        );
        return { status: 'guest', appointmentId: joined.appointmentId, joined: true };
      }
      // วินิจฉัยในธุรกรรมเดียวกัน — ลิงก์เสียก่อน (404) → สมาชิก → ถูกนำออก (404) → แขกอยู่แล้ว → หมดอายุ (410) → เต็ม (409)
      const s = await findShareByTokenHash(tx, tokenHash, me.id, now);
      if (!s || !s.intact) throw new AppError('SHARE_LINK_INVALID');
      if (s.viewerIsMember) return { status: 'member', appointmentId: s.appointmentId, joined: false };
      if (s.viewerGuest === 'removed') throw new AppError('SHARE_LINK_INVALID');
      if (s.viewerGuest === 'active') return { status: 'guest', appointmentId: s.appointmentId, joined: false };
      if (!s.open) throw new AppError('SHARE_LINK_EXPIRED');
      if (s.activeGuests >= APPOINTMENT_GUESTS_MAX) throw new AppError('SHARE_FULL', { max: APPOINTMENT_GUESTS_MAX });
      throw new AppError('CONFLICT');
    });
  } catch (e) {
    await refundGuest();
    if (isAppError(e) && (e.code === 'SHARE_FULL' || e.code === 'CONFLICT')) await refundJoin();
    throw e;
  }
  if (!result.joined) await refundGuest();
  await refundJoin();
  return result;
}

// ───────── มุมมอง/การกระทำของแขก ─────────
export async function getGuestAppointment(actor: Actor, appointmentId: string, ctx: DataCtx): Promise<{ appointment: GuestAppointmentDto }> {
  const c = await appointmentFor(actor, appointmentId, ctx);
  authorize(actor, 'appointment.guest.view', guestRes(c));
  const me = asUser(actor);
  return { appointment: await guestDetailDto(ctx.db, me.id, ctx.now, c) };
}

export async function getGuestAppointmentIcs(actor: Actor, appointmentId: string, appOrigin: string, ctx: DataCtx): Promise<string> {
  const c = await appointmentFor(actor, appointmentId, ctx);
  authorize(actor, 'appointment.guest.view', guestRes(c));
  const me = asUser(actor);
  return appointmentIcsText(c.appointment!, me.id, appOrigin, ctx);
}

export async function setGuestRsvp(actor: Actor, appointmentId: string, input: GuestRsvpInput, ctx: DataCtx): Promise<{ appointment: GuestAppointmentDto }> {
  const c = await appointmentFor(actor, appointmentId, ctx);
  authorize(actor, 'appointment.guest.rsvp', guestRes(c));
  const me = asUser(actor);
  const row = c.appointment!;
  const { db, now } = ctx;
  if (row.status === 'cancelled') throw new AppError('APPOINTMENT_CANCELLED');
  if (row.endAt <= now) throw new AppError('APPOINTMENT_PAST');
  await takeSlots(db, [userSlot(APPOINTMENT_WRITE_RATE_LIMITS.rsvp, me.id)], now);
  await inTx(db, async (tx) => {
    const previous = (await findActiveGuest(tx, appointmentId, me.id))?.response ?? null;
    if (!(await setGuestResponseIfOpen(tx, { appointmentId, userId: me.id, response: input.response }, now))) {
      const again = await loadAppointmentCtx(tx, me, appointmentId);
      if (!again.appointment || again.group.deleted || !again.isGuest || again.group.actorRole !== null) throw new AppError('NOT_FOUND');
      if (again.appointment.status === 'cancelled') throw new AppError('APPOINTMENT_CANCELLED');
      if (again.appointment.endAt <= now) throw new AppError('APPOINTMENT_PAST');
      throw new AppError('CONFLICT');
    }
    // ADR 0016 §7.2: ผู้สร้างนัด (ยังเป็นสมาชิก active) ได้ rsvp_changed แบบเดิม + responderGuest
    if (previous !== input.response && c.creatorActive) {
      const cached = takeResolvedSessionUser(ctx.req);
      const responderName = sanitizeDisplayText(cached && cached.id === me.id ? cached.displayName : ((await findUserById(tx, me.id))?.displayName ?? ''));
      await notify(
        tx,
        {
          userIds: [row.createdBy],
          kind: 'appointment.rsvp_changed',
          params: { groupId: row.groupId, groupName: sanitizeDisplayText(c.groupName), appointmentId, title: sanitizeDisplayText(row.title), startAt: row.startAt, tz: row.tz, responderName, responderId: me.id, response: input.response, responderGuest: true },
        },
        now,
      );
    }
  });
  return { appointment: await guestDetailDto(db, me.id, now, c) };
}

/** แขกออกเอง — ลบแถว (กลับเข้าได้ด้วยลิงก์ที่ยังใช้ได้) · นับถัง share:guest:u · ไม่แจ้งใคร [A] */
export async function leaveAsGuest(actor: Actor, appointmentId: string, ctx: DataCtx): Promise<{ left: true }> {
  const c = await appointmentFor(actor, appointmentId, ctx);
  const allow = authorize(actor, 'appointment.guest.leave', guestRes(c));
  const me = asUser(actor);
  const { db, now } = ctx;
  await takeSlots(db, [userSlot(SHARE_RATE_LIMITS.guestUser, me.id)], now);
  await inTx(db, async (tx) => {
    if (!(await deleteGuestSelf(tx, appointmentId, me.id))) throw new AppError('NOT_FOUND');
    await audit(tx, me, allow, { action: 'appointment.guest.leave', targetType: 'appointment', targetId: appointmentId, groupId: c.group.id }, now);
  });
  return { left: true };
}

/** S6: สมาชิกนำแขกออก — แถวคงอยู่เป็นตัวกันกลับเข้า (removed_at) · แขกได้ appointment.guest.removed (กระดิ่งเท่านั้น ไม่บอกผู้นำออก) */
export async function removeGuest(actor: Actor, appointmentId: string, guestUserId: string, ctx: DataCtx): Promise<{ removed: true }> {
  const t = await guestTargetFor(actor, appointmentId, guestUserId, ctx);
  if (!t.target) {
    // แขกเป้าหมายไม่มี/ถูกนำออกแล้ว: คนนอก → NOT_FOUND ที่ด่านกลุ่ม · สมาชิก → NOT_FOUND (แบบ requireTargetMember)
    authorize(actor, 'appointment.view', apptRes(t.appointment));
    throw new AppError('NOT_FOUND');
  }
  const allow = authorize(actor, 'appointment.guest.remove', t.target);
  const me = asUser(actor);
  const row = t.appointment.appointment!;
  const { db, now } = ctx;
  await takeSlots(db, [userSlot(SHARE_RATE_LIMITS.guestRemoveUser, me.id)], now);
  await inTx(db, async (tx) => {
    const ok = await markGuestRemovedGuarded(
      tx,
      { appointmentId, userId: guestUserId, groupId: row.groupId, removedBy: me.id },
      { actorId: me.id, actorRole: t.appointment.group.actorRole },
      now,
    );
    if (!ok) throw new AppError((await findActiveGuest(tx, appointmentId, guestUserId)) ? 'CONFLICT' : 'NOT_FOUND');
    const target = await findUserById(tx, guestUserId);
    await notify(
      tx,
      {
        userIds: target?.status === 'active' ? [guestUserId] : [],
        kind: 'appointment.guest.removed',
        params: { groupId: row.groupId, groupName: sanitizeDisplayText(t.appointment.groupName), title: sanitizeDisplayText(row.title), startAt: row.startAt, tz: row.tz },
      },
      now,
    );
    await audit(tx, me, allow, { action: 'appointment.guest.remove', targetType: 'appointment', targetId: appointmentId, groupId: row.groupId, meta: { guestUserId } }, now);
  });
  return { removed: true };
}
