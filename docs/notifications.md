# Notifications

What SAFRA sends unprompted, who receives it, and how to prove it was sent.

---

## What exists

| Template               | Goes to     | When                                                | Why it matters                                           |
| ---------------------- | ----------- | --------------------------------------------------- | -------------------------------------------------------- |
| `booking.needs_action` | The partner | A booking is paid and enters `pending_confirmation` | §6.4 fines a partner for not answering in time           |
| `review.received`      | The partner | A guest publishes a review of their listing         | A review cannot be deleted; a reply is the only response |
| `review.replied`       | The guest   | The partner replies to that guest's review          | The reply is published under their name                  |

Email only. WhatsApp is in `NOTIFICATION_TEMPLATES` as a channel these templates _could_ use, and the
provider is undecided — see roadmap item 192. The console shows the per-channel truth rather than one
flag per template, because "confirmation sending is broken" and "the WhatsApp half is not wired" lead
to different actions.

All three exist in Arabic, English and German. The locale is the RECIPIENT's
`users.preferred_locale`, not the locale of whoever caused the event — a German guest reviewing a
Syrian host means the host reads Arabic and the guest reads German, from the same action.

---

## Why `booking.needs_action` exists at all

§6.4 fines a partner and cuts their score for not answering a booking request inside the confirmation
window. Until this notice existed, the only way to learn a request had arrived was to be looking at
the dashboard.

**Fining somebody for missing a message nobody sent them is not a rule, it is a trap.** That is the
whole of the reasoning, and it is why this one carries the deadline in the body rather than just
saying a booking is waiting.

This closes `S-2`.

---

## Proving it was sent

Every send writes a row to `notifications`, **whether or not it succeeded**. That table had existed
since the first migration with nothing ever writing to it, so «سجل المراسلات» in the console showed a
catalogue of templates over an empty log.

```sql
-- Was this partner told about this booking?
SELECT template_key, status, queued_at, sent_at, attempts, failure_reason
FROM notifications
WHERE booking_id = (SELECT id FROM bookings WHERE reference = 'BKG-2026-000123');
```

`status` is `queued` → `sent` | `failed`. A `failed` row carries the provider's reason, which is the
difference between "we tried and could not reach them" and "we never tried" — the two answers a
partner disputing a fine needs told apart.

### What the log deliberately does NOT hold

- **The recipient's address.** The subject foreign keys (`booking_id`, `partner_id`,
  `customer_profile_id`, `dispute_id`) identify who was written to without repeating an email address
  in a second table. Reconstructing "who" means joining, which is an authorization boundary rather
  than a free read.
- **The message body.**
- **Anything in `failure_reason` that looks like contact details.** An SMTP rejection routinely
  quotes the address it refused — `550 5.1.1 <someone@example.com> recipient not found` — so the
  reason is passed through `redactContactDetails` before it is stored. This was found by the test
  that asserted it, not by inspection.

---

## Visibility rules

**A notice reaches exactly one person, derived from the record being acted on — never from the
request.**

- A guest writing a review causes mail to reach the host of the booking they stayed at. The partner
  id comes from the booking row, so a guest cannot address a notice to anybody else.
- A partner replying causes mail to reach the guest who wrote that review, taken from the review's
  own `customer_profile_id`. The partner supplies the text and nothing about who reads it.
- A paid booking notifies the booking's own partner. A payment webhook cannot redirect it.

A recipient whose account is not `active`, or who has no email address, is skipped silently. There is
nothing the other party should be told about somebody else's mailbox.

---

## Failure is contained

**A notification that cannot be sent never fails the thing it is about.** A guest's review is saved
whether or not the host's mail server is reachable; a booking stays paid whether or not the notice
went out. `NotificationService.notify` swallows the send failure, records it, and returns — the
caller is told nothing, because there is nothing the caller should do differently.

Both are asserted: `review.integration.test.ts` writes a review with the transport throwing, and
`payments.integration.test.ts` captures a payment the same way.

---

## Sends happen in the request

There is no queue. `notify` calls the mail transport inline, after the database transaction commits.

That is honest for three low-volume notices and **wrong for a platform**: a slow mail server becomes a
slow API, and rule 3's p95 budget does not survive an SMTP timeout on the booking path. The fix is
the background queue — `docs/FUTURE-WORK.md` item 9, BullMQ — deferred until the hosting decision is
made, because it turns Redis from a cache into durable job infrastructure with its own backup and
restore story.

Until then, this service is the seam that move happens behind: every send already goes through one
method with a recorded outcome, so the change is to how `notify` dispatches, not to eleven call
sites.

**Accepted, with the consequence stated:** an unreachable mail server adds its connection timeout to
the request that triggered it. Sends are after the commit, so nothing is lost — but the caller waits.

---

## Sending happens after the commit, always

Inside the transaction, a mail server that hung would hold a database transaction open for the
duration — one that has just written ledger entries, in the booking case. And a send that succeeded
before a later rollback would have told somebody about a review that does not exist.

The record is the fact; the notice is a consequence of it.

---

## Adding one

1. Add the copy to `packages/i18n/src/messages/email/{ar,en,de}.ts`. All three, or the completeness
   test fails — which is the point.
2. Add a template function to `apps/api/src/mail/mail.templates.ts`.
3. Add the key to `NOTIFICATION_TEMPLATES` in `apps/api/src/admin/notification-templates.ts` with its
   real channel and `implemented` state, so the console's inventory stays true.
4. Call `NotificationService.notify(key, mail, locale, subject)` **after** the transaction, deriving
   the recipient from the record rather than from the request.
5. Test the `notifications` row, not the send. The row is what answers the question months later.
