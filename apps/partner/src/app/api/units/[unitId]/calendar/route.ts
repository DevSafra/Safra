import { NextResponse } from 'next/server';

import { calendarRangeUpdateSchema } from '@safra/contracts';

import { proxy } from '@/lib/proxy';

/**
 * Applying a change to a span of dates.
 *
 * A PUT over a RANGE rather than a write per day: the partner edits «من … إلى …», and applying it
 * one day at a time over a browser connection leaves a half-changed month whenever the tab is
 * closed mid-way. The API writes the whole span in one transaction.
 *
 * The schema refuses `booked` on the way through — see the note on `unitCalendar` in the
 * catalogue. That refusal lives in `@safra/contracts` and is enforced by the API; repeating the
 * parse here only means the browser gets told which field was wrong.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ unitId: string }> },
): Promise<NextResponse> {
  const { unitId } = await params;
  const body: unknown = await request.json().catch(() => null);
  const parsed = calendarRangeUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? 'validation.failed' },
      { status: 400 },
    );
  }

  return proxy(`/partner/units/${encodeURIComponent(unitId)}/calendar`, {
    method: 'PUT',
    body: parsed.data,
  });
}
