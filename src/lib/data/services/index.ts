// services — ทุกฟังก์ชันรูป (actor, input) → authorize() บรรทัดแรก → repos → audit/notify (ARCHITECTURE §2)
// ยกเว้นงานระบบที่ไม่มี actor (maintenance.ts — ด่านคือ CRON_SECRET)
// สถานะ: R0 มีเฉพาะ maintenance · R1 auth/me/prefs (บันทึกลงบัญชี) · R2 กลุ่ม/คำเชิญ · R4 busy/นัด · R5 admin
export { runDailyMaintenance, recordHeartbeat } from './maintenance';
export type { DailyMaintenanceResult, HeartbeatResult } from './maintenance';
