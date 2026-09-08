import type { DisputeNotifier } from './dispute-notifier.js';

/**
 * A `DisputeNotifier` that announces nothing, for the suites that assert the DISPUTE.
 *
 * ## Why this is a shared factory and not a literal in each file
 *
 * There were five `{ closed: () => Promise.resolve() } as never` stubs, each a hand-written claim
 * about which notifier methods the service under test calls. `as never` is what made that claim
 * invisible to the compiler, so when `openForBooking` and `acknowledge` grew announcements of their
 * own (finding 223) every one of those five suites failed at runtime with «this.notifier.opened is
 * not a function» — eighteen tests, none of which was about notifications.
 *
 * One factory means the next method added is one line here rather than a hunt. `satisfies` is the
 * part that matters: it type-checks the stub AGAINST the real class, so a method added to
 * `DisputeNotifier` and not to this fails to compile instead of failing eighteen tests later.
 *
 * ## Why the suites stub it at all
 *
 * The notifier reaches a mail server and swallows its own failures, so a real one would make every
 * dispute test depend on a queue for an assertion none of them makes. That the messages are
 * actually sent is `dispute-notifier.integration.test.ts`'s subject, with a real
 * `NotificationService` and an inline queue.
 */
export function silentDisputeNotifier(): DisputeNotifier {
  const nothing = (): Promise<void> => Promise.resolve();

  return {
    closed: nothing,
    opened: nothing,
    underReview: nothing,
  } satisfies Record<keyof DisputeNotifier, unknown> as unknown as DisputeNotifier;
}
