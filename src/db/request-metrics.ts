// ตัวนับ query + เวลา DB ต่อ request — R7_CONTRACT §2 (เฟส A วัด baseline)
//
// - ผูกกับ request ด้วย AsyncLocalStorage (ห้าม state ระดับ module ที่ปนข้าม request): นอก runWithRequestMetrics() = ไม่นับอะไร
// - ห่อ client ของ libSQL ที่ชั้นเดียว (createDb → instrumentClient) — ทุกเส้นทางของ drizzle ผ่านเมธอดเหล่านี้:
//     execute (คำสั่งเดี่ยว) · batch / migrate (หลายคำสั่งในรอบเดียว) · transaction() → tx.execute/batch + commit/rollback
// - "query" = การเรียก DB หนึ่งครั้ง ≈ 1 round trip บน Turso: execute 1 · batch 1 · เปิดธุรกรรม 1 · commit/rollback 1
// - เก็บแค่ "จำนวน" และ "เวลา" — ไม่เก็บ SQL / พารามิเตอร์ / id / ข้อมูลผู้ใช้ใด ๆ (กฎ 7 · R7-3)
// - dbMs = ผลรวมเวลาของแต่ละการเรียก (query ที่รันขนานกันนับเวลาซ้อนกัน → dbMs อาจ > เวลาจริงที่รอ DB)
// - เวลาวัดด้วย performance.now() (นาฬิกา monotonic สำหรับวัดช่วง — ไม่ใช่การคำนวณวัน/เวลาปฏิทิน · กฎ 9 ไม่เกี่ยว)
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Client, Transaction } from '@libsql/client';

export type RequestMetrics = {
  /** จำนวนการเรียก DB (ดูนิยามด้านบน) */
  queries: number;
  /** ผลรวมเวลาที่รอ DB (ms) */
  dbMs: number;
  /** performance.now() ตอนเริ่ม request */
  startedAt: number;
};

const storage = new AsyncLocalStorage<RequestMetrics>();

/** ตัวนับของ request ปัจจุบัน (undefined = ไม่ได้อยู่ใน runWithRequestMetrics หรือปิดอยู่) */
export function currentRequestMetrics(): RequestMetrics | undefined {
  return storage.getStore();
}

/** รัน fn ด้วยตัวนับใหม่ของ request นี้ (แยกจาก request อื่นแม้ทำงานพร้อมกัน) */
export function runWithRequestMetrics<T>(fn: (m: RequestMetrics) => Promise<T>): Promise<T> {
  const m: RequestMetrics = { queries: 0, dbMs: 0, startedAt: performance.now() };
  return storage.run(m, () => fn(m));
}

/** จับเวลาการเรียก DB หนึ่งครั้ง · นอก request = เรียกตรง ไม่ทำอะไรเพิ่ม */
function timed<T>(call: () => Promise<T>): Promise<T> {
  const m = storage.getStore();
  if (!m) return call();
  const t0 = performance.now();
  const done = () => {
    m.queries += 1;
    m.dbMs += performance.now() - t0;
  };
  return call().then(
    (v) => {
      done();
      return v;
    },
    (e: unknown) => {
      done();
      throw e;
    },
  );
}

const INSTRUMENTED = Symbol.for('maewmeet.db.instrumented');

type AnyAsync = (...args: never[]) => Promise<unknown>;

/** แทนเมธอด `key` ของ obj ด้วยตัวจับเวลา — ส่งอาร์กิวเมนต์ต่อครบทุกตัว (รักษา overload เช่น execute(sql, args)) */
function wrapMethod<O extends object, K extends keyof O>(obj: O, key: K, after?: (v: unknown) => unknown): void {
  const orig = (obj[key] as unknown as AnyAsync).bind(obj);
  const wrapped = (...args: never[]) => {
    const p = timed(() => orig(...args));
    return after ? p.then(after) : p;
  };
  obj[key] = wrapped as unknown as O[K];
}

function instrumentTx(tx: Transaction): Transaction {
  for (const k of ['execute', 'batch', 'executeMultiple', 'commit', 'rollback'] as const) wrapMethod(tx, k);
  return tx;
}

/** ห่อเมธอดของ client (แก้ที่ instance — โค้ด/เทสต์ที่ห่อ $client.execute ทับอีกชั้นยังทำงานได้) · เรียกซ้ำได้ ไม่ห่อสองชั้น */
export function instrumentClient(client: Client): Client {
  const flagged = client as Client & { [INSTRUMENTED]?: true };
  if (flagged[INSTRUMENTED]) return client;
  flagged[INSTRUMENTED] = true;
  for (const k of ['execute', 'batch', 'migrate', 'executeMultiple'] as const) wrapMethod(client, k);
  wrapMethod(client, 'transaction', (tx) => instrumentTx(tx as Transaction));
  return client;
}

// เปิด/ปิด: serverTimingEnabled() ใน src/lib/shared/env.ts (SERVER_TIMING_ENABLED) — ผู้เรียก (route wrapper) ตัดสินก่อนเข้า runWithRequestMetrics
const ms = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** ค่า header Server-Timing — มีแค่ตัวเลข: `db;dur=…;desc="N queries", total;dur=…` (ไม่มี SQL/พารามิเตอร์/ข้อมูลผู้ใช้) */
export function serverTimingValue(m: RequestMetrics, now: number = performance.now()): string {
  const n = Math.max(0, Math.trunc(m.queries));
  return `db;dur=${ms(m.dbMs)};desc="${n} ${n === 1 ? 'query' : 'queries'}", total;dur=${ms(now - m.startedAt)}`;
}

/** บรรทัด log แบบนับเท่านั้น (ทางเลือกของหน้า RSC ที่ตั้ง header เองไม่ได้) — label ต้องเป็นชื่อเส้นทางแบบ pattern เช่น '/groups/[gid]' ไม่ใช่ path จริงที่มี id */
export function metricsLogLine(label: string, m: RequestMetrics, now: number = performance.now()): string {
  const safe = /^[A-Za-z0-9_/\[\]\-.:]{1,80}$/.test(label) ? label : '_';
  return `[perf] ${safe} queries=${m.queries} db=${ms(m.dbMs)}ms total=${ms(now - m.startedAt)}ms`;
}
