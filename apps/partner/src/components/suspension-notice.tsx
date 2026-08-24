import { fill, t } from '@/lib/strings';

/**
 * The hold on this account, said plainly, at the top of every screen.
 *
 * ## The state this exists for
 *
 * A suspended partner is a LIVE session (Bashar, 2026-08-24): they sign in, they read their
 * account, and every write is refused. Suspension used to strip the token's `partnerId`, so the
 * portal rendered as though the business did not exist — which meant the one person who most needs
 * to know why could not be told.
 *
 * ## Why the order of the sentences is the design
 *
 * The reason comes first, because it is what they opened the portal to find. Then `guestsSafe`,
 * BEFORE the list of what is blocked — the first fear of a suspended owner is that their guests
 * have been cancelled on, and a notice that lists four blocked things before answering that
 * question has already caused the panic it was written to prevent. Then what is blocked, then what
 * is still theirs, so the screen does not end on a refusal.
 *
 * ## Rendered by the shell, never by a page
 *
 * `Shell` renders it, so no page can omit it. Pages already pass a name and badges; this is
 * deliberately NOT a fifth prop, because the page that forgets it is the page where somebody is
 * left guessing why nothing works.
 */
export function SuspensionNotice({
  suspension,
}: {
  readonly suspension: { readonly reason: string; readonly since: string };
}) {
  return (
    <section
      /*
        `role="status"` rather than `alert`: this is a standing condition the reader arrived to
        find, not an interruption. `alert` is assertive and would talk over a screen reader on every
        navigation — twenty times an hour for somebody whose account is on hold.
      */
      role="status"
      data-suspension-notice
      className="grid gap-3 rounded-xl border border-bad/40 bg-bad/5 p-4"
    >
      <div className="grid gap-1">
        <h2 className="text-sm font-semibold text-bad">{t.suspension.title}</h2>
        <p className="text-[12.5px] text-text">
          {fill(t.suspension.reason, { reason: suspension.reason })}
        </p>
        <p className="text-[12px] text-faint">
          {fill(t.suspension.since, { date: suspension.since })}
        </p>
      </div>

      {/*
        Second, and before anything about what stopped. This is the sentence the notice is for.
      */}
      <p className="text-[12.5px] font-medium text-text">{t.suspension.guestsSafe}</p>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-1">
          <h3 className="text-[12px] font-semibold text-muted">
            {t.suspension.blockedTitle}
          </h3>
          <ul className="grid gap-1 text-[12.5px] text-muted">
            <li>{t.suspension.blockedListings}</li>
            <li>{t.suspension.blockedProperties}</li>
            <li>{t.suspension.blockedPayouts}</li>
          </ul>
        </div>

        <div className="grid gap-1">
          <h3 className="text-[12px] font-semibold text-muted">
            {t.suspension.allowedTitle}
          </h3>
          <ul className="grid gap-1 text-[12.5px] text-muted">
            <li>{t.suspension.allowedRead}</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

/**
 * What a refused WRITE says while the account is on hold.
 *
 * Separate from the notice because it answers a different question: the notice says why the
 * account is held, this says why the thing you just tried did not happen. Both are needed — a
 * refusal with only the banner above it leaves the reader to infer the connection, and inference
 * is what produces a support ticket.
 *
 * It exists at all because `partnerFetch` maps the API's 403 to `'unauthenticated'`, so a refusal
 * that falls through renders «انتهت الجلسة» and sends somebody to sign in again over a state that
 * signing in cannot change. That is the same trap the console's section gate was built to close,
 * arriving on a different screen.
 */
export function SuspendedRefusal() {
  return (
    <p data-suspended-refusal className="text-sm text-bad">
      {t.suspension.refused}
    </p>
  );
}
