"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Cat } from "@/components/brand";
import { Icon } from "@/components/icons/Icon";
import { useNotifications } from "@/components/shell/NotificationsProvider";
import type { CalendarLocale } from "@/lib/calendar";
import { fetchNotifications, markRead } from "./api";
import {
  NOTIFICATION_RETENTION_DAYS,
  markAllRead,
  markIdsRead,
  mergePage,
  notificationView,
  timeLabel,
  type NotificationItem,
  type NotificationPage,
} from "./model";

export interface NotificationsViewProps {
  /** null = โหลดฝั่งเซิร์ฟเวอร์ไม่สำเร็จ → แสดงสถานะผิดพลาด + ลองอีกครั้ง */
  initial: NotificationPage | null;
  /** เวลาของเซิร์ฟเวอร์ตอนเรนเดอร์ — ใช้ตอนเรนเดอร์ครั้งแรกเพื่อให้ hydrate ตรงกัน (ห้ามอ่านนาฬิกาในเรนเดอร์) */
  initialNowMs: number;
}

type Status = "ready" | "loading" | "error";

export function NotificationsView({ initial, initialNowMs }: NotificationsViewProps) {
  const t = useTranslations();
  const locale = useLocale() as CalendarLocale;
  const { setUnread, markedOne, refresh } = useNotifications();

  const [status, setStatus] = useState<Status>(initial ? "ready" : "error");
  const [items, setItems] = useState<NotificationItem[]>(initial?.notifications ?? []);
  const [cursor, setCursor] = useState<string | null>(initial?.nextCursor ?? null);
  const [unread, setLocalUnread] = useState<number>(initial?.unreadCount ?? 0);
  const [nowMs, setNowMs] = useState(initialNowMs);
  const [marking, setMarking] = useState(false);
  const [markFailed, setMarkFailed] = useState(false);
  const [justMarked, setJustMarked] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const focusId = useRef<string | null>(null);

  const seq = useRef(0); // stale-response guard ของการโหลด (ลองใหม่/โหลดเพิ่ม)
  const statusRef = useRef<HTMLParagraphElement>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      seq.current += 1;
    };
  }, []);

  // นาฬิกาสำหรับป้าย "N นาทีที่แล้ว" — เริ่มหลัง mount เท่านั้น
  useEffect(() => {
    const first = window.setTimeout(() => setNowMs(Date.now()), 0);
    const h = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(h);
    };
  }, []);

  // ซิงก์จำนวนของกระดิ่งกับที่เซิร์ฟเวอร์ให้มากับหน้านี้
  useEffect(() => {
    if (initial) setUnread(initial.unreadCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = focusId.current;
    if (!id) return;
    focusId.current = null;
    document.querySelector<HTMLElement>(`[data-notif-id="${CSS.escape(id)}"]`)?.focus();
  }, [items]);

  const apply = useCallback(
    (page: NotificationPage, mode: "replace" | "append") => {
      setItems((cur) => (mode === "replace" ? page.notifications : mergePage(cur, page.notifications)));
      setCursor(page.nextCursor);
      setLocalUnread(page.unreadCount);
      setUnread(page.unreadCount);
    },
    [setUnread],
  );

  const reload = useCallback(async () => {
    seq.current += 1;
    const mine = seq.current;
    setStatus("loading");
    const r = await fetchNotifications();
    if (!alive.current || mine !== seq.current) return;
    if (r.ok) {
      apply(r.data, "replace");
      setMarkFailed(false);
      setStatus("ready");
    } else {
      setStatus("error");
    }
  }, [apply]);

  const loadMore = useCallback(async () => {
    if (!cursor || moreBusy) return;
    seq.current += 1;
    const mine = seq.current;
    const firstNew = items[items.length - 1]?.id ?? null;
    setMoreBusy(true);
    setMoreFailed(false);
    const r = await fetchNotifications({ cursor });
    if (!alive.current || mine !== seq.current) return;
    setMoreBusy(false);
    if (!r.ok) {
      setMoreFailed(true);
      return;
    }
    const known = new Set(items.map((i) => i.id));
    const next = r.data.notifications.find((i) => !known.has(i.id));
    focusId.current = next?.id ?? firstNew;
    apply(r.data, "append");
  }, [apply, cursor, items, moreBusy]);

  const markAll = useCallback(async () => {
    if (marking) return;
    setMarking(true);
    setMarkFailed(false);
    const r = await markRead({ all: true });
    if (!alive.current) return;
    setMarking(false);
    if (!r.ok) {
      setMarkFailed(true);
      return;
    }
    setItems((cur) => markAllRead(cur, Date.now()));
    setLocalUnread(r.data.unreadCount);
    setUnread(r.data.unreadCount);
    setJustMarked(true);
    // ปุ่ม "อ่านทั้งหมด" หายไป → ย้ายโฟกัสมาที่บรรทัดสถานะ ไม่ให้หลุดไปต้นหน้า
    window.setTimeout(() => statusRef.current?.focus(), 0);
  }, [marking, setUnread]);

  /** แตะแถว: ทำเครื่องหมายอ่านทันทีในเครื่อง + ยิง API (keepalive เพราะกำลังเปลี่ยนหน้า) */
  const open = useCallback(
    (item: NotificationItem) => {
      const wasUnread = item.readAt === null;
      if (!wasUnread) return;
      setItems((cur) => markIdsRead(cur, [item.id], Date.now()));
      setLocalUnread((n) => Math.max(0, n - 1));
      markedOne(true);
      void markRead({ ids: [item.id] }, { keepalive: true }).then((r) => {
        if (r.ok) {
          setUnread(r.data.unreadCount);
          if (alive.current) setLocalUnread(r.data.unreadCount);
        } else {
          refresh();
        }
      });
    },
    [markedOne, refresh, setUnread],
  );

  const showMarkAll = status === "ready" && unread > 0;

  return (
    <>
      <header className="topbar">
        <Link className="icon-btn" href="/" aria-label={t("notifications.back")} data-testid="notif-back">
          <Icon name="arrow-left" />
        </Link>
        <h1 className="title" style={{ fontSize: "var(--text-lg)" }}>
          {t("notifications.title")}
        </h1>
        {showMarkAll ? (
          <button
            type="button"
            className="btn btn-text"
            aria-label={t("notifications.markAllAria")}
            aria-busy={marking}
            disabled={marking}
            onClick={() => void markAll()}
            data-testid="notif-mark-all"
          >
            <span>{marking ? t("notifications.marking") : t("notifications.markAll")}</span>
          </button>
        ) : null}
      </header>
      <main className="main" id="main" aria-busy={status === "loading"}>
        {status === "loading" ? <LoadingBlock /> : null}
        {status === "error" ? (
          <>
            <div className="alert" role="alert" data-testid="notif-error">
              <Icon name="circle-alert" />
              <div>
                <b>{t("notifications.error.title")}</b>
                <span>{t("notifications.error.body")}</span>
              </div>
            </div>
            <button type="button" className="btn btn-secondary" style={{ marginTop: "var(--space-3)" }} onClick={() => void reload()} data-testid="notif-retry">
              <Icon name="refresh-cw" />
              <span>{t("states.retry")}</span>
            </button>
          </>
        ) : null}
        {status === "ready" ? (
          <>
            <p
              className="notif-sub"
              role="status"
              ref={statusRef}
              tabIndex={-1}
              style={{ marginBottom: "var(--space-3)" }}
              data-testid="notif-unread-count"
            >
              {t("notifications.unreadCount", { count: unread })}
              {justMarked ? <span className="sr-only"> · {t("notifications.markedAll")}</span> : null}
            </p>
            {markFailed ? (
              <div className="alert" role="alert" style={{ marginBottom: "var(--space-3)" }} data-testid="notif-mark-error">
                <Icon name="circle-alert" />
                <div>
                  <span>{t("notifications.markError")}</span>
                </div>
              </div>
            ) : null}
            {items.length === 0 ? (
              <section className="empty panel" data-testid="notif-empty">
                <Cat pose="sleep" size="lg" />
                <h2 className="h-section">{t("notifications.empty.title")}</h2>
                <p className="muted">{t("notifications.empty.body")}</p>
              </section>
            ) : (
              <>
                <div className="notif-card">
                  <ul className="notif-list" data-testid="notif-list">
                    {items.map((item) => (
                      <li key={item.id}>
                        <Row item={item} nowMs={nowMs} locale={locale} onOpen={open} />
                      </li>
                    ))}
                  </ul>
                </div>
                {moreFailed ? (
                  <div className="alert" role="alert" style={{ marginTop: "var(--space-3)" }} data-testid="notif-more-error">
                    <Icon name="circle-alert" />
                    <div>
                      <b>{t("notifications.error.title")}</b>
                      <span>{t("notifications.error.body")}</span>
                    </div>
                  </div>
                ) : null}
                {cursor ? (
                  <div className="notif-foot">
                    <button type="button" className="btn btn-secondary" aria-busy={moreBusy} disabled={moreBusy} onClick={() => void loadMore()} data-testid="notif-load-more">
                      <span>{moreBusy ? t("notifications.loadingMore") : t("notifications.loadMore")}</span>
                    </button>
                  </div>
                ) : null}
                <p className="notif-retention">{t("notifications.retention", { days: NOTIFICATION_RETENTION_DAYS })}</p>
              </>
            )}
          </>
        ) : null}
      </main>
    </>
  );
}

function LoadingBlock() {
  const t = useTranslations();
  return (
    <>
      <div className="notif-card" aria-hidden="true" data-testid="notif-loading">
        <div className="notif-skel">
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      </div>
      <p className="loading-note" role="status">
        <Icon name="refresh-cw" size="sm" />
        <span>{t("notifications.loading")}</span>
      </p>
    </>
  );
}

function Row({ item, nowMs, locale, onOpen }: { item: NotificationItem; nowMs: number; locale: CalendarLocale; onOpen: (i: NotificationItem) => void }) {
  const t = useTranslations();
  const view = notificationView(item.kind, item.params, locale, t("account.deletedName"));
  const tl = timeLabel(item.createdAt, nowMs, locale);
  const isUnread = item.readAt === null;
  const className = `notif-row${isUnread ? " is-unread" : ""}`;
  const body = (
    <>
      <span className={`notif-ico${view.tone === "plain" ? "" : ` k-${view.tone}`}`} aria-hidden="true">
        <Icon name={view.icon} />
      </span>
      <span className="notif-body">
        <span className="notif-msg">
          {isUnread ? <span className="sr-only">{t("notifications.unreadSr")} · </span> : null}
          <span>{t(view.messageKey, view.values)}</span>
        </span>
        <span className="notif-time">{t(tl.key, tl.values)}</span>
      </span>
      {isUnread ? <span className="notif-dot" aria-hidden="true" /> : null}
      {view.href ? <Icon name="chevron-right" className="notif-chev" /> : null}
    </>
  );
  const common = { className, "data-notif-id": item.id, "data-unread": isUnread ? "true" : "false", "data-testid": "notif-row" } as const;
  if (view.href) {
    return (
      <Link {...common} href={view.href} onClick={() => onOpen(item)} onAuxClick={() => onOpen(item)}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" {...common} onClick={() => onOpen(item)}>
      {body}
    </button>
  );
}
