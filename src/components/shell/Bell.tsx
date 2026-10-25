"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { badgeText, bellCount } from "@/components/notifications/model";
import { Icon } from "@/components/icons/Icon";
import { useNotifications } from "./NotificationsProvider";

/**
 * กระดิ่งแจ้งเตือนในหัวของทุกแท็บ (UX X64) → /notifications · ตัวเลข = สัญญาณที่ไม่ใช่สี (>9 = "9+")
 * aria-label มีจำนวนที่ยังไม่อ่าน · แจ้ง screen reader เมื่อจำนวนเปลี่ยนหลังโหลด (live region) — ไม่ประกาศค่าตอนเปิดหน้า
 */
export function Bell() {
  const t = useTranslations();
  const { unread } = useNotifications();
  const count = bellCount(unread);
  const text = badgeText(unread);
  const prev = useRef(count);
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    if (prev.current !== count) {
      prev.current = count;
      setAnnounce(t("notifications.unreadCount", { count }));
    }
  }, [count, t]);

  return (
    <>
      <Link href="/notifications" className="icon-btn bell" aria-label={t("notifications.bell.aria", { count })} data-testid="bell">
        <Icon name="bell" />
        {text ? (
          <span className="bell-badge" aria-hidden="true" data-testid="bell-badge">
            {text}
          </span>
        ) : null}
      </Link>
      <span className="sr-only" role="status" aria-live="polite" data-testid="bell-live">
        {announce}
      </span>
    </>
  );
}
