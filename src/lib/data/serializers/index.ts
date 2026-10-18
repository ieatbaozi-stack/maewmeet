// serializers — DTO ที่ส่งออก API + กรอง busy ตาม ADR 0006 (ARCHITECTURE §1/§2)
// สถานะ: **โครง (R0)** — เติมตั้งแต่ R1 (session/me) · R2 (กลุ่ม) · R4 (busy/นัด — กรองตาม viewer ที่นี่เท่านั้น)
// กติกา: ห้ามส่ง pin_hash / token / code_hash / note ของคนอื่นออกจาก serializer ใด ๆ

export {};
