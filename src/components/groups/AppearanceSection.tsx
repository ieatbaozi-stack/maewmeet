"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { callApi } from "@/components/auth/api";
import { Icon } from "@/components/icons/Icon";
import type { MyAppearanceDto } from "@/lib/data/serializers/groups";
import { isGone } from "./errors";
import { MEMBER_SLOT_COUNT, memberInitial, memberSlot } from "./helpers";

const SLOTS = Array.from({ length: MEMBER_SLOT_COUNT }, (_, i) => i + 1);

type Status = { kind: "saving" | "saved" | "autoSaved" | "failed" } | null;
type Kind = "color" | "shape";

/**
 * "หน้าตาของฉันในกลุ่มนี้" (R6C · docs/design/R6C_APPEARANCE.md) — radiogroup 2 ชุด (สี / รูปทรง) บันทึกทันทีเมื่อเลือก
 * ใช้ input type=radio ซ่อนด้วย sr-only (ไม่ใช้ display:none) → Tab เข้ากลุ่มละ 1 จุด · ลูกศรเลื่อน+เลือก · Home/End เพิ่มเอง
 * สิทธิ์ตรวจที่เซิร์ฟเวอร์ (member.setOwnAppearance) — ส่วนนี้แสดงเฉพาะสมาชิก (myAppearance ไม่เป็น null)
 */
export function AppearanceSection({ groupId, displayName, initial }: { groupId: string; displayName: string; initial: MyAppearanceDto }) {
  const t = useTranslations("groupSettings.appearance");
  const router = useRouter();
  const id = useId();
  const [mine, setMine] = useState<MyAppearanceDto>(initial);
  const [status, setStatus] = useState<Status>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  const color = memberSlot(mine.colorIndex);
  const shape = memberSlot(mine.shapeIndex);
  const isAuto = mine.color === null && mine.shape === null;
  const letter = memberInitial(displayName);

  async function save(next: { color: number | null; shape: number | null }, optimistic: MyAppearanceDto | null, done: "saved" | "autoSaved") {
    if (busyRef.current) return; // ห้ามส่งซ้อน
    busyRef.current = true;
    setBusy(true);
    const before = mine;
    if (optimistic) setMine(optimistic);
    setStatus({ kind: "saving" });
    const res = await callApi<MyAppearanceDto>(`/api/groups/${groupId}/members/me/appearance`, { method: "PATCH", body: next });
    busyRef.current = false;
    setBusy(false);
    if (res.ok) {
      setMine(res.data);
      setStatus({ kind: done });
      router.refresh();
      return;
    }
    setMine(before); // คืนค่าเดิม
    setStatus({ kind: "failed" });
    if (isGone(res)) router.refresh();
  }

  function pick(kind: Kind, n: number) {
    if (busyRef.current) return;
    if ((kind === "color" ? color : shape) === n) return;
    const body = { color: mine.color, shape: mine.shape, [kind]: n };
    const optimistic = { ...mine, ...(kind === "color" ? { colorIndex: n - 1, color: n } : { shapeIndex: n - 1, shape: n }) };
    void save(body, optimistic, "saved");
  }

  function auto() {
    if (isAuto) return;
    void save({ color: null, shape: null }, null, "autoSaved");
  }

  // Home/End: radio ปกติไม่รองรับ → เลื่อนไปช่องแรก/ช่องสุดท้ายของกลุ่ม
  function edgeKeys(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Home" && e.key !== "End") return;
    const inputs = e.currentTarget.querySelectorAll<HTMLInputElement>("input");
    const target = e.key === "Home" ? inputs[0] : inputs[inputs.length - 1];
    if (!target) return;
    e.preventDefault();
    target.focus();
    target.click();
  }

  const group = (kind: Kind) => {
    const current = kind === "color" ? color : shape;
    return (
      <div className="appr-group">
        <h3 className="sub-h" id={`${id}-${kind}`}>
          {t(kind === "color" ? "colorLabel" : "shapeLabel")}
        </h3>
        <div className="appr-grid" role="radiogroup" aria-labelledby={`${id}-${kind}`} onKeyDown={edgeKeys}>
          {SLOTS.map((n) => (
            <label className="appr-opt" key={n}>
              <input
                type="radio"
                className="sr-only"
                name={`${id}-${kind}`}
                checked={current === n}
                onChange={() => pick(kind, n)}
                aria-label={t("optionAria", { name: t(`${kind}.${n}`) })}
                data-testid={`appearance-${kind}-${n}`}
              />
              <span className="appr-cell">
                <span className="member-avatar lg" data-color={kind === "color" ? n : color} data-shape={kind === "shape" ? n : shape} aria-hidden="true">
                  <span className="member-initial">{letter}</span>
                </span>
                <span className="appr-chk">
                  <Icon name="check" size="sm" />
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>
    );
  };

  return (
    <section className="set-sec" aria-labelledby={`${id}-h`} data-testid="appearance-section">
      <h2 id={`${id}-h`}>{t("title")}</h2>
      <p className="lead">{t("body")}</p>
      <div className="appr-preview">
        <span
          className="member-avatar lg appr-big"
          role="img"
          aria-label={t("previewAria", { color: t(`color.${color}`), shape: t(`shape.${shape}`) })}
          data-color={color}
          data-shape={shape}
          data-testid="appearance-preview"
        >
          <span className="member-initial" aria-hidden="true">
            {letter}
          </span>
        </span>
        <p className="small muted" aria-hidden="true">
          {t(`color.${color}`)} · {t(`shape.${shape}`)}
        </p>
      </div>
      {group("color")}
      {group("shape")}
      <button type="button" className="btn btn-secondary" disabled={isAuto || busy} onClick={auto} aria-describedby={`${id}-auto`} data-testid="appearance-auto">
        {t("auto")}
      </button>
      {isAuto ? (
        <p className="field-hint" id={`${id}-auto`}>
          {t("autoHint")}
        </p>
      ) : (
        <span className="sr-only" id={`${id}-auto`}>
          {t("autoHint")}
        </span>
      )}
      <p className={status?.kind === "failed" ? "field-error appr-status" : "field-hint appr-status"} role="status" aria-live="polite" data-testid="appearance-status">
        {status ? t(status.kind) : null}
      </p>
    </section>
  );
}
