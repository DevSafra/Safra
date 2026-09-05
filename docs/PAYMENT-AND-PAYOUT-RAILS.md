# Payment rails and payout destinations

**Asked by Bashar, 2026-09-05:** extend the payout-account model to support Visa, Mastercard,
Klarna and Sham Cash — but _"first determine whether each one is a valid payout destination, a
payment method, or both"_, and _"do not add them as UI-only placeholder options"_.

This is that determination. It is written before any schema change, because the answer turns out to
be that **most of the change should not be made.**

---

## 1. The answer, in one table

| Rail           | Money **in** (customer pays)             | Money **out** (SAFRA pays)                                                | Verdict                                              |
| -------------- | ---------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Visa**       | Yes — card acceptance                    | Only via **Visa Direct** (OCT), a separate product SAFRA has no access to | **Payment method.** Not a payout destination today.  |
| **Mastercard** | Yes — card acceptance                    | Only via **Mastercard Send**, likewise                                    | **Payment method.** Not a payout destination today.  |
| **Klarna**     | Yes, in Klarna's own markets — not Syria | **No. There is no such product.**                                         | **Payment method only.** Never a payout destination. |
| **Sham Cash**  | Yes                                      | Yes                                                                       | **Both.** Already modelled as both.                  |

**Nothing should be added to the payout-destination list.** The one rail that could eventually join
it is push-to-card, and it is a different kind of thing from a bank account — §4 explains why.

---

## 2. Why a card is not a payout destination

A card number is an instruction to **pull** money, not an address to **push** it to. Sending money
to a card is a distinct scheme product — an Original Credit Transaction, sold as **Visa Direct** and
**Mastercard Send** — and it needs:

- an acquirer or enabler contractually permitted to originate OCTs, which is a separate permission
  from card acceptance and is granted per-market;
- the destination stored as a **network token or PAN**, not an account number. SAFRA's payout
  accounts hold an encrypted number plus a last-4, and reusing that shape for a card would pull the
  entire platform into **PCI-DSS** scope — today SAFRA never touches a PAN, and that is worth more
  than the feature;
- different economics and limits: the sender pays, per-transaction ceilings are low, and failures
  reverse on a different timetable than a bank transfer.

So even where it is available, push-to-card is **not** "another value in the payout-method enum".
It is a second kind of destination with its own storage, its own compliance surface and its own
provider contract.

## 3. Why Klarna is not a payout destination at all

Klarna is deferred-payment credit. Its API surface is **Payments** (create a checkout session) and
**Order Management** (capture, refund) — there is no disbursement product, and no way to push funds
to an arbitrary person's Klarna balance. Klarna settles to **the merchant's** bank account on its
own schedule.

Two consequences that matter more than the missing feature:

- **A Klarna refund is not a payout.** It reverses the original order through Klarna, and the
  customer's credit obligation is what unwinds. Modelling it as a transfer to a stored destination
  would be wrong in a way that produces real money movement.
- **Klarna makes SAFRA a credit intermediary in the customer's jurisdiction.** Consumer-credit
  regulation, and Klarna's own market list, decide who may be offered it. It is a rail for
  non-Syrian customers or not at all.

## 4. The same point, generally: refunds are not payouts

Bashar's list included customer refunds alongside partner payouts and treasury transfers. They are
different mechanisms and SAFRA already treats them differently, correctly:

- **A refund returns money along the path it arrived on** — a credit against the original card
  authorisation, a reversal of the Klarna order, a wallet credit. It needs **no payout destination**
  and no stored bank details, which is also why it cannot leak them.
- **A payout sends money to a destination the recipient nominated** — a bank account, a Sham Cash
  wallet, an exchange office. This is where destination records, verification and activation belong.
- **A wallet withdrawal is a payout**, not a refund, and needs a real destination. A card cannot
  receive one without Visa Direct; Klarna never can.

---

## 5. What SAFRA already models correctly

This was checked in the code rather than assumed, and the separation is already right:

- `paymentMethod` (`packages/db/src/schema/enums.ts`) — money in: `visa`, `mastercard`,
  `sham_cash`, `klarna`, plus the internal `gift_card` / `wallet` and the finance-side
  `bank_transfer`.
- `PAYOUT_METHODS` (`packages/contracts/src/payout-account.ts`) — money out: `bank_transfer`,
  `sham_cash`, `cash_office`. **Visa, Mastercard and Klarna are already absent, and should stay
  absent.**

The same three destination types serve partner payouts, SAFRA treasury transfers and wallet
withdrawals, which is the consistency Bashar asked for and it is already there.

**So the requested change is largely a change that should not be made.** Adding the card networks
to the payout list would not extend the model, it would break a distinction the model already
draws.

## 6. What is actually missing — and it is bigger than the enum

**Not one of the four customer-facing payment methods can take a single riyal today.**
`PaymentProviderRegistry` registers exactly `manual_transfer` (plus `simulator` outside
production). Since the platform derives what it offers from provider routing — a method with no
provider behind it is not shown — the live answer is that SAFRA accepts money by manual transfer
and nothing else.

That is a commercial gap, not an engineering one: each rail needs an acquirer or provider
agreement, underwriting, and then an adapter behind the existing `PaymentProvider` port. The port
is already there and `manual_transfer` proves the shape works.

## 7. What changed in Syria, and what it unlocks

Verified 2026-09-05 rather than recalled: **Visa and Mastercard resumed operations in Syria in May
2026**, going live on 9 May through Qatar National Bank, after the US removed Syria's terrorism
designation; the Central Bank of Syria authorised local institutions to reconnect to the global card
networks, and the EU restored trade relations on 11 May 2026. Targeted restrictions on designated
individuals and entities remain.

This is genuinely new and it changes the plan: **card acceptance is now a realistic route** where
it was impossible for fifteen years. Two cautions before treating it as done:

- reporting describes trials and a _"cautious expansion"_, months old — the practical question is
  which Syrian acquirer will underwrite a travel marketplace, not whether the network is live;
- **acceptance being restored says nothing about Visa Direct or Mastercard Send.** Push-to-card is
  a separate enablement and there is no evidence it is available in Syria. Until an acquirer states
  otherwise in writing, cards remain payment-in only.

---

## 8. Recommendation

1. **Change nothing in `PAYOUT_METHODS`.** It is correct. Adding card networks would be exactly the
   placeholder Bashar said he did not want.
2. **Pursue acquiring, not enums.** The blocking work for Visa and Mastercard is a Syrian acquirer
   agreement now that the networks are live. The adapter behind it is small.
3. **Treat Klarna as out of scope for Syria-resident customers**, and revisit only if SAFRA sells
   into a Klarna market through an entity established there.
4. **Sham Cash is the highest-value integration** — the only rail that is already both directions,
   domestic, and needs no sanctions relief. It should be first.
5. **Record push-to-card as a design, not a feature.** If an acquirer later offers Visa Direct, it
   arrives as a new destination KIND with tokenised storage — not as a fourth value in the existing
   enum. Writing that down now stops somebody adding `'visa'` to `PAYOUT_METHODS` later because it
   looked like the small change.

## 9. What was deliberately not done

No schema was changed and no option was added to any screen, because every candidate either already
exists in the right place or cannot move money. Per Bashar's own instruction, an option that cannot
receive or process funds does not belong in the interface — and the honest form of "add support for
Visa, Mastercard and Klarna as payout destinations" is this document explaining why three of the
four should not be added, and what to do instead.
