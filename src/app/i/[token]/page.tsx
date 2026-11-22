import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { ShareLanding } from "@/components/share/ShareLanding";
import { ShareStatus } from "@/components/share/ShareStatus";
import { loadSharePage } from "@/lib/data/share-page";

/**
 * R18 §S3 (ADR 0016 §3): metadata ทั่วไป — ไม่มีชื่อนัด/ชื่อกลุ่ม/token ใน title/OG (ลิงก์ถูกวางในแชต → crawler อ่านได้)
 * noindex + ไม่ส่ง referrer ออกไป (token อยู่ใน path)
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return {
    title: t("name"),
    description: t("description"),
    robots: { index: false, follow: false, nocache: true }, // security-v1 Info 3
    referrer: "no-referrer",
    openGraph: { title: t("name"), description: t("description"), type: "website" },
  };
}

/** หน้าเปิดลิงก์ชวน /i/<token> — โหลดฝั่งเซิร์ฟเวอร์ผ่าน loadSharePage (platform ตัดสินทุกสถานะ) · ไม่มี bottom nav (นอกกลุ่ม (app)) */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const page = await loadSharePage(token);
  switch (page.kind) {
    case "member":
    case "guest":
      redirect(`/appointments/${page.appointmentId}`);
    case "pinChangeRequired":
      redirect("/set-pin");
    case "preview":
      return (
        <AuthScreen>
          <ShareLanding token={token} preview={page.preview} signedIn={page.signedIn} />
        </AuthScreen>
      );
    case "expired":
      return (
        <AuthScreen>
          <ShareStatus kind="expired" />
        </AuthScreen>
      );
    case "rateLimited":
      return (
        <AuthScreen>
          <ShareStatus kind="rate" />
        </AuthScreen>
      );
    case "invalid":
    default:
      return (
        <AuthScreen>
          <ShareStatus kind="invalid" />
        </AuthScreen>
      );
  }
}
