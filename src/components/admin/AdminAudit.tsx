"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { useFormatter, useTranslations } from "next-intl";
import "@/components/groups/groups.css";
import { AUDIT_ID_KEYS, queryString, shortId, shownName, visibleMeta, type AuditMetaKey, type AuditMetaValue } from "@/components/account/model";
import { SelectField } from "@/components/groups/SelectField";
import { Icon } from "@/components/icons/Icon";
import { Name } from "@/components/Name";
import type { AuditRowDto } from "@/lib/data/serializers/admin";
import { AdminListState, LoadMore } from "./AdminParts";
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES, auditActionKey, auditTargetTypeKey } from "./audit-labels";
import { usePaged } from "./usePaged";

type Filters = { action: string; targetType: string; targetId: string; actor: { id: string; username: string } | null };
const EMPTY: Filters = { action: "", targetType: "", targetId: "", actor: null };
const TARGET_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * audit log (R5 §2 ข้อ 3–4) — ใหม่→เก่า · กรอง action/ชนิดเป้าหมาย/รหัสเป้าหมาย/ผู้ทำ · โหลดเพิ่มด้วย before
 * ชื่อ action แปลทุกตัว (ไม่รู้จัก → "การกระทำอื่น (code)") · meta แสดงเฉพาะคีย์ใน whitelist (AUDIT_META_KEYS)
 */
export function AdminAudit() {
  const t = useTranslations();
  const format = useFormatter();
  const id = useId();
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [idError, setIdError] = useState(false);
  const list = usePaged<AuditRowDto, { entries: AuditRowDto[]; nextCursor: string | null }>(
    `/api/admin/audit${queryString({ action: applied.action, targetType: applied.targetType, targetId: applied.targetId, actor: applied.actor?.id })}`,
    "before",
    (d) => ({ items: d.entries, nextCursor: d.nextCursor }),
  );

  function apply(e: FormEvent) {
    e.preventDefault();
    const tid = draft.targetId.trim();
    if (tid !== "" && !TARGET_ID.test(tid)) {
      setIdError(true);
      return;
    }
    setIdError(false);
    setApplied({ ...draft, targetId: tid });
  }

  function byActor(actor: { id: string; username: string }) {
    const next = { ...applied, actor };
    setDraft(next);
    setApplied(next);
  }

  const actorName = (a: { username: string } | null) => (a ? shownName(a.username, t("account.deletedName")) : t("adminAudit.system"));
  const when = (ms: number) => format.dateTime(ms, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const actionLabel = (action: string) => {
    const key = auditActionKey(action);
    return key ? t(key) : t("adminAudit.unknownAction", { code: action });
  };
  const typeLabel = (type: string) => {
    const key = auditTargetTypeKey(type);
    return key ? t(key) : type;
  };
  const metaValue = (key: AuditMetaKey, v: AuditMetaValue): string => {
    if (v === null) return "–";
    if (Array.isArray(v)) return v.join(", ");
    if (typeof v === "string" && AUDIT_ID_KEYS.has(key)) return shortId(v);
    return t("adminAudit.value", { value: String(v) });
  };

  return (
    <>
      <form className="admin-filters" onSubmit={apply} aria-labelledby={`${id}-f`}>
        <h2 className="sub-h" id={`${id}-f`}>
          {t("adminAudit.filters")}
        </h2>
        <SelectField
          id={`${id}-a`}
          label={t("adminAudit.action")}
          value={draft.action}
          options={[{ value: "", label: t("adminAudit.anyAction") }, ...AUDIT_ACTIONS.map((a) => ({ value: a, label: actionLabel(a) }))]}
          onChange={(v) => setDraft((d) => ({ ...d, action: v }))}
        />
        <SelectField
          id={`${id}-t`}
          label={t("adminAudit.targetType")}
          value={draft.targetType}
          options={[{ value: "", label: t("adminAudit.anyTarget") }, ...AUDIT_TARGET_TYPES.map((x) => ({ value: x, label: typeLabel(x) }))]}
          onChange={(v) => setDraft((d) => ({ ...d, targetType: v }))}
        />
        <div className="field">
          <label htmlFor={`${id}-i`}>{t("adminAudit.targetId")}</label>
          <div className="input">
            <input
              id={`${id}-i`}
              className="input-bare"
              value={draft.targetId}
              maxLength={64}
              onChange={(e) => {
                setDraft((d) => ({ ...d, targetId: e.target.value }));
                setIdError(false);
              }}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={idError ? true : undefined}
              aria-describedby={`${id}-ih`}
            />
          </div>
          <p className={idError ? "form-error" : "field-hint"} id={`${id}-ih`} role={idError ? "alert" : undefined}>
            {idError ? t("errors.VALIDATION") : t("adminAudit.targetIdHint")}
          </p>
        </div>
        {applied.actor ? (
          <div className="admin-chip-row">
            <span className="tag tag-role">
              <Icon name="user" size="sm" />
              <span>{t("adminAudit.actorFilter", { actor: actorName(applied.actor) })}</span>
            </span>
            <button
              type="button"
              className="btn btn-text"
              onClick={() => {
                const next = { ...applied, actor: null };
                setDraft(next);
                setApplied(next);
              }}
            >
              {t("adminAudit.clearActor")}
            </button>
          </div>
        ) : null}
        <div className="admin-filter-actions">
          <button type="submit" className="btn btn-primary">
            {t("adminAudit.apply")}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setDraft(EMPTY);
              setApplied(EMPTY);
              setIdError(false);
            }}
          >
            {t("adminAudit.reset")}
          </button>
        </div>
      </form>

      <AdminListState list={list} emptyTitle={t("adminAudit.empty.title")} emptyBody={t("adminAudit.empty.body")} />

      {list.status === "ready" && list.items.length > 0 ? (
        <>
          <ul className="admin-cards" data-testid="admin-audit">
            {list.items.map((e) => {
              const meta = visibleMeta(e.meta);
              return (
                <li className="admin-card audit-row" key={e.id} data-testid="audit-row" data-action={e.action}>
                  <div className="admin-card-top">
                    <span className="admin-card-title">{actionLabel(e.action)}</span>
                  </div>
                  <p className="admin-card-meta">
                    {when(e.createdAt)}
                  </p>
                  <ul className="admin-facts">
                    <li>
                      <Icon name="user" size="sm" />
                      {e.actor ? (
                        <button type="button" className="link-btn audit-actor" aria-label={t("adminAudit.byActor", { actor: actorName(e.actor) })} onClick={() => byActor(e.actor!)}>
                          <Name>{actorName(e.actor)}</Name>
                        </button>
                      ) : (
                        <span>{t("adminAudit.system")}</span>
                      )}
                    </li>
                    <li>
                      <Icon name="info" size="sm" />
                      <span className="audit-target" title={e.targetId}>
                        {t("adminAudit.target", { type: typeLabel(e.targetType), id: shortId(e.targetId) })}
                      </span>
                    </li>
                    {e.groupId ? (
                      <li>
                        <Icon name="users" size="sm" />
                        <Link className="link-btn" href={`/admin/groups/${e.groupId}`}>
                          {t("adminAudit.openGroup")}
                        </Link>
                      </li>
                    ) : null}
                  </ul>
                  {meta.length > 0 ? (
                    <dl className="audit-meta">
                      {meta.map((m) => (
                        <div key={m.key}>
                          <dt>{t(`adminAudit.meta.${m.key}`)}</dt>
                          <dd>{metaValue(m.key, m.value)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <LoadMore list={list} />
        </>
      ) : null}
    </>
  );
}
