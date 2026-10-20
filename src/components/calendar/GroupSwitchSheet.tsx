"use client";

import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons/Icon";
import { Name } from "@/components/Name";
import { Sheet } from "@/components/shell/Sheet";

export interface GroupOption {
  id: string;
  name: string;
  memberCount: number;
}

/** เลือกกลุ่มที่ดูปฏิทิน (radiogroup ใน bottom sheet) — ช่วงไม่ว่างของฉันเหมือนกันทุกกลุ่ม (D5) */
export function GroupSwitchSheet({ groups, currentId, onPick, onClose }: { groups: readonly GroupOption[]; currentId: string; onPick: (id: string) => void; onClose: () => void }) {
  const t = useTranslations();
  return (
    <Sheet title={t("calendar.groupSwitch.title")} onClose={onClose}>
      <div className="places" role="radiogroup" aria-label={t("calendar.groupSwitch.title")} data-testid="cal-group-list">
        {groups.map((g) => (
          <button
            type="button"
            key={g.id}
            className="place"
            role="radio"
            aria-checked={g.id === currentId}
            data-testid={`cal-group-option-${g.id}`}
            onClick={() => onPick(g.id)}
          >
            <span className="radio" aria-hidden="true" />
            <span className="row-main">
              <span className="pn">
                <Name>{g.name}</Name>
              </span>
              <span className="small muted">{t("groups.memberCount", { count: g.memberCount })}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="sheet-hint cal-switch-hint">
        <Icon name="info" size="sm" />
        <span>{t("calendar.groupSwitch.hint")}</span>
      </p>
    </Sheet>
  );
}
