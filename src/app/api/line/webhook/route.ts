// POST /api/line/webhook — ไม่มี actor/CSRF (server-to-server) · ด่านคือ X-Line-Signature กับ raw body (ใน handleLineWebhook) · R10 §2 · เจ้าของ: Integrations
import { dataCtx } from '@/lib/data/context';
import { handleLineWebhook } from '@/lib/integrations/line/webhook';
import { route } from '../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/line/webhook',
  handler: ({ req, now }) => handleLineWebhook(req, dataCtx(req, now)),
});
