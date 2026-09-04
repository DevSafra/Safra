import { NextResponse } from 'next/server';

import {
  amenityCreateSchema,
  cancellationPolicyCreateSchema,
  partnerTypeCreateSchema,
} from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Creating a catalogue entry — كتالوج المنصّة (Bashar, 2026-09-04).
 *
 * ## The entity is an ALLOW-LIST, not a path segment passed through
 *
 * `[entity]` comes from the URL. Forwarding it verbatim would let a crafted link reach anything
 * under `/admin/catalogue/…` that a staff session can, including routes added later that nobody
 * considered in this context — the same reasoning the payout `[action]` handler gives, and the
 * reason that one is written the way it is.
 *
 * ## Each entity's body is validated against ITS schema
 *
 * Not one permissive schema for three shapes. A cancellation policy needs a refund ladder and an
 * amenity needs a sidebar group; a shared schema would have to make both optional, which is the
 * same as checking neither. The API validates again on its own authority — this parses at the edge
 * so the form can say which field is wrong instead of showing a bare 400.
 */
const ENTITIES = {
  amenities: amenityCreateSchema,
  'cancellation-policies': cancellationPolicyCreateSchema,
  'partner-types': partnerTypeCreateSchema,
} as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ entity: string }> },
): Promise<NextResponse> {
  const { entity } = await params;
  const schema = ENTITIES[entity as keyof typeof ENTITIES];

  /* 404 rather than 400: an entity nobody offers is not a bad request, it is not a route. */
  if (!schema) return new NextResponse(null, { status: 404 });

  const parsed = schema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? 'validation.failed' },
      { status: 400 },
    );
  }

  return proxy(`/admin/catalogue/${entity}`, { method: 'POST', body: parsed.data });
}
