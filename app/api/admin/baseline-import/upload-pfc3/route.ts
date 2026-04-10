import { jsonError, jsonOk } from '@/lib/admin-json';
import { parseUploadText } from '@/lib/normalization';
import { saveUploadRows } from '@/lib/firestore-repo';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return jsonOk({ message: 'file is required' }, 400);

    const text = await file.text();
    const rows = parseUploadText(file.name, text);
    if (rows.length === 0) return jsonOk({ message: '업로드 파일에서 행을 찾지 못했습니다.' }, 400);

    await saveUploadRows('pfc3', rows);
    return jsonOk({ message: 'pfc3 파일 업로드가 완료되었습니다.', uploadedRows: rows.length, sourceFile: file.name });
  } catch (error) {
    return jsonError('pfc3 upload failed', { status: 500, detailMessage: error instanceof Error ? error.message : 'unknown error' });
  }
}
