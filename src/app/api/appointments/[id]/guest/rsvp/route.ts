// PUT /api/appointments/:id/guest/rsvp { response } — แขกตอบ ไป/อาจไป/ไม่ไป — R18 §S4 · เจ้าของ: Platform
import { dataCtx } from '@/lib/data/context';
import { guestRsvpInputSchema, setGuestRsvp, shareAppointmentParamsSchema } from '@/lib/data/services/share';
import { route } from '../../../../_lib/route';

export const PUT = route({
  method: 'PUT',
  path: '/api/appointments/:id/guest/rsvp',
  params: shareAppointmentParamsSchema,
  input: guestRsvpInputSchema,
  handler: ({ actor, params, input, req, now }) => setGuestRsvp(actor, params.id, input, dataCtx(req, now)),
});
