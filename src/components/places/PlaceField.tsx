"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons/Icon";
import { Name } from "@/components/Name";
import { parseLocationInput } from "@/lib/shared/location-parse";
import { callApiFull } from "@/components/appointments/api";
import {
  PLACE_NAME_MAX,
  PLACE_QUERY_MAX,
  PLACE_QUERY_MIN,
  coordsText,
  parsePlaceResults,
  placeFromResult,
  placeSearchFailure,
  textLength,
  type FormProblem,
  type PlaceSearchState,
  type PlaceValue,
} from "@/components/appointments/model";

export interface PlaceFieldProps {
  value: PlaceValue | null;
  onChange: (next: PlaceValue | null) => void;
  /** ข้อผิดพลาดจากเซิร์ฟเวอร์/ตรวจก่อนส่ง (ชื่อยาวเกิน ฯลฯ) */
  problem: FormProblem | null;
  /** ให้แผงวางลิงก์เปิดอยู่ตอนเริ่ม (เซิร์ฟเวอร์ปฏิเสธลิงก์/พิกัด) */
  forcePaste?: boolean;
}

const clip = (v: string, max: number): string => {
  const chars = [...v];
  return chars.length > max ? chars.slice(0, max).join("") : v;
};

/** value มี "ตำแหน่งที่ยืนยันแล้ว" (พิกัดหรือลิงก์) → แสดงเป็นชิป · มีแต่ชื่อที่พิมพ์ = ยังเป็นช่องพิมพ์ */
const isResolved = (v: PlaceValue | null): v is PlaceValue => v !== null && (v.lat !== null || v.mapUrl !== null);

/**
 * ช่องสถานที่ (X56–X58): พิมพ์ชื่อ + กด [ค้นหา] (ไม่ autocomplete) → ผล ≤ 5 เป็น radiogroup · หรือวางลิงก์/พิกัด (ตรวจที่ client ก่อน, เซิร์ฟเวอร์ตรวจซ้ำ)
 * ปิดชั่วคราว/ถี่เกิน/ต้นทางล่ม → ข้อความ + เปิดแผงวางลิงก์ให้เอง · ไม่เรียก Google
 */
export function PlaceField({ value, onChange, problem, forcePaste = false }: PlaceFieldProps) {
  const t = useTranslations();
  const uid = useId();
  const seq = useRef(0);
  const [query, setQuery] = useState(value?.name ?? "");
  const [search, setSearch] = useState<PlaceSearchState>({ kind: "idle" });
  const [pasteOpen, setPasteOpen] = useState(forcePaste);
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState<"INVALID_MAP_URL" | "INVALID_COORDINATES" | null>(null);
  const [lastForce, setLastForce] = useState(forcePaste);
  if (forcePaste !== lastForce) {
    setLastForce(forcePaste);
    if (forcePaste) setPasteOpen(true);
  }

  const resolved = isResolved(value);
  const hintId = `${uid}-h`;
  const nameCount = textLength(query);

  function typeName(v: string) {
    const next = clip(v, PLACE_NAME_MAX);
    setQuery(next);
    seq.current += 1; // ผลค้นหาที่ค้างอยู่เป็นของคำเก่า
    if (search.kind === "searching") setSearch({ kind: "idle" });
    onChange(next.trim() === "" ? null : { name: next, lat: null, lng: null, mapUrl: null });
  }

  async function runSearch() {
    if (search.kind === "searching") return;
    const q = clip(query.normalize("NFC").replace(/\s+/g, " ").trim(), PLACE_QUERY_MAX);
    if (textLength(q) < PLACE_QUERY_MIN) {
      setSearch({ kind: "tooShort" });
      return;
    }
    const mine = ++seq.current;
    setSearch({ kind: "searching" });
    const res = await callApiFull<unknown>(`/api/places/search?q=${encodeURIComponent(q)}`);
    if (mine !== seq.current) return; // ผู้ใช้พิมพ์ต่อ/ค้นหาใหม่แล้ว — ทิ้งผลเก่า
    if (!res.ok) {
      const next = placeSearchFailure(res);
      setSearch(next);
      if (next.kind === "disabled") setPasteOpen(true);
      return;
    }
    const results = parsePlaceResults(res.data);
    setSearch(results.length === 0 ? { kind: "none", query: q } : { kind: "results", results });
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault(); // ไม่ให้ Enter ส่งฟอร์มนัด
      void runSearch();
    }
  }

  function applyPaste() {
    const parsed = parseLocationInput(pasteText);
    if (!parsed.ok) {
      setPasteError(parsed.reason === "INVALID_COORDINATES" ? "INVALID_COORDINATES" : "INVALID_MAP_URL");
      return;
    }
    setPasteError(null);
    const name = query.trim() === "" ? null : query;
    onChange({ name, lat: parsed.lat, lng: parsed.lng, mapUrl: parsed.mapUrl });
    setPasteOpen(false);
    setPasteText("");
    setSearch({ kind: "idle" });
  }

  function clear() {
    seq.current += 1;
    // ล้างชิป: กลับไปช่องพิมพ์ว่าง
    setQuery("");
    onChange(null);
    setSearch({ kind: "idle" });
  }

  const label = (
    <div className="field-label-row">
      <label htmlFor={`${uid}-q`}>
        {t("places.label")} <span className="opt">({t("appointments.form.optional")})</span>
      </label>
    </div>
  );

  if (resolved) {
    const displayName = value.name ?? t("places.selected.defaultName");
    const sub = coordsText(value) !== null ? t("places.selected.coords", { lat: roundCoord(value.lat), lng: roundCoord(value.lng) }) : t("places.selected.linkOnly", { host: hostOfUrl(value.mapUrl) });
    return (
      <div className="field" id={`${uid}-place`} data-testid="place-field">
        <div className="field-label-row">
          <span className="label">{t("places.label")}</span>
        </div>
        <div className="place-chip" role="group" aria-label={t("places.selected.aria", { name: displayName })} data-testid="place-chip">
          <Icon name="map-pin" />
          <div className="tx">
            <span className="pn" data-testid="place-chip-name">
              <Name>{displayName}</Name>
            </span>
            <span className="ps num" data-testid="place-chip-sub">
              {sub}
            </span>
          </div>
          <button type="button" className="icon-btn" aria-label={t("places.clearAria", { name: displayName })} data-testid="place-clear" onClick={clear}>
            <Icon name="x" />
          </button>
        </div>
        {problem ? <PlaceProblem problem={problem} /> : null}
      </div>
    );
  }

  const busy = search.kind === "searching";
  const disabled = search.kind === "disabled";
  return (
    <div className="field" id={`${uid}-place`} data-testid="place-field">
      {label}
      <div className="place-search">
        <div className={problem ? "input has-error" : "input"}>
          <Icon name="map-pin" />
          <input
            id={`${uid}-q`}
            className="input-bare"
            value={query}
            autoComplete="off"
            placeholder={t("places.name.placeholder")}
            aria-describedby={hintId}
            aria-invalid={problem ? true : undefined}
            data-testid="place-query"
            onChange={(e) => typeName(e.target.value)}
            onKeyDown={onKey}
          />
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          aria-disabled={disabled || undefined}
          disabled={busy}
          aria-label={t("places.search.aria", { query: query.trim() || "…" })}
          data-testid="place-search"
          onClick={() => {
            if (!disabled) void runSearch();
          }}
        >
          <Icon name={busy ? "refresh-cw" : "search"} size={busy ? "sm" : "md"} className={busy ? "ov-spin" : undefined} />
          <span>{busy ? t("places.search.searching") : t("places.search.button")}</span>
        </button>
      </div>
      <p className="field-hint" id={hintId}>
        {t("places.name.hint")} <span className="num">{nameCount}/{PLACE_NAME_MAX}</span>
      </p>
      {problem ? <PlaceProblem problem={problem} /> : null}

      {search.kind === "results" ? (
        <>
          <ul className="place-results" role="radiogroup" aria-label={t("places.search.results")} data-testid="place-results">
            {search.results.map((r, i) => (
              <li key={`${r.lat},${r.lng},${i}`}>
                <button
                  type="button"
                  className="place-opt"
                  role="radio"
                  aria-checked={false}
                  aria-label={t("places.search.pickAria", { name: r.name })}
                  data-testid="place-result"
                  onClick={() => {
                    onChange(placeFromResult(r));
                    setSearch({ kind: "idle" });
                    setPasteOpen(false);
                  }}
                >
                  <span className="radio-mark" aria-hidden="true" />
                  <span>
                    <span className="pn">
                      <Name>{r.name}</Name>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="place-foot">
            <span role="status">{t("places.search.count", { count: search.results.length })}</span>
            <span>{t("places.search.attribution")}</span>
          </p>
        </>
      ) : null}

      {search.kind === "tooShort" ? (
        <div className="place-note" role="status" data-testid="place-too-short">
          <Icon name="info" />
          <div>{t("places.search.tooShort", { min: PLACE_QUERY_MIN })}</div>
        </div>
      ) : null}
      {search.kind === "none" ? (
        <div className="place-note" role="status" data-testid="place-none">
          <Icon name="search" />
          <div>
            <b>{t("places.search.noResults.title", { query: search.query })}</b>
            {t("places.search.noResults.body")}
          </div>
        </div>
      ) : null}
      {search.kind === "error" ? (
        <div className="place-note is-error" role="status" data-testid="place-error">
          <Icon name="circle-alert" />
          <div>{t("places.search.error")}</div>
        </div>
      ) : null}
      {search.kind === "rate" ? (
        <div className="place-note is-warn" role="status" data-testid="place-rate">
          <Icon name="triangle-alert" />
          <div>{t("places.search.rateLimited")}</div>
        </div>
      ) : null}
      {search.kind === "disabled" ? (
        <div className="place-note" role="status" data-testid="place-disabled">
          <Icon name="info" />
          <div>{t("places.search.disabled")}</div>
        </div>
      ) : null}

      {pasteOpen ? (
        <div className="place-paste" data-testid="place-paste">
          <div className="field field-first">
            <label htmlFor={`${uid}-u`}>{t("places.paste.label")}</label>
            <div className="row2">
              <div className={pasteError ? "input has-error" : "input"}>
                <Icon name="link" />
                <input
                  id={`${uid}-u`}
                  className="input-bare"
                  value={pasteText}
                  autoComplete="off"
                  inputMode="url"
                  placeholder={t("places.paste.placeholder")}
                  aria-describedby={`${uid}-uh`}
                  aria-invalid={pasteError ? true : undefined}
                  data-testid="place-paste-input"
                  onChange={(e) => {
                    setPasteText(e.target.value);
                    setPasteError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyPaste();
                    }
                  }}
                />
              </div>
              <button type="button" className="btn btn-primary" data-testid="place-paste-submit" onClick={applyPaste}>
                {t("places.paste.submit")}
              </button>
            </div>
            {pasteError ? (
              <p className="field-error" role="alert" data-testid="place-paste-error">
                <Icon name="circle-alert" size="sm" />
                <span>{t(`errors.${pasteError}`)}</span>
              </p>
            ) : null}
            <p className="field-hint" id={`${uid}-uh`}>
              {t("places.paste.hint")}
            </p>
          </div>
          <button type="button" className="link-btn" data-testid="place-paste-back" onClick={() => { setPasteOpen(false); setPasteError(null); }}>
            <Icon name="search" size="sm" />
            <span>{t("places.paste.back")}</span>
          </button>
        </div>
      ) : (
        <button type="button" className="link-btn place-toggle" data-testid="place-paste-toggle" onClick={() => setPasteOpen(true)}>
          <Icon name="link" size="sm" />
          <span>{t("places.paste.toggle")}</span>
        </button>
      )}
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

const roundCoord = (n: number | null): number => (n === null ? 0 : Math.round(n * 1e5) / 1e5);
const hostOfUrl = (u: string | null): string => {
  if (!u) return "";
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
};
