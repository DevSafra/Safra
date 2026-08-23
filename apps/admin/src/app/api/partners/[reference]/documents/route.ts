import { NextResponse } from 'next/server';

import { ERROR, partnerDocumentUploadSchema } from '@safra/contracts';

import { getStaffSession } from '@/lib/session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * The API's own ceiling, mirrored so an oversized file is refused before it is buffered here.
 *
 * Eight megabytes is `PartnerDocumentsService`'s limit and multer's. This is not the control — the
 * API refuses it either way — but without it the console would read the whole body into memory
 * only to forward it to something that will throw it away.
 */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * A super admin filing a partner's document during an in-person onboarding
 * (Bashar, 2026-08-23).
 *
 * ## Why this does not use `proxy()`
 *
 * `proxy()` serialises a JSON body. A document arrives as multipart — chosen so the bytes never
 * touch `body-parser` and the `/admin/partners` prefix keeps its 100kb JSON limit — so the body
 * has to be rebuilt and forwarded as `FormData` instead.
 *
 * The token is still attached server-side from the HttpOnly cookie, which is the whole reason
 * these handlers exist: no access token ever reaches client JavaScript.
 *
 * ## The forwarded form is an ALLOW-LIST
 *
 * Two fields, named explicitly, and `kind` is parsed against the shared schema before it is
 * repacked. Passing the incoming `FormData` straight through would forward whatever else a
 * caller put in it to an endpoint whose own validator rejects unknown keys — a 400 for a reason
 * nobody could see from here, and, worse, a habit that stops being harmless the day the API's
 * schema grows a field the console did not mean to expose.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;

  const session = await getStaffSession();

  if (!session) {
    return NextResponse.json({ message: 'Not signed in.' }, { status: 401 });
  }

  const declared = Number(request.headers.get('content-length') ?? 0);

  if (declared > MAX_BYTES + 8192) {
    return NextResponse.json({ message: ERROR.UPLOAD_FILE_TOO_LARGE }, { status: 413 });
  }

  let incoming: FormData;

  try {
    incoming = await request.formData();
  } catch {
    return NextResponse.json({ message: ERROR.REQUEST_MALFORMED_BODY }, { status: 400 });
  }

  const kind = partnerDocumentUploadSchema.safeParse({ kind: incoming.get('kind') });

  if (!kind.success) {
    return NextResponse.json({ message: ERROR.VALIDATION_REQUIRED }, { status: 400 });
  }

  const file = incoming.get('file');

  /*
    `FormData.get` returns `string | File | null`. A string here would be posted as if it were a
    file, and the API would answer `upload.file_missing` about a field that was present — so the
    shape is narrowed rather than assumed.
  */
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ message: ERROR.UPLOAD_FILE_MISSING }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ message: ERROR.UPLOAD_FILE_TOO_LARGE }, { status: 413 });
  }

  const forwarded = new FormData();
  forwarded.set('kind', kind.data.kind);
  forwarded.set('file', file, file.name);

  try {
    /*
      No `Content-Type` header. `fetch` derives it from the `FormData` along with the multipart
      boundary, and setting it by hand produces a boundary that does not match the body — which
      parses as an empty form on the other side.
    */
    const response = await fetch(
      `${API_URL}/api/v1/admin/partners/${encodeURIComponent(reference)}/documents`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: forwarded,
        cache: 'no-store',
      },
    );

    const payload: unknown = await response.json().catch(() => null);

    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json(
      { message: 'Could not reach the server. Please try again.' },
      { status: 502 },
    );
  }
}
