import 'server-only';

import { z } from 'zod';

import { getSession } from './session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * The customer's own data, fetched with their access token.
 *
 * Separate from `lib/api.ts` because everything there is anonymous and cacheable —
 * cities, search, property pages. Nothing here may EVER be cached: a booking list
 * cached across requests is one customer's bookings shown to the next, which is the
 * worst bug this app could ship. Hence `cache: 'no-store'` on every call, without an
 * option to change it.
 */
async function authedFetch<T>(
  path: string,
  schema: z.ZodType<T>,
): Promise<T | 'unauthenticated' | 'failed'> {
  const session = await getSession();
  if (!session) return 'unauthenticated';

  let response: Response;

  try {
    response = await fetch(`${API_URL}/api/v1${path}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
      },
      cache: 'no-store',
    });
  } catch {
    return 'failed';
  }

  /**
   * A 401 here means the token expired between middleware's check and this fetch,
   * or was revoked mid-request. Reported as unauthenticated so the page renders a
   * sign-in prompt rather than an error — the customer's next navigation passes
   * through middleware and refreshes.
   */
  if (response.status === 401 || response.status === 403) return 'unauthenticated';

  if (!response.ok) return 'failed';

  const parsed = schema.safeParse(await response.json().catch(() => null));

  return parsed.success ? parsed.data : 'failed';
}

// ─── Bookings ────────────────────────────────────────────────────────────────

const bookingSchema = z.object({
  reference: z.string(),
  status: z.string(),
  checkIn: z.string(),
  checkOut: z.string(),
  nights: z.number(),
  guestsAdults: z.number(),
  totalAmount: z.string(),
  createdAt: z.union([z.string(), z.date()]).transform((v) => new Date(v).toISOString()),
});

export type CustomerBooking = z.infer<typeof bookingSchema>;

const bookingsSchema = z.object({
  items: z.array(bookingSchema),
  nextCursor: z.string().nullable(),
});

export async function getMyBookings() {
  return authedFetch('/bookings?limit=20', bookingsSchema);
}

// ─── Wallet ──────────────────────────────────────────────────────────────────

const walletSchema = z.object({
  wallet: z.object({ balance: z.string(), currencyCode: z.string() }).nullable(),
});

export type WalletBalance = z.infer<typeof walletSchema>['wallet'];

export async function getMyWallet() {
  return authedFetch('/wallet', walletSchema);
}

const walletTransactionSchema = z.object({
  id: z.string(),
  direction: z.enum(['credit', 'debit']),
  reason: z.string(),
  amount: z.string(),
  balanceAfter: z.string(),
  bookingReference: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});

export type WalletTransaction = z.infer<typeof walletTransactionSchema>;

const walletTransactionsSchema = z.object({
  items: z.array(walletTransactionSchema),
  nextCursor: z.string().nullable(),
});

export async function getMyWalletTransactions() {
  return authedFetch('/wallet/transactions?limit=10', walletTransactionsSchema);
}
