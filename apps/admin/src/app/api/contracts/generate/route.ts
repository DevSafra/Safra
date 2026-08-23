import type { NextResponse } from 'next/server';

import { proxy } from '@/lib/proxy';

/**
 * Generates the partnership agreement from SAFRA's template (§8.1, Bashar 2026-08-21).
 *
 * The body is forwarded as it arrives; the API validates it against `generateContractSchema`,
 * which is the only place the partner reference and the contract kind are checked. Restating those
 * rules here would give two answers to the same question and only one of them would be updated.
 */
export async function POST(request: Request): Promise<NextResponse> {
  return proxy('/admin/partner-contracts/generate', {
    method: 'POST',
    body: await request.json().catch(() => ({})),
  });
}
