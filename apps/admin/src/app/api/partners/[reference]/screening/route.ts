import { NextResponse } from 'next/server';

import { sanctionsScreeningSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Records a sanctions screening result (§8.1, ADR 0002).
 *
 * Until item 120 lands, this records what a human found by checking the EU
 * consolidated list themselves — the endpoint stores a result, it does not obtain
 * one. The screen says so plainly rather than implying an automated check happened.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;

  const parsed = sanctionsScreeningSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? 'Invalid screening result.' },
      { status: 400 },
    );
  }

  return proxy(`/admin/partners/${encodeURIComponent(reference)}/sanctions-screening`, {
    method: 'POST',
    body: parsed.data,
  });
}
