"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { callApi, type ApiResult } from "@/components/auth/api";
import { appendUnique } from "@/components/account/model";

export type Failure = Extract<ApiResult<unknown>, { ok: false }>;

export type Paged<T> = {
  status: "loading" | "error" | "ready";
  items: T[];
  nextCursor: string | null;
  failure: Failure | null;
  moreBusy: boolean;
  moreFailure: Failure | null;
  loadMore: () => Promise<void>;
  reload: () => void;
  update: (fn: (items: T[]) => T[]) => void;
};

/**
 * รายการแบบ cursor ของหน้า admin: โหลดหน้าแรกใหม่ทุกครั้งที่ `baseUrl` เปลี่ยน (ค้นหา/กรอง) · "โหลดเพิ่ม" ต่อท้ายแบบตัด id ซ้ำ
 * คำตอบที่มาช้ากว่าคำขอใหม่ถูกทิ้ง (กันผลค้นหาเก่าทับผลใหม่)
 */
export function usePaged<T extends { id: string }, D>(
  baseUrl: string,
  cursorParam: string,
  pick: (data: D) => { items: T[]; nextCursor: string | null },
): Paged<T> {
  const [status, setStatus] = useState<Paged<T>["status"]>("loading");
  const [items, setItems] = useState<T[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreFailure, setMoreFailure] = useState<Failure | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const seq = useRef(0);
  const pickRef = useRef(pick);
  useEffect(() => {
    pickRef.current = pick;
  });

  useEffect(() => {
    const mine = ++seq.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- เริ่มโหลดหน้าแรกใหม่เมื่อคำค้น/ตัวกรองเปลี่ยน
    setStatus("loading");
    setMoreFailure(null);
    void callApi<D>(baseUrl, { method: "GET" }).then((res) => {
      if (mine !== seq.current) return;
      if (res.ok) {
        const p = pickRef.current(res.data);
        setItems(p.items);
        setNextCursor(p.nextCursor);
        setFailure(null);
        setStatus("ready");
      } else {
        setFailure(res);
        setStatus("error");
      }
    });
  }, [baseUrl, reloadKey]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || moreBusy) return;
    const mine = seq.current;
    setMoreBusy(true);
    setMoreFailure(null);
    const sep = baseUrl.includes("?") ? "&" : "?";
    const res = await callApi<D>(`${baseUrl}${sep}${cursorParam}=${encodeURIComponent(nextCursor)}`, { method: "GET" });
    setMoreBusy(false);
    if (mine !== seq.current) return;
    if (res.ok) {
      const p = pickRef.current(res.data);
      setItems((cur) => appendUnique(cur, p.items));
      setNextCursor(p.nextCursor);
    } else {
      setMoreFailure(res);
    }
  }, [baseUrl, cursorParam, moreBusy, nextCursor]);

  return {
    status,
    items,
    nextCursor,
    failure,
    moreBusy,
    moreFailure,
    loadMore,
    reload: () => setReloadKey((k) => k + 1),
    update: (fn) => setItems((cur) => fn(cur)),
  };
}
