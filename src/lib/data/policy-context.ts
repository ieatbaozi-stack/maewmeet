// policy-context — ARCHITECTURE §2 · ADR 0003 §1
// โหลด GroupCtx / role ของ actor / เจ้าของ resource ด้วย 1 query แล้วส่งให้ can() ของ src/lib/rbac (pure)
//
// สถานะ: **stub (R0)** — ยังไม่มี service ใดเรียก
// - R2 (กลุ่ม): loadGroupContext(actor, groupId) → { id, deleted, actorRole } · member / invite resource
// - R4 (วันว่าง/นัด): appointment / busy resource
// ชนิดข้อมูลจริงจะ import จาก '@/lib/rbac/types' (Auth & Access) เมื่อเติม

export {};
