import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { CURRENT_GROUP_COOKIE, parseCurrentGroupCookie } from "@/lib/shared/current-group-cookie";
import { getTranslations } from "next-intl/server";
import { getPageUser, requireUser } from "@/app/_lib/session";
import { Aurora, Cat } from "@/components/brand";
import { FlashNotice } from "@/components/groups/Notice";
import { MemberList } from "@/components/groups/MemberList";
import { StepBar } from "@/components/groups/StepBar";
import { STEP_TOTAL, computeSteps } from "@/components/groups/steps-model";
import { viewerRole } from "@/components/groups/helpers";
import { Icon } from "@/components/icons/Icon";
import { Name } from "@/components/Name";
import { RememberGroup } from "@/components/calendar/RememberGroup";
import { CreateAppointmentButton } from "@/components/appointments/CreateAppointmentButton";
import { loadGroup } from "../_lib/load";
import { loadGroupAppointments } from "../../appointments/_lib/load";

export async function generateMetadata({ params }: { params: Promise<{ gid: string }> }): Promise<Metadata> {
  // ชื่อกลุ่มเป็นข้อมูลของสมาชิก: ไม่ล็อกอิน/ถูกระงับ/ต้องเปลี่ยน PIN → ใช้ title เริ่มต้น (หน้าเองจะ redirect) ไม่เรียก service ที่จะโยน PolicyError แล้วไป log stack
  const user = await getPageUser().catch(() => null);
  if (!user || user.mustChangePin) return {};
  const { gid } = await params;
  try {
    return { title: (await loadGroup(gid)).name };
  } catch {
    return {}; // 404/ผิดพลาดอื่น: ให้ตัวหน้าตัดสินเอง (notFound / error boundary) — metadata ไม่ทำให้ request ล้ม
  }
}

/** หน้ากลุ่ม (UX: group) — หัวกลุ่ม · ชวนเพื่อน · สมาชิกพร้อมบทบาท · ที่ว่างของปฏิทิน (R3–R4) */
export default async function GroupPage({ params }: { params: Promise<{ gid: string }> }) {
  const user = await requireUser();
  const { gid } = await params;
  const group = await loadGroup(gid);
  const t = await getTranslations();
  // คุกกี้ mm_group เป็น HttpOnly → อ่านได้เฉพาะฝั่งเซิร์ฟเวอร์ · ยิง PUT เฉพาะเมื่อค่าต่างจากกลุ่มนี้ (security R6D L2 · ADR 0009 §5)
  const remembered = parseCurrentGroupCookie((await cookies()).get(CURRENT_GROUP_COOKIE)?.value);
  const solo = group.memberCount <= 1;
  // จำนวนนัดที่กำลังจะถึง (ไม่นับที่ยกเลิก) สำหรับการ์ดนัดของกลุ่ม · โหลดไม่ได้ → ไม่ทำให้หน้ากลุ่มล้ม (การ์ดแสดงข้อความ 0)
  const upcoming = solo ? null : await loadGroupAppointments(gid).catch(() => null);
  const upcomingCount = upcoming ? upcoming.appointments.filter((a) => a.status !== "cancelled").length : 0;
  // R8: ขั้น 2 = แถวของผู้ดูเองมี busy ใน 30 วัน (ไม่ใช่สมาชิก/ไม่มีค่า → false) · ขั้น 4 = มีนัดที่กำลังจะถึง (กลุ่มคนเดียวไม่โหลด → 0)
  const viewerHasBusy = group.members.find((m) => m.userId === user.id)?.hasUpcomingBusy === true;
  const steps = computeSteps({ memberCount: group.memberCount, viewerHasBusy, upcomingCount });
  const invitePath = `/groups/${group.id}/settings#invite`;
  const inviteButton = (tone: "btn-primary" | "btn-secondary") => (
    <Link className={`btn ${tone}`} href={invitePath}>
      <Icon name="user-plus" />
      <span>{t("group.invite")}</span>
    </Link>
  );

  return (
    <>
      <Aurora intensity="soft" />
      {/* R6D G1: เปิดหน้ากลุ่ม = กลุ่มปัจจุบันของเครื่องนี้ (เฉพาะสมาชิกจริง — เซิร์ฟเวอร์ตรวจซ้ำที่ PUT) */}
      {group.myRole !== null && remembered !== group.id ? <RememberGroup gid={group.id} /> : null}
      <header className="topbar">
        <Link className="icon-btn" href="/groups" aria-label={t("group.back")}>
          <Icon name="chevron-left" />
        </Link>
        <span className="title" />
        <Link className="icon-btn" href={`/groups/${group.id}/settings`} aria-label={t("group.settings")}>
          <Icon name="settings" />
        </Link>
      </header>
      <main className="main group-main" id="main">
        <div className="group-head">
          <h1><Name>{group.name}</Name></h1>
          <p className="meta">
            <span>{t("groups.memberCount", { count: group.memberCount })}</span>
            {group.myRole !== null ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{t("group.yourRole", { role: group.myRole })}</span>
              </>
            ) : null /* super admin ที่ไม่ใช่สมาชิก: ไม่แสดงป้ายบทบาท (ไม่ใช่ admin ของกลุ่มนี้) */}
          </p>
        </div>

        <FlashNotice />

        {/* R8: แถบขั้นตอนแทนการ์ด solo เดิม · ซ่อนสำหรับ super admin ที่ไม่ใช่สมาชิก (ไม่มีแถวของตัวเอง ขั้นตอนไม่เกี่ยว) */}
        {group.myRole !== null ? (
          <StepBar
            groupId={group.id}
            steps={steps.steps}
            doneCount={steps.doneCount}
            total={STEP_TOTAL}
            allDone={steps.allDone}
            solo={solo}
            planAction={
              solo ? undefined : (
                <CreateAppointmentButton groupId={group.id} groupName={group.name} memberCount={group.memberCount} tz={group.tz} userId={user.id} className="btn btn-secondary" testId="group-step-create-appt" />
              )
            }
          />
        ) : null}

        {!solo ? (
          <div className="btn-row">
            <CreateAppointmentButton groupId={group.id} groupName={group.name} memberCount={group.memberCount} tz={group.tz} userId={user.id} testId="group-create-appt" />
            {inviteButton("btn-secondary")}
          </div>
        ) : null}

        <section aria-labelledby="mem-h" className="members-section">
          <h2 className="h-section" id="mem-h">
            {t("group.members.title")}
          </h2>
          <MemberList groupId={group.id} members={group.members} viewer={viewerRole(group.myRole)} myId={user.id} />
        </section>

        {!solo ? (
          <section className="cal-links" aria-labelledby="cal-links-h" data-testid="group-cal-links">
            <h2 className="h-section" id="cal-links-h">
              {t("group.calendarLinks.title")}
            </h2>
            <div className="cal-links-grid">
              <Link className="panel cal-link" href={`/groups/${group.id}/appointments`} data-testid="group-link-appointments">
                <Cat pose="pin" size="md" />
                <span>
                  <b>{t("group.calendarLinks.appointments.title")}</b>
                  <span className="muted">{t("group.calendarLinks.appointments.body", { count: upcomingCount })}</span>
                </span>
              </Link>
              <Link className="panel cal-link" href={`/calendar?g=${group.id}&v=free`} data-testid="group-link-free">
                <Cat pose="calendar" size="md" />
                <span>
                  <b>{t("group.calendarLinks.free.title")}</b>
                  <span className="muted">{t("group.calendarLinks.free.body")}</span>
                </span>
              </Link>
              <Link className="panel cal-link" href={`/calendar?g=${group.id}&v=month`} data-testid="group-link-month">
                <Icon name="calendar" />
                <span>
                  <b>{t("group.calendarLinks.month.title")}</b>
                  <span className="muted">{t("group.calendarLinks.month.body")}</span>
                </span>
              </Link>
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}
