"use client";

import { useRouter } from "next/navigation";
import { createElement, useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { callApiFull } from "@/components/appointments/api";
import { GroupIcon } from "@/components/icons/GroupIcon";
import { Icon } from "@/components/icons/Icon";
import { GROUP_ICON_NODES } from "@/components/icons/group-icons";
import { BusyButton } from "@/components/shell/BusyButton";
import { Sheet } from "@/components/shell/Sheet";
import { GROUP_ICON_KEYS, displayGroupIcon, normalizeGroupIcon, type GroupIconKey } from "@/lib/shared/group-icons";
import { PICKER_KEYS, iconBody, initialPick, isUnchanged, mapIconFailure, movePick, type PickerKey } from "./icon-model";
import type { SectionProps } from "./NameSection";

const WIDE = "(min-width: 48em)";

/**
 * ไอคอนกลุ่ม (R15a §1.4): admin/moderator เห็นปุ่ม "เปลี่ยนไอคอน" → แผ่นเลือก 24 แบบ · สมาชิกเห็นอ่านอย่างเดียว
 * ซ่อนปุ่มไม่ใช่การป้องกัน — PUT /api/groups/:gid/icon ตรวจสิทธิ์ที่เซิร์ฟเวอร์ (group.icon.update)
 */
export function IconSection({ groupId, icon, editable, notify }: SectionProps & { icon: string | null }) {
  const t = useTranslations();
  const router = useRouter();
  const id = useId();
  const [saved, setSaved] = useState<string | null>(normalizeGroupIcon(icon));
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const shown = displayGroupIcon(saved);
  const name = t(`groupIcon.names.${shown}`);

  return (
    <section className="set-sec" aria-labelledby={`${id}-h`} data-testid="group-icon-section">
      <h2 id={`${id}-h`}>{t("groupSettings.icon.title")}</h2>
      <p className="small muted">{t("groupSettings.icon.body")}</p>
      <div className="gi-set">
        <GroupIcon icon={saved} size="lg" />
        <div className="t" data-testid="group-icon-current" data-icon={shown}>
          {saved === null ? t("groupSettings.icon.currentDefault") : t("groupSettings.icon.current", { name })}
        </div>
      </div>
      {editable ? (
        <button
          ref={openerRef}
          type="button"
          className="btn btn-secondary gi-change"
          aria-label={t("groupSettings.icon.changeAria", { name })}
          aria-haspopup="dialog"
          data-testid="group-icon-change"
          onClick={() => setOpen(true)}
        >
          <Icon name="pencil" />
          <span>{t("groupSettings.icon.change")}</span>
        </button>
      ) : (
        <p className="field-hint gi-viewonly" data-testid="group-icon-viewonly">
          <Icon name="lock" size="sm" /> {t("groupSettings.icon.viewOnly")}
        </p>
      )}
      {open && editable ? (
        <IconPicker
          groupId={groupId}
          current={saved}
          onClose={() => setOpen(false)}
          onSaved={(next) => {
            setSaved(next);
            setOpen(false);
            notify({ kind: "ok", text: t("groupSettings.icon.toast.saved") });
            router.refresh();
          }}
          onStale={() => router.refresh()}
        />
      ) : null}
    </section>
  );
}

function IconPicker({ groupId, current, onClose, onSaved, onStale }: { groupId: string; current: string | null; onClose: () => void; onSaved: (icon: GroupIconKey | null) => void; onStale: () => void }) {
  const t = useTranslations();
  const [picked, setPicked] = useState<GroupIconKey>(() => initialPick(current));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unchangedNote, setUnchangedNote] = useState(false);
  const optRefs = useRef(new Map<GroupIconKey, HTMLButtonElement>());
  const selRef = useRef<HTMLButtonElement | null>(null);
  const unchanged = isUnchanged(current, picked);

  function pick(key: GroupIconKey) {
    if (busy) return;
    setPicked(key);
    setUnchangedNote(false);
    setError(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (busy || !PICKER_KEYS.includes(e.key)) return;
    e.preventDefault();
    const cols = window.matchMedia(WIDE).matches ? 6 : 4;
    const next = movePick(picked, e.key as PickerKey, cols);
    if (next === picked) return;
    pick(next);
    optRefs.current.get(next)?.focus();
  }

  async function save() {
    if (busy) return;
    if (unchanged) {
      setUnchangedNote(true);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await callApiFull<{ groupId: string; icon: GroupIconKey | null }>(`/api/groups/${groupId}/icon`, { method: "PUT", body: iconBody(picked) });
    setBusy(false);
    if (res.ok) {
      onSaved(normalizeGroupIcon(res.data?.icon) ?? null);
      return;
    }
    const f = mapIconFailure(res);
    setError(t(f.ref.key, f.ref.values));
    if (f.forbidden || f.gone) onStale();
  }

  return (
    <Sheet title={t("groupSettings.icon.picker.title")} tall onClose={() => (busy ? undefined : onClose())} initialFocusRef={selRef}
      footer={
        <BusyButton
          type="button"
          className="btn btn-primary btn-block gi-sheet-save"
          busy={busy}
          busyLabel={t("groupSettings.icon.picker.saving")}
          idleLabel={t("groupSettings.icon.picker.save")}
          aria-disabled={unchanged || undefined}
          data-testid="group-icon-save"
          onClick={() => void save()}
        />
      }
    >
      <div data-testid="group-icon-picker">
        <p className="small muted">{t("groupSettings.icon.picker.hint")}</p>
        {error ? (
          <div className="alert gi-alert" role="alert" data-testid="group-icon-error">
            <Icon name="circle-alert" />
            <div>
              <span>{error}</span>
            </div>
          </div>
        ) : null}
        <div className="gi-grid" role="radiogroup" aria-label={t("groupSettings.icon.picker.listAria")} aria-busy={busy || undefined} onKeyDown={onKeyDown}>
          {GROUP_ICON_KEYS.map((k) => {
            const on = k === picked;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                className="gi-opt"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                data-testid={`group-icon-option-${k}`}
                ref={(el) => {
                  if (el) optRefs.current.set(k, el);
                  else optRefs.current.delete(k);
                  if (on) selRef.current = el;
                }}
                onClick={() => pick(k)}
              >
                <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                  {GROUP_ICON_NODES[k].map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
                </svg>
                <span>{t(`groupIcon.names.${k}`)}</span>
                <span className="gi-check" aria-hidden="true">
                  <Icon name="check" />
                </span>
              </button>
            );
          })}
        </div>
        <p className="small muted gi-status" role="status" data-testid="group-icon-unchanged">
          {unchangedNote && unchanged ? t("groupSettings.icon.picker.unchanged") : ""}
        </p>
      </div>
    </Sheet>
  );
}
