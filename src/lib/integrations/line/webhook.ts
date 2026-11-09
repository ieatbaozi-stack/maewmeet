// POST /api/line/webhook — R10 §2 · ADR 0011 §1 · อ่าน raw body แล้วตรวจลายเซ็นก่อน parse · ลายเซ็นผิด/ไม่ได้ตั้ง secret = 401 แบบเดียวกัน
//  - message (ข้อความรูปโค้ดเท่านั้น): ผูกบัญชีแล้ว reply · ข้อความอื่นเงียบ (ไม่ทับ auto-response/แชทมือของ boss)
//  - โค้ดผิด/หมดอายุ/ใช้แล้ว/โดน rate limit: reply line.link.invalid เหมือนกันทุกกรณี
//  - unfollow: ยกเลิกการผูก + ล้างคิว pending · ห้าม log โค้ด/token/LINE user id/เนื้อหาข้อความ
import { z } from 'zod';
import type { Db, Tx } from '@/db/client';
import { rateKey } from '@/lib/auth/throttle';
import { bindLineUser, consumeLineLinkCode, findLocaleByLineUser, findLocaleOfUser, unlinkByLineUser } from '@/lib/data/repos/line';
import { reserveBucket } from '@/lib/data/repos/rate-limit-bucket';
import { inTx, serialized } from '@/lib/data/tx';
import { getEnv } from '@/lib/shared/env';
import { AppError } from '@/lib/shared/errors';
import { LINE_LINK_RATE_LIMITS, LINE_WEBHOOK_MAX_BODY_BYTES, LINE_WEBHOOK_MAX_EVENTS } from '@/lib/shared/limits';
import { replyText } from './client';
import { lineConfig, type LineConfig } from './config';
import { hashLineLinkCode, lineUserRateId, normalizeLineLinkCode } from './link-code';
import { renderLineLinkReply, type LineLinkReply, type LineLocale } from './messages';
import { verifyLineSignature } from './signature';

const LINE_USER_ID = /^U[0-9a-f]{32}$/;

const bodySchema = z.object({ events: z.array(z.unknown()) });
const eventSchema = z.object({
  type: z.string(),
  replyToken: z.string().optional(),
  source: z.object({ type: z.string(), userId: z.string().optional() }).optional(),
  message: z.object({ type: z.string(), text: z.string().optional() }).optional(),
});
type LineEvent = z.output<typeof eventSchema>;

export type WebhookCtx = { readonly db: Db; readonly now: number; readonly appSecret: string };

const tooLarge = () => new AppError('VALIDATION', { fields: { _body: 'TOO_LARGE' } });

async function readRawBody(req: Request): Promise<Buffer> {
  if (Number(req.headers.get('content-length') ?? '0') > LINE_WEBHOOK_MAX_BODY_BYTES) {
    await req.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > LINE_WEBHOOK_MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function parseBody(raw: Buffer): unknown[] {
  let json: unknown;
  try {
    json = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new AppError('VALIDATION', { fields: { _body: 'INVALID_JSON' } });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) throw new AppError('VALIDATION', { fields: { events: 'INVALID' } });
  return parsed.data.events;
}

/** ใช้โค้ด + ผูกบัญชีในธุรกรรมเดียว */
async function linkAccount(tx: Tx, codeHash: string, lineUserId: string, now: number): Promise<{ reply: LineLinkReply; ownerId: string | null }> {
  const ownerId = await consumeLineLinkCode(tx, codeHash, now);
  if (!ownerId) return { reply: 'invalid', ownerId: null };
  const bound = await bindLineUser(tx, ownerId, lineUserId, now);
  return { reply: bound ? 'success' : 'alreadyLinked', ownerId };
}

async function handleText(event: LineEvent, lineUserId: string, config: LineConfig, ctx: WebhookCtx): Promise<void> {
  if (event.message?.type !== 'text' || event.message.text === undefined) return;
  const code = normalizeLineLinkCode(event.message.text);
  if (!code) return;
  const { db, now, appSecret } = ctx;

  const spec = LINE_LINK_RATE_LIMITS.attempt;
  const slot = await serialized(db, () => reserveBucket(db, rateKey(spec, lineUserRateId(lineUserId, appSecret)), spec.windowMs, spec.limit, now));
  let reply: LineLinkReply = 'invalid';
  let locale: LineLocale | null = null;
  if (slot.admitted) {
    const hash = hashLineLinkCode(code, appSecret);
    const r = await inTx(db, (tx) => linkAccount(tx, hash, lineUserId, now));
    reply = r.reply;
    if (r.reply === 'success' && r.ownerId) locale = await findLocaleOfUser(db, r.ownerId);
  }
  locale ??= await findLocaleByLineUser(db, lineUserId);
  if (event.replyToken) await replyText(config, { replyToken: event.replyToken, text: renderLineLinkReply(locale ?? 'th', reply) });
}

async function handleEvent(raw: unknown, config: LineConfig, ctx: WebhookCtx): Promise<void> {
  const parsed = eventSchema.safeParse(raw);
  if (!parsed.success) return;
  const event = parsed.data;
  const lineUserId = event.source?.userId;
  if (event.source?.type !== 'user' || lineUserId === undefined || !LINE_USER_ID.test(lineUserId)) return;
  if (event.type === 'message') await handleText(event, lineUserId, config, ctx);
  else if (event.type === 'unfollow') await inTx(ctx.db, (tx) => unlinkByLineUser(tx, lineUserId, ctx.now));
}

export async function handleLineWebhook(req: Request, ctx: WebhookCtx): Promise<{ ok: true }> {
  const config = lineConfig(getEnv());
  const raw = await readRawBody(req);
  if (!config || !verifyLineSignature(raw, req.headers.get('x-line-signature'), config.channelSecret)) throw new AppError('AUTH_REQUIRED');
  const events = parseBody(raw);
  for (const event of events.slice(0, LINE_WEBHOOK_MAX_EVENTS)) {
    try {
      await handleEvent(event, config, ctx);
    } catch (e) {
      console.error(`[line] webhook event failed ${e instanceof Error ? e.name : typeof e}`);
    }
  }
  return { ok: true };
}
