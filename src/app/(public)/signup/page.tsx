import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirectIfSignedIn } from "@/app/_lib/session";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { SignupForm } from "@/components/auth/SignupForm";
import { nextFromSearch } from "@/components/share/model";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("signup");
  return { title: t("title") };
}

/** สมัครบัญชี (UX W2 · samples/signup.html) */
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const next = nextFromSearch((await searchParams).next); // R18 §S3: allowlist เดียวกับ login
  await redirectIfSignedIn(next);
  return (
    <AuthScreen>
      <SignupForm next={next} />
    </AuthScreen>
  );
}
