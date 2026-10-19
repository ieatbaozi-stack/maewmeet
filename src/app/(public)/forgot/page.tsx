import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getResetStatus, redirectIfSignedIn } from "@/app/_lib/session";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { ForgotView } from "@/components/auth/ForgotView";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("forgot");
  return { title: t("title") };
}

/** ลืม PIN (UX W3 · samples/forgot.html) — สถานะเริ่มต้นอ่านจาก cookie ผูกเครื่อง แล้ว client ถามซ้ำ */
export default async function ForgotPage() {
  await redirectIfSignedIn();
  const initial = await getResetStatus();
  return (
    <AuthScreen>
      <ForgotView initial={initial} />
    </AuthScreen>
  );
}
