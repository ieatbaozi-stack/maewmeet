"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons/Icon";
import { parseLocationInput } from "@/lib/shared/location-parse";
import { PLACE_NAME_MAX, textLength, type FormProblem, type PlaceValue } from "@/components/appointments/model";
import { MapAppLinks } from "./MapAppLinks";

export type PlaceLinkError = "INVALID_MAP_URL" | "INVALID_COORDINATES";

export interface PlaceFieldProps {
  value: PlaceValue | null;
  onChange: (next: PlaceValue | null) => void;
  /** ข้อผิดพลาดจากเซิร์ฟเวอร์/ตรวจก่อนส่ง (ชื่อยาวเกิน ลิงก์ผิด ฯลฯ) */
  problem: FormProblem | null;
  /** แจ้งฟอร์มว่าช่องลิงก์ตอนนี้ผิดรูปแบบไหม (null = ถูก/ว่าง) — ฟอร์มใช้กันบันทึกลิงก์ที่ผิด */
  onLinkError?: (error: PlaceLinkError | null) => void;
}

const clip = (v: string, max: number): string => {
  const chars = [...v];
  return chars.length > max ? chars.slice(0, max).join("") : v;
};

/** ค่าเริ่มของช่องลิงก์: มีลิงก์ใช้ลิงก์ (รวมลิงก์ OSM ของนัดเก่า) · มีแต่พิกัด (นัดเก่า) แสดงเป็น lat,lng · ไม่มี = ว่าง */
export function linkTextOf(v: PlaceValue | null): string {
  if (!v) return "";
  if (v.mapUrl) return v.mapUrl;
  if (v.lat !== null && v.lng !== null) return `${v.lat},${v.lng}`;
  return "";
}

const placeOf = (name: string, link: Pick<PlaceValue, "lat" | "lng" | "mapUrl">): PlaceValue | null => {
  const n = name.trim() === "" ? null : name;
  return n === null && link.lat === null && link.mapUrl === null ? null : { name: n, ...link };
};

/**
 * ช่องสถานที่ (R13 §1.1): ชื่อ + ลิงก์แผนที่ เห็นตลอด แก้ได้อิสระ · ตรวจลิงก์/พิกัดด้วย parseLocationInput (เซิร์ฟเวอร์ตรวจซ้ำ)
 * ปุ่ม Google/Apple Maps เป็นลิงก์ https เปิดแท็บใหม่ — ชื่อถูกส่งไปผู้ให้บริการเฉพาะตอนผู้ใช้กดเอง · ไม่มีการค้นหาในแอป
 */
export function PlaceField({ value, onChange, problem, onLinkError }: PlaceFieldProps) {
  const t = useTranslations();
  const uid = useId();
  const [name, setName] = useState(value?.name ?? "");
  const [linkText, setLinkText] = useState(() => linkTextOf(value));
  const [linkError, setLinkError] = useState<PlaceLinkError | null>(null);
  // ค่าลิงก์ที่ยืนยันแล้ว (ใช้ตอนแก้แต่ชื่อ: ไม่แปลงลิงก์/พิกัดเดิมซ้ำ จึงบันทึกกลับได้ค่าเดิม)
  const [link, setLink] = useState<Pick<PlaceValue, "lat" | "lng" | "mapUrl">>({ lat: value?.lat ?? null, lng: value?.lng ?? null, mapUrl: value?.mapUrl ?? null });

  const nameId = `${uid}-n`;
  const linkId = `${uid}-l`;
  const nameHintId = `${uid}-nh`;
  const linkHintId = `${uid}-lh`;
  const linkErrId = `${uid}-le`;

  function typeName(v: string) {
    const next = clip(v, PLACE_NAME_MAX);
    setName(next);
    onChange(placeOf(next, link));
  }

  function typeLink(v: string) {
    setLinkText(v);
    if (v.trim() === "") {
      const none = { lat: null, lng: null, mapUrl: null };
      setLink(none);
      setLinkError(null);
      onLinkError?.(null);
      onChange(placeOf(name, none));
      return;
    }
    const parsed = parseLocationInput(v);
    if (!parsed.ok) {
      const err: PlaceLinkError = parsed.reason === "INVALID_COORDINATES" ? "INVALID_COORDINATES" : "INVALID_MAP_URL";
      const none = { lat: null, lng: null, mapUrl: null };
      setLink(none);
      onLinkError?.(err);
      onChange(placeOf(name, none));
      return;
    }
    const ok = { lat: parsed.lat, lng: parsed.lng, mapUrl: parsed.mapUrl };
    setLink(ok);
    setLinkError(null);
    onLinkError?.(null);
    onChange(placeOf(name, ok));
  }

  /** แสดงข้อผิดพลาดลิงก์ตอนออกจากช่อง (ไม่ขัดจังหวะตอนกำลังวาง/พิมพ์) */
  function checkLink() {
    if (linkText.trim() === "") return setLinkError(null);
    const parsed = parseLocationInput(linkText);
    setLinkError(parsed.ok ? null : parsed.reason === "INVALID_COORDINATES" ? "INVALID_COORDINATES" : "INVALID_MAP_URL");
  }

  // ข้อผิดพลาดของช่องลิงก์: จากเซิร์ฟเวอร์/ตอนกดบันทึก (problem) มาก่อน ไม่งั้นที่ตรวจในช่อง
  const linkProblemKey = problem && (problem.ref.key === "errors.INVALID_MAP_URL" || problem.ref.key === "errors.INVALID_COORDINATES") ? problem.ref.key : null;
  const shownLinkError = linkProblemKey ?? (linkError ? `errors.${linkError}` : null);
  const nameProblem = problem && !linkProblemKey ? problem : null;
  const nameCount = textLength(name);

  return (
    <div className="field place-field" id={`${uid}-place`} data-testid="place-field">
      <div className="field-label-row">
        <label htmlFor={nameId}>
          {t("places.label")} <span className="opt">({t("appointments.form.optional")})</span>
        </label>
      </div>
      <div className={nameProblem ? "input has-error" : "input"}>
        <Icon name="map-pin" />
        <input
          id={nameId}
          className="input-bare"
          value={name}
          autoComplete="off"
          placeholder={t("places.name.placeholder")}
          aria-describedby={nameHintId}
          aria-invalid={nameProblem ? true : undefined}
          data-testid="place-query"
          onChange={(e) => typeName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault(); // ไม่ให้ Enter ส่งฟอร์มนัด
          }}
        />
      </div>
      <p className="field-hint" id={nameHintId}>
        {t("places.name.hint")} <span className="num">{nameCount}/{PLACE_NAME_MAX}</span>
      </p>
      {nameProblem ? <PlaceProblem problem={nameProblem} /> : null}

      <div className="place-link">
        <div className="field-label-row">
          <label htmlFor={linkId}>{t("places.link.label")}</label>
        </div>
        <div className={shownLinkError ? "input has-error" : "input"}>
          <Icon name="link" />
          <input
            id={linkId}
            className="input-bare"
            value={linkText}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
            placeholder={t("places.link.placeholder")}
            aria-describedby={shownLinkError ? `${linkErrId} ${linkHintId}` : linkHintId}
            aria-invalid={shownLinkError ? true : undefined}
            data-testid="place-link"
            onChange={(e) => typeLink(e.target.value)}
            onBlur={checkLink}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
          />
        </div>
        {shownLinkError ? (
          <p className="field-error" id={linkErrId} role="alert" data-testid="place-link-error">
            <Icon name="circle-alert" size="sm" />
            <span>{t(shownLinkError)}</span>
          </p>
        ) : null}
        <p className="field-hint" id={linkHintId} data-testid="place-link-hint">
          {t("places.link.hint")}
        </p>
      </div>

      <div className="place-apps">
        <p className="place-apps-lead">{t("places.apps.lead")}</p>
        <MapAppLinks name={name} variant="apps" groupLabel={t("places.apps.groupAria")} />
      </div>
    </div>
  );
}

function PlaceProblem({ problem }: { problem: FormProblem }) {
  const t = useTranslations();
  return (
    <p className="field-error" role="alert" data-testid="place-problem">
      <Icon name="circle-alert" size="sm" />
      <span>{t(problem.ref.key, problem.ref.values)}</span>
    </p>
  );
}
