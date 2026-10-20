// R3-4/R3-10 ฝั่งเซิร์ฟเวอร์จริง (next start + DB ไฟล์) — ไม่เปิดเบราว์เซอร์ จึงเร็ว · รันที่ mobile-390 ตัวเดียว
//
// ซ้ำกับ tests/busy/** หรือไม่? tests/busy/** เรียก route handler ในโปรเซสเดียวกับเทสต์ (นาฬิกา inject) — ที่นี่ผ่าน HTTP ของ build จริง:
//   cookie session จริง · CSRF จริง · header no-store ที่ผ่าน middleware/proxy จริง · และ "ออกจากกลุ่ม → 404 ทันที" ตามเรื่องเล่า R3-10
//   เคสที่ต้องใช้นาฬิกา (DST/ขอบเที่ยงคืน) ไม่ซ้ำ — อยู่ที่ tests/busy + tests/calendar
import { canary, calendarApi, createBusyApi, seedBusyBulk, addDays, todayBkk } from './support/busy';
import { expect, test } from './support/auth';
import { api, createGroupApi, joinViaApiCode, membersApi, person, signup, userIdOf } from './support/groups';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'API ไม่ขึ้นกับความกว้างจอ');
});

test('A ลง 3 แบบ → B เห็นผ่านปฏิทินกลุ่ม ไม่มี note/title ซ่อน → ไม่ซ้ำข้ามกลุ่ม · B ออกกลุ่ม → 404 ทันที', async ({ newDevice }) => {
  const [a, b] = await Promise.all([newDevice(), newDevice()]);
  const [pa, pb] = [person('Ann'), person('Ben')];
  await signup(a.context, pa);
  await signup(b.context, pb);
  const gid = await createGroupApi(a.context.request, `Cal ${Date.now().toString(36)}`);
  await joinViaApiCode(a.context.request, gid, b.context.request);

  const today = todayBkk();
  const d1 = addDays(today, 3);
  const [noteTimed, noteHidden, noteMulti, titleHidden] = [canary('note-timed'), canary('note-hidden'), canary('note-multi'), canary('title-hidden')];
  await createBusyApi(a.context.request, { kind: 'timed', startDate: d1, startTime: '22:00', endDate: addDays(d1, 1), endTime: '06:00', title: 'ซ้อมวง', note: noteTimed });
  await createBusyApi(a.context.request, { kind: 'all_day', startDate: addDays(d1, 5), endDate: addDays(d1, 5), title: titleHidden, note: noteHidden, hideDetail: true });
  await createBusyApi(a.context.request, { kind: 'all_day', startDate: addDays(d1, 8), endDate: addDays(d1, 10), title: 'ไปเชียงใหม่', note: noteMulti });

  const r = await calendarApi(b.context.request, gid, d1, addDays(d1, 20));
  expect(r.status).toBe(200);
  for (const secret of [noteTimed, noteHidden, noteMulti, titleHidden]) expect(r.text, `ไม่รั่ว ${secret}`).not.toContain(secret);
  const data = r.json!.data as unknown as { busy: { userId: string; title?: string; allDay: boolean; localStartDate: string; localEndDate: string }[] };
  const aId = userIdOf(await membersApi(b.context.request, gid), pa);
  const mine = data.busy.filter((x) => x.userId === aId);
  expect(mine).toHaveLength(3);
  expect(mine.map((x) => x.title ?? null).sort()).toEqual(['ซ้อมวง', 'ไปเชียงใหม่', null].sort()); // รายการซ่อน = ไม่มี title
  expect(mine.find((x) => !x.allDay)).toMatchObject({ localStartDate: d1, localEndDate: addDays(d1, 1) }); // ข้ามเที่ยงคืน = 2 วัน
  expect(mine.find((x) => x.localStartDate === addDays(d1, 8))).toMatchObject({ localEndDate: addDays(d1, 10) }); // หลายวัน = รายการเดียว
  expect(r.json && JSON.stringify(r.json)).not.toMatch(/"note"/);

  // B ออกจากกลุ่ม → ปฏิทินกลุ่มเป็น 404 ทันที (ไม่รอ cache)
  expect((await api(b.context.request, 'POST', `/api/groups/${gid}/leave`)).status).toBe(200);
  const gone = await calendarApi(b.context.request, gid, d1, addDays(d1, 20));
  expect(gone.status).toBe(404);
  for (const secret of [noteTimed, noteHidden, noteMulti, titleHidden, 'ซ้อมวง']) expect(gone.text).not.toContain(secret);
});

test('เพดาน: ครบ 300 (seed ตรงใน DB) แล้วลงเพิ่ม → LIMIT_REACHED busyCount · ย้อนหลัง > 7 วัน → busyBackdate', async ({ newDevice }) => {
  const a = await newDevice();
  const pa = person('Lim');
  await signup(a.context, pa);
  const gid = await createGroupApi(a.context.request, `Lim ${Date.now().toString(36)}`);
  const uid = userIdOf(await membersApi(a.context.request, gid), pa);

  const today = todayBkk();
  const old = addDays(today, -10);
  const back = await api(a.context.request, 'POST', '/api/me/busy', { kind: 'all_day', startDate: old, endDate: addDays(old, 1) });
  expect([back.status, back.json?.error?.code]).toEqual([400, 'LIMIT_REACHED']);
  expect((back.json?.error as { params?: unknown } | undefined)?.params).toMatchObject({ limit: 'busyBackdate', max: 7 });

  await seedBusyBulk(uid, 300);
  const over = await api(a.context.request, 'POST', '/api/me/busy', { kind: 'all_day', startDate: addDays(today, 2), endDate: addDays(today, 2) });
  expect([over.status, over.json?.error?.code]).toEqual([409, 'LIMIT_REACHED']);
  expect((over.json?.error as { params?: unknown } | undefined)?.params).toEqual({ limit: 'busyCount', max: 300 });
});
