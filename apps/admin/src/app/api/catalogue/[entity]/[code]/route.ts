import { NextResponse } from 'next/server';

import {
  amenityUpdateSchema,
  cancellationPolicyUpdateSchema,
  partnerTypeUpdateSchema,
} from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Editing, retiring and deleting one catalogue entry.
 *
 * The same entity allow-list as the create handler beside it, for the same reason. The CODE is
 * encoded on the way through rather than trusted: it is a path segment the browser supplies, and
 * a code containing a slash would otherwise reach a different route than the one this handler
 * names.
 *
 * `DELETE` carries no body and needs no schema — the API decides everything from the code and the
 * session, and refuses with `catalogue.in_use` and a count when something still points at the row.
 */
const ENTITIES = {
  amenities: amenityUpdateSchema,
  'cancellation-policies': cancellationPolicyUpdateSchema,
  'partner-types': partnerTypeUpdateSchema,
} as const;

function pathFor(entity: string, code: string): string | null {
  if (!(entity in ENTITIES)) return null;

  return `/admin/catalogue/${entity}/${encodeURIComponent(code)}`;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ entity: string; code: string }> },
): Promise<NextResponse> {
  const { entity, code } = await params;
  const path = pathFor(entity, code);
  const schema = ENTITIES[entity as keyof typeof ENTITIES];

  if (!path || !schema) return new NextResponse(null, { status: 404 });

  const parsed = schema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? 'validation.failed' },
      { status: 400 },
    );
  }

  return proxy(path, { method: 'PATCH', body: parsed.data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ entity: string; code: string }> },
): Promise<NextResponse> {
  const { entity, code } = await params;
  const path = pathFor(entity, code);

  if (!path) return new NextResponse(null, { status: 404 });

  return proxy(path, { method: 'DELETE' });
}
