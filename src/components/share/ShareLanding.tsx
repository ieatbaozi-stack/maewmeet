"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Cat } from "@/components/brand";
import { setFlash } from "@/components/groups/flash";
import { GroupIcon } from "@/components/icons/GroupIcon";
import { Icon } from "@/components/icons/Icon";
import { Name, withNames } from "@/components/Name";
import { callApiFull } from "@/components/appointments/api";
import { actionFailureRef } from "@/components/appointments/model";
import { placeView, longDateLabel, timeRange } from "@/components/home/model";
import { MapAppLinks, OpenInMaps } from "@/components/places/MapAppLinks";
import { mapOpenLink } from "@/components/places/map-model";
import { BusyButton } from "@/components/shell/BusyButton";
import { signalNavStart } from "@/components/shell/nav-start";
import type { CalendarLocale } from "@/lib/calendar";
import type { SharePreviewDto } from "@/lib/data/serializers/share";
import { ShareStatus, type ShareStatusKind } from "./ShareStatus";
import { authHref, joinFailure, previewCountParts } from "./model";

/**
 * หน้าลิงก์ชวน (UX R18_SHARE_FLOW §3): การ์ดนัด (ไม่มีรายชื่อ/avatar/รายละเอียด) + ปุ่มเดียว
 * ยังไม่ login → เข้าสู่ระบบ/สมัคร (พก next=/i/<token>) · login แล้ว → "เพิ่มนัดนี้" (POST /api/share/join)
 * ผลของ join ตัดสินที่เซิร์ฟเวอร์ — เต็ม/หมดอายุ/ใช้ไม่ได้ระหว่างนั้นสลับเป็นหน้าสถานะที่ตรง
 */
export function ShareLanding({ token, preview, signedIn }: { token: string; preview: SharePreviewDto; signedIn: boolean }) {
  const t = useTranslations();
  const locale = useLocale() as CalendarLocale;
  const router = useRouter();
  const uid = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ShareStatusKind | null>(preview.state === "full" ? "full" : null);

  if (status !== null) return <ShareStatus kind={status} />;

  const when = timeRange(preview, locale);
  const whenText = when.kind === "overnight" ? t("appointments.when.overnight", { start: when.start, end: when.end }) : when.text;
  const place = placeView(preview);
  const target = { placeName: preview.placeName, lat: preview.lat, lng: preview.lng, mapUrl: preview.mapUrl };
  const counts = previewCountParts(preview.counts);

  async function add() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await callApiFull<{ status: "guest" | "member"; appointmentId: string; joined: boolean }>("/api/share/join", { method: "POST", body: { token } });
    if (res.ok) {
      if (res.data.joined) setFlash({ key: "shareLanding.added", values: {} });
      const dest = `/appointments/${encodeURIComponent(res.data.appointmentId)}`;
      signalNavStart(dest);
      router.replace(dest);
      router.refresh();
      return; // ค้างสถานะ busy จนกว่าหน้าจะเปลี่ยน
    }
    setBusy(false);
    const why = joinFailure(res);
    if (why === "full" || why === "expired" || why === "invalid") {
      setStatus(why);
      return;
    }
    // rate: ข้อความกลางของ RATE_LIMITED · อื่นๆ: shareLanding.addError (ปุ่มกดซ้ำได้)
    const ref = why === "rate" ? actionFailureRef(res, "shareLanding.addError") : { key: "shareLanding.addError", values: {} };
    setError(t(ref.key, ref.values));
  }

  return (
    <section className="panel login-card share-card" aria-labelledby={`${uid}-t`} data-testid="share-landing">
      <Cat pose="sit" size="sm" className="share-cat" />
      {preview.inviterName ? (
        <p className="share-invited" data-testid="share-invited-by">
          {withNames((n) => t("shareLanding.invitedBy", { name: n.name }), { name: preview.inviterName })}
        </p>
      ) : null}
      <h1 className="share-title" id={`${uid}-t`} data-testid="share-title">
        <Name>{preview.title}</Name>
      </h1>
      <ul className="share-facts">
        <li>
          <Icon name="calendar" />
          <span className="num" data-testid="share-when">
            {longDateLabel(preview, locale)} · {whenText}
          </span>
        </li>
        {place || preview.placeName ? (
          <li data-testid="share-place">
            <Icon name="map-pin" />
            <span className="appt-place">
              {place && !place.linkOnly ? <Name>{place.label}</Name> : null}
              {mapOpenLink(target) !== null ? (
                <OpenInMaps target={target} name={preview.placeName ?? t("places.selected.defaultName")} />
              ) : preview.placeName ? (
                <MapAppLinks name={preview.placeName} variant="find" />
              ) : null}
            </span>
          </li>
        ) : null}
        <li data-testid="share-group">
          <GroupIcon icon={preview.groupIcon} variant="glyph" />
          <span>{withNames((n) => t("shareLanding.inGroup", { group: n.group }), { group: preview.groupName })}</span>
        </li>
      </ul>
      {counts.none ? (
        <p className="muted" data-testid="share-counts">
          {t("shareLanding.counts.none")}
        </p>
      ) : (
        <p className="rsvp-counts share-counts" role="group" aria-label={t("shareLanding.counts.aria", { going: counts.going ?? 0, maybe: counts.maybe ?? 0 })} data-testid="share-counts">
          {counts.going !== null ? (
            <span className="rsvp-count" data-answer="going">
              <Icon name="circle-check" size="sm" />
              <span>{t("shareLanding.counts.going", { count: counts.going })}</span>
            </span>
          ) : null}
          {counts.maybe !== null ? (
            <span className="rsvp-count" data-answer="maybe">
              <Icon name="circle-help" size="sm" />
              <span>{t("shareLanding.counts.maybe", { count: counts.maybe })}</span>
            </span>
          ) : null}
        </p>
      )}

      <div className="share-cta">
        {signedIn ? (
          <BusyButton className="btn btn-primary" busy={busy} busyLabel={t("shareLanding.cta.adding")} idleLabel={t("shareLanding.cta.add")} onClick={() => void add()} data-testid="share-add" />
        ) : (
          <>
            <p className="share-hint">{t("shareLanding.loginHint")}</p>
            <Link className="btn btn-primary" href={authHref("/login", token)} data-testid="share-login">
              {t("shareLanding.cta.login")}
            </Link>
            <Link className="btn btn-secondary" href={authHref("/signup", token)} data-testid="share-signup">
              {t("shareLanding.cta.signup")}
            </Link>
          </>
        )}
        <p className="form-error" role="alert" data-testid="share-add-error">
          {error}
        </p>
      </div>
      <p className="share-note">{t("shareLanding.note")}</p>
      <Link className="share-privacy" href="/privacy#guest" data-testid="share-privacy">
        {t("shareLanding.privacyLink")}
      </Link>
    </section>
  );
}
