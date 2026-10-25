import { requireUser } from "@/app/_lib/session";
import { Aurora } from "@/components/brand";
import { HomeView } from "@/components/home/HomeView";
import { TopBar } from "@/components/shell/TopBar";
import { loadHome } from "./_lib/home";

/**
 * หน้าหลัก (UX W16 · R4B U11) — การ์ด "นัดถัดไป" ข้ามทุกกลุ่ม + นัดถัดๆ ไป + ตอบ RSVP ได้จากการ์ด
 * ไม่มีนัด → แมว + ปุ่ม "ดูวันที่ว่างตรงกัน" (/calendar?v=free) · ไม่มีกลุ่ม → ชวนสร้างกลุ่ม
 * เซิร์ฟเวอร์โหลดข้อมูลแรก (service ตรง) · ไคลเอนต์ดูแล RSVP แบบ optimistic + รีเฟรชเมื่อกลับมาที่แท็บ
 */
export default async function HomePage() {
  await requireUser();
  const data = await loadHome();
  const initial = data.kind === "ready" ? ({ kind: "ready", appointments: data.appointments } as const) : ({ kind: data.kind } as const);
  return (
    <>
      <Aurora intensity="hero" />
      <TopBar />
      <HomeView initial={initial} initialNowMs={data.nowMs} />
    </>
  );
}
