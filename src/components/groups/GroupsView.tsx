"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { callApi } from "@/components/auth/api";
import { Cat } from "@/components/brand";
import { Icon } from "@/components/icons/Icon";
import { Sheet } from "@/components/shell/Sheet";
import type { GroupSummaryDto } from "@/lib/data/serializers/groups";
import type { PendingInviteDto } from "@/lib/data/serializers/groups";
import { failureMessage } from "./errors";
import { setFlash } from "./flash";
import { GROUP_NAME_MAX, formatShortDate, groupNameLength } from "./helpers";
import { FlashNotice, Notice } from "./Notice";

type Sheets = null | "create" | "join";
type Status = { kind: "ok" | "error"; text: string } | null;

/** แท็บ "กลุ่ม" (UX W9): ปุ่มสร้าง/ใส่โค้ด · คำเชิญตรงที่ค้าง · รายการกลุ่ม · สถานะว่าง — ข้อมูลมาจากเซิร์ฟเวอร์ (page) แล้ว refresh หลังกระทำ */
export function GroupsView({ groups, invites }: { groups: GroupSummaryDto[]; invites: PendingInviteDto[] }) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [sheet, setSheet] = useState<Sheets>(null);
  const [status, setStatus] = useState<Status>(null);
  const [busyInvite, setBusyInvite] = useState<string | null>(null);

  async function respond(inv: PendingInviteDto, decision: "accept" | "decline") {
    setBusyInvite(inv.id);
    setStatus(null);
    const res = await callApi(`/api/me/invites/${inv.id}/${decision}`);
    setBusyInvite(null);
    if (res.ok) {
      setStatus({ kind: "ok", text: decision === "accept" ? t("groups.invites.accepted", { group: inv.groupName }) : t("groups.invites.declined") });
      router.refresh();
      return;
    }
    setStatus({ kind: "error", text: failureMessage(t, "respondInvite", res) });
    // คำเชิญใช้ไม่ได้แล้ว → ให้การ์ดหายจากรายการ
    if (res.kind === "api" && (res.error.code === "NOT_FOUND" || res.error.code === "CONFLICT")) router.refresh();
  }

  const createBtn = (
    <button type="button" className="btn btn-primary" onClick={() => setSheet("create")}>
      <Icon name="plus" />
      <span>{t("groups.create")}</span>
    </button>
  );

  return (
    <>
      <FlashNotice />
      {status ? <Notice kind={status.kind}>{status.text}</Notice> : null}

      {groups.length === 0 && invites.length === 0 ? (
        <section className="empty panel">
          <Cat pose="peek" size="lg" />
          <h2 className="h-section">{t("empty.groups.title")}</h2>
          <p className="muted">{t("empty.groups.body")}</p>
          {createBtn}
          <button type="button" className="btn btn-text" onClick={() => setSheet("join")}>
            {t("empty.groups.joinCode")}
          </button>
        </section>
      ) : (
        <>
          <div className="btn-row">
            {createBtn}
            <button type="button" className="btn btn-secondary" onClick={() => setSheet("join")}>
              <Icon name="key" />
              <span>{t("groups.join.cta")}</span>
            </button>
          </div>

          {invites.length > 0 ? (
            <section aria-labelledby="g-inv-h">
              <h2 className="h-section" id="g-inv-h">
                {t("groups.invites.title")}
              </h2>
              {invites.map((inv) => (
                <article className="panel invite-card" key={inv.id}>
                  <div>
                    <p className="who-line">{t("groups.invites.item", { inviter: inv.inviterName, group: inv.groupName })}</p>
                    <p className="small muted">{t("groups.invites.expires", { date: formatShortDate(inv.expiresAt, locale) })}</p>
                  </div>
                  <div className="actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busyInvite === inv.id}
                      aria-label={t("groups.invites.acceptAria", { group: inv.groupName })}
                      onClick={() => void respond(inv, "accept")}
                    >
                      {t("groups.invites.accept")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={busyInvite === inv.id}
                      aria-label={t("groups.invites.declineAria", { group: inv.groupName })}
                      onClick={() => void respond(inv, "decline")}
                    >
                      {t("groups.invites.decline")}
                    </button>
                  </div>
                </article>
              ))}
            </section>
          ) : null}

          {groups.length > 0 ? (
            <section aria-labelledby="g-list-h" className="groups-list">
              <h2 className="h-section" id="g-list-h">
                {t("groups.listLabel")}
              </h2>
              <ul className="rows group-rows">
                {groups.map((g) => (
                  <li key={g.id}>
                    <Link className="row" href={`/groups/${g.id}`} aria-label={t("groups.openAria", { name: g.name, count: g.memberCount })}>
                      <span className="row-main">
                        <span className="row-title">{g.name}</span>
                        <span className="row-meta">
                          {t("groups.memberCount", { count: g.memberCount })} · {t("group.yourRole", { role: g.role })}
                        </span>
                      </span>
                      <Icon name="chevron-right" className="chev" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      {sheet === "create" ? (
        <CreateGroupSheet
          onClose={() => setSheet(null)}
          onDone={(id, name) => {
            setFlash({ key: "groups.createSheet.created", values: { name } });
            router.push(`/groups/${id}`);
          }}
        />
      ) : null}
      {sheet === "join" ? (
        <JoinSheet
          onClose={() => setSheet(null)}
          onDone={(r) => {
            setFlash(
              r.alreadyMember
                ? { key: "groups.join.already", values: { name: r.groupName } }
                : { key: "groups.join.joined", values: { name: r.groupName } },
            );
            router.push(`/groups/${r.groupId}`);
          }}
        />
      ) : null}
    </>
  );
}

function CreateGroupSheet({ onClose, onDone }: { onClose: () => void; onDone: (id: string, name: string) => void }) {
  const t = useTranslations();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState(false);
  const len = groupNameLength(name);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || len === 0) return;
    setBusy(true);
    setError(null);
    setFieldError(false);
    const res = await callApi<{ group: { id: string; name: string } }>("/api/groups", { body: { name } });
    if (res.ok) {
      onDone(res.data.group.id, res.data.group.name);
      return;
    }
    setBusy(false);
    setError(failureMessage(t, "groupName", res));
    setFieldError(res.kind === "api" && res.error.code === "VALIDATION");
  }

  return (
    <Sheet
      title={t("groups.createSheet.title")}
      onClose={onClose}
      initialFocusRef={inputRef}
      footer={
        <>
          <button type="submit" form={`${id}-f`} className="btn btn-primary btn-block" disabled={busy || len === 0}>
            {busy ? t("groups.createSheet.submitting") : t("groups.createSheet.submit")}
          </button>
          <button type="button" className="btn btn-secondary btn-block" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </>
      }
    >
      <form id={`${id}-f`} onSubmit={(e) => void submit(e)} noValidate>
        <div className="field field-first">
          <label htmlFor={`${id}-n`}>{t("groups.createSheet.name")}</label>
          <div className="input" aria-invalid={fieldError || undefined}>
            <input
              ref={inputRef}
              id={`${id}-n`}
              className="input-bare"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("groups.createSheet.placeholder")}
              autoComplete="off"
              aria-invalid={fieldError || undefined}
              aria-describedby={`${id}-h`}
            />
            <span className="counter num" aria-hidden="true">
              {len}/{GROUP_NAME_MAX}
            </span>
          </div>
          <p className="field-hint" id={`${id}-h`}>
            {t("groups.createSheet.hint", { max: GROUP_NAME_MAX })}
          </p>
          {error ? (
            <p className="field-error" role="alert">
              <Icon name="circle-alert" size="sm" />
              <span>{error}</span>
            </p>
          ) : null}
        </div>
        <p className="note-box">
          <Icon name="crown" size="sm" />
          <span>{t("groups.createSheet.role")}</span>
        </p>
      </form>
    </Sheet>
  );
}

function JoinSheet({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (r: { groupId: string; groupName: string; alreadyMember: boolean }) => void;
}) {
  const t = useTranslations();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || code.trim() === "") return;
    setBusy(true);
    setError(null);
    // โค้ดอยู่ใน state ของ sheet เท่านั้น — ไม่ใส่ URL / storage / log (R2-10)
    const res = await callApi<{ groupId: string; groupName: string; alreadyMember: boolean }>("/api/invites/redeem", { body: { code } });
    if (res.ok) {
      onDone(res.data);
      return;
    }
    setBusy(false);
    setError(failureMessage(t, "join", res));
  }

  return (
    <Sheet
      title={t("groups.join.title")}
      onClose={onClose}
      initialFocusRef={inputRef}
      footer={
        <>
          <button type="submit" form={`${id}-f`} className="btn btn-primary btn-block" disabled={busy || code.trim() === ""}>
            {busy ? t("groups.join.submitting") : t("groups.join.submit")}
          </button>
          <button type="button" className="btn btn-secondary btn-block" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </>
      }
    >
      <form id={`${id}-f`} onSubmit={(e) => void submit(e)} noValidate>
        <div className="field field-first">
          <label htmlFor={`${id}-c`}>{t("groups.join.label")}</label>
          <div className="input" aria-invalid={error ? true : undefined}>
            <input
              ref={inputRef}
              id={`${id}-c`}
              className="input-bare"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t("groups.join.placeholder")}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-e ${id}-h` : `${id}-h`}
            />
          </div>
          {error ? (
            <p className="field-error" id={`${id}-e`} role="alert">
              <Icon name="circle-alert" size="sm" />
              <span>{error}</span>
            </p>
          ) : null}
          <p className="field-hint" id={`${id}-h`}>
            {t("groups.join.hint")}
          </p>
        </div>
      </form>
    </Sheet>
  );
}
