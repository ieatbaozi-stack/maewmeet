/** R16 H4b: ชื่อผู้เชิญในรายการคำเชิญ — super admin นอกกลุ่ม (actorSystemAdmin) → ป้ายกลาง · ชื่อว่างเฉยๆ → ป้ายบัญชีที่ถูกลบ */
export function inviterLabel(inv: { inviterName: string; actorSystemAdmin?: boolean }, systemAdmin: string, deleted: string): string {
  if (inv.actorSystemAdmin === true) return systemAdmin;
  return inv.inviterName === "" ? deleted : inv.inviterName;
}
