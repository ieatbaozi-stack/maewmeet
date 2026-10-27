import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { getPageUser } from "@/app/_lib/session";
import { Logo } from "@/components/brand";
import { Icon } from "@/components/icons/Icon";
import { LoginPrefs } from "@/components/prefs/LoginPrefs";
import { THEME_COOKIE, parseLocale, parseTheme } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("privacy");
  return { title: t("title") };
}

/** หัวข้อและรายการของแต่ละส่วน (คีย์ใน messages: privacy.<section>.<item>) — ลำดับตามที่แสดง */
const SECTIONS = [
  { key: "collect", items: ["account", "busy", "groups", "security", "cookies"] },
  { key: "see", items: ["owner", "members", "note", "outsiders", "groups", "superAdmin"] },
  { key: "places", items: ["search", "tiles", "noTracking"] },
  { key: "retention", items: ["busy", "notifications", "sessions", "security", "groups", "providers"] },
  { key: "delete", items: ["how", "removed", "kept", "noRestore"] },
  { key: "contact", items: ["body"] },
] as const;

/** ล็อกอินอยู่ไหม — ฐานข้อมูลมีปัญหาก็ยังต้องอ่านประกาศได้ (ถือว่าไม่ได้ล็อกอิน) */
async function signedIn(): Promise<boolean> {
  try {
    return (await getPageUser()) !== null;
  } catch {
    return false;
  }
}

/**
 * ประกาศความเป็นส่วนตัว (R5 §2 ข้อ 5) — สาธารณะ ไม่ต้องล็อกอิน · TH/EN · ลิงก์จากหน้าเข้าสู่ระบบและแท็บ ฉัน
 * ข้อความร่างโดยทีมจากพฤติกรรมจริงของโค้ด (ไม่ใช่คำปรึกษากฎหมาย — เจ้าของแอปต้องรับรองก่อนเปิดใช้จริง · R5_CONTRACT §7 ข้อ 4)
 */
export default async function PrivacyPage() {
  const locale = parseLocale(await getLocale());
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const t = await getTranslations("privacy");
  const back = (await signedIn()) ? "/me" : "/login";
  return (
    <main className="legal" id="main">
      <div className="login-top">
        <Link className="legal-back" href={back} data-testid="privacy-back">
          <Icon name="chevron-left" size="sm" />
          <span>{t("back")}</span>
        </Link>
        <LoginPrefs current={{ locale, theme }} />
      </div>
      <header className="legal-head">
        <Logo variant="mark" />
        <h1>{t("title")}</h1>
        <p className="muted">{t("updated")}</p>
      </header>
      <div className="alert alert-warn" role="note" data-testid="privacy-draft">
        <Icon name="info" />
        <div>{t("draft")}</div>
      </div>
      <p className="legal-intro">{t("intro")}</p>
      {SECTIONS.map((s) => (
        <section className="legal-sec" key={s.key} aria-labelledby={`privacy-${s.key}`}>
          <h2 id={`privacy-${s.key}`}>{t(`${s.key}.title`)}</h2>
          {s.items.length === 1 ? (
            <p>{t(`${s.key}.${s.items[0]}`)}</p>
          ) : (
            <ul>
              {s.items.map((i) => (
                <li key={i}>{t(`${s.key}.${i}`)}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </main>
  );
}
