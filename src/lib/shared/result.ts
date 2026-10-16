// Result type ใช้ร่วมทุกโดเมน (ARCHITECTURE §1 shared) — ใช้เมื่อความล้มเหลวเป็นผลปกติที่ผู้เรียกต้องจัดการ
// (เช่น validate เวลา) แทนการโยน exception · ฝั่ง HTTP ใช้ AppError
import type { ErrorCode, ErrorParams } from './errors';

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E = AppErrorShape> = Ok<T> | Err<E>;

/** รูป error มาตรฐานที่แปลงเป็น AppError ได้ตรงตัว */
export type AppErrorShape = { readonly code: ErrorCode; readonly params?: ErrorParams };

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
  return !r.ok;
}

/** map ค่าฝั่ง ok โดยไม่แตะ error */
export function mapResult<T, U, E>(r: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return r.ok ? ok(fn(r.value)) : r;
}
