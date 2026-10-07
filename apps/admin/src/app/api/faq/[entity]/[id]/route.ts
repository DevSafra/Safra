import { NextResponse } from 'next/server';

import { faqQuestionUpdateSchema, generalFaqUpdateSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Editing and removing an FAQ entry — الأسئلة الشائعة (Bashar, 2026-09-28).
 *
 * `[id]` is a UUID rather than the `code` كتالوج المنصّة keys on, and it is CHECKED here rather
 * than forwarded: the id lands in a URL path, and a segment taken from the request and pasted into
 * an upstream path is how `/admin/faq/questions/../../partners` gets reached. A UUID pattern
 * cannot express a traversal, so testing the shape is the whole defence — and the API's own
 * `ParseUUIDPipe` refuses anything that gets past it.
 */
const ENTITIES = {
  questions: faqQuestionUpdateSchema,
  general: generalFaqUpdateSchema,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pathFor(entity: string, id: string): string | null {
  // `hasOwn`, not `in`: `constructor` and `toString` are inherited, not entities.
  if (!Object.hasOwn(ENTITIES, entity) || !UUID.test(id)) return null;

  return `/admin/faq/${entity}/${id}`;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ entity: string; id: string }> },
): Promise<NextResponse> {
  const { entity, id } = await params;
  const path = pathFor(entity, id);
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
  { params }: { params: Promise<{ entity: string; id: string }> },
): Promise<NextResponse> {
  const { entity, id } = await params;
  const path = pathFor(entity, id);

  if (!path) return new NextResponse(null, { status: 404 });

  return proxy(path, { method: 'DELETE' });
}
