# Is sanctions screening actually required? — a review before changing it

**Asked by Bashar, 2026-08-21.** Reviewed by engineering. **Nothing has been implemented; this
document exists to be decided on first.**

> **Not legal advice.** This is an engineering review of a compliance dependency, written from
> public sources. Section 7 lists what has to be confirmed by counsel before the recommendation is
> acted on, and which claims here are second-hand.

---

## 1. The short answer

**Do not remove the control. Remove the coupling.**

The obligation is real and it did not come from a development assumption — but it is not the
obligation the code currently implements. Three separate things have been fused together, and only
one of them is required:

|                                                                   | Required?                   |
| ----------------------------------------------------------------- | --------------------------- |
| Not making funds available to a person designated by the EU       | **Yes — criminal law**      |
| Screening partner names as the control that achieves that         | **In practice, yes**        |
| A hard gate at partner APPROVAL, against a ≤7-day-old EU XML feed | **No. This is our choice.** |

`M-2` is a launch blocker because of the third row. The third row is engineering's decision, not a
regulator's, and it can be changed without touching the first.

**Recommended: a compliance setting, defaulted to ON, plus enforcement moved to where money
actually moves.** Detail in §5.

---

## 2. What changed since the assumption was written — and it is not what you would expect

The reasoning in [`ADR 0002`](../.claude/memory/0002-payments-entity-and-sanctions.md) is one line:
a German entity makes EU screening "a legal obligation, not a nice-to-have". That is right as far as
it goes, and it stopped being the whole picture.

**The EU lifted its economic sanctions on Syria on 29 May 2025.** Suspended first by Council
Regulation (EU) 2025/407 on 24 February 2025, then lifted by Council Regulation (EU) 2025/1098.
The Council's own press release describes it as "lifting all economic restrictive measures on Syria,
with the exception of those based on security grounds."

**What was kept is the part that matters to us.** The remaining designations under Regulation (EU)
No 36/2012 target:

- persons and entities linked to the former al-Assad government,
- the chemical weapons sector,
- the captagon and illicit-drug trade.

So the intuition behind the question — _we are focused on Syria, therefore EU sanctions are
someone else's problem_ — points the wrong way. **The general embargo is gone; what survives is a
list of Syrian individuals and companies.** A platform whose partners are Syrian accommodation
businesses is the highest-yield place on the map for a name on that list to appear. The lifting made
the country tradeable. It did not make the list irrelevant — it made the list the _only_ thing left
to check.

This is the single most important finding in this review, and it inverts the premise of the request.

---

## 3. What the obligation actually is

The EU asset-freeze prohibition forbids making funds **or economic resources** available, directly
or indirectly, to or for the benefit of a designated person. Two properties of it drive everything
below:

- **It binds everyone in the EU**, not only banks and payment institutions. SAFRA GmbH is in scope
  as an ordinary commercial party. There is no de-minimis and no "we are just a marketplace" carve-out.
- **It is about the outcome, not the procedure.** No EU regulation says "you must run a screening
  before approving a counterparty." It says you must not let a designated person have the money.

Enforcement of breaches was harmonised by **Directive (EU) 2024/1226** (24 April 2024), which
requires member states to criminalise violation _and circumvention_ of restrictive measures.
Germany's transposition — reported as AWG amendments in January/February 2026, raising penalties and
organisational duties — is **the weakest-sourced claim in this document** and is flagged in §7.

**What this means for the design.** Screening is a _control_, chosen by us, to discharge a duty
defined by outcome. We are free to choose a different control, a different moment, or a
risk-weighted one. We are not free to choose _no_ control and still claim the duty is discharged.

---

## 4. Where the dependency actually lives

Smaller than it feels. **One line blocks partner approval:**

```
apps/api/src/admin/review.service.ts:524
  if (input.decision === 'approve' && partner.sanctionsScreenedAt === null) {
    throw badRequest(ERROR.PARTNER_SANCTIONS_SCREENING_REQUIRED);
```

That is the entire gate. Everything else is machinery around it:

| Area             | Files                                                                          | Role                                       |
| ---------------- | ------------------------------------------------------------------------------ | ------------------------------------------ |
| The gate         | `admin/review.service.ts`                                                      | The only enforcement point in the platform |
| Screening engine | `sanctions/sanctions.service.ts`, `name-normalisation.ts`, `eu-list.parser.ts` | Matching, snapshots, the 7-day refusal     |
| Feed             | `sanctions/sanctions-refresh.service.ts`, `queue/scheduled.job.ts`             | Daily fetch, needs `SANCTIONS_FEED_URL`    |
| Console          | `screening-panel.tsx`, `partners/[reference]/page.tsx`, `lib/api.ts`           | Run it, read the result, override a hit    |
| Signals          | `metrics.service.ts` (alert 6), `review.service.ts` attention counters         | Staleness paging, unscreened backlog       |
| Docs             | `runbooks/sanctions-feed.md`, `FUTURE-WORK.md` M-2, ADR 0002                   | Procedure and the blocker record           |

**And the gate is in the wrong place.** Approval is not where funds move — `partner_payouts` is.
Today a partner approved in January and designated in June is screened exactly never again, and
nothing stops the payout. That is a real gap, it is worth more than the gate being removed, and it
is invisible while everyone's attention is on the approval blocker.

---

## 5. The options

### Option A — remove the gate outright

Delete the check; keep screening as a manual tool.

- **For:** unblocks onboarding today, smallest diff, M-2 stops being a launch blocker.
- **Against:** the control becomes a thing people remember to do. Nothing records _why_ a partner
  was approved unscreened, so a later audit cannot distinguish "policy decision" from "nobody
  bothered". Given §2 — the residual EU list is Syria-specific — this is the option with real
  exposure attached.
- **Verdict:** not recommended.

### Option B — a compliance setting, defaulted ON ✅ **recommended**

`compliance.sanctions_screening` in the existing settings table, with three values:

| Value      | Behaviour                                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `required` | Today's behaviour. Approval refused without a screening. **Default.**                                                        |
| `advisory` | Screening runs and is recorded; approval is allowed without it, and the reviewer sees an explicit warning they must confirm. |
| `off`      | Screening is not offered. The panel states it is disabled by policy, by whom, and when.                                      |

The settings table is already the right home: console-editable by `super_admin`, audited on change,
cached with invalidation, no migration needed beyond a seed row.

**The non-negotiable part: an approval must record the policy that was in force when it happened.**
A `sanctions_policy` value stamped on the partner (or on the approval audit entry) at approval time.
Without it, turning the setting off makes historical approvals indistinguishable from
approvals where the control silently failed — and the whole value of a compliance control is being
able to answer, two years later, _what did we do and why_.

- **For:** unblocks onboarding by a recorded decision rather than by deletion; reversible in one
  console change; the audit trail survives the reversal in both directions.
- **Against:** more code than Option A, and one more setting somebody can get wrong.

### Option C — risk-weighted screening

Screen only above a threshold — payout value, ownership complexity, listed-jurisdiction links.

- **Verdict:** the right long-term shape, and premature. It needs a documented risk methodology to
  be defensible, and a methodology written by engineering to unblock a queue is worse than no
  methodology. Revisit when compliance owns it. Recorded, not built.

---

## 6. What Option B costs

Roughly **1.5–2 days**, tests and docs included.

**API**

- `packages/contracts/src/compliance.ts` — `SANCTIONS_POLICIES = ['required','advisory','off']`, a
  schema, and the setting key. One source of truth for the three values.
- `admin/review.service.ts` — read the policy; gate only under `required`; stamp the policy in force
  onto the approval in the same transaction as the verification write.
- `sanctions/sanctions.service.ts` — `screen()` unchanged. Under `off`, callers must not reach it;
  the refusal stays as it is, because a screening that runs must still refuse a stale or absent list.
- `settings-admin.service.ts` — allow the key, validated against the contract enum, audited like
  every other setting.
- **`payouts/payout.service.ts` — the addition worth making.** Under `required`, refuse to release a
  payout to a partner whose screening is absent or older than a stated interval. This is where
  "making funds available" actually happens, and it closes the January-approved/June-designated gap
  that exists today regardless of what is decided about the approval gate.

**Console**

- `screening-panel.tsx` — three states instead of two; under `advisory` an explicit confirmation on
  the approval control; under `off` a plain statement that it is disabled by policy.
- Settings screen — the control itself, with the consequence spelled out in the copy rather than a
  bare toggle.
- Attention counters — `partners_unscreened` stays in all three modes. The backlog must remain
  visible so it can be worked once the feed exists.

**Copy** — `@safra/i18n`, admin catalogue, three states plus the confirmation. Error codes for the
new refusals.

**Tests** — approval refused under `required`, permitted under `advisory` with the policy stamped,
permitted under `off`; the payout refusal; the setting rejecting an unknown value; and the
assertion that matters most — **an approval made under `off` is still identifiable as such
afterwards**.

**Docs** — `FUTURE-WORK.md` M-2 downgraded from launch blocker to compliance task with a stated
default; `runbooks/sanctions-feed.md` gains the policy; ADR 0002 amended with §2 of this document,
because its one-line reasoning is now out of date in a way that matters.

---

## 7. What I could not verify, and what needs counsel

Stated plainly, because the recommendation rests on it.

| Claim                                                     | Confidence     | Basis                                                                                        |
| --------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------- |
| EU economic sanctions on Syria lifted 29 May 2025         | **High**       | Council press release; EUR-Lex 2025/407; White & Case                                        |
| Residual designations are Assad/chemical/captagon         | **High**       | Council; OpenSanctions EU-SYR programme                                                      |
| Asset freeze binds all EU persons, not just banks         | **High**       | Settled law; corroborated across advisory sources                                            |
| Directive (EU) 2024/1226 exists and criminalises breaches | **High**       | EUR-Lex, Legifrance, EP legislative train                                                    |
| German AWG amendments of Jan/Feb 2026 tightened duties    | **Low–Medium** | Two secondary sources, **one a screening-software vendor**. Not checked against primary law. |

**Questions only a lawyer should answer, and the decision should wait for them:**

1. Is SAFRA GmbH an _obliged entity_ under German GwG (AML), or only bound by the general asset
   freeze? This is the difference between "screening is a documented control we chose" and
   "screening is a statutory duty with prescribed form".
2. Does the acquirer/PSP contract independently require counterparty screening? **Payment
   contracts routinely impose it regardless of statute, and this may settle the question on its own
   without any reference to sanctions law.** Worth checking before the legal question.
3. If the answer to both is "no formal requirement", does `advisory` satisfy the standard of care
   for a platform paying out to Syrian businesses, given §2?

**My engineering position, for what it is worth:** the residual EU list is Syria-specific, and this
platform's partners are Syrian. That is the argument for keeping the default at `required` and
fixing the feed, rather than for lowering the control.

---

## 8. Recommended sequence

1. **Confirm §7 question 2 first** — the PSP contract. It is one email, and it may make the rest of
   the analysis irrelevant either way.
2. **Build Option B with the default at `required`.** Nothing changes in behaviour on day one; the
   ability to change it exists and is recorded when used.
3. **Add the payout-time check** alongside it. This is the part that improves compliance rather than
   relaxing it, and it is the reason to touch this code at all.
4. **Decide the runtime value with compliance**, not in a pull request.
5. **Keep M-2 open** as a compliance task. Downgraded from launch blocker — which is the outcome
   asked for — but not closed, because the feed is what makes `required` usable.

The setting is what stops this being a launch blocker. The default is what stops it being a
liability. They are separate decisions and both should be made deliberately.
