// POST /api/me/busy/import — บันทึกรายการ busy ที่ผู้ใช้ยืนยันแบบ atomic (v1.1.0 · ADR 0017 §3 · เจ้าของ: Platform)
import { dataCtx } from '@/lib/data/context';
import { confirmBusyImport, confirmBusyImportSchema } from '@/lib/data/services/busy-import';
import { reply, route } from '../../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/me/busy/import',
  input: confirmBusyImportSchema,
  handler: async ({ actor, input, req, now }) => reply(await confirmBusyImport(actor, input, dataCtx(req, now)), { status: 201 }),
});
