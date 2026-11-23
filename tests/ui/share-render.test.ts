// R18 §S — เรนเดอร์คอมโพเนนต์แชร์นัด/แขกจริง (react-dom/server + next-intl) ทั้ง th/en: คีย์หาย/ICU ขาดตัวแปร/คีย์ดิบหลุด = ล้ม
// + ตรวจว่าหน้าที่แขกเห็น "ไม่มี" ข้อมูลที่ต้องไม่เห็น (ลิงก์กลุ่ม/ปุ่มแก้/ปุ่มชวน/ชื่อสมาชิก) — โครงเดียวกับ tests/i18n/render.test.ts
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import thMessages from '../../messages/th.json';
import enMessages from '../../messages/en.json';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, back: () => undefined, prefetch: () => undefined }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: () => undefined,
  notFound: () => undefined,
}));

import { CalendarView } from '@/components/calendar/CalendarView';
import { GuestAppointmentView } from '@/components/share/GuestAppointmentView';
import { GuestsSection } from '@/components/share/GuestsSection';
import { ShareLanding } from '@/components/share/ShareLanding';
import { ShareStatus } from '@/components/share/ShareStatus';
import type { GuestAppointmentDto, GuestsBlockDto, SharePreviewDto } from '@/lib/data/serializers/share';

const LOCALES = ['th', 'en'] as const;
type Locale = (typeof LOCALES)[number];
const MESSAGES = { th: thMessages, en: enMessages } as const;
const TOP_LEVEL = Object.keys(thMessages);
const RAW_KEY = new RegExp(`(?<![\\w./@-])(?:${TOP_LEVEL.join('|')})(?:\\.[A-Za-z][A-Za-z0-9_]*)+(?![\\w@-])`, 'g');

function render(locale: Locale, Component: ComponentType<never>, props: unknown): string {
  const html = renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      {
        locale,
        messages: MESSAGES[locale],
        timeZone: 'Asia/Bangkok',
        onError: (err: { code?: string; message: string }) => {
          throw new Error(`[${locale}] next-intl ${err.code ?? ''}: ${err.message}`);
        },
        getMessageFallback: ({ namespace, key }: { namespace?: string; key: string }) => {
          throw new Error(`[${locale}] ไม่พบข้อความ ${namespace ? `${namespace}.` : ''}${key}`);
        },
      } as never,
      createElement(Component, props as never),
    ),
  );
  const text = html.replace(/<[^>]*>/g, ' ');
  expect(text.match(RAW_KEY), `[${locale}] คีย์ดิบหลุดใน HTML`).toBeNull();
  expect(text).not.toMatch(/MISSING_MESSAGE|\[object Object\]/);
  return html;
}

const NOW = Date.UTC(2026, 11, 1, 5, 0, 0);
const DAY = 86_400_000;
const START = NOW + 5 * DAY;
const TOKEN = 'Xk3_a-B9zQ1mN2pR4sT6uV';

const preview = (over: Partial<SharePreviewDto> = {}): SharePreviewDto => ({
  state: 'ok',
  title: 'กินข้าวบ้านเฟิร์น',
  startAt: START,
  endAt: START + 2 * 3_600_000,
  tz: 'Asia/Bangkok',
  localDate: '2026-12-06',
  placeName: 'บ้านเฟิร์น',
  lat: null,
  lng: null,
  mapUrl: null,
  groupName: 'ก๊วนเสาร์',
  groupIcon: null,
  inviterName: 'เฟิร์น',
  counts: { going: 4, maybe: 2 },
  ...over,
});

const guestDto = (over: Partial<GuestAppointmentDto> = {}): GuestAppointmentDto => ({
  id: 'a1',
  viewerKind: 'guest',
  title: 'กินข้าวบ้านเฟิร์น',
  description: 'เอาขนมมาด้วย',
  startAt: START,
  endAt: START + 2 * 3_600_000,
  tz: 'Asia/Bangkok',
  localDate: '2026-12-06',
  placeName: 'บ้านเฟิร์น',
  lat: null,
  lng: null,
  mapUrl: null,
  groupName: 'ก๊วนเสาร์',
  groupIcon: null,
  status: 'active',
  isPast: false,
  daysUntil: 5,
  invitedBy: 'เฟิร์น',
  myRsvp: null,
  counts: { going: 4, maybe: 2 },
  permissions: { canRsvp: true, canLeave: true },
  myConflicts: [],
  myConflictsTruncated: false,
  ...over,
});

const guests = (n: number, canRemove = true): GuestsBlockDto => ({
  items: Array.from({ length: n }, (_, i) => ({
    userId: `g${i}`,
    displayName: `แขก${i}`,
    response: i === 0 ? 'going' : i === 1 ? 'not_going' : null,
    invitedBy: i % 2 === 0 ? { userId: 'u1', displayName: 'เฟิร์น', colorIndex: 1, shapeIndex: 1 } : null,
    canRemove,
  })),
  counts: { going: 1, maybe: 0, not_going: 1, noResponse: Math.max(0, n - 2) },
  max: 10,
});

describe.each(LOCALES)('แชร์นัด/แขก render (%s)', (locale) => {
  it('ShareStatus ทุกสถานะ — ไม่มีชื่อนัด/กลุ่ม · มีปุ่มกลับหน้าหลักเท่านั้น', () => {
    for (const kind of ['full', 'expired', 'invalid', 'rate'] as const) {
      const html = render(locale, ShareStatus as never, { kind });
      expect(html).toContain(`data-kind="${kind}"`);
      expect(html).toContain('data-testid="share-status-home"');
      expect(html).not.toContain('กินข้าว');
    }
    const full = render(locale, ShareStatus as never, { kind: 'full' });
    expect(full).toContain('10'); // {max}
  });

  it('ShareLanding ก่อน login: การ์ด + ตัวเลขล้วน + ปุ่ม login/สมัครพก next · ไม่มีปุ่มเพิ่มนัด', () => {
    const html = render(locale, ShareLanding as never, { token: TOKEN, preview: preview(), signedIn: false });
    expect(html).toContain('data-testid="share-title"');
    expect(html).toContain('กินข้าวบ้านเฟิร์น');
    expect(html).toContain('ก๊วนเสาร์');
    expect(html).toContain('เฟิร์น');
    expect(html).toContain(`href="/login?next=%2Fi%2F${TOKEN}"`);
    expect(html).toContain(`href="/signup?next=%2Fi%2F${TOKEN}"`);
    expect(html).toContain('href="/privacy#guest"');
    expect(html).not.toContain('data-testid="share-add"');
    expect(html).not.toContain('member-avatar'); // ไม่มี avatar สมาชิก
  });

  it('ShareLanding login แล้ว: ปุ่ม "เพิ่มนัดนี้" ปุ่มเดียว · ไม่มี login/signup', () => {
    const html = render(locale, ShareLanding as never, { token: TOKEN, preview: preview(), signedIn: true });
    expect(html).toContain('data-testid="share-add"');
    expect(html).not.toContain('data-testid="share-login"');
    expect(html).not.toContain('data-testid="share-signup"');
  });

  it('ShareLanding: ยังไม่มีใครตอบ / ไม่มีผู้ชวน / ไม่มีสถานที่ / state เต็ม', () => {
    const empty = render(locale, ShareLanding as never, { token: TOKEN, preview: preview({ counts: { going: 0, maybe: 0 }, inviterName: null, placeName: null }), signedIn: true });
    expect(empty).not.toContain('data-testid="share-invited-by"');
    expect(empty).not.toContain('data-testid="share-place"');
    const full = render(locale, ShareLanding as never, { token: TOKEN, preview: preview({ state: 'full' }), signedIn: true });
    expect(full).toContain('data-kind="full"');
    expect(full).not.toContain('กินข้าวบ้านเฟิร์น');
  });

  it('GuestsSection: ว่าง / มีแขก (ปุ่มนำออกตาม canRemove) / เต็ม', () => {
    const props = { appointmentId: 'a1', onRemoved: () => undefined };
    expect(render(locale, GuestsSection as never, { ...props, guests: guests(0) })).toContain('data-testid="guests-empty"');
    const some = render(locale, GuestsSection as never, { ...props, guests: guests(3) });
    expect(some.match(/data-testid="guest-row"/g)).toHaveLength(3);
    expect(some.match(/data-testid="guest-remove"/g)).toHaveLength(3);
    expect(render(locale, GuestsSection as never, { ...props, guests: guests(3, false) })).not.toContain('data-testid="guest-remove"');
    expect(render(locale, GuestsSection as never, { ...props, guests: guests(10) })).toContain('guests-limit is-full');
  });

  it('GuestAppointmentView: ไม่มีลิงก์กลุ่ม/ปุ่มแก้/ปุ่มชวน/รายชื่อ · มีตัวเลขรวม + ออกจากนัด', () => {
    const html = render(locale, GuestAppointmentView as never, { initial: guestDto(), nowMs: NOW, appOrigin: 'https://example.test' });
    expect(html).toContain('data-testid="guest-banner"');
    expect(html).toContain('data-testid="guest-badge"');
    expect(html).toContain('data-testid="guest-counts"');
    expect(html).toContain('data-testid="guest-leave"');
    expect(html).toContain('data-testid="appt-group-text"');
    expect(html).not.toContain('/groups/');
    expect(html).not.toContain('data-testid="appt-edit');
    expect(html).not.toContain('data-testid="appt-cancel');
    expect(html).not.toContain('data-testid="share-invite"');
    expect(html).not.toContain('data-testid="appt-who"');
  });

  it('GuestAppointmentView: ยกเลิก/ผ่านแล้ว/ไม่มีผู้ชวน/ไม่มีรายละเอียด · ตอบ "ไป" แล้วมีปุ่มปฏิทิน', () => {
    expect(render(locale, GuestAppointmentView as never, { initial: guestDto({ status: 'cancelled', permissions: { canRsvp: false, canLeave: true } }), nowMs: NOW, appOrigin: '' })).toContain('data-status="cancelled"');
    render(locale, GuestAppointmentView as never, { initial: guestDto({ isPast: true, daysUntil: -1, permissions: { canRsvp: false, canLeave: true } }), nowMs: START + 5 * DAY, appOrigin: '' });
    const bare = render(locale, GuestAppointmentView as never, { initial: guestDto({ invitedBy: null, description: null, placeName: null }), nowMs: NOW, appOrigin: '' });
    expect(bare).not.toContain('data-testid="appt-detail-description"');
    expect(render(locale, GuestAppointmentView as never, { initial: guestDto({ myRsvp: 'going' }), nowMs: NOW, appOrigin: '' })).toContain('data-testid="appt-add-calendar"');
  });
});

// ───────── R18 H4: ปฏิทิน "ของฉัน" โดน 429 → ข้อความ "ลองใหม่อีกครั้ง" (ไม่ใช่ข้อผิดพลาดทั่วไป) ─────────

describe.each(LOCALES)('ปฏิทิน 429 ของ GET /api/me/busy (%s)', (locale) => {
  const base = {
    groups: [{ id: 'g1', name: 'ก๊วน', icon: null, memberCount: 3, tz: 'Asia/Bangkok' }],
    gid: 'g1',
    tz: 'Asia/Bangkok',
    userId: 'u1',
    initialToday: '2026-12-01',
    initialNowMs: NOW,
    initialDate: '2026-12-01',
    initialView: 'mine',
    initial: { status: 'skipped' },
  };
  it('rateLimited → ข้อความ busyRateLimited + ปุ่มลองใหม่ · ไม่ใช่ข้อความ error ทั่วไป', () => {
    const t = (MESSAGES[locale] as unknown as { calendar: { busyRateLimited: { title: string } }; busy: { mine: { error: { title: string } } } });
    const html = render(locale, CalendarView as never, { ...base, initialMine: { status: 'error', rateLimited: true } });
    expect(html).toContain('data-testid="cal-busy-rate-limited"');
    expect(html).toContain(t.calendar.busyRateLimited.title);
    expect(html).not.toContain(t.busy.mine.error.title);
  });
  it('error ธรรมดา → ข้อความเดิม', () => {
    const t = (MESSAGES[locale] as unknown as { busy: { mine: { error: { title: string } } } });
    const html = render(locale, CalendarView as never, { ...base, initialMine: { status: 'error' } });
    expect(html).toContain('data-testid="cal-error"');
    expect(html).toContain(t.busy.mine.error.title);
    expect(html).not.toContain('data-testid="cal-busy-rate-limited"');
  });
});
