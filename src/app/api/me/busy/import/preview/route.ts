// POST /api/me/busy/import/preview — วิเคราะห์ไฟล์ .ics + ตรวจซ้ำ + โควตา (v1.1.0 · ADR 0017 §3 · เจ้าของ: Platform)
import { dataCtx } from '@/lib/data/context';
import { previewBusyImport, previewBusyImportSchema } from '@/lib/data/services/busy-import';
import { ICS_IMPORT_PREVIEW_MAX_BODY_BYTES } from '@/lib/shared/limits';
import { route } from '../../../../_lib/route';

export const POST = route({
  method: 'POST',
  path: '/api/me/busy/import/preview',
  input: previewBusyImportSchema,
  maxBodyBytes: ICS_IMPORT_PREVIEW_MAX_BODY_BYTES,
  bodyTooLargeCode: 'ICS_TOO_LARGE',
  handler: ({ actor, input, req, now }) => previewBusyImport(actor, input, dataCtx(req, now)),
});
