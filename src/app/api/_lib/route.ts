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
import type { z } from 'zod';
import type { Actor } from '@/lib/rbac/types';
import { clock } from '@/lib/shared/clock';
import { configuredAppOrigin, getEnv, isEnvError, type Env } from '@/lib/shared/env';
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
  handler: (ctx: HandlerContext<Out<S>, Out<PS>>) => Promise<O | Reply<O>> | O | Reply<O>;
};

// ───────── helpers ─────────
function json(body: unknown, status: number, extra?: Headers): Response {
  const headers = extra ?? new Headers();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', CACHE_CONTROL);
  return new Response(JSON.stringify(body), { status, headers });
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

const tooLarge = () => new AppError('VALIDATION', { fields: { _body: 'TOO_LARGE' } });

/**
 * อ่าน body แบบ stream พร้อมตัวนับไบต์ — ครบ 64KB เมื่อไหร่ยกเลิก stream ทันที (ไม่ buffer ทั้งก้อนก่อนค่อยวัด)
 * ครอบคลุม chunked / ไม่มี content-length / content-length โกหก
 */
async function readJsonBody(req: Request): Promise<unknown> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) {
    await req.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!req.body) return undefined;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
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

  return async (req: Request, ctx?: RouteContext): Promise<Response> => {
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

      // 2. validate input + params
      let input: unknown = undefined;
      if (spec.input) {
        const raw = isRead ? queryObject(req) : await readJsonBody(req);
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

      // 3. actor (R0: anonymous — R1 session)
      const actor: Actor = entry.auth === 'actor' ? await resolveActor(req) : { kind: 'anonymous' };

      // 4. handler → service
      const result = await spec.handler({
        req,
        input: input as Out<S>,
        params: params as Out<PS>,
        actor,
        now: clock.now(),
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
      return json(r.init.raw ? r.data : { data: r.data }, r.init.status ?? 200, headers);
    } catch (e) {
      const coded = asCodedError(e);
      if (coded) return errorResponse(coded.code, coded.params, coded.status, coded.retryAfterSec);
      logUnexpected(entry, e);
      return errorResponse('UNKNOWN');
    }
  };
}
