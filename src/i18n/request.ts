// next-intl แบบไม่มี locale ใน URL (ADR 0008 §1) — locale มาจาก cookie mm_locale เท่านั้น
import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { LOCALE_COOKIE, parseLocale } from "./config";

export default getRequestConfig(async () => {
  const store = await cookies();
  const locale = parseLocale(store.get(LOCALE_COOKIE)?.value);
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages, timeZone: "Asia/Bangkok" };
});
