// service: ข้อมูลหน้าหลัก (R7 B-4) — รายการกลุ่มของฉัน ∥ นัดที่จะถึงของฉัน ในการเรียกเดียว
//  - authorize ที่ต้นฟังก์ชัน + service ย่อยแต่ละตัว authorize ของตัวเองอีกชั้น (group.list.mine / appointment.list.mine — ข้อมูลของ actor เท่านั้น)
//  - ทั้งสองอิสระกัน (ผูก user_id ของ actor) จึงเริ่มพร้อมกัน · ไม่มีกลุ่ม → hasGroups=false, appointments=[] (ผลนัดถูกทิ้ง และความล้มเหลวของมันไม่ทำให้ล้ม — เท่ากับเดิมที่ไม่เรียกเลย)
import { authorize } from '@/lib/rbac/can';
import type { Actor } from '@/lib/rbac/types';
import type { DataCtx } from '../context';
import type { AppointmentDto } from '../serializers/appointments';
import { listMyAppointments, type MyAppointmentsQuery } from './appointments';
import { listMyGroups } from './groups';

export type HomeFeedDto = { hasGroups: boolean; appointments: AppointmentDto[] };

/** = listMyGroups แล้ว (ถ้ามีกลุ่ม) listMyAppointments(query) แบบเดิม แต่ไม่รอกันเป็นทอด (−1 wave) · query ตรวจโดย listMyAppointments เหมือนเดิม */
export async function getHomeFeed(actor: Actor, query: MyAppointmentsQuery, ctx: DataCtx): Promise<HomeFeedDto> {
  authorize(actor, 'group.list.mine', { type: 'none' });
  const appointments = listMyAppointments(actor, query, ctx);
  appointments.catch(() => undefined); // ไม่มีกลุ่ม → ไม่ await ผลนี้ · กัน unhandled rejection (มีกลุ่ม → await ด้านล่างโยนต่อตามเดิม)
  const { groups } = await listMyGroups(actor, ctx);
  if (groups.length === 0) return { hasGroups: false, appointments: [] };
  return { hasGroups: true, appointments: (await appointments).appointments };
}
