'use client';

import Link from 'next/link';

import { useBookingSelection, type BasketLine } from '@/components/booking-selection';
import { MAX_BASKET_ROOMS } from '@/lib/basket-limits';
import { Stepper } from '@/components/field-popover';
import { rangeArrow } from '@/lib/arrows';
import { convertMoney, type FxRate } from '@/lib/convert-money';
import { priceWithCustomerFee } from '@/lib/customer-fee';
import { addMoney } from '@/lib/localise';
import type { Locale } from '@/i18n/routing';

/**
 * The booking basket, and the summary of what it will cost.
 *
 * ## What it replaces
 *
 * A static box showing the cheapest room's «from» price and a button that booked that room. Then a
 * card that held ONE choice and replaced it, so a family needing two doubles and a suite made two
 * bookings — two payments, two vouchers, two confirmations — and adding the suite silently
 * discarded the doubles.
 *
 * It now accumulates. Each type is a line with its own quantity, its own subtotal and its own way
 * out, and the foot answers the two questions a basket exists to answer: what does the whole thing
 * cost, and does everybody fit.
 *
 * ## The money is computed HERE, and that is deliberate
 *
 * Pre-computing every combination of types and quantities server-side is exponential, so the card
 * does the arithmetic — in MINOR UNITS, through the same helpers the API uses (`priceWithCustomerFee`
 * applies the same rule `pricing.service.ts` does, and `addMoney` never sees a float). Each line's
 * per-room figure arrives in the unit's own currency and the sum is converted ONCE at the end:
 * converting per line and adding the results rounds three times and disagrees with the charge.
 *
 * Checkout re-quotes from the API and is authoritative. These two agree because they are the same
 * arithmetic on the same inputs, and `e2e/booking-basket.spec.ts` compares them.
 */
export function BookingSummaryCard({
  locale,
  propertySlug,
  guests,
  stay,
  fromPrice,
  money,
  copy,
}: {
  readonly locale: Locale;
  readonly propertySlug: string;
  readonly guests: { adults: number; children: number; infants: number };
  readonly stay: {
    checkIn: string;
    checkOut: string;
    checkInText: string;
    checkOutText: string;
  };
  /** The cheapest STAY for these dates, shown only while the basket is empty. */
  readonly fromPrice: string;
  /**
   * Everything needed to state a figure as money, as plain data.
   *
   * `fees` is the platform's customer-fee RULE, not a computed amount: the fee is charged once per
   * booking on the summed accommodation, so it can only be worked out after the lines are added up.
   */
  readonly money: {
    readonly currencyCode: string;
    readonly target: string;
    readonly rates: readonly FxRate[];
    readonly fees: {
      readonly customerFeeMode: string;
      readonly customerFeeValue: number;
    };
  };
  /*
    Every label is a STRING, never a formatter. This is a client component, and a server component
    may not hand one a function — so the plurals a summary needs are resolved by the page.
  */
  readonly copy: {
    fromLabel: string;
    fromCaption: string;
    chooseRoom: string;
    bookNow: string;
    selected: string;
    remove: string;
    clear: string;
    addMore: string;
    roomsLabel: string;
    increase: string;
    decrease: string;
    fee: string;
    total: string;
    policy: string;
    amenities: string;
    empty: string;
    accommodation: string;
    nightsText: string;
    guestsText: string;
    /**
     * «تتسع لـ ٨ ضيوف» and «غرفتان», indexed BY THE NUMBER.
     *
     * Arrays rather than functions: a server component may not hand a client component a
     * formatter, and both counts are bounded — a basket holds at most ten rooms, so the reachable
     * capacities stop at ten times the largest room. So the page resolves every one of them and
     * this indexes in. The words stay in the catalogue and no sentence is built in a component.
     */
    capacityTexts: readonly string[];
    roomsCountTexts: readonly string[];
    full: string;
    lineAll: string;
  };
}) {
  const { lines, rooms, capacity, setRooms, remove, clear, hasRoom } =
    useBookingSelection();

  const show = (amount: string) =>
    convertMoney(amount, money.currencyCode, locale, money.target, money.rates).text;

  if (lines.length === 0) {
    return (
      <>
        <p className="text-[11px] text-faint">{copy.fromLabel}</p>
        <p className="mt-0.5 text-2xl font-bold tabular-nums text-gold">{fromPrice}</p>
        <p className="mt-0.5 text-[12px] text-muted">{copy.fromCaption}</p>

        <div className="gold-rule my-4" />

        <p className="text-[12.5px] leading-relaxed text-faint">{copy.empty}</p>

        {/*
          An anchor, not a link: the list is on this page. It moves the reader to the choice rather
          than taking them somewhere to make it, which is what «اختر غرفة» promises.
        */}
        <a
          href="#units"
          className="btn-gold mt-4 block rounded-lg px-5 py-3 text-center font-semibold transition-opacity hover:opacity-90"
        >
          {copy.chooseRoom}
        </a>
      </>
    );
  }

  /*
    ── The arithmetic ────────────────────────────────────────────────────────

    Accommodation first, as the sum of the lines. Then the fee ONCE on that sum, which is what the
    API charges — a fee per line would be a card that overstates every basket with more than one
    type in it.
  */
  const subtotalOf = (line: BasketLine) =>
    [...Array(line.rooms).keys()].reduce(
      (sum) => addMoney(sum, line.room.perRoomAmount, money.currencyCode),
      '0',
    );

  const accommodation = lines.reduce(
    (sum, line) => addMoney(sum, subtotalOf(line), money.currencyCode),
    '0',
  );
  const withFee = priceWithCustomerFee(accommodation, money.currencyCode, money.fees);
  const fee = subtract(withFee, accommodation, money.currencyCode);

  /* The lead line is the first type chosen; the rest travel as `lines` on the link. */
  const [lead, ...rest] = lines;
  const checkout = [
    `/${locale}/checkout?property=${propertySlug}`,
    `unitId=${lead!.room.unitId}`,
    `rooms=${lead!.rooms}`,
    ...(rest.length > 0
      ? [`lines=${rest.map((line) => `${line.room.unitId}:${line.rooms}`).join(',')}`]
      : []),
    `checkIn=${stay.checkIn}`,
    `checkOut=${stay.checkOut}`,
    /* Never more of the party than the basket sleeps — the API refuses it, so the link must not. */
    `adults=${Math.max(1, Math.min(guests.adults, capacity))}`,
    `children=${guests.children}`,
    `infants=${guests.infants}`,
  ].join('&');

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[11.5px] font-bold tracking-wide text-faint">
          {copy.selected}
        </span>
        <span className="-my-2 ms-auto flex gap-3">
          <a
            href="#units"
            className="inline-flex min-h-10 items-center text-[12px] text-gold underline underline-offset-2 lg:min-h-0"
          >
            {copy.addMore}
          </a>
          <button
            type="button"
            onClick={clear}
            className="inline-flex min-h-10 cursor-pointer items-center text-[12px] text-muted underline underline-offset-2 transition-colors hover:text-text2 lg:min-h-0"
          >
            {copy.clear}
          </button>
        </span>
      </div>

      {/* One block per TYPE: what it is, how many, what those cost. */}
      {/*
        Divided rows, not boxes.

        Three bordered panels inside a bordered card is a card inside a card, which the craft floor
        names as always wrong — and at three lines it made the basket look like three separate
        things rather than one booking. A rule between them separates just as well and lets the
        card read as a single object.
      */}
      <ul className="mt-2 divide-y divide-line2">
        {lines.map((line) => (
          <li
            key={line.room.unitId}
            data-basket-line={line.room.unitId}
            className="grid gap-1.5 py-3 first:pt-1"
          >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h3 className="font-display text-[15px] leading-tight text-text">
                {line.room.name}
              </h3>
              <button
                type="button"
                aria-label={`${copy.remove} — ${line.room.name}`}
                onClick={() => remove(line.room.unitId)}
                className="-my-2 ms-auto inline-flex min-h-10 cursor-pointer items-center text-[11.5px] text-muted underline underline-offset-2 transition-colors hover:text-bad lg:min-h-0"
              >
                {copy.remove}
              </button>
            </div>

            {/*
              A stepper only where there IS a quantity to choose.

              A villa is one of a kind: `maxRooms` is 1, so both arrows would be dead the moment
              the line existed — a control that cannot move, which is the defect this review keeps
              finding. The line still says «غرفة واحدة» below, so nothing is lost but the noise.
            */}
            {line.room.maxRooms > 1 ? (
              <Stepper
                label={copy.roomsLabel}
                value={line.rooms}
                min={1}
                /*
                  Two ceilings, and the lower one wins: what the hotel has free of THIS type, and
                  what is left of the basket's own limit. A stepper that ran past either would
                  build a basket checkout refuses.
                */
                max={Math.min(line.room.maxRooms, line.rooms + (hasRoom ? 1 : 0))}
                onChange={(next) => setRooms(line.room.unitId, next)}
                increase={copy.increase}
                decrease={copy.decrease}
                tone="gold"
              />
            ) : null}

            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[12px]">
              <span className="text-muted">
                {text(copy.roomsCountTexts, line.rooms)} ·{' '}
                {text(copy.capacityTexts, line.room.maxGuests * line.rooms)}
              </span>
              <span className="font-semibold tabular-nums text-text">
                {show(subtotalOf(line))}
              </span>
            </div>

            {/*
              Said at THIS type's ceiling, distinctly from the basket's own.

              «كل الغرف المتاحة» at the basket limit and «كل المتاح من هذا النوع» here are different
              facts: one means the booking is full, the other that the hotel has no more doubles.
              A guest told the first when the second is true would stop adding a suite they could
              have had.
            */}
            {line.rooms >= line.room.maxRooms && line.room.maxRooms > 1 ? (
              <p className="text-[11px] leading-relaxed text-faint2">{copy.lineAll}</p>
            ) : null}

            <p className="text-[11px] leading-relaxed text-faint">
              {copy.policy}: {line.room.policyText}
              {line.room.amenityNames.length > 0
                ? ` · ${line.room.amenityNames.join(' · ')}`
                : ''}
            </p>
          </li>
        ))}
      </ul>

      {/* Said at the ceiling rather than left to a «+» that stops answering. */}
      {rooms >= MAX_BASKET_ROOMS ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-warn">{copy.full}</p>
      ) : null}

      <div className="gold-rule my-3.5" />

      <dl className="grid gap-1.5 text-[12.5px]">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-text2">{stay.checkInText}</dt>
          <dd className="text-text2">
            {rangeArrow(locale)} {stay.checkOutText}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-faint">{copy.nightsText}</dt>
          <dd className="text-faint">{copy.guestsText}</dd>
        </div>
        {/*
          What the WHOLE basket sleeps. The question a family asks of a basket is «do we all fit»,
          and no single line answers it.
        */}
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-faint">{text(copy.roomsCountTexts, rooms)}</dt>
          <dd className="font-semibold text-text2">
            {text(copy.capacityTexts, capacity)}
          </dd>
        </div>
      </dl>

      <dl className="mt-3 grid gap-1.5 border-t border-line pt-3 text-[12.5px]">
        <div className="flex items-baseline justify-between gap-3">
          {/* «الإقامة», not «ليلتان» — the row is what the rooms cost, not how long the stay is. */}
          <dt className="text-muted">{copy.accommodation}</dt>
          <dd className="tabular-nums text-text">{show(accommodation)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">{copy.fee}</dt>
          <dd className="tabular-nums text-text">{show(fee)}</dd>
        </div>
      </dl>

      <div
        data-summary-total={withFee}
        className="mt-3 flex items-baseline justify-between gap-3 rounded-lg border border-[rgba(var(--goldA),0.35)] bg-[rgba(var(--goldA),0.06)] px-3 py-2.5"
      >
        <span className="text-[12.5px] font-bold text-text">{copy.total}</span>
        <span className="text-[17px] font-extrabold tabular-nums text-gold">
          {show(withFee)}
        </span>
      </div>

      <Link
        href={checkout}
        className="btn-gold mt-4 block rounded-lg px-5 py-3 text-center font-semibold transition-opacity hover:opacity-90"
      >
        {copy.bookNow}
      </Link>
    </>
  );
}

/**
 * A counted sentence by its number, and never an out-of-range read.
 *
 * The arrays are built for every reachable count, so a miss means the page and the basket disagree
 * about what is reachable — an empty string is the honest answer to that, not a guess at the word.
 */
function text(texts: readonly string[], count: number): string {
  return texts[count] ?? '';
}

/**
 * `a − b`, in minor units.
 *
 * The fee is derived by subtracting the accommodation from the fee-inclusive total rather than
 * computed twice, so the two figures on the card cannot disagree by a rounding step. `nights` is
 * unused here — the amounts already cover the stay.
 */
function subtract(total: string, part: string, currency: string): string {
  const negated = part.trim().startsWith('-') ? part.replace('-', '') : `-${part}`;

  return addMoney(total, negated, currency);
}
