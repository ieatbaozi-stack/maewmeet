import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirectIfSignedIn } from "@/app/_lib/session";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { SignupForm } from "@/components/auth/SignupForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("signup");
  return { title: t("title") };
}

/** สมัครบัญชี (UX W2 · samples/signup.html) */
export default async function SignupPage() {
  await redirectIfSignedIn();
  return (
    <AuthScreen>
      <SignupForm />
    </AuthScreen>
  );
}
