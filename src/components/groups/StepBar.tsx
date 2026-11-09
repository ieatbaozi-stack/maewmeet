"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons/Icon";
import { stepBusyAddHref, type StepId, type StepState } from "./steps-model";

export interface StepBarProps {
  groupId: string;
  steps: { id: StepId; n: number; state: StepState }[];
  doneCount: number;
  total: number;
  allDone: boolean;
  /** กลุ่มคนเดียว: ขั้น 1 ใช้ข้อความ soloBody */
  solo: boolean;
  /** ปุ่มสร้างนัดเดิม (ขั้น 4) — ไม่ส่ง = ไม่แสดง (เช่น กลุ่มคนเดียว) */
  planAction?: ReactNode;
}

/**
 * แถบขั้นตอนเริ่มใช้กลุ่ม (R8 · docs/design/R8_ONBOARDING.md §2) — สถานะคำนวณจากเซิร์ฟเวอร์ (steps-model) ส่งมาให้
 * ครบ (ขั้น 1, 2, 4) → ยุบเป็นแถบบาง สลับแสดง/ซ่อนได้ (ไม่จำสถานะ) · ขั้นถัดไปมี aria-current="step"
 */
export function StepBar({ groupId, steps, doneCount, total, allDone, solo, planAction }: StepBarProps) {
  const t = useTranslations();
  const id = useId();
  const [open, setOpen] = useState(false);
  const headingId = `${id}-h`;
  const listId = `${id}-list`;
  const hrefs: Record<StepId, string> = {
    invite: `/groups/${groupId}/settings#invite`,
    busy: `/calendar?g=${groupId}&v=month`,
    free: `/calendar?g=${groupId}&v=free`,
    plan: "",
  };

  const list = (
    <ol role="list" className="steps-list" id={listId} aria-label={t("group.steps.listAria")} hidden={allDone && !open} data-testid="group-steps-list">
      {steps.map((s) => {
        const title = t(`group.steps.${s.id}.title`);
        const label = t("group.steps.stepLabel", { n: s.n });
        if (s.state === "next") {
          const body = s.id === "invite" && solo ? t("group.steps.invite.soloBody") : t(`group.steps.${s.id}.body`);
          return (
            <li key={s.id} className="steps-item is-next" aria-current="step" data-step={s.id} data-state="next">
              <p className="steps-label">
                <span>{label}</span>
                <span aria-hidden="true"> · </span>
                <span>{t("group.steps.next")}</span>
              </p>
              <p className="steps-title">{title}</p>
              <p className="steps-body">{body}</p>
              <Link className="btn btn-primary" href={s.id === "busy" ? stepBusyAddHref(groupId) : hrefs[s.id]} data-testid={`group-step-cta-${s.id}`}>
                <span>{t(`group.steps.${s.id}.cta`)}</span>
              </Link>
            </li>
          );
        }
        const done = s.state === "done";
        const inner = (
          <>
            <span className="steps-mark" aria-hidden="true">{done ? <Icon name="circle-check" /> : null}</span>
            <span className="steps-text">
              <span className="steps-label">{label}</span>
              <span className="steps-title">{title}</span>
            </span>
            {done ? <span className="steps-done">{t("group.steps.done")}</span> : null}
          </>
        );
        return (
          <li key={s.id} className={`steps-item${done ? " is-done" : ""}`} data-step={s.id} data-state={s.state}>
            {s.id === "plan" ? (
              <div className="steps-row">
                {inner}
                {planAction}
              </div>
            ) : (
              <Link className="steps-row" href={hrefs[s.id]}>
                {inner}
                <Icon name="chevron-right" className="chev" />
              </Link>
            )}
          </li>
        );
      })}
    </ol>
  );

  return (
    <section className={`steps panel${allDone ? " is-all-done" : ""}`} aria-labelledby={headingId} data-testid="group-steps" data-all-done={allDone ? "true" : "false"}>
      {allDone ? (
        <div className="steps-collapsed">
          <Icon name="circle-check" className="steps-ok" />
          <h2 className="steps-heading" id={headingId}>
            <span>{t("group.steps.allDone.title")}</span>
            <span aria-hidden="true"> · </span>
            <span className="steps-sub">{t("group.steps.allDone.body")}</span>
          </h2>
          <button type="button" className="btn btn-secondary steps-toggle" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((v) => !v)} data-testid="group-steps-toggle">
            {open ? t("group.steps.allDone.hide") : t("group.steps.allDone.show")}
          </button>
        </div>
      ) : (
        <div className="steps-head">
          <h2 className="steps-heading" id={headingId}>{t("group.steps.heading")}</h2>
          <p className="steps-progress">{t("group.steps.progress", { done: doneCount, total })}</p>
        </div>
      )}
      {list}
    </section>
  );
}
