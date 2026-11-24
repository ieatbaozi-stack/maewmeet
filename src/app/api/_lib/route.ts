// route wrapper — ARCHITECTURE §2 ขั้น 1–5 · ADR 0008 §3 (error เป็นรหัส) · ADR 0003 §4 (manifest)
//
//   export const POST = route({
//     method: 'POST', path: '/api/prefs',          // ต้องตรงกับ ROUTE_MANIFEST (ไม่ตรง = โยนตอนโหลดโมดูล)
//     input: z.object({...}).strict(),              // GET: query string · อื่น ๆ: JSON body
//     params: z.object({ gid: z.string() }),        // (ถ้ามี) segment แบบ [gid]
//     handler: async ({ actor, input, params, now }) => service(actor, input),   // คืนค่า = {data}
//   });
//
// ลำดับตายตัว: (cron: Bearer) → 1. CSRF Origin + JSON content-type (non-GET, auth=actor) → 2. zod → 3. actor →
//              4. handler/service → 5. {data} | {error:{code,params}} + Cache-Control: private, no-store
// R7 §2: ครอบทั้งหมดด้วยตัวนับ query/เวลาต่อ request (ปิดได้ด้วย SERVER_TIMING_ENABLED=false) → header Server-Timing (ดู shouldExposeServerTiming)
// R16 H3: ขั้น 3½ — GET ที่ต้องล็อกอิน (ผู้ใช้จริง · action ไม่สาธารณะ) จองช่อง API_READ_RATE_LIMIT ต่อผู้ใช้ *ก่อน* handler
//          เต็ม → 429 RATE_LIMITED + Retry-After โดย handler ไม่รันเลย (ไม่อ่านฐาน · ไม่เขียน audit การอ่าน) · ผู้ที่เพิ่งถูกปฏิเสธ → 429 ทันทีไม่แตะ DB
//          R18 H1 (security-r16 Info 1): เดิมจองขนานกับ handler แล้วทิ้งผล — handler ยังอ่านฐาน/บันทึก audit ของ SA ทั้งที่ได้ 429 · แลกกับ +1 round trip ต่อเนื่อง
//          (ดู src/lib/data/read-limit.ts)
import type { z } from 'zod';
import { isPinChangeAllowed, isPublicAction, isSuperAdminOnly, type Action } from '@/lib/rbac/actions';
import type { Actor } from '@/lib/rbac/types';
import { clock } from '@/lib/shared/clock';
import { getDb } from '@/db/client';
import { runWithRequestMetrics, serverTimingValue } from '@/db/request-metrics';
import { assertNotReadBlocked, readLimited, takeReadSlot } from '@/lib/data/read-limit';
import { configuredAppOrigin, getEnv, isEnvError, serverTimingEnabled, type Env } from '@/lib/shared/env';
import { AppError, errorBody, httpStatusOf, isErrorCode, type ErrorCode, type ErrorParams } from '@/lib/shared/errors';
import { resolveActor, setActorResolver } from './actor';
import { getActor, takeRenewedSessionCookie } from '@/lib/auth/session';
import { serializeCookie, type CookieSpec } from './cookies';
import { isAuthorizedCron } from './cron-auth';
import { findRoute, type HttpMethod, type ManifestEntry } from './manifest';

// R1: เสียบตัวหา actor จริง (Lead อนุมัติข้อยกเว้น 1 บรรทัด) — ก่อนหน้านี้ = anonymous
setActorResolver(getActor);

export const CACHE_CONTROL = 'private, no-store';
export const MAX_BODY_BYTES = 64 * 1024;

// ───────── ผลลัพธ์จาก handler ─────────
const REPLY = Symbol('maewmeet.reply');

export type ReplyInit = {
  status?: number;
  headers?: Record<string, string>;
  cookies?: readonly CookieSpec[];
  /** ส่ง body ตามที่ให้โดยไม่ห่อ {data} — สงวนไว้ให้ GET /api/health (R0_CONTRACT §3 กำหนดรูป body เอง) */
  raw?: boolean;
  /** ส่ง data (string) เป็น body ข้อความล้วนด้วย Content-Type นี้ แทน JSON — R12 §5 · actor / cookie ต่ออายุ / Cache-Control ยังผ่านขั้นตอนเดิมครบ */
  contentType?: string;
};
export type Reply<T> = { readonly [REPLY]: true; readonly data: T; readonly init: ReplyInit };

/** คืนจาก handler เมื่อต้องการ status/cookie/header เพิ่ม — ไม่งั้นคืนค่าตรง ๆ ได้ (= 200 {data}) */
export function reply<T>(data: T, init: ReplyInit = {}): Reply<T> {
  return { [REPLY]: true, data, init };
}

function isReply(value: unknown): value is Reply<unknown> {
  return typeof value === 'object' && value !== null && REPLY in value;
}

// ───────── spec ─────────
type ParamsShape = Record<string, string | string[] | undefined>;
/** context ที่ Next ส่งเป็นอาร์กิวเมนต์ที่สองของ route handler */
export type RouteContext = { params: Promise<ParamsShape> };
export type RouteHandler = (req: Request, ctx?: RouteContext) => Promise<Response>;

export type HandlerContext<I, P> = {
  req: Request;
  input: I;
  params: P;
  actor: Actor;
  /** เวลา "ตอนนี้" ของ request นี้ (epoch ms) — อ่านครั้งเดียวจาก clock เพื่อให้ทั้ง request ใช้ค่าเดียว */
  now: number;
  entry: ManifestEntry;
};

type AnySchema = z.ZodType;
type Out<S> = S extends z.ZodType ? z.output<S> : undefined;

export type RouteSpec<S extends AnySchema | undefined, PS extends AnySchema | undefined, O> = {
  method: HttpMethod;
  path: string;
  input?: S;
  params?: PS;
  /** เพดานขนาด JSON body (ไบต์) — ดีฟอลต์ MAX_BODY_BYTES (64 KB) · ใช้เมื่อ route รับไฟล์ข้อความเช่น .ics preview (ADR 0017 §1) */
  maxBodyBytes?: number;
  /** รหัส error เมื่อเกิน maxBodyBytes — ดีฟอลต์ VALIDATION { fields: { _body: 'TOO_LARGE' } } */
  bodyTooLargeCode?: ErrorCode;
  handler: (ctx: HandlerContext<Out<S>, Out<PS>>) => Promise<O | Reply<O>> | O | Reply<O>;
  /**
   * ชั้นนอกสุด: แปลงคำตอบสุดท้ายหลังทุกขั้นตอนจบแล้ว (รวม Server-Timing ซึ่งตัดสินจาก status เดิม) — R12 §5 redirect ตอนเปิดจากลิงก์
   * ไม่ระบุ = คำตอบเดิมทุกประการ
   */
  finalize?: (res: Response, req: Request, ctx: RouteContext | undefined) => Response | Promise<Response>;
};

// ───────── helpers ─────────
function json(body: unknown, status: number, extra?: Headers): Response {
  const headers = extra ?? new Headers();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', CACHE_CONTROL);
  return new Response(JSON.stringify(body), { status, headers });
}

function textBody(body: unknown, contentType: string, status: number, headers: Headers): Response {
  if (typeof body !== 'string') throw new TypeError('reply: contentType requires a string body');
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', CACHE_CONTROL);
  return new Response(body, { status, headers });
}

export function errorResponse(code: ErrorCode, params?: ErrorParams, status?: number, retryAfterSec?: number): Response {
  const headers = new Headers();
  if (retryAfterSec !== undefined) headers.set('Retry-After', String(Math.max(0, Math.ceil(retryAfterSec))));
  return json(errorBody(code, params), status ?? httpStatusOf(code), headers);
}

/** Origin ที่ยอมรับ: APP_ORIGIN → https://VERCEL_URL → (dev) origin ของ request เอง (URL หรือ Host header) */
function allowedOrigins(req: Request, env: Env): string[] {
  const configured = configuredAppOrigin(env);
  if (configured) return [configured];
  const url = new URL(req.url);
  const out = [url.origin];
  const host = req.headers.get('host');
  if (host) out.push(`${url.protocol}//${host}`);
  return out;
}

export function checkCsrf(req: Request, env: Env): boolean {
  const origin = req.headers.get('origin');
  if (!origin || origin === 'null') return false;
  if (!allowedOrigins(req, env).includes(origin)) return false;
  const ct = req.headers.get('content-type') ?? '';
  return /^application\/json\s*(;|$)/i.test(ct);
}

/** จำนวน field สูงสุดใน VALIDATION params — กัน response ขยายตามจำนวนคีย์แปลกที่ผู้เรียกส่งมา (Security R0) */
export const MAX_VALIDATION_FIELDS = 32;
const SAFE_FIELD_SEGMENT = /^[A-Za-z0-9_]{1,64}$/;

/** path ที่มี segment มาจากผู้เรียก (คีย์แปลก / คีย์ของ record) → '_' ถ้าไม่ใช่ชื่อธรรมดา (ไม่สะท้อนสตริงของผู้เรียก) */
function fieldKey(segments: readonly PropertyKey[]): string {
  const parts = segments.map(String);
  if (parts.length === 0 || !parts.every((p) => SAFE_FIELD_SEGMENT.test(p))) return '_';
  return parts.join('.');
}

/** zod issues → {fields: {path: REASON}} (ADR 0008 §3) — ไม่มีข้อความภาษาคน ไม่สะท้อนค่า/คีย์แปลกที่ส่งมา */
export function validationParams(error: z.ZodError, raw: unknown): { fields: Record<string, string> } {
  const fields: Record<string, string> = Object.create(null) as Record<string, string>;
  const put = (key: string, reason: string) => {
    if (key in fields || Object.keys(fields).length >= MAX_VALIDATION_FIELDS) return;
    fields[key] = reason;
  };
  for (const issue of error.issues) {
    const key = fieldKey(issue.path);
    let reason: string;
    switch (issue.code) {
      case 'invalid_type':
        reason = valueAt(raw, issue.path) === undefined ? 'REQUIRED' : 'INVALID_TYPE';
        break;
      case 'too_big':
        reason = issue.origin === 'string' ? 'TOO_LONG' : 'TOO_LARGE';
        break;
      case 'too_small':
        reason = issue.origin === 'string' ? 'TOO_SHORT' : 'TOO_SMALL';
        break;
      case 'unrecognized_keys':
        for (const k of issue.keys) put(fieldKey([...issue.path, k]), 'UNKNOWN_FIELD');
        continue;
      case 'invalid_value':
      case 'invalid_format':
      case 'invalid_union':
        reason = 'INVALID';
        break;
      default:
        reason = 'INVALID';
    }
    put(key, reason);
  }
  return { fields: { ...fields } };
}

function valueAt(raw: unknown, path: readonly PropertyKey[]): unknown {
  let cur: unknown = raw;
  for (const p of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[p];
  }
  return cur;
}

const tooLarge = (code?: ErrorCode) =>
  code ? new AppError(code) : new AppError('VALIDATION', { fields: { _body: 'TOO_LARGE' } });

/**
 * อ่าน body แบบ stream พร้อมตัวนับไบต์ — ครบ maxBytes เมื่อไหร่ยกเลิก stream ทันที (ไม่ buffer ทั้งก้อนก่อนค่อยวัด)
 * ครอบคลุม chunked / ไม่มี content-length / content-length โกหก
 */
async function readJsonBody(req: Request, maxBytes = MAX_BODY_BYTES, tooLargeCode?: ErrorCode): Promise<unknown> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) {
    await req.body?.cancel().catch(() => undefined);
    throw tooLarge(tooLargeCode);
  }
  if (!req.body) return undefined;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge(tooLargeCode);
    }
    chunks.push(value);
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError('VALIDATION', { fields: { _body: 'INVALID_JSON' } });
  }
}

function queryObject(req: Request): Record<string, string> {
  return Object.fromEntries(new URL(req.url).searchParams.entries());
}

/** error ที่มีรูป {code: ErrorCode, status?: number} เช่น PolicyError ของ src/lib/rbac */
function asCodedError(e: unknown): { code: ErrorCode; status?: number; params?: ErrorParams; retryAfterSec?: number } | null {
  if (e instanceof AppError) return e;
  if (typeof e === 'object' && e !== null && 'code' in e && isErrorCode((e as { code: unknown }).code)) {
    const o = e as { code: ErrorCode; status?: unknown; params?: unknown };
    return {
      code: o.code,
      status: typeof o.status === 'number' ? o.status : undefined,
      params: o.params && typeof o.params === 'object' && Object.keys(o.params).length ? (o.params as ErrorParams) : undefined,
    };
  }
  return null;
}

function logUnexpected(entry: ManifestEntry, e: unknown): void {
  // ห้าม log PIN/token/hash/ค่า env: EnvError มีแค่ชื่อตัวแปร · error อื่น log แค่ชื่อชนิด
  if (isEnvError(e)) {
    console.error(`[api] ${entry.method} ${entry.path} ${e.message}`);
  } else {
    const name = e instanceof Error ? e.name : typeof e;
    console.error(`[api] ${entry.method} ${entry.path} unexpected ${name}`);
  }
}

// ───────── wrapper ─────────
export function route<S extends AnySchema | undefined = undefined, PS extends AnySchema | undefined = undefined, O = unknown>(
  spec: RouteSpec<S, PS, O>,
): RouteHandler {
  const entry = findRoute(spec.method, spec.path);
  if (!entry) {
    throw new Error(`route ${spec.method} ${spec.path} is not registered in src/app/api/_lib/manifest.ts`);
  }

  /** ทำงานจริงของ request (ขั้น cron → 1–5) · seen.user = actor ที่ resolve ได้เป็นผู้ใช้ที่ล็อกอิน (ใช้ตัดสินว่าแนบ Server-Timing ไหม) */
  const handle = async (req: Request, ctx: RouteContext | undefined, seen: { user: boolean }): Promise<Response> => {
    try {
      // (cron) Bearer ก่อนทุกอย่าง
      if (entry.auth === 'cron') {
        const env = getEnv();
        if (!isAuthorizedCron(req, env.CRON_SECRET)) return errorResponse('AUTH_REQUIRED');
      }

      // 1. CSRF: non-GET ของผู้ใช้ ต้อง Origin ตรง + JSON content-type
      const isRead = entry.method === 'GET';
      if (!isRead && entry.auth === 'actor') {
        if (!checkCsrf(req, getEnv())) return errorResponse('CSRF_REJECTED');
      }

      // 1½. Security L1 (v1.2.0 · ADR 0017 §6 H2): route non-GET ที่รับ body ใหญ่กว่า 64 KB และต้องล็อกอิน
      //     ตรวจ actor + ด่านบัญชี (anonymous / suspended / must_change_pin / SA-only) *ก่อน* อ่าน body
      //     เพื่อไม่ให้ผู้ที่ยังไม่ผ่านด่านบัญชีส่ง payload ใหญ่เข้ามา buffer (service ยังคงเรียก authorize() บรรทัดแรกตามเดิม)
      const preAuthLargeBody =
        !isRead &&
        entry.auth === 'actor' &&
        entry.action !== null &&
        !isPublicAction(entry.action) &&
        (spec.maxBodyBytes ?? MAX_BODY_BYTES) > MAX_BODY_BYTES;
      let preResolvedActor: Actor | undefined;
      if (preAuthLargeBody) {
        preResolvedActor = await resolveActor(req);
        seen.user = preResolvedActor.kind === 'user';
        if (preResolvedActor.kind !== 'user') {
          await req.body?.cancel().catch(() => undefined);
          return errorResponse('AUTH_REQUIRED');
        }
        if (preResolvedActor.status === 'suspended') {
          await req.body?.cancel().catch(() => undefined);
          return errorResponse('ACCOUNT_SUSPENDED');
        }
        if (preResolvedActor.status !== 'active') {
          await req.body?.cancel().catch(() => undefined);
          return errorResponse('AUTH_REQUIRED');
        }
        if (preResolvedActor.mustChangePin && !isPinChangeAllowed(entry.action!)) {
          await req.body?.cancel().catch(() => undefined);
          return errorResponse('PIN_CHANGE_REQUIRED');
        }
        if (isSuperAdminOnly(entry.action!) && !preResolvedActor.isSuperAdmin) {
          await req.body?.cancel().catch(() => undefined);
          return errorResponse('FORBIDDEN');
        }
      }

      // 2. validate input + params
      let input: unknown = undefined;
      if (spec.input) {
        const raw = isRead ? queryObject(req) : await readJsonBody(req, spec.maxBodyBytes ?? MAX_BODY_BYTES, spec.bodyTooLargeCode);
        const parsed = spec.input.safeParse(raw);
        if (!parsed.success) return errorResponse('VALIDATION', validationParams(parsed.error, raw));
        input = parsed.data;
      }
      let params: unknown = undefined;
      if (spec.params) {
        const rawParams = (await ctx?.params) ?? {};
        const parsed = spec.params.safeParse(rawParams);
        if (!parsed.success) return errorResponse('VALIDATION', validationParams(parsed.error, rawParams));
        params = parsed.data;
      }

      // 3. actor (R0: anonymous — R1 session · ใช้ผลจากขั้น 1½ ถ้าตรวจไปแล้ว)
      const actor: Actor = preResolvedActor ?? (entry.auth === 'actor' ? await resolveActor(req) : { kind: 'anonymous' });
      seen.user = actor.kind === 'user';

      const now = clock.now();
      // 3½. R16 H3 / R18 H1: limiter อ่านต่อผู้ใช้ — จองช่องให้เสร็จ *ก่อน* เริ่ม handler · เกินโควตา = โยน RATE_LIMITED → 429 โดย handler ไม่รัน
      //     ห้ามกลับไปรันขนาน: GET ของ super admin เขียน audit การอ่าน — handler ที่เริ่มก่อนรู้ผล limiter จะบันทึกทั้งที่ได้ 429
      if (actor.kind === 'user' && readLimited(entry.method, entry.auth, entry.action, true)) {
        assertNotReadBlocked(actor.id, now);
        await takeReadSlot(getDb(), actor.id, now);
      }

      // 4. handler → service
      const result = await spec.handler({
        req,
        input: input as Out<S>,
        params: params as Out<PS>,
        actor,
        now,
        entry,
      });

      // 5. response
      const r = isReply(result) ? result : reply(result);
      const headers = new Headers(r.init.headers);
      const cookies = r.init.cookies ?? [];
      for (const c of cookies) headers.append('Set-Cookie', serializeCookie(c));
      // sliding session: getActor ต่ออายุแถวใน DB แล้ว → แนบคุกกี้ใหม่ (handler ตั้งคุกกี้ชื่อเดียวกันเองแล้ว = ใช้ของ handler เช่น logout)
      if (entry.auth === 'actor') {
        const renewed = takeRenewedSessionCookie(req);
        if (renewed && !cookies.some((c) => c.name === renewed.name)) headers.append('Set-Cookie', serializeCookie(renewed));
      }
      if (r.init.contentType !== undefined) return textBody(r.data, r.init.contentType, r.init.status ?? 200, headers);
      return json(r.init.raw ? r.data : { data: r.data }, r.init.status ?? 200, headers);
    } catch (e) {
      const coded = asCodedError(e);
      if (coded) return errorResponse(coded.code, coded.params, coded.status, coded.retryAfterSec);
      logUnexpected(entry, e);
      return errorResponse('UNKNOWN');
    }
  };

  const measured = async (req: Request, ctx: RouteContext | undefined): Promise<Response> => {
    if (!serverTimingEnabled()) return handle(req, ctx, { user: false });
    // R7 §2: นับ query/เวลา DB ต่อ request (AsyncLocalStorage — ไม่ปนข้าม request)
    return runWithRequestMetrics(async (m) => {
      const seen = { user: false };
      const res = await handle(req, ctx, seen);
      if (shouldExposeServerTiming(entry.action, seen.user, res.status)) res.headers.set('Server-Timing', serverTimingValue(m));
      return res;
    });
  };

  return async (req: Request, ctx?: RouteContext): Promise<Response> => {
    const res = await measured(req, ctx);
    return spec.finalize ? spec.finalize(res, req, ctx) : res;
  };
}

/**
 * แนบ Server-Timing เฉพาะ: route ที่ไม่ใช่ action สาธารณะ + ผู้ใช้ที่ล็อกอินแล้ว + คำตอบสำเร็จ (< 400) — R7-3
 * - ไม่แนบให้ route ที่ action อยู่ใน PUBLIC_ACTIONS (signup / login / pin-reset / pin-reset status / prefs cookie) **ไม่ว่าผู้เรียก
 *   ล็อกอินอยู่หรือไม่** — ตัดสินจาก action ของ route ไม่ใช่ actor: ผู้ใช้ที่ล็อกอินแล้วยิง pin-reset ได้ (route ใช้ auth 'actor')
 *   และจำนวน query ของเส้นทางที่ตั้งใจตอบเหมือนกันทุกกรณี (เช่น pin-reset ตอบเหมือนกันทั้งมีและไม่มีบัญชี) ต่างกันตามข้อมูล
 *   → เป็น oracle บอกว่า username มีบัญชี active (security-r7 Low 1)
 * - ไม่แนบให้ anonymous และ route ที่ไม่มี action (health / cron)
 * - ไม่แนบให้คำตอบ error: NOT_FOUND ของคนนอกกลุ่ม/กลุ่มไม่มี/ลบแล้ว ต้องเหมือนกันทุกไบต์ (ADR 0003 IDOR) — จำนวน query อาจต่างกัน
 * ค่าใน header มีแค่ตัวเลข (ดู serverTimingValue) ไม่มี SQL/พารามิเตอร์/id/ข้อมูลผู้ใช้
 */
export function shouldExposeServerTiming(action: Action | null, actorIsUser: boolean, status: number): boolean {
  if (action === null || isPublicAction(action)) return false;
  return actorIsUser && status < 400;
}
