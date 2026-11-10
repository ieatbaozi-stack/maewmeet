"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons/Icon";
import { detectMapApps, mapOpenLink, mapSearchLink, type MapApp, type MapTarget } from "./map-model";

const subscribe = (): (() => void) => () => {};
/** ชนิดเครื่องจาก user agent (client เท่านั้น) · คืนสตริงคงที่เพื่อให้ useSyncExternalStore เทียบค่าได้ */
const clientSnapshot = (): string => detectMapApps(typeof navigator === "undefined" ? "" : navigator.userAgent).join(",");
/** server render และ hydrate รอบแรก = Google อย่างเดียว (ไม่เกิด hydration mismatch) แล้วเพิ่ม Apple หลัง mount */
const serverSnapshot = (): string => "google";

export function useMapApps(): MapApp[] {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot).split(",") as MapApp[];
}

/**
 * ปุ่มเปิดแอปแผนที่ (R13 §1.1/§1.2): ลิงก์ https ธรรมดา เปิดแท็บใหม่ · ชื่อถูกส่งไปผู้ให้บริการเฉพาะตอนผู้ใช้กดเอง
 * variant "apps" = ในฟอร์ม (Apple Maps / Google Maps) · "find" = หน้ารายละเอียด (ค้นหาใน ...)
 */
export function MapAppLinks({ name, variant, groupLabel }: { name: string | null; variant: "apps" | "find"; groupLabel?: string }) {
  const t = useTranslations("places");
  const apps = useMapApps();
  const clean = (name ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  return (
    <div className={variant === "find" ? "map-apps is-find" : "map-apps"} role="group" aria-label={groupLabel} data-testid="map-apps" data-apps={apps.join(",")}>
      {apps.map((app) => {
        const label =
          variant === "apps"
            ? clean === ""
              ? t(`apps.${app}AriaBlank`)
              : t(`apps.${app}Aria`, { name: clean })
            : t(`find.${app}Aria`, { name: clean });
        return (
          <a
            key={app}
            className="btn btn-secondary map-app"
            href={mapSearchLink(app, clean)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label}
            data-testid={`map-app-${app}`}
          >
            <Icon name="map-pin" />
            <span>{variant === "apps" ? t(`apps.${app}`) : t(`find.${app}`)}</span>
          </a>
        );
      })}
    </div>
  );
}

/** ปุ่ม "เปิดในแอปแผนที่": ลิงก์ https ของผู้ใช้ (แท็บใหม่ noopener) หรือ geo: (ให้ระบบเลือกแอป) · ไม่มีทั้งคู่ → ไม่แสดง */
export function OpenInMaps({ target, name }: { target: MapTarget; name: string }) {
  const t = useTranslations("places");
  const link = mapOpenLink(target);
  if (!link) return null;
  const linkOnly = target.lat === null || target.lng === null;
  const host = link.host ?? "";
  return (
    <a
      className="btn btn-secondary map-open"
      href={link.href}
      target={link.target}
      rel={link.rel}
      aria-label={linkOnly ? t("openLinkAria", { name, host }) : t("openAria", { name })}
      data-testid="place-open"
      data-kind={link.kind}
    >
      <Icon name="external-link" />
      <span className="map-open-text">{linkOnly ? t("openLink", { host }) : t("open")}</span>
    </a>
  );
}
