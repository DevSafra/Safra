import { ERROR } from '@safra/contracts';
import { errorMessage } from '@safra/i18n';

/**
 * What a refused WRITE means, when the reason is one the reader can act on.
 *
 * ## Why every write component consults this before its own switch
 *
 * A suspended partner is a live, authenticated session that is refused on every write (Bashar,
 * 2026-08-24). `SuspendedPartnerGuard` is opt-in per route on the API, so which routes refuse is a
 * decision made THERE and changes over time — the portal must not hold a second copy of that list.
 * It only has to recognise the code when it arrives.
 *
 * Without this, `partner.suspended` falls to each component's `default:` and renders «تعذّر
 * الحفظ» — a generic failure for a specific, explicable state. The partner then retries, gets the
 * same nothing, and opens a support ticket to ask a question their own screen could have answered.
 *
 * ## The sentence comes from the ERROR catalogue, not from the portal's own copy
 *
 * `partner.suspended` already has ar/en/de messages, and `support-form.tsx` was already rendering
 * them through `errorMessage`. A second sentence written here for the same state is the same defect
 * as two labels for one status: whichever screen a partner happens to be on decides what they are
 * told. One code, one sentence, resolved where the reader's language is known.
 *
 * ## A string, not a component
 *
 * There WAS a `SuspendedRefusal` component beside the notice — a `<p>` carrying this same sentence
 * — and nothing ever imported it (`O-partner-12`, removed 2026-08-24). Its docblock made a point
 * worth keeping: the notice and the refusal answer different questions, and both are needed. The
 * banner says why the ACCOUNT is held; this says why the thing you just tried did not happen. A
 * refusal with only a banner above it leaves the reader to infer the connection, and inference is
 * what produces a support ticket.
 *
 * A string rather than a component because that is what the twelve write components need: each has
 * its own message area, its own `kind: 'bad'` styling and its own vocabulary to fall back to. A
 * component would have made this the thirteenth answer to a question the other twelve had settled.
 *
 * ## Why it returns null rather than a fallback
 *
 * A helper that returned "something went wrong" for every unrecognised code would quietly swallow
 * the component's OWN vocabulary — `alreadyEmployed`, `roleNotFound`, the sentences that make a
 * refusal useful. Returning null keeps this strictly additive: it answers only for the codes it
 * knows, and the component's switch still owns everything else.
 */
export function refusalFor(code: unknown): string | null {
  return code === ERROR.PARTNER_SUSPENDED
    ? errorMessage(ERROR.PARTNER_SUSPENDED, 'ar')
    : null;
}

/**
 * The API's error code out of a proxied response, whatever shape the failure took.
 *
 * A refusal may arrive with no body, a body that is not JSON, or a body with no `code` — a proxy
 * timing out mid-stream produces all three. Every one of those answers `null`, which callers read
 * as "not a code I know" and fall through to their own message, rather than throwing inside an
 * error handler and replacing a useful sentence with a blank screen.
 */
export async function codeOfResponse(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);

  return typeof body === 'object' && body !== null && 'code' in body
    ? (body as { code?: unknown }).code
    : null;
}
