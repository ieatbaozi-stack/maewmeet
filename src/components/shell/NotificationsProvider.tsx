"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fetchUnreadCount } from "@/components/notifications/api";
import { shouldApplyRefresh, unreadAfterMarkOne } from "@/components/notifications/model";

export interface NotificationsState {
  /** จำนวนที่ยังไม่อ่าน · null = ยังไม่ทราบ (โหลดไม่ได้) → กระดิ่งไม่โชว์ตัวเลข */
  unread: number | null;
  /** ตั้งจำนวนจากคำตอบของเซิร์ฟเวอร์ (หน้ารายการ/ผล mark read) */
  setUnread: (n: number) => void;
  /** แตะอ่านหนึ่งรายการในเครื่อง (ลดทีละ 1 เมื่อรายการนั้นยังไม่อ่าน) */
  markedOne: (wasUnread: boolean) => void;
  /** ขอจำนวนใหม่จากเซิร์ฟเวอร์ (มี stale-response guard) */
  refresh: () => void;
}

const NOOP: NotificationsState = { unread: null, setUnread: () => undefined, markedOne: () => undefined, refresh: () => undefined };
const Ctx = createContext<NotificationsState>(NOOP);
export const useNotifications = (): NotificationsState => useContext(Ctx);

const MIN_GAP_MS = 10_000;

/**
 * จำนวนแจ้งเตือนที่ยังไม่อ่าน ใช้ร่วมกันทุกแท็บ: เซิร์ฟเวอร์ใส่ค่าเริ่มต้นใน layout (ไม่มีแฟลช) แล้วรีเฟรชเมื่อ
 * โฟกัสกลับมาที่แท็บ/เปลี่ยนหน้า (ห่างกันอย่างน้อย 10 วินาที) · หน้ารายการเรียก setUnread หลัง mark read
 * ไม่มี endpoint นับแยก → fetchUnreadCount ขอ list limit=1
 */
export function NotificationsProvider({ initialUnread, children }: { initialUnread: number | null; children: ReactNode }) {
  const [unread, setUnreadState] = useState<number | null>(initialUnread);
  const seq = useRef(0); // คำขอล่าสุด
  const gen = useRef(0); // นับครั้งที่แก้ในเครื่อง
  const last = useRef(0);
  const unreadRef = useRef<number | null>(initialUnread);
  const pathname = usePathname();

  const apply = useCallback((n: number | null) => {
    unreadRef.current = n;
    setUnreadState(n);
  }, []);

  const setUnread = useCallback(
    (n: number) => {
      gen.current += 1;
      apply(Math.max(0, Math.trunc(n)));
    },
    [apply],
  );

  const markedOne = useCallback(
    (wasUnread: boolean) => {
      gen.current += 1;
      apply(unreadAfterMarkOne(unreadRef.current ?? 0, wasUnread));
    },
    [apply],
  );

  const refresh = useCallback(() => {
    last.current = Date.now();
    seq.current += 1;
    const start = { seq: seq.current, gen: gen.current };
    void fetchUnreadCount().then((n) => {
      if (n === null) return; // โหลดไม่ได้ → คงค่าเดิม (ไม่ล้างตัวเลข)
      if (!shouldApplyRefresh(start, { seq: seq.current, gen: gen.current })) return;
      apply(n);
    });
  }, [apply]);

  const refreshIfDue = useCallback(() => {
    if (Date.now() - last.current >= MIN_GAP_MS) refresh();
  }, [refresh]);

  useEffect(() => {
    last.current = Date.now(); // ค่าเริ่มต้นมาจากเซิร์ฟเวอร์เมื่อครู่
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshIfDue();
    };
    window.addEventListener("focus", refreshIfDue);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", refreshIfDue);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshIfDue]);

  // เปลี่ยนหน้าภายในแอป: layout ไม่เรนเดอร์ใหม่ จึงรีเฟรชเอง (ข้ามครั้งแรกที่เพิ่งโหลดจากเซิร์ฟเวอร์)
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    refreshIfDue();
  }, [pathname, refreshIfDue]);

  const value = useMemo(() => ({ unread, setUnread, markedOne, refresh }), [unread, setUnread, markedOne, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
