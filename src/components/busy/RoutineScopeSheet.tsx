"use client";

import { useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { callApiFull } from "@/components/appointments/api";
import { ConfirmDialog } from "@/components/groups/ConfirmDialog";
import { Name, withNames } from "@/components/Name";
import { Sheet } from "@/components/shell/Sheet";
import { DEFAULT_TZ, todayIn, type CalendarLocale, type DateISO } from "@/lib/calendar";
import { clock } from "@/lib/shared/clock";
import {
  deleteRequest,
  mapDeleteFailure,
  monthLabel,
  scopeChoices,
  weekRangeValues,
  weekdaysText,
  ymOf,
  type RoutineDone,
  type RoutineProblem,
  type ScopeAction,
  type ScopeChoice,
  type ScopeTarget,
} from "./routine-model";

export interface RoutineScopeSheetProps {
  action: ScopeAction;
  target: ScopeTarget;
  onClose: () => void;
  /** แก้: ผู้ใช้เลือกขอบเขตแล้ว → หน้าเปิดฟอร์มที่เหมาะ (one = ฟอร์ม busy เดิม · from/all = ฟอร์ม routine) */
  onEdit: (choice: ScopeChoice, periodStart: DateISO) => void;
  /** ลบ: ทำเสร็จ/รายการหาย */
  onDone: (result: RoutineDone) => void;
  /** CONFLICT: ให้หน้าโหลดรายการใหม่ */
  onStale: () => void;
}

const CHOICE_TESTID: Record<ScopeChoice, string> = { one: "one", from: "from", all: "all" };

/**
 * sheet เลือกขอบเขตแก้/ลบ (design §4): เฉพาะวันนี้ · ตั้งแต่สัปดาห์/เดือนนี้ไป · ทั้งหมด — ปุ่มเต็มความกว้าง ≥ --tap-lg (ชื่อ + คำอธิบาย)
 * ลบ "ทั้งหมด" ขอยืนยันอีกชั้น (ConfirmDialog) · ลบ one/from ยิง API ทันที (คำอธิบายใต้ปุ่มบอกผลไว้แล้ว)
 * สิทธิ์/ขอบเขตจริงตัดสินที่เซิร์ฟเวอร์ — ที่นี่แค่ส่งคำขอและแสดงผล
 */
export function RoutineScopeSheet({ action, target, onClose, onEdit, onDone, onStale }: RoutineScopeSheetProps) {
  const t = useTranslations();
  const locale = useLocale() as CalendarLocale;
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [today] = useState(() => todayIn(DEFAULT_TZ, clock.now()));
  const { choices, periodStart } = useMemo(() => scopeChoices(target, today), [target, today]);
  const [busyChoice, setBusyChoice] = useState<ScopeChoice | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [problem, setProblem] = useState<RoutineProblem | null>(null);
  const r = target.routine;
  const text = (ref: { key: string; values: Record<string, string | number> }) => t(ref.key, ref.values);

  const fromLabel =
    r.rangeKind === "weeks"
      ? t("busy.routine.scope." + action + ".fromWeek", { range: t("busy.routine.range.week", weekRangeValues(periodStart, locale)) })
      : t("busy.routine.scope." + action + ".fromMonth", { month: monthLabel(ymOf(periodStart), locale) });

  const labelOf = (c: ScopeChoice): { title: string; help: string } => ({
    title: c === "from" ? fromLabel : t(`busy.routine.scope.${action}.${c}`),
    help: t(`busy.routine.scope.${action}.${c}Help`),
  });

  const rule = r.allDay ? t("busy.routine.calendar.detailAllDay", { days: weekdaysText(t, r.weekdays) }) : t("busy.routine.calendar.detail", { days: weekdaysText(t, r.weekdays), time: `${r.startTime}–${r.endTime}` });

  async function runDelete(choice: ScopeChoice) {
    if (busyChoice) return;
    setBusyChoice(choice);
    setProblem(null);
    const rq = deleteRequest(choice, target, periodStart);
    const res = await callApiFull<unknown>(rq.path, { method: rq.method });
    setBusyChoice(null);
    if (res.ok) {
      onDone(choice === "one" ? { type: "deletedOne" } : choice === "from" ? { type: "stopped", periodStart, rangeKind: r.rangeKind } : { type: "deletedAll" });
      return;
    }
    const f = mapDeleteFailure(res);
    if (f.type === "gone") {
      onDone({ type: "gone" });
      return;
    }
    if (f.type === "conflict") onStale();
    setConfirmAll(false);
    setProblem(f.problem);
  }

  function choose(c: ScopeChoice) {
    if (busyChoice) return;
    if (action === "edit") {
      onEdit(c, periodStart);
      return;
    }
    if (c === "all") {
      setConfirmAll(true);
      return;
    }
    void runDelete(c);
  }

  if (confirmAll) {
    return (
      <ConfirmDialog
        title={t("busy.routine.scope.confirmAll.title")}
        body={r.title ? withNames((n) => t("busy.routine.scope.confirmAll.body", { title: n.title }), { title: r.title }) : t("busy.routine.scope.confirmAll.bodyNoTitle")}
        confirmLabel={t("busy.routine.scope.confirmAll.confirm")}
        busy={busyChoice === "all"}
        error={problem ? problem.refs.map(text).join(" ") : null}
        onConfirm={() => void runDelete("all")}
        onClose={() => {
          setConfirmAll(false);
          setProblem(null);
        }}
      />
    );
  }

  return (
    <Sheet
      title={t(`busy.routine.scope.${action}.title`)}
      onClose={onClose}
      alert={action === "delete"}
      initialFocusRef={cancelRef}
      footer={
        <button ref={cancelRef} type="button" className="btn btn-secondary btn-block" disabled={busyChoice !== null} data-testid="routine-scope-cancel" onClick={onClose}>
          {t("busy.routine.scope.cancel")}
        </button>
      }
    >
      <div data-testid="routine-scope" data-action={action}>
        <p className="small muted rt-scope-rule" data-testid="routine-scope-rule">
          {r.title ? <Name>{r.title}</Name> : t("busy.mine.noTitle")}
          {" · "}
          {rule}
        </p>
        <div className="rt-scope-list">
          {choices.map((c) => {
            const l = labelOf(c);
            const danger = action === "delete" && c === "all";
            return (
              <button
                type="button"
                key={c}
                className={danger ? "rt-scope-btn is-danger" : "rt-scope-btn"}
                disabled={busyChoice !== null}
                aria-busy={busyChoice === c || undefined}
                data-testid={`routine-scope-${CHOICE_TESTID[c]}`}
                onClick={() => choose(c)}
              >
                <b>{l.title}</b>
                <span>{l.help}</span>
              </button>
            );
          })}
        </div>
        {problem ? (
          <p className="form-error sheet-error" role="alert" data-testid="routine-scope-error">
            {problem.refs.map((p, i) => (
              <span key={i} className="rt-err-line">
                {text(p)}
              </span>
            ))}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
