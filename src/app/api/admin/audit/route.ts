// GET /api/admin/audit?actor=&action=&targetType=&targetId=&before=&limit= — audit log (U12 · R5 §2 ข้อ 3) · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { auditListQuerySchema, listAudit } from '@/lib/data/services/admin-audit';
import { route } from '../../_lib/route';

export const GET = route({
  method: 'GET',
  path: '/api/admin/audit',
  input: auditListQuerySchema,
  handler: ({ actor, input, req, now }) => listAudit(actor, input, dataCtx(req, now)),
});
