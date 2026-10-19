import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireMustChangePin } from "@/app/_lib/session";
import { Aurora, Logo } from "@/components/brand";
import { SetPinForm, SetPinSignOut } from "@/components/auth/SetPinForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("setPin");
  return { title: t("title") };
}

/** ตั้ง PIN ใหม่ (บังคับหลัง reset · UX W2 · samples/set-pin.html) — ไม่มีแถบล่าง มีแค่ "ออกจากระบบ" */
export default async function SetPinPage() {
  await requireMustChangePin();
  const t = await getTranslations("setPin");
  return (
    <>
      <Aurora intensity="hero" />
      <main className="login" id="main">
        <div className="login-top">
          <Logo variant="mark" />
          <SetPinSignOut />
        </div>
        <div className="login-hero login-hero-compact">
          <h1>{t("title")}</h1>
        </div>
        <SetPinForm />
      </main>
    </>
  );
}
