import { NextResponse } from 'next/server';

import { partnerDocumentReviewSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/** Approve or reject ONE document (§8.1, item 121). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
): Promise<NextResponse> {
  const { documentId } = await params;

  const parsed = partnerDocumentReviewSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? 'Invalid decision.' },
      { status: 400 },
    );
  }

  return proxy(`/admin/partners/documents/${encodeURIComponent(documentId)}/review`, {
    method: 'POST',
    body: parsed.data,
  });
}
