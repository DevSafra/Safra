import { NextResponse } from 'next/server';

import { ERROR, propertyImageOrderSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';
import { getPartnerSession } from '@/lib/session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Uploading one photograph.
 *
 * The multipart body is streamed through UNPARSED. Re-reading it here to validate would mean
 * buffering ten megabytes in this process for no gain: the API is the only place that can judge
 * an image, because judging it means decoding it — and it does exactly that before storing
 * anything. `Content-Type` is forwarded because the boundary lives in it.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;
  const session = await getPartnerSession();

  if (!session) {
    return NextResponse.json({ code: ERROR.AUTH_REQUIRED }, { status: 401 });
  }

  const contentType = request.headers.get('content-type');

  if (!contentType?.startsWith('multipart/form-data')) {
    return NextResponse.json({ code: ERROR.UPLOAD_FILE_MISSING }, { status: 400 });
  }

  try {
    const response = await fetch(
      `${API_URL}/api/v1/partner/properties/${encodeURIComponent(reference)}/images`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${session.accessToken}`,
          'content-type': contentType,
        },
        body: await request.arrayBuffer(),
        cache: 'no-store',
      },
    );

    const payload: unknown = await response.json().catch(() => null);

    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json(
      { code: ERROR.REQUEST_UPSTREAM_UNREACHABLE },
      { status: 502 },
    );
  }
}

/** The display order, as the full list of ids — see `propertyImageOrderSchema`. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;

  const parsed = propertyImageOrderSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? ERROR.REQUEST_VALIDATION_FAILED },
      { status: 400 },
    );
  }

  return proxy(`/partner/properties/${encodeURIComponent(reference)}/images/order`, {
    method: 'PATCH',
    body: parsed.data,
  });
}
