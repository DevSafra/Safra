/**
 * The rate-limit keys a request was counted against, remembered until the response is written.
 *
 * ## Why anything needs to remember them
 *
 * A throttler decides BEFORE the handler runs — that is what makes it cheap, and it is the whole
 * reason it sits first in the guard chain. But "did this sign-in succeed" is only knowable
 * AFTERWARDS. Refunding the per-IP hit for a successful sign-in (`O-sec-3`) therefore needs the
 * exact key the guard incremented, and that key is a `sha256` of the controller, the handler, the
 * throttler name and the tracker — reconstructing it downstream would mean reimplementing
 * `ThrottlerGuard.generateKey` and keeping the copy in step with the dependency for ever.
 *
 * So the guard records what it used, on the way past. `CodedThrottlerGuard.generateKey` is the one
 * place that writes here.
 *
 * ## A `WeakMap`, not a property on the request
 *
 * The request object is shared with every middleware, guard and library in the process, and a
 * property on it is a name anybody can collide with or read. A `WeakMap` keyed on the request is
 * private to this module and its entry disappears with the request, so nothing has to remember to
 * clean up.
 */
const keysByRequest = new WeakMap<object, Map<string, string>>();

/** Called by the guard for every throttler that actually counted this request. */
export function recordThrottleKey(request: object, throttler: string, key: string): void {
  const existing = keysByRequest.get(request);

  if (existing) {
    existing.set(throttler, key);
    return;
  }

  keysByRequest.set(request, new Map([[throttler, key]]));
}

/**
 * The key this request was counted against for the named throttler, if it was counted at all.
 *
 * Absent when the throttler skipped the request — `skipUnlessAccountNamed` does exactly that — and
 * a caller must treat that as "nothing to refund" rather than as an error.
 */
export function throttleKeyOf(request: object, throttler: string): string | undefined {
  return keysByRequest.get(request)?.get(throttler);
}
