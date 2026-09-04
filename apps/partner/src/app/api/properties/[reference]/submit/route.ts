import type { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Submitting a draft listing for SAFRA's review — the step that was missing (Bashar, 2026-09-04).
 *
 * `POST /partner/properties/:reference/submit` has existed with its permission, its ownership
 * check, its «a listing with no bookable unit cannot be reviewed» guard, its audit row and its
 * timeline event since the lifecycle was written. **Nothing called it.** On 2026-09-04 the database
 * held 627 drafts, 61 rejected listings and **zero** in `pending_review`: a partner could create a
 * listing and then had no way to move it toward being live, and the console's approval queue was
 * permanently empty for a reason no screen explained.
 *
 * There is no body — the reference in the path is the whole request, and the API decides everything
 * else from the caller's session. Nothing is validated here for the same reason: there is nothing
 * to validate, and a handler that invented a schema would be adding a rule the API does not have.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference } = await params;

  return proxy(`/partner/properties/${encodeURIComponent(reference)}/submit`, {
    method: 'POST',
  });
}
