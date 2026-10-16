import Link from "next/link";
import type { ReactNode } from "react";
import { Cat, type CatPose, type CatSize } from "@/components/brand";

export interface EmptyStateProps {
  pose: CatPose;
  catSize?: CatSize;
  title: string;
  body: string;
  /** ปุ่มเดียวของหน้าว่าง (UX §3: แมว 1 ตัว + 1 ประโยค + 1 ปุ่ม) · ไม่มี href = ยังไม่เปิดใช้ในรุ่นนี้ → ปุ่มปิด */
  cta?: { label: string; href?: string };
  /** ระดับหัวข้อ: h1 เมื่อหน้าไม่มีหัวข้ออื่น */
  headingLevel?: 1 | 2;
  extra?: ReactNode;
}

/** หน้าว่างบนแผง veil (aurora hero: ข้อความรองต้องอยู่บน veil — UX X17) */
export function EmptyState({ pose, catSize = "lg", title, body, cta, headingLevel = 2, extra }: EmptyStateProps) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <section className="empty panel">
      <Cat pose={pose} size={catSize} />
      <Heading className="h-section">{title}</Heading>
      <p className="muted">{body}</p>
      {cta ? (
        cta.href ? (
          <Link className="btn btn-primary" href={cta.href}>
            {cta.label}
          </Link>
        ) : (
          <button type="button" className="btn btn-primary" disabled>
            {cta.label}
          </button>
        )
      ) : null}
      {extra}
    </section>
  );
}
