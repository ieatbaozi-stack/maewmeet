"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons/Icon";
import { MAP_ZOOM, OSM_COPYRIGHT_URL, mapOpenLink, tileGrid, type MapTarget } from "./map-model";

/** ถ้า tile ไม่โหลดภายในเวลานี้หลังเห็นแผนที่ → ถือว่าโหลดไม่ได้ (ถูกบล็อก/ออฟไลน์) */
const MAP_TIMEOUT_MS = 10_000;

type MapStatus = "loading" | "ok" | "failed";

/**
 * แผนที่หน้ารายละเอียดนัด (X59): กริด tile OSM 3×3 ที่ zoom 15 + หมุด CSS — ไม่มีไลบรารีแผนที่ ไม่มีสคริปต์ภายนอก
 * tile จาก tile.openstreetmap.org (CSP เดิมอนุญาต) · เครดิต © OpenStreetMap contributors เป็นลิงก์ใต้แผนที่ (เป้าแตะ ≥ --tap)
 * โหลดไม่ได้ (onError ที่ tile กลาง/เกินครึ่ง/หมดเวลา) → ข้อความ + ปุ่มเปิดแอป (ชื่อ/พิกัดแสดงในหน้าอยู่แล้ว)
 */
export function PlaceMap({ name, lat, lng }: { name: string; lat: number; lng: number }) {
  const t = useTranslations("places");
  const grid = tileGrid(lat, lng, MAP_ZOOM);
  const boxRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
  const [errored, setErrored] = useState<ReadonlySet<string>>(new Set());
  const [timedOut, setTimedOut] = useState(false);

  const real = grid.cells.filter((c) => c.url !== null);
  const centerKey = grid.cells[Math.floor(grid.cells.length / 2)]!.key;
  const status: MapStatus =
    timedOut || errored.has(centerKey) || errored.size * 2 > real.length ? "failed" : loaded.has(centerKey) ? "ok" : "loading";

  const markLoaded = (k: string) => setLoaded((s) => (s.has(k) ? s : new Set(s).add(k)));
  const markError = (k: string) => setErrored((s) => (s.has(k) ? s : new Set(s).add(k)));

  // รูปที่โหลดเสร็จ/พังก่อน hydrate (onLoad/onError ไม่ถูกเรียก) + จับเวลาเมื่อแผนที่เข้าจอ
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    box.querySelectorAll<HTMLImageElement>("img[data-tile]").forEach((img) => {
      const k = img.dataset.tile!;
      if (img.complete) (img.naturalWidth > 0 ? markLoaded : markError)(k);
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      timer ??= setTimeout(() => setTimedOut(true), MAP_TIMEOUT_MS);
    };
    let io: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === "undefined") start();
    else {
      io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          start();
          io?.disconnect();
        }
      });
      io.observe(box);
    }
    return () => {
      io?.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);

  // หมดเวลาแต่ tile กลางโหลดทันแล้ว = ปกติ
  const failed = status === "failed" && !(timedOut && loaded.has(centerKey) && !errored.has(centerKey));
  const shownStatus: MapStatus = failed ? "failed" : status === "failed" ? "ok" : status;

  return (
    <figure className="map-fig" data-testid="place-map" data-status={shownStatus}>
      <div ref={boxRef} className="map-box" role="img" aria-label={t("map.region", { name })}>
        {shownStatus === "failed" ? (
          <div className="map-fallback" data-testid="place-map-failed">
            <Icon name="map-pin" />
            <b>{t("map.failed.title")}</b>
            <span>{t("map.failed.body")}</span>
          </div>
        ) : (
          <>
            <div
              className="map-canvas"
              aria-hidden="true"
              style={{
                left: "50%",
                top: "50%",
                inset: "auto",
                width: `${grid.size * 50}%`,
                aspectRatio: "1",
                transform: `translate(${-grid.marker.x * 100}%, ${-grid.marker.y * 100}%)`,
                display: "grid",
                gridTemplateColumns: `repeat(${grid.size}, minmax(0, 1fr))`,
                position: "absolute",
              }}
            >
              {grid.cells.map((c) =>
                c.url === null ? (
                  <span key={c.key} />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- tile ภายนอก (OSM) ขนาดคงที่: ไม่ผ่าน next/image optimizer (ไม่เพิ่ม remotePatterns/CSP)
                  <img
                    key={c.key}
                    src={c.url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    data-tile={c.key}
                    style={{ display: "block", width: "100%", height: "100%" }}
                    onLoad={() => markLoaded(c.key)}
                    onError={() => markError(c.key)}
                  />
                ),
              )}
            </div>
            <span className="map-pin" aria-hidden="true">
              <Icon name="map-pin" />
            </span>
            {shownStatus === "loading" ? (
              <div className="map-loading" role="status" data-testid="place-map-loading">
                <Icon name="refresh-cw" size="sm" className="ov-spin" />
                <span style={{ marginLeft: "var(--space-2)" }}>{t("map.loading")}</span>
              </div>
            ) : null}
          </>
        )}
      </div>
      {shownStatus === "failed" ? null : (
        <figcaption className="map-caption">
          <a href={OSM_COPYRIGHT_URL} target="_blank" rel="noopener noreferrer" data-testid="place-map-attribution">
            {t("map.attribution")}
          </a>
        </figcaption>
      )}
    </figure>
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
      <span>{linkOnly ? t("openLink", { host }) : t("open")}</span>
    </a>
  );
}

