import type { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Running the accrual sweep by hand.
 *
 * ## Why this route exists (Bashar, 2026-09-07)
 *
 * «Please add a proper administrative surface for payout accrual. I do not want operational
 * workflows that require direct API calls when they should reasonably be available through the
 * Super Admin Console.»
 *
 * `POST /admin/payouts/accrue` has existed since payouts did, guarded by `PAYOUT_EXECUTE`, and
 * nothing in any of the three applications called it. So the only ways to attach a completed
 * booking to a transfer were to wait up to an hour for the timer or to hand-craft an authenticated
 * request — which is not an operational workflow, it is an engineer being paged.
 *
 * It also blocked the test runner: a freshly reset testbed has no payouts at all, so every payout
 * workflow was unverifiable from a clean database (`docs/FUTURE-WORK.md` §7, items 202-203).
 *
 * ## No body, and therefore nothing to validate
 *
 * Unlike the six per-payout transitions, accrual takes no arguments: it sweeps every partner and
 * decides for itself what is due. There is no shape to check before the round trip, so this
 * forwards and nothing more. The API's own `PAYOUT_EXECUTE` guard is the control — this route
 * cannot grant what the session does not carry, and a caller without it gets the API's refusal
 * rather than a screen that pretended.
 */
export async function POST(): Promise<NextResponse> {
  return proxy('/admin/payouts/accrue', { method: 'POST' });
}
