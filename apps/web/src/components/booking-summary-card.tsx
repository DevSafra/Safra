'use client';

import Link from 'next/link';

import { useBookingSelection } from '@/components/booking-selection';

/**
 * The booking card, as a live summary of what the guest has chosen.
 *
 * ## What it replaces
 *
 * A static box showing the cheapest room's «from» price and a button that booked that room. A guest
 * reading «من ٧٣٫٩٩» on a thirteen-room hotel and pressing «احجز الآن» silently bought the smallest
 * one; the figure and the action disagreed and nothing said so.
 *
 * Now the card answers one question — *what am I about to book, and what does it cost* — and it
 * answers it from the guest's own choice rather than from an accident of price ordering.
 *
 * ## Two states, and the button names which one it is in
 *
 * Nothing chosen: a «from» price, a sentence saying so, and «اختر غرفة» that moves to the list.
 * Something chosen: the room, its terms, its facilities, the arithmetic, and «احجز الآن». The label
 * is the honest description of what pressing it does, which is the distinction the old card lost.
 *
 * ## The arithmetic is shown, not just the answer
 *
 * Per night × nights = total, with the fee stated as included. A total on its own is a number a
 * guest has to trust; a total with its working is one they can check — and a booking is the moment
 * they most want to.
 */
export function BookingSummaryCard({
  locale,
  propertySlug,
  guests,
  fromPrice,
  copy,
}: {
  readonly locale: string;
  readonly propertySlug: string;
  readonly guests: { adults: number; children: number; infants: number };
  /** The «from» figure, shown only while nothing is chosen. */
  readonly fromPrice: string;
  /*
    Every label is a STRING, never a formatter.

    This is a client component, and a server component may not hand one a function. The plurals a
    booking summary needs — nights, guests — depend on numbers the server already knows, so it
    formats them and passes the sentence.
  */
  readonly copy: {
    perNightSuffix: string;
    guestsUpToParty: string;
    chooseRoom: string;
    bookNow: string;
    selected: string;
    change: string;
    remove: string;
    guestsCount: string;
    fee: string;
    total: string;
    policy: string;
    amenities: string;
    empty: string;
  };
}) {
  const { chosen, clear } = useBookingSelection();

  if (!chosen) {
    return (
      <>
        <p className="text-2xl font-bold text-gold">
          {fromPrice}
          <span className="ms-1 text-sm font-normal text-muted">
            {copy.perNightSuffix}
          </span>
        </p>
        <p className="mt-1 text-sm text-muted">{copy.guestsUpToParty}</p>

        <div className="gold-rule my-4" />

        <p className="text-[12.5px] leading-relaxed text-faint">{copy.empty}</p>

        {/*
          An anchor, not a link: the list is on this page. It moves the reader to the choice rather
          than taking them somewhere to make it, which is what «اختر غرفة» promises.
        */}
        <a
          href="#units"
          className="mt-4 block rounded-lg btn-gold px-5 py-3 text-center font-semibold transition-opacity hover:opacity-90"
        >
          {copy.chooseRoom}
        </a>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[11.5px] font-bold tracking-wide text-faint">
          {copy.selected}
        </span>
        {/*
          «تغيير» goes back to the list and «إزالة» empties the card. Two ways out, because a guest
          who picked the wrong room wants a different one and a guest who changed their mind wants
          the page back — and a card with no way out of a choice is a trap.
        */}
        <span className="ms-auto flex gap-3">
          <a href="#units" className="text-[12px] text-gold underline underline-offset-2">
            {copy.change}
          </a>
          <button
            type="button"
            onClick={clear}
            className="cursor-pointer text-[12px] text-muted underline underline-offset-2"
          >
            {copy.remove}
          </button>
        </span>
      </div>

      <h3 className="mt-1.5 font-display text-lg leading-tight text-text">
        {chosen.name}
      </h3>

      {/*
        What the ROOM sleeps, not the party — the party is on the line below with the nights.
        Both said «ضيفان» before, which reads as a rendering fault rather than two facts.
      */}
      <p className="mt-1 text-[12.5px] text-muted">{chosen.capacityText}</p>

      <div className="gold-rule my-3.5" />

      <dl className="grid gap-1.5 text-[12.5px]">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">{chosen.checkIn}</dt>
          <dd className="text-muted">← {chosen.checkOut}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-faint">{chosen.nightsText}</dt>
          <dd className="text-faint">{copy.guestsCount}</dd>
        </div>
      </dl>

      {/*
        A breakdown that RECONCILES, which the first version did not.

        It showed a fee-inclusive nightly rate above a total, so a guest multiplying 186.99 by two
        nights got 373.98 against a stated 371.99 and had no way to see why. The fee is charged once
        per booking, so it is its own line — the room, the fee, the sum — and every figure on the
        card can be checked against the one below it.
      */}
      <dl className="mt-3 grid gap-1.5 border-t border-line pt-3 text-[12.5px]">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">{chosen.roomLineLabel}</dt>
          <dd className="tabular-nums text-text">{chosen.roomLineAmount}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">{copy.fee}</dt>
          <dd className="tabular-nums text-text">{chosen.feeAmount}</dd>
        </div>
      </dl>

      <div className="mt-3 flex items-baseline justify-between gap-3 rounded-lg border border-[rgba(var(--goldA),0.35)] bg-[rgba(var(--goldA),0.06)] px-3 py-2.5">
        <span className="text-[12.5px] font-bold text-text">{copy.total}</span>
        <span className="text-[17px] font-extrabold tabular-nums text-gold">
          {chosen.total}
        </span>
      </div>

      <div className="mt-3 grid gap-1.5 text-[12px]">
        <p className="text-muted">
          <span className="text-faint">{copy.policy}:</span> {chosen.policyText}
        </p>
        {chosen.amenityNames.length > 0 ? (
          <p className="text-muted">
            <span className="text-faint">{copy.amenities}:</span>{' '}
            {chosen.amenityNames.join(' · ')}
          </p>
        ) : null}
      </div>

      {/*
        THE room the guest chose, with the dates the row quoted — never re-derived here.

        Checkout is handed the same unit and window the summary describes, so the page a guest lands
        on cannot quote a different room or a different stay than the one they just agreed to.
      */}
      <Link
        href={`/${locale}/checkout?property=${propertySlug}&unitId=${chosen.unitId}&checkIn=${chosen.checkIn}&checkOut=${chosen.checkOut}&adults=${Math.min(guests.adults, chosen.maxGuests)}&children=${guests.children}&infants=${guests.infants}`}
        className="mt-4 block rounded-lg btn-gold px-5 py-3 text-center font-semibold transition-opacity hover:opacity-90"
      >
        {copy.bookNow}
      </Link>
    </>
  );
}
