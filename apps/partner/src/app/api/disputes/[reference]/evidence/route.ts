import { NextResponse } from 'next/server';

import { ERROR } from '@safra/contracts';

import { getPartnerSession } from '@/lib/session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * A photograph the partner files on a dispute against them (finding 223).
 *
 * ## Streamed through UNPARSED
 *
 * Re-reading the multipart body here to validate it would buffer ten megabytes in this process for
 * nothing: the API is the only place that can judge an image, because judging one means DECODING
 * it — `ImageService.inspect` refuses anything whose magic bytes are not a supported photograph
 * before a byte reaches storage. `content-type` is forwarded because the multipart boundary lives
 * in it, and a proxy that forwards a PARSED body instead of the stream arrives at the API
 * file-less, which is the exact failure `partner-images.spec.ts` was written for.
 *
 * ## Nothing here names the partner
 *
 * The API takes the business from the verified token, so «file evidence on somebody else's
 * dispute» is not a request this route can express.
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
      `${API_URL}/api/v1/partner/disputes/${encodeURIComponent(reference)}/evidence`,
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
