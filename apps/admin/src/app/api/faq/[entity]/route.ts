import { NextResponse } from 'next/server';

import { faqQuestionCreateSchema, generalFaqCreateSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Creating an FAQ entry — الأسئلة الشائعة (Bashar, 2026-09-28).
 *
 * The shape كتالوج المنصّة's handler already takes, for the reasons written there: `[entity]` is an
 * ALLOW-LIST rather than a segment passed through, and each entity is parsed against ITS OWN schema
 * so the form can name the wrong field instead of showing a bare 400. The API validates again on
 * its own authority — this is the edge, not the gate.
 *
 * The two entities are genuinely different shapes, which is why one permissive schema would be
 * wrong: a question has `isRequired` and no answer, a general entry has an answer and nothing that
 * could be required of anyone.
 */
const ENTITIES = {
  questions: faqQuestionCreateSchema,
  general: generalFaqCreateSchema,
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

  return proxy(`/admin/faq/${entity}`, { method: 'POST', body: parsed.data });
}
