/**
 * policy function กลาง — ADR 0003
 * pure + synchronous: ไม่อ่าน DB / env / เวลา · ทุกข้อมูลมาจาก actor + resource ที่ policy-context.ts โหลดให้
 *
 * ลำดับการตัดสิน (ADR 0003 §2 — ตายตัว):
 *  1. anonymous → เฉพาะ PUBLIC_ACTIONS · อื่น ๆ AUTH_REQUIRED
 *  2. status ≠ active → ACCOUNT_SUSPENDED (suspended) / AUTH_REQUIRED (deleted)
 *  3. mustChangePin → เฉพาะ PIN_CHANGE_ALLOWED · อื่น ๆ PIN_CHANGE_REQUIRED
 *  4. SUPER_ADMIN_ONLY → ต้อง isSuperAdmin ไม่งั้น FORBIDDEN
 *  5. resource ผูกกลุ่ม: กลุ่มถูกลบ → NOT_FOUND · ไม่ใช่สมาชิกและไม่ใช่ SA → NOT_FOUND
 *  6. กฎต่อ action (สิทธิ์ SA ∪ สิทธิ์ตาม role) แล้วจึงกฎธุรกิจ D8 (ADMIN_TRANSFER_REQUIRED) ซึ่งใช้กับทุกคนรวม SA
 */
import {
  ACTION_RESOURCE,
  isPinChangeAllowed,
  isPublicAction,
  isSuperAdminAudited,
  isSuperAdminOnly,
  type Action,
} from './actions';
import { POLICY_STATUS, PolicyError, RbacMisuseError } from './errors';
import type {
  Actor,
  Allow,
  AppointmentResource,
  Decision,
  Deny,
  GroupCtx,
  GroupRole,
  InviteResource,
  MemberResource,
  PolicyErrorCode,
  Resource,
  ResourceFor,
  UserActor,
} from './types';

const ALLOW: Allow = Object.freeze({ allow: true, auditAsSuperAdmin: false });
const ALLOW_AUDITED: Allow = Object.freeze({ allow: true, auditAsSuperAdmin: true });

const deny = (code: PolicyErrorCode): Deny => ({ allow: false, code, status: POLICY_STATUS[code] });

/**
 * สิทธิ์ = (ตาม role) ∪ (super admin) — ADR 0003 §2 ข้อ 6
 * ใช้สิทธิ์ SA ที่ role ไม่มี → ติดธง audit (รวม SA ที่ไม่ใช่สมาชิกทุกกรณี)
 */
const grant = (roleAllows: boolean, isSuperAdmin: boolean): Decision => {
  if (roleAllows) return ALLOW;
  if (isSuperAdmin) return ALLOW_AUDITED;
  return deny('FORBIDDEN');
};

type GroupScoped = { readonly group: GroupCtx };
type GroupCtxArgs<R extends GroupScoped> = {
  readonly actor: UserActor;
  /** role ของ actor ในกลุ่ม · null = SA ที่ไม่ใช่สมาชิก (คนนอกที่ไม่ใช่ SA ถูกตัดที่ด่านกลุ่มแล้ว) */
  readonly role: GroupRole | null;
  readonly sa: boolean;
  readonly resource: R;
};

type Rule<R> = (actor: UserActor, resource: R) => Decision;

/** ด่านกลุ่ม (ADR 0003 §2 ข้อ 5) แล้วจึงกฎของ action */
const inGroup =
  <R extends GroupScoped>(rule: (args: GroupCtxArgs<R>) => Decision): Rule<R> =>
  (actor, resource) => {
    const { group } = resource;
    if (group.deleted) return deny('NOT_FOUND');
    if (group.actorRole === null && !actor.isSuperAdmin) return deny('NOT_FOUND');
    return rule({ actor, role: group.actorRole, sa: actor.isSuperAdmin, resource });
  };

const anyUser: Rule<unknown> = () => ALLOW;

/** สมาชิกทุก role ✅ · SA ทุกกลุ่ม ✅ (audit ถ้าไม่ใช่สมาชิก) · คนนอก 404 */
const anyMember = <R extends GroupScoped>(): Rule<R> => inGroup<R>(({ role, sa }) => grant(role !== null, sa));

/** admin/moderator ✅ · member ❌ */
const adminOrModerator = <R extends GroupScoped>(): Rule<R> =>
  inGroup<R>(({ role, sa }) => grant(role === 'admin' || role === 'moderator', sa));

/** admin เท่านั้น (+ SA) */
const adminOnly = <R extends GroupScoped>(): Rule<R> => inGroup<R>(({ role, sa }) => grant(role === 'admin', sa));

/** admin/moderator ✅ · member เฉพาะของที่ตัวเองสร้าง (D4 / §3 แถว 8, 10) */
const adminModOrCreator = <R extends GroupScoped & { readonly createdBy: string }>(): Rule<R> =>
  inGroup<R>(({ actor, role, sa, resource }) =>
    grant(
      role === 'admin' || role === 'moderator' || (role === 'member' && resource.createdBy === actor.id),
      sa,
    ),
  );

/** เจ้าของเท่านั้น — ไม่มีข้อยกเว้นให้ SA (§3 แถว 3) */
const ownerOnly: Rule<{ readonly ownerId: string }> = (actor, r) => (r.ownerId === actor.id ? ALLOW : deny('FORBIDDEN'));

const superAdminAction =
  (action: Action): Rule<unknown> =>
  // ด่านข้อ 4 ตรวจ isSuperAdmin แล้ว — ที่นี่แค่ตัดสินธง audit
  () =>
    isSuperAdminAudited(action) ? ALLOW_AUDITED : ALLOW;

/** §3 แถว 12 (D7, Q2) */
const memberRemove: Rule<MemberResource> = inGroup<MemberResource>(({ actor, role, sa, resource }) => {
  const isSelf = resource.targetUserId === actor.id;
  // R1_CONTRACT §3 ข้อ 1: ลบตัวเองผ่าน member.remove ไม่ได้ทุกคนรวม SA — ใช้ group.leave (และกฎ D8) แทน
  if (isSelf) return deny('FORBIDDEN');
  const roleAllows =
    (role === 'admin' && !isSelf) || // GA: ทุกคนยกเว้นตัวเอง
    (role === 'moderator' && !isSelf && resource.targetRole === 'member'); // MOD: เฉพาะ member (D7)
  const decision = grant(roleAllows, sa);
  if (!decision.allow) return decision;
  // D8 + Q2: เป้าหมายถือ role admin → ต้องโอนก่อน แม้เป็น SA
  if (resource.targetRole === 'admin') return deny('ADMIN_TRANSFER_REQUIRED');
  return decision;
});

/** §3 แถว 14 — member ↔ moderator เท่านั้น เป้าหมายไม่ใช่ admin */
const memberSetRole: Rule<MemberResource> = inGroup<MemberResource>(({ actor, role, sa, resource }) => {
  // R1_CONTRACT §3 ข้อ 1: เปลี่ยน role ตัวเองไม่ได้ทุกคนรวม SA
  if (resource.targetUserId === actor.id) return deny('FORBIDDEN');
  const decision = grant(role === 'admin', sa);
  if (!decision.allow) return decision;
  if (resource.targetRole === 'admin') return deny('FORBIDDEN');
  return decision;
});

/** §3 แถว 15 (D8) — เป้าหมายเป็นสมาชิกปัจจุบัน และไม่ใช่ตัวเอง */
const transferAdmin: Rule<MemberResource> = inGroup<MemberResource>(({ actor, role, sa, resource }) => {
  const decision = grant(role === 'admin', sa);
  if (!decision.allow) return decision;
  if (resource.targetUserId === actor.id || resource.targetRole === 'admin') return deny('FORBIDDEN');
  return decision;
});

/** §3 แถว 17 (D8) — ต้องเป็นสมาชิก · admin ต้องโอนก่อน · SA ที่ไม่ใช่สมาชิก = "—" → 404 */
const groupLeave: Rule<ResourceFor<'group.leave'>> = inGroup(({ role }) => {
  if (role === null) return deny('NOT_FOUND');
  if (role === 'admin') return deny('ADMIN_TRANSFER_REQUIRED');
  return ALLOW;
});

/** §3 แถว 11 — ต้องเป็นสมาชิก (SA ที่ไม่ใช่สมาชิก → FORBIDDEN, ไม่ใช่ 404 เพราะ SA เห็นกลุ่มได้) */
const appointmentRsvp: Rule<AppointmentResource> = inGroup<AppointmentResource>(({ role }) =>
  role !== null ? ALLOW : deny('FORBIDDEN'),
);

/**
 * R6C_CONTRACT §2 (F3a) — ตั้งสี/รูปร่างของตัวเองในกลุ่ม: สมาชิกทุก role ✅ · SA ที่ไม่ใช่สมาชิก → FORBIDDEN
 * (ไม่ใช้ anyMember เพราะให้ SA ผ่าน — SA นอกกลุ่มไม่มีแถว group_member ให้ตั้งค่า) · NM → 404 ที่ด่านกลุ่ม
 * ไม่มีกรณี "ของคนอื่น": API ใช้ userId จาก session เสมอ resource จึงเป็นแค่กลุ่ม
 */
const memberSetOwnAppearance: Rule<ResourceFor<'member.setOwnAppearance'>> = inGroup(({ role }) =>
  role !== null ? ALLOW : deny('FORBIDDEN'),
);

/**
 * R6D G1 (ADR 0009 §5) — จำกลุ่มปัจจุบันของเครื่อง (PUT /api/me/current-group): สมาชิกทุก role ✅ ·
 * SA ที่ไม่ใช่สมาชิก → FORBIDDEN (SA เห็นกลุ่มได้แต่ไม่ใช่ "กลุ่มของฉัน") · NM/กลุ่มลบ → 404 ที่ด่านกลุ่ม
 */
const memberSetCurrentGroup: Rule<ResourceFor<'member.setCurrentGroup'>> = inGroup(({ role }) =>
  role !== null ? ALLOW : deny('FORBIDDEN'),
);

type Rules = { readonly [A in Action]: Rule<ResourceFor<A>> };

const RULES: Rules = {
  // PUBLIC (ผู้ใช้ที่ล็อกอินแล้วก็เรียกได้ — ADR 0003)
  'auth.signup': anyUser,
  'auth.login': anyUser,
  'auth.pinReset.request': anyUser,
  'auth.pinReset.status': anyUser,
  'prefs.cookie.set': anyUser,

  // ผู้ใช้ทุกคน (เฉพาะตัวเอง)
  'auth.logout': anyUser,
  'self.pin.change': anyUser,
  'self.read': anyUser,
  'self.update': anyUser,
  'self.session.revokeAll': anyUser,
  // R5_CONTRACT §2 ข้อ 2: super admin ลบบัญชีตัวเองผ่านแอปไม่ได้ (FORBIDDEN — กันระบบไม่มี SA; ทำผ่าน SQL) · ตัดสินก่อนกฎ D8
  'self.delete': (actor, r) => {
    if (actor.isSuperAdmin) return deny('FORBIDDEN');
    return r.holdsGroupAdmin ? deny('ADMIN_TRANSFER_REQUIRED') : ALLOW;
  },

  'group.create': anyUser,
  'group.list.mine': anyUser,

  'busy.create': anyUser,
  'busy.list.own': anyUser,
  'busy.update': ownerOnly, // §3 แถว 3: busy ของคนอื่น ❌ ทุกคนรวม SA
  'busy.delete': ownerOnly,

  'group.view': anyMember(),
  'group.calendar.view': anyMember(),
  'group.availability.view': anyMember(),

  'invite.code.create': anyMember(),
  'invite.direct.create': anyMember(),
  'invite.list': anyMember(), // MEM เห็นเฉพาะของตัวเอง — data layer กรองด้วย can(…,'invite.revoke',row)
  'invite.code.redeem': anyUser, // สมาชิกเดิม = สำเร็จแบบ idempotent (U5 AC)
  'invite.direct.respond': (actor, r) => (r.inviteeUserId === actor.id ? ALLOW : deny('FORBIDDEN')),
  'invite.direct.list.mine': anyUser,
  'invite.revoke': adminModOrCreator<InviteResource>(),

  'appointment.create': anyMember(),
  'appointment.view': anyMember(),
  'appointment.update': adminModOrCreator<AppointmentResource>(),
  'appointment.cancel': adminModOrCreator<AppointmentResource>(),
  'appointment.rsvp': appointmentRsvp,
  'appointment.list.mine': anyUser,

  'member.remove': memberRemove,
  'group.update': adminOrModerator(),
  'member.setRole': memberSetRole,
  'group.transferAdmin': transferAdmin,
  'group.delete': adminOnly(),
  'group.leave': groupLeave,
  'member.setOwnAppearance': memberSetOwnAppearance,
  'member.setCurrentGroup': memberSetCurrentGroup,

  'pinReset.list': superAdminAction('pinReset.list'),
  'pinReset.decide': superAdminAction('pinReset.decide'),
  'admin.console.view': superAdminAction('admin.console.view'),
  'admin.user.list': superAdminAction('admin.user.list'),
  'admin.user.suspend': superAdminAction('admin.user.suspend'),
  'admin.user.unlock': superAdminAction('admin.user.unlock'),
  'admin.group.list': superAdminAction('admin.group.list'),
  'admin.group.view': superAdminAction('admin.group.view'),
  'admin.audit.view': superAdminAction('admin.audit.view'),

  'notification.list.own': ownerOnly,
  'notification.markRead.own': ownerOnly,
  'place.search': anyUser,
};

const acceptsResource = (action: Action, resource: Resource): boolean =>
  (ACTION_RESOURCE[action] as readonly string[]).includes(resource.type);

/**
 * ตัดสินสิทธิ์ (pure) — ไม่ throw ยกเว้นส่ง resource ผิดชนิด (`RbacMisuseError` = บั๊กของผู้เรียก)
 */
export function can<A extends Action>(actor: Actor, action: A, resource: ResourceFor<A>): Decision {
  if (!acceptsResource(action, resource)) throw new RbacMisuseError(action, resource.type);

  // 1 — fail closed: อะไรที่ไม่ใช่ kind 'user' ชัด ๆ (anonymous หรือค่าผิดรูปจาก resolver) ได้สิทธิ์เท่า anonymous
  if (actor?.kind !== 'user') return isPublicAction(action) ? ALLOW : deny('AUTH_REQUIRED');
  // 2
  if (actor.status === 'suspended') return deny('ACCOUNT_SUSPENDED');
  if (actor.status !== 'active') return deny('AUTH_REQUIRED');
  // 3
  if (actor.mustChangePin && !isPinChangeAllowed(action)) return deny('PIN_CHANGE_REQUIRED');
  // 4
  if (isSuperAdminOnly(action) && !actor.isSuperAdmin) return deny('FORBIDDEN');
  // 5 + 6
  const rule = RULES[action] as Rule<ResourceFor<A>>;
  return rule(actor, resource);
}

/**
 * เรียกเป็นบรรทัดแรกของทุก service (ARCHITECTURE §2) — ปฏิเสธ → throw `PolicyError`
 * คืน `Allow` เพื่อให้ service รู้ว่าต้องเขียน audit ในฐานะ super admin หรือไม่
 */
export function authorize<A extends Action>(actor: Actor, action: A, resource: ResourceFor<A>): Allow {
  const decision = can(actor, action, resource);
  if (!decision.allow) throw new PolicyError(decision.code, action);
  return decision;
}

/** resource ที่ผูกกลุ่ม → id ของกลุ่มที่ resource สังกัด */
const groupIdOf = (resource: Resource): string | null => ('group' in resource ? resource.group.id : null);

/**
 * กัน IDOR ข้ามกลุ่ม (R2-6): route แบบ `/api/groups/:gid/<ของในกลุ่ม>/:id` ส่ง `:gid` จาก URL มาด้วย
 * resource ที่โหลดมาอยู่คนละกลุ่มกับ `:gid` → NOT_FOUND (ทุกคนรวม SA — ของนั้นไม่มีใน path นี้)
 * ด่านบัญชี (anonymous / suspended / mustChangePin) ตัดสินก่อนเสมอ · resource ที่ไม่ผูกกลุ่ม = บั๊กผู้เรียก (`RbacMisuseError`)
 */
export function canInGroup<A extends Action>(
  actor: Actor,
  action: A,
  resource: ResourceFor<A>,
  urlGroupId: string,
): Decision {
  const resourceGroupId = groupIdOf(resource);
  if (resourceGroupId === null) throw new RbacMisuseError(action, resource.type);
  const base = can(actor, action, resource);
  if (!base.allow && ACCOUNT_GATE_CODES.has(base.code)) return base;
  if (resourceGroupId !== urlGroupId) return deny('NOT_FOUND');
  return base;
}

const ACCOUNT_GATE_CODES: ReadonlySet<PolicyErrorCode> = new Set(['AUTH_REQUIRED', 'ACCOUNT_SUSPENDED', 'PIN_CHANGE_REQUIRED']);

/** `canInGroup` แบบ throw — บรรทัดแรกของ service ที่รับ `:gid` + id ของของในกลุ่ม */
export function authorizeInGroup<A extends Action>(
  actor: Actor,
  action: A,
  resource: ResourceFor<A>,
  urlGroupId: string,
): Allow {
  const decision = canInGroup(actor, action, resource, urlGroupId);
  if (!decision.allow) throw new PolicyError(decision.code, action);
  return decision;
}
