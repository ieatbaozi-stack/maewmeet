// โหลดข้อมูลหน้ากลุ่มฝั่งเซิร์ฟเวอร์ — เรียก service ตรง (authorize() บรรทัดแรกของ service ยังทำงานเหมือนผ่าน API)
// สิทธิ์ตัดสินที่ service เสมอ: ไม่ใช่สมาชิก / กลุ่มไม่มี / ถูกลบ → NOT_FOUND → notFound() (404 ไม่ยืนยันว่ากลุ่มมีอยู่)
import { cache } from "react";
import { notFound } from "next/navigation";
import { dataCtx } from "@/lib/data/context";
import { getGroup, groupParamsSchema, listMyGroups } from "@/lib/data/services/groups";
import { listInvites, listMyInvites } from "@/lib/data/services/invites";
import type { GroupDetailDto, GroupSummaryDto, InviteDto, PendingInviteDto } from "@/lib/data/serializers/groups";
import { getRequestSession } from "@/lib/auth/page-session";
import { clock } from "@/lib/shared/clock";
import { AppError } from "@/lib/shared/errors";

async function scope() {
  const { req, actor } = await getRequestSession();
  return { actor, ctx: dataCtx(req, clock.now()) };
}

/** NOT_FOUND จาก service (รวมคนนอกกลุ่ม/กลุ่มที่ลบแล้ว) → หน้า 404 · อื่นๆ ปล่อยให้ error boundary */
async function orNotFound<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}

/** gid ที่ไม่ใช่ uuid ก็คือ "ไม่มีหน้านี้" */
function validGid(gid: string): string {
  const parsed = groupParamsSchema.safeParse({ gid });
  if (!parsed.success) notFound();
  return parsed.data.gid;
}

export async function loadGroupsTab(): Promise<{ groups: GroupSummaryDto[]; invites: PendingInviteDto[] }> {
  const { actor, ctx } = await scope();
  const [{ groups }, { invites }] = await Promise.all([listMyGroups(actor, ctx), listMyInvites(actor, ctx)]);
  return { groups, invites };
}

/** cache ต่อ request: generateMetadata + page เรียกซ้ำได้โดยอ่าน DB/audit ครั้งเดียว */
export const loadGroup = cache(async (gid: string): Promise<GroupDetailDto> => {
  const id = validGid(gid);
  const { actor, ctx } = await scope();
  return (await orNotFound(() => getGroup(actor, id, ctx))).group;
});

export async function loadGroupSettings(gid: string): Promise<{ group: GroupDetailDto; invites: InviteDto[] }> {
  const id = validGid(gid);
  const { actor, ctx } = await scope();
  const { group } = await orNotFound(() => getGroup(actor, id, ctx));
  const { invites } = await orNotFound(() => listInvites(actor, id, ctx));
  return { group, invites };
}
