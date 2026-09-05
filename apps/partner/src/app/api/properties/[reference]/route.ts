import { NextResponse } from 'next/server';

import { propertyUpdateSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Saving the تعديل form.
 *
 * Validated HERE as well as in the API, and the duplication is deliberate: a body that fails
 * `.strict()` upstream comes back as a 400 the form has to translate, whereas parsing it at the
 * edge lets the browser be told which field is wrong. The API's copy is the one that ENFORCES —
 * this one only improves the message — which is why this handler cannot be the only check and is
 * not written as though it were.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;
  const body: unknown = await request.json().catch(() => null);
  const parsed = propertyUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? 'validation.failed' },
      { status: 400 },
    );
  }

  /*
    Only the fields the caller actually SENT.

    `propertyUpdateSchema` is `.partial()`, but `attributes` carries `.default([])` and a zod
    default survives partial: parsing `{ amenityCodes: [...] }` returns
    `{ amenityCodes: [...], attributes: [] }`. The API writes `attributes` whenever it is defined,
    so this proxy was adding an empty list to every PATCH — and `properties.service` sets it
    verbatim. A partner correcting an address was silently clearing the listing's trip attributes,
    and a request touching nothing structural was refused as structural.

    Found on 2026-09-06 when an amenity-only patch answered 409 property.not_structurally_editable:
    the refusal named a field the client had never sent. Validate against the schema, then send the
    intersection with what arrived — the defaults are what the schema is FOR on a create, and are
    exactly wrong on a patch.
  */
  const sent = new Set(Object.keys(body ?? {}));
  const body_ = Object.fromEntries(
    Object.entries(parsed.data).filter(([key]) => sent.has(key)),
  );

  return proxy(`/partner/properties/${encodeURIComponent(reference)}`, {
    method: 'PATCH',
    body: body_,
  });
}
