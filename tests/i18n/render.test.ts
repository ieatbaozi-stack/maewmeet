// R18 H6 — render test ของ i18n: เรนเดอร์คอมโพเนนต์จริง (react-dom/server + next-intl) ทั้ง th/en
// แล้วล้มเมื่อคีย์หาย / namespace ผิด / ICU ขาดตัวแปร / มีคีย์ดิบหลุดใน HTML
// ต่างจาก messages.test.ts (เทียบ JSON) และ no-hardcoded-text.test.ts (grep ซอร์ส): เทสต์นี้รัน `t("…")` จริงตาม namespace ที่โค้ดเรียก
// → จับบั๊กแบบ R16 H4c (ป้าย `common.systemAdmin` ถูกเรียกใน namespace ผิด → คีย์ไม่พบ) ที่ grep มองไม่เห็น
//
// วิธีทำงาน: NextIntlClientProvider ที่ onError/getMessageFallback โยน error (ไม่ใช่แค่ log) + ตรวจ HTML ที่ได้ไม่มีรูปแบบคีย์ดิบ
// ขอบเขต: view หลักของ "ทุกหน้า" (public: login/signup/forgot/set-pin · app: หน้าหลัก/กลุ่ม/ตั้งค่ากลุ่ม/นัด/แจ้งเตือน/me/admin · shell)
//   ไม่รวม IntroCard/LineSection: เรนเดอร์ว่าง (null) จนกว่า useEffect จะรัน — ข้อความของสองตัวนี้ถูกครอบโดยเทสต์ namespace/คีย์ด้านล่าง + e2e
//   ส่วนที่โหลดฝั่ง client หลัง mount (useEffect) ไม่ถูกรันใน SSR → ครอบเฉพาะสถานะเริ่มต้นที่ส่ง props เข้า (ใส่ props ให้ครบกิ่งสำคัญ)
// หน้า server component (page.tsx) ใช้ getTranslations ไม่ render ที่นี่ → ตรวจแยกด้านล่าง ("namespace/คีย์ของทุกไฟล์ใน src ต้องมีจริง")
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import thMessages from '../../messages/th.json';
import enMessages from '../../messages/en.json';

// next/navigation ใช้ไม่ได้นอก App Router — ให้ตัวเปล่าพอให้ SSR ผ่าน
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: () => undefined,
    replace: () => undefined,
    refresh: () => undefined,
    back: () => undefined,
    prefetch: () => undefined,
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: () => undefined,
  notFound: () => undefined,
}));

import { LoginForm } from '@/components/login/LoginForm';
import { SignupForm } from '@/components/auth/SignupForm';
import { ForgotView, type ResetStatus } from '@/components/auth/ForgotView';
import { SetPinForm, SetPinSignOut } from '@/components/auth/SetPinForm';
import { LoginPrefs } from '@/components/prefs/LoginPrefs';
import { PrefsSettings } from '@/components/prefs/PrefsSettings';
import { AccountSection } from '@/components/account/AccountSection';
import { HomeView } from '@/components/home/HomeView';
import { GroupsView } from '@/components/groups/GroupsView';
import { SettingsView } from '@/components/groups/SettingsView';
import { AppointmentDetail } from '@/components/appointments/AppointmentDetail';
import { NotificationsView } from '@/components/notifications/NotificationsView';
import { TabBar } from '@/components/shell/TabBar';
import { Bell } from '@/components/shell/Bell';
import { ErrorState } from '@/components/shell/ErrorState';
import { AdminUsers } from '@/components/admin/AdminUsers';
import { AdminGroups } from '@/components/admin/AdminGroups';
import { AdminAudit } from '@/components/admin/AdminAudit';
import { PinResetList } from '@/components/admin/PinResetList';
import { AdminGroupDetail } from '@/components/admin/AdminGroupDetail';
import type { GroupDetailDto, GroupSummaryDto, InviteDto, MemberDto, PendingInviteDto } from '@/lib/data/serializers/groups';
import type { AppointmentDetailDto, PersonDto } from '@/lib/data/serializers/appointments';

const LOCALES = ['th', 'en'] as const;
type Locale = (typeof LOCALES)[number];
const MESSAGES = { th: thMessages, en: enMessages } as const;

// ───────── เรนเดอร์แบบเข้มงวด ─────────
/** โยนทันทีที่ next-intl รายงานปัญหา (คีย์หาย · ตัวแปรขาด · รูปแบบ ICU เสีย) */
function strictIntl(locale: Locale, children: unknown) {
  const props = {
    locale,
    messages: MESSAGES[locale],
    timeZone: 'Asia/Bangkok',
    onError: (err: { code?: string; message: string }) => {
      throw new Error(`[${locale}] next-intl ${err.code ?? ''}: ${err.message}`);
    },
    getMessageFallback: ({ namespace, key }: { namespace?: string; key: string }) => {
      throw new Error(`[${locale}] ไม่พบข้อความ ${namespace ? `${namespace}.` : ''}${key}`);
    },
  };
  return createElement(NextIntlClientProvider, props as never, children as never);
}

/** คีย์ดิบที่หลุดลง HTML: รูป `ns.key` / `ns.sub.key` ที่ขึ้นต้นด้วย namespace ระดับบนของ messages */
const TOP_LEVEL = Object.keys(thMessages);
const RAW_KEY = new RegExp(`(?<![\\w./@-])(?:${TOP_LEVEL.join('|')})(?:\\.[A-Za-z][A-Za-z0-9_]*)+(?![\\w@-])`, 'g');

function render(locale: Locale, Component: ComponentType<never>, props: unknown): string {
  const html = renderToStaticMarkup(strictIntl(locale, createElement(Component, props as never)));
  const text = html.replace(/<[^>]*>/g, ' ');
  expect(text.match(RAW_KEY), `[${locale}] คีย์ดิบหลุดใน HTML`).toBeNull();
  expect(text, `[${locale}] ข้อความ MISSING_MESSAGE`).not.toMatch(/MISSING_MESSAGE|\[object Object\]/);
  expect(html.length).toBeGreaterThan(0);
  return html;
}

// ───────── fixture ─────────
const NOW = Date.UTC(2026, 10, 20, 5, 0, 0);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const person = (n: number, name: string): PersonDto => ({
  userId: `u${n}`,
  displayName: name,
  colorIndex: n % 8,
  shapeIndex: n % 6,
});
const member = (n: number, name: string, role: MemberDto['role']): MemberDto => ({
  userId: `u${n}`,
  displayName: name,
  role,
  colorIndex: n % 8,
  shapeIndex: n % 6,
  joinedAt: NOW - 5 * DAY,
  hasUpcomingBusy: n % 2 === 0,
});
const appearance = {
  colorIndex: 1,
  shapeIndex: 2,
  color: null,
  shape: null,
} as unknown as NonNullable<GroupDetailDto['myAppearance']>;

const groupDetail = (myRole: GroupDetailDto['myRole']): GroupDetailDto => ({
  id: 'g1',
  name: 'ก๊วนกาแฟ',
  icon: null,
  tz: 'Asia/Bangkok',
  freeWindowStartMin: 8 * 60,
  freeWindowEndMin: 22 * 60,
  minFreeMinutes: 240,
  createdAt: NOW - 30 * DAY,
  myRole,
  memberCount: 3,
  members: [member(1, 'Ann', 'admin'), member(2, 'Ben', 'member'), member(3, 'Cat', 'member')],
  myAppearance: myRole === null ? null : appearance,
});

const invite = (id: string, over: Partial<InviteDto>): InviteDto => ({
  id,
  kind: 'code',
  codeHint: 'AB12',
  inviteeName: null,
  createdBy: 'u1',
  creatorName: 'Ann',
  creatorSystemAdmin: false,
  createdAt: NOW - HOUR,
  expiresAt: NOW + 2 * DAY,
  usesCount: 0,
  ...over,
});
// รวมกิ่ง R16 H4c: ผู้สร้างเป็นผู้ดูแลระบบ (creatorName '') · ผู้สร้างเป็นบัญชีที่ลบแล้ว (creatorName '' + ธง false) · คำเชิญตรง
const INVITES: InviteDto[] = [
  invite('i1', {}),
  invite('i2', { creatorName: '', creatorSystemAdmin: true }),
  invite('i3', { creatorName: '', creatorSystemAdmin: false }),
  invite('i4', { kind: 'direct', codeHint: null, inviteeName: 'Dao' }),
  invite('i5', {
    kind: 'direct',
    codeHint: null,
    inviteeName: 'Eve',
    creatorName: '',
    creatorSystemAdmin: true,
  }),
  invite('i6', { usesCount: 3, expiresAt: NOW - HOUR }),
];

const groupSummary = (id: string, name: string, role: GroupSummaryDto['role']): GroupSummaryDto => ({
  id,
  name,
  icon: null,
  role,
  memberCount: 3,
  createdAt: NOW - DAY,
});
const pending = (id: string, over: Partial<PendingInviteDto>): PendingInviteDto => ({
  id,
  groupId: `g-${id}`,
  groupName: 'ทีมวิ่ง',
  inviterName: 'Ann',
  createdAt: NOW - HOUR,
  expiresAt: NOW + DAY,
  actorSystemAdmin: false,
  ...over,
});

const rsvpMembers = {
  going: [person(1, 'Ann')],
  maybe: [person(2, 'Ben')],
  not_going: [person(3, 'Cat')],
};
const apptDetail = (over: Partial<AppointmentDetailDto>): AppointmentDetailDto => ({
  id: 'a1',
  groupId: 'g1',
  groupName: 'ก๊วนกาแฟ',
  groupIcon: null,
  title: 'ดื่มกาแฟ',
  description: 'ร้านหน้าปากซอย',
  placeName: 'Cafe A',
  lat: 13.75,
  lng: 100.5,
  mapUrl: null,
  startAt: NOW + 2 * DAY,
  endAt: NOW + 2 * DAY + 2 * HOUR,
  tz: 'Asia/Bangkok',
  localDate: '2026-11-22',
  status: 'active',
  isPast: false,
  daysUntil: 2,
  createdBy: person(1, 'Ann'),
  createdAt: NOW - DAY,
  updatedAt: NOW - DAY,
  cancelledAt: null,
  cancelledBy: null,
  rsvp: {
    counts: { going: 1, maybe: 1, not_going: 1, noResponse: 0 },
    mine: 'going',
    members: rsvpMembers,
  },
  permissions: { canEdit: true, canCancel: true, canRsvp: true },
  myAppearance: { colorIndex: 1, shapeIndex: 2 } as never,
  myConflicts: [],
  myConflictsTruncated: false,
  ...over,
});
const noRsvp = {
  counts: { going: 0, maybe: 0, not_going: 0, noResponse: 3 },
  mine: null,
  members: { going: [], maybe: [], not_going: [] },
};
const frozen = { canEdit: false, canCancel: false, canRsvp: false };
const detailProps = (initial: AppointmentDetailDto, me: PersonDto) => ({
  initial,
  me,
  nowMs: NOW,
  appOrigin: 'https://example.test',
});

const NOTIFS = [
  {
    kind: 'appointment.created',
    params: {
      groupName: 'ก๊วน',
      title: 'กาแฟ',
      appointmentId: 'a1',
      startAt: NOW + DAY,
      tz: 'Asia/Bangkok',
    },
  },
  {
    kind: 'appointment.reminder_1d',
    params: {
      groupName: 'ก๊วน',
      title: 'กาแฟ',
      appointmentId: 'a1',
      startAt: NOW + DAY,
      tz: 'Asia/Bangkok',
    },
  },
  {
    kind: 'appointment.reminder_1h',
    params: {
      groupName: 'ก๊วน',
      title: 'กาแฟ',
      appointmentId: 'a1',
      startAt: NOW + HOUR,
      tz: 'Asia/Bangkok',
    },
  },
  {
    kind: 'appointment.rsvp_nudge',
    params: {
      groupName: 'ก๊วน',
      title: 'กาแฟ',
      appointmentId: 'a1',
      startAt: NOW + DAY,
      tz: 'Asia/Bangkok',
    },
  },
  {
    kind: 'appointment.cancelled',
    params: {
      groupName: 'ก๊วน',
      title: 'กาแฟ',
      appointmentId: 'a1',
      startAt: NOW + DAY,
      actorName: 'Ann',
    },
  },
  {
    kind: 'appointment.cancelled',
    params: {
      groupName: 'ก๊วน',
      title: 'กาแฟ',
      appointmentId: 'a1',
      startAt: NOW + DAY,
      actorName: '',
      actorSystemAdmin: true,
    },
  },
  {
    kind: 'appointment.updated',
    params: {
      groupName: 'ก๊วน',
      title: 'กาแฟ',
      appointmentId: 'a1',
      startAt: NOW + DAY,
      actorName: 'Ann',
      changes: 'time',
    },
  },
  {
    kind: 'appointment.updated',
    params: {
      groupName: 'ก๊วน',
      title: 'กาแฟ',
      appointmentId: 'a1',
      startAt: NOW + DAY,
      actorName: '',
      changes: 'both',
    },
  },
  {
    kind: 'appointment.rsvp_changed',
    params: {
      groupName: 'ก๊วน',
      title: 'กาแฟ',
      appointmentId: 'a1',
      startAt: NOW + DAY,
      responderName: 'Ben',
      response: 'going',
    },
  },
  {
    kind: 'appointment.rsvp_changed',
    params: {
      groupName: 'ก๊วน',
      title: 'กาแฟ',
      appointmentId: 'a1',
      startAt: NOW + DAY,
      responderName: 'Ben',
      response: 'not_going',
    },
  },
  {
    kind: 'group.invite.received',
    params: { groupName: 'ทีมวิ่ง', inviterName: 'Ann' },
  },
  {
    kind: 'group.invite.received',
    params: { groupName: 'ทีมวิ่ง', inviterName: '', actorSystemAdmin: true },
  },
  {
    kind: 'group.invite.accepted',
    params: { groupName: 'ทีมวิ่ง', inviteeName: 'Dao', groupId: 'g1' },
  },
  {
    kind: 'group.invite.declined',
    params: { groupName: 'ทีมวิ่ง', inviteeName: '', groupId: 'g1' },
  },
  {
    kind: 'group.member.joined',
    params: { groupName: 'ทีมวิ่ง', memberName: 'Dao', groupId: 'g1' },
  },
  {
    kind: 'group.member.left',
    params: { groupName: 'ทีมวิ่ง', memberName: 'Dao', groupId: 'g1' },
  },
  { kind: 'no.such.kind', params: {} },
].map((n, i) => ({
  id: `n${i}`,
  createdAt: NOW - i * HOUR,
  readAt: i % 2 === 0 ? null : NOW,
  ...n,
}));

const homeAppt = (id: string, mine: 'going' | 'maybe' | 'not_going' | null, over: Record<string, unknown> = {}) => ({
  id,
  groupId: 'g1',
  groupName: 'ก๊วนกาแฟ',
  groupIcon: null,
  title: `นัด ${id}`,
  placeName: 'Cafe A',
  startAt: NOW + DAY,
  endAt: NOW + DAY + 2 * HOUR,
  tz: 'Asia/Bangkok',
  localDate: '2026-11-21',
  daysUntil: 1,
  rsvp: { counts: { going: 1, maybe: 1, not_going: 0, noResponse: 1 }, mine },
  ...over,
});

// ───────── ตารางเรนเดอร์: ชื่อ · คอมโพเนนต์ · props (หลายสถานะ) ─────────
type Case = { name: string; Component: ComponentType<never>; props: unknown[] };
const CASES: Case[] = [
  // public
  {
    name: 'login',
    Component: LoginForm as never,
    props: [{ reset: null }, { reset: { status: 'pending' } }, { reset: { status: 'approved', expiresAt: NOW + HOUR } }, { reset: null, next: '/i/Xk3_a-B9zQ1mN2pR4sT6uV' }], // R18 §S3: ?next ของลิงก์ชวน
  },
  {
    name: 'login prefs',
    Component: LoginPrefs as never,
    props: [{ current: { locale: 'th', theme: 'system' } }, { current: { locale: 'en', theme: 'dark' } }],
  },
  { name: 'signup', Component: SignupForm as never, props: [{}, { next: '/i/Xk3_a-B9zQ1mN2pR4sT6uV' }] },
  {
    name: 'forgot',
    Component: ForgotView as never,
    props: [{ status: 'none' }, { status: 'pending' }, { status: 'closed' }, { status: 'approved', expiresAt: NOW + HOUR }].map((initial) => ({ initial: initial as ResetStatus })),
  },
  { name: 'set-pin', Component: SetPinForm as never, props: [{}] },
  { name: 'set-pin sign out', Component: SetPinSignOut as never, props: [{}] },
  // shell
  { name: 'tab bar', Component: TabBar as never, props: [{}] },
  { name: 'bell', Component: Bell as never, props: [{}] },
  {
    name: 'error state',
    Component: ErrorState as never,
    props: [{ retry: () => undefined }],
  },
  // home
  {
    name: 'home',
    Component: HomeView as never,
    props: [
      { initial: { kind: 'no-group' }, initialNowMs: NOW },
      { initial: { kind: 'error' }, initialNowMs: NOW },
      { initial: { kind: 'ready', appointments: [] }, initialNowMs: NOW },
      {
        initial: {
          kind: 'ready',
          appointments: [homeAppt('a1', 'going'), homeAppt('a2', 'maybe'), homeAppt('a3', 'not_going'), homeAppt('a4', null), homeAppt('a5', null, { daysUntil: 0, startAt: NOW + HOUR })],
        },
        initialNowMs: NOW,
      },
    ],
  },
  // groups
  {
    name: 'groups',
    Component: GroupsView as never,
    props: [
      { groups: [], invites: [] },
      {
        groups: [groupSummary('g1', 'ก๊วนกาแฟ', 'admin'), groupSummary('g2', 'Run Club', 'member')],
        invites: [pending('p1', {}), pending('p2', { inviterName: '', actorSystemAdmin: true }), pending('p3', { inviterName: '' })],
      },
    ],
  },
  {
    name: 'group settings',
    Component: SettingsView as never,
    props: (['admin', 'member', null] as const).map((role) => ({
      group: groupDetail(role),
      invites: INVITES,
      myId: role === 'admin' ? 'u1' : role === 'member' ? 'u2' : 'u9',
    })),
  },
  // appointments
  {
    name: 'appointment detail',
    Component: AppointmentDetail as never,
    props: [
      detailProps(apptDetail({}), person(1, 'Ann')),
      detailProps(
        apptDetail({
          rsvp: noRsvp as never,
          permissions: { canEdit: false, canCancel: false, canRsvp: true },
        }),
        person(2, 'Ben'),
      ),
      // R18 §S: สมาชิกเห็นปุ่มชวนคนนอก + ส่วนแขก ("มากับ X" / นำออก) — แขกเต็มเพดาน และไม่มีแขก
      detailProps(
        apptDetail({
          permissions: { canEdit: true, canCancel: true, canRsvp: true, canShare: true },
          guests: {
            items: [
              { userId: 'g0', displayName: 'แขกหนึ่ง', response: 'going', invitedBy: { userId: 'u1', displayName: 'Ann', colorIndex: 1, shapeIndex: 1 }, canRemove: true },
              { userId: 'g1', displayName: 'แขกสอง', response: null, invitedBy: null, canRemove: false },
            ],
            counts: { going: 1, maybe: 0, not_going: 0, noResponse: 1 },
            max: 10,
          },
          shareLinks: [{ id: 'l1', createdBy: person(1, 'Ann'), createdAt: NOW - HOUR, guestsJoined: 1, mine: true, url: 'https://example.test/i/Xk3_a-B9zQ1mN2pR4sT6uV' }],
        }),
        person(1, 'Ann'),
      ),
      detailProps(
        apptDetail({
          permissions: { canEdit: false, canCancel: false, canRsvp: true, canShare: true },
          guests: { items: [], counts: { going: 0, maybe: 0, not_going: 0, noResponse: 0 }, max: 10 },
          shareLinks: [],
        }),
        person(2, 'Ben'),
      ),
      detailProps(
        apptDetail({
          status: 'cancelled',
          cancelledAt: NOW - HOUR,
          cancelledBy: null,
          permissions: frozen,
        }),
        person(2, 'Ben'),
      ),
      detailProps(
        apptDetail({
          status: 'cancelled',
          cancelledAt: NOW - HOUR,
          cancelledBy: person(1, 'Ann'),
          permissions: frozen,
        }),
        person(2, 'Ben'),
      ),
      detailProps(
        apptDetail({
          isPast: true,
          daysUntil: -1,
          startAt: NOW - 2 * DAY,
          endAt: NOW - 2 * DAY + HOUR,
          permissions: frozen,
        }),
        person(1, 'Ann'),
      ),
      detailProps(
        apptDetail({
          placeName: null,
          description: null,
          lat: null,
          lng: null,
          createdBy: null,
          myConflicts: [
            {
              kind: 'busy',
              busyId: 'b1',
              title: null,
              allDay: true,
              startAt: NOW + 2 * DAY,
              endAt: NOW + 3 * DAY,
              localStartDate: '2026-11-22',
              localEndDate: '2026-11-22',
              tz: 'Asia/Bangkok',
            },
            {
              kind: 'appointment',
              appointmentId: 'a9',
              title: 'นัดอื่น',
              groupId: 'g2',
              groupName: 'Run Club',
              startAt: NOW + 2 * DAY,
              endAt: NOW + 2 * DAY + HOUR,
              tz: 'Asia/Bangkok',
            },
          ],
          myConflictsTruncated: true,
        }),
        person(1, 'Ann'),
      ),
    ],
  },
  // notifications
  {
    name: 'notifications',
    Component: NotificationsView as never,
    props: [
      {
        initial: { notifications: NOTIFS, nextCursor: 'c1', unreadCount: 9 },
        initialNowMs: NOW,
      },
      {
        initial: { notifications: [], nextCursor: null, unreadCount: 0 },
        initialNowMs: NOW,
      },
      { initial: null, initialNowMs: NOW },
    ],
  },
  // me
  {
    name: 'account',
    Component: AccountSection as never,
    props: [
      { displayName: 'Ann', username: 'ann', isSuperAdmin: false },
      { displayName: 'Root', username: 'root', isSuperAdmin: true },
    ],
  },
  {
    name: 'prefs',
    Component: PrefsSettings as never,
    props: [{ current: { locale: 'th', theme: 'light' } }, { current: { locale: 'en', theme: 'system' } }],
  },
  // admin (เนื้อหาโหลดฝั่ง client — ตรวจโครง/สถานะโหลดเริ่มต้น)
  {
    name: 'admin users',
    Component: AdminUsers as never,
    props: [{ meId: 'u1' }],
  },
  { name: 'admin groups', Component: AdminGroups as never, props: [{}] },
  { name: 'admin audit', Component: AdminAudit as never, props: [{}] },
  { name: 'admin pin resets', Component: PinResetList as never, props: [{}] },
  {
    name: 'admin group detail',
    Component: AdminGroupDetail as never,
    props: [{ groupId: 'g1' }],
  },
];

describe('R18 H6 เรนเดอร์จริง — ไม่มีคีย์หาย/คีย์ดิบ ทั้ง th และ en', () => {
  for (const c of CASES) {
    for (const locale of LOCALES) {
      it(`${c.name} · ${locale} (${c.props.length} สถานะ)`, () => {
        for (const props of c.props) render(locale, c.Component, props);
      });
    }
  }

  it('เครื่องมือจับได้จริง: คีย์ที่ไม่มี → ล้ม · namespace ผิด (แบบ H4c) → ล้ม (กัน harness เงียบ)', () => {
    const Missing = () => createElement('p', null, useTranslations('common')('noSuchKey__' as never));
    const WrongNs = () => createElement('p', null, useTranslations('groupSettings')('systemAdmin' as never));
    expect(() => render('th', Missing as never, {})).toThrow(/common\.noSuchKey__/);
    expect(() => render('en', WrongNs as never, {})).toThrow(/groupSettings\.systemAdmin/);
  });
});

// ───────── หน้า server component: namespace/คีย์ของทุกไฟล์ใน src ต้องมีจริง (ครอบ page.tsx/layout ที่ render ตรงๆ ไม่ได้) ─────────
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(f)) out.push(p);
  }
  return out;
}
const SRC = path.resolve(import.meta.dirname, '../../src');
type Tree = { [k: string]: string | Tree };
const hasPath = (tree: Tree, dotted: string): boolean => {
  let cur: string | Tree | undefined = tree;
  for (const part of dotted.split('.')) {
    if (cur === undefined || typeof cur === 'string') return false;
    cur = cur[part];
  }
  return cur !== undefined;
};

describe('R18 H6 ทุกไฟล์ใน src: useTranslations/getTranslations("ns") ชี้ namespace ที่มีจริง และคีย์ตัวอักษรตรงๆ หาเจอ', () => {
  const files = walk(SRC);
  const NS_CALL = /\b(?:useTranslations|getTranslations)\(\s*["'`]([A-Za-z0-9_.]+)["'`]\s*\)/g;

  it('namespace ทั้งหมดมีใน th และ en', () => {
    const bad: string[] = [];
    let n = 0;
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(NS_CALL)) {
        n++;
        for (const l of LOCALES) if (!hasPath(MESSAGES[l] as Tree, m[1]!)) bad.push(`${path.relative(SRC, f)} → "${m[1]}" ไม่มีใน ${l}`);
      }
    }
    expect(n, 'พบการเรียก namespace อย่างน้อยหนึ่งชุดใหญ่').toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });

  it('ไฟล์ที่ผูก namespace เดียว (และไม่มี t ที่ไม่มี namespace ปน) → คีย์ t("…") ตัวอักษรตรงๆ ต้องมีใน th และ en', () => {
    const bad: string[] = [];
    let checked = 0;
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const nsList = [...src.matchAll(NS_CALL)].map((m) => m[1]!);
      const bare = [...src.matchAll(/\b(?:useTranslations|getTranslations)\(\s*\)/g)].length;
      if (nsList.length !== 1 || bare > 0) continue;
      const ns = nsList[0]!;
      for (const m of src.matchAll(/(?<![\w.$])t(?:\.rich|\.raw|\.has)?\(\s*["']([A-Za-z0-9_.]+)["']/g)) {
        checked++;
        const full = `${ns}.${m[1]}`;
        for (const l of LOCALES) if (!hasPath(MESSAGES[l] as Tree, full)) bad.push(`${path.relative(SRC, f)} → ${full} ไม่มีใน ${l}`);
      }
    }
    expect(checked, 'ตรวจคีย์อย่างน้อยหนึ่งชุดใหญ่').toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });
});
