// GET /api/places/search?q= — ค้นหาสถานที่ผ่าน proxy Nominatim (แคช 30 วัน · 1 req/s ทั้งระบบ · kill switch) — D11, ADR 0001 · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { placeSearchQuerySchema, searchPlaces } from '@/lib/data/services/places';
import { route } from '../../_lib/route';

export const GET = route({
  method: 'GET',
  path: '/api/places/search',
  input: placeSearchQuerySchema,
  handler: ({ actor, input, req, now }) => searchPlaces(actor, input, dataCtx(req, now)),
});
