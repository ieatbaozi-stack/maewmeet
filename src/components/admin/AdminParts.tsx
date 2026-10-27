"use client";

import type { FormEvent } from "react";
import { useTranslations } from "next-intl";
import { failureText } from "@/components/auth/errors";
import { Icon } from "@/components/icons/Icon";
import type { Paged } from "./usePaged";

/** มุมมองอ่านอย่างเดียวของรายการ (ไม่ผูกชนิดแถว) */
type ListView = Pick<Paged<unknown>, "status" | "failure" | "reload" | "nextCursor" | "moreBusy" | "moreFailure" | "loadMore"> & { items: readonly unknown[] };

/** ช่องค้นหาของหน้า admin (ฟอร์ม: Enter/ปุ่มค้นหา) */
export function SearchBox({
  id,
  label,
  hint,
  value,
  maxLength,
  onChange,
  onSubmit,
  onClear,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  maxLength: number;
  onChange: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
  onClear?: () => void;
}) {
  const t = useTranslations("admin");
  return (
    <form className="admin-search" role="search" onSubmit={onSubmit}>
      <label htmlFor={id} className="setting-label">
        {label}
      </label>
      <div className="admin-search-row">
        <div className="input">
          <Icon name="search" size="sm" />
          <input
            id={id}
            className="input-bare"
            type="search"
            value={value}
            maxLength={maxLength}
            onChange={(e) => onChange(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            aria-describedby={hint ? `${id}-h` : undefined}
          />
          {onClear ? (
            <button type="button" className="icon-btn" aria-label={t("clear")} onClick={onClear}>
              <Icon name="x" size="sm" />
            </button>
          ) : null}
        </div>
        <button type="submit" className="btn btn-secondary">
          {t("search")}
        </button>
      </div>
      {hint ? (
        <p className="field-hint" id={`${id}-h`}>
          {hint}
        </p>
      ) : null}
    </form>
  );
}

/** สถานะโหลด / ผิดพลาด / ว่าง ของรายการ admin */
export function AdminListState({ list, emptyTitle, emptyBody }: { list: ListView; emptyTitle: string; emptyBody: string }) {
  const t = useTranslations();
  if (list.status === "loading") {
    return (
      <div className="admin-loading" aria-busy="true">
        <div className="skeleton skeleton-req" />
        <div className="skeleton skeleton-req" />
        <p className="loading-note" role="status">
          {t("states.loading")}
        </p>
      </div>
    );
  }
  if (list.status === "error" && list.failure) {
    return (
      <div className="admin-loading">
        <div className="alert" role="alert">
          <Icon name="circle-alert" />
          <div>
            <b>{failureText(t, list.failure)}</b>
            <span>{t("states.error.dataSafe")}</span>
          </div>
        </div>
        <button type="button" className="btn btn-secondary" onClick={list.reload}>
          <Icon name="refresh-cw" />
          <span>{t("states.retry")}</span>
        </button>
      </div>
    );
  }
  if (list.status === "ready" && list.items.length === 0) {
    return (
      <div className="empty admin-empty" data-testid="admin-empty">
        <h2 className="h-section">{emptyTitle}</h2>
        <p className="muted">{emptyBody}</p>
      </div>
    );
  }
  return null;
}

/** ปุ่ม "โหลดเพิ่ม" + ข้อผิดพลาดของหน้าถัดไป · ไม่มีหน้าถัดไป → "แสดงครบแล้ว" */
export function LoadMore({ list }: { list: ListView }) {
  const t = useTranslations();
  return (
    <div className="admin-more">
      {list.moreFailure ? (
        <div className="alert" role="alert">
          <Icon name="circle-alert" />
          <div>{failureText(t, list.moreFailure)}</div>
        </div>
      ) : null}
      {list.nextCursor ? (
        <button type="button" className="btn btn-secondary" aria-busy={list.moreBusy} disabled={list.moreBusy} onClick={() => void list.loadMore()} data-testid="admin-load-more">
          {list.moreBusy ? t("admin.loadingMore") : t("admin.loadMore")}
        </button>
      ) : (
        <p className="muted admin-end">{t("admin.end")}</p>
      )}
    </div>
  );
}
