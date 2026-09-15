'use client';

import Link from 'next/link';

import { useBookingSelection, type BasketLine } from '@/components/booking-selection';
import { MAX_BASKET_ROOMS } from '@/lib/basket-limits';
import { Stepper } from '@/components/field-popover';
import { rangeArrow } from '@/lib/arrows';
import { priceWithCustomerFee } from '@/lib/customer-fee';
import { addMoney, formatMoney } from '@/lib/localise';
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
    roomsLabel: string;
    increase: string;
    decrease: string;
    fee: string;
    /** «رسوم سفرة ×{count}», indexed BY the count — see `countedTexts`. */
    feeTimes: readonly string[];
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

  /*
    One currency, so nothing converts (Bashar, 2026-09-14). This used to run every figure in the
    basket through the visitor's chosen currency and a rate table; the amounts here are the ones
    checkout charges, and now they are also the ones it shows.
  */
  const show = (amount: string) => formatMoney(amount, money.currencyCode, locale);

  if (lines.length === 0) {
    return (
      <>
        <p className="text-[14px] text-faint">{copy.fromLabel}</p>
        <p className="mt-0.5 text-2xl font-bold tabular-nums text-gold">{fromPrice}</p>
        <p className="mt-0.5 text-[13px] text-muted">{copy.fromCaption}</p>

        <div className="gold-rule my-4" />

        <p className="text-[14px] leading-relaxed text-faint">{copy.empty}</p>

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
  /*
    The fee is charged once per unit TYPE (Bashar, 2026-09-14) — `lines.length`, not the number of
    rooms. Three doubles is one fee; a double and a suite is two. The API charges exactly this,
    through the same rule in `customerFeeMinor`; a second arithmetic here would be a card and a
    checkout disagreeing about money.
  */
  const withFee = priceWithCustomerFee(
    accommodation,
    money.currencyCode,
    money.fees,
    lines.length,
  );
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
        <span className="text-[13px] font-bold tracking-wide text-faint">
          {copy.selected}
        </span>
        {/*
          «امسح» alone (Bashar, 2026-09-13: «remove أضف غرفة أخرى from the left cart»). There used
          to be an «أضف غرفة أخرى» link beside it, jumping to `#units`. `flex` stays — it is what
          makes `-my-2` pull the 40px tap target back into the heading's line; `gap-3` went with the
          second control it used to separate.
        */}
        <span className="-my-2 ms-auto flex">
          <button
            type="button"
            onClick={clear}
            className="inline-flex min-h-10 cursor-pointer items-center text-[13px] text-muted underline underline-offset-2 transition-colors hover:text-text2 lg:min-h-0"
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
      {/*
        `divide-line`, NOT `divide-line2`.

        `--color-line2` is declared in the console and the portal and NOT in this app, so Tailwind
        emitted no colour for it and the rule fell back to `currentColor` — a 1px band of INK
        between every pair of rooms, measured at rgb(29,35,51) on white and near-white on the night
        theme. It was not styled dark; it was not styled at all. Same defect as the room chips on
        the property page (2026-09-11), same fix.
      */}
      <ul className="mt-2 divide-y divide-line">
        {lines.map((line) => (
          <li
            key={line.room.unitId}
            data-basket-line={line.room.unitId}
            className="grid gap-1.5 py-3 first:pt-1"
          >
            {/*
              The NAME and what it costs, on one line (Bashar, 2026-09-15: «design this better and
              easier to read… make the unit names bold»).

              They were three rows apart — name at the top, price down beside the occupancy — so
              reading «what did I choose and what does it cost» meant zig-zagging. Paired, they are
              the two things a guest checks and the only two in this block carrying weight.

              Bold, and the strongest thing in its own block: the name identifies the line, and it
              was previously lighter than the figure sitting next to it.
            */}
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="font-display text-[16px] font-bold leading-tight text-text">
                {line.room.name}
              </h3>
              <span className="ms-auto text-[15px] font-bold tabular-nums text-text">
                {show(subtotalOf(line))}
              </span>
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

            {/*
              How many and who fits, with «إزالة» at the end of the same row.

              The control moved off the name line when the price took that edge. It belongs beside
              the quantity rather than beside the name: both are things a guest DOES to this line,
              and the name row is now purely what-and-how-much.
            */}
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[13px]">
              <span className="text-muted">
                {text(copy.roomsCountTexts, line.rooms)} ·{' '}
                {text(copy.capacityTexts, line.room.maxGuests * line.rooms)}
              </span>
              <button
                type="button"
                aria-label={`${copy.remove} — ${line.room.name}`}
                onClick={() => remove(line.room.unitId)}
                className="-my-2 inline-flex min-h-10 cursor-pointer items-center text-[13px] text-muted underline underline-offset-2 transition-colors hover:text-bad lg:min-h-0"
              >
                {copy.remove}
              </button>
            </div>

            {/*
              Said at THIS type's ceiling, distinctly from the basket's own.

              «كل الغرف المتاحة» at the basket limit and «كل المتاح من هذا النوع» here are different
              facts: one means the booking is full, the other that the hotel has no more doubles.
              A guest told the first when the second is true would stop adding a suite they could
              have had.
            */}
            {line.rooms >= line.room.maxRooms && line.room.maxRooms > 1 ? (
              <p className="text-[14px] leading-relaxed text-faint">{copy.lineAll}</p>
            ) : null}

            {/*
              Two tiers, because these are two kinds of fact.

              The cancellation policy is a DECISION value — it is the thing a guest weighs before
              paying — and it sat at `text-faint` in the same run as the facilities, which the
              standing rule forbids: «important operational information is never the faintest text
              on the screen». It reads at `text-muted` now. The facilities stay explanatory, quieter
              and a tier smaller, on their own line so a long list cannot push the policy out of
              sight.
            */}
            <p className="text-[14px] leading-relaxed text-muted">
              {copy.policy}: {line.room.policyText}
            </p>
            {line.room.amenities.length > 0 ? (
              <p className="text-[13px] leading-relaxed text-faint">
                {line.room.amenities.map((amenity) => amenity.name).join(' · ')}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      {/* Said at the ceiling rather than left to a «+» that stops answering. */}
      {rooms >= MAX_BASKET_ROOMS ? (
        <p className="mt-2 text-[13px] leading-relaxed text-warn">{copy.full}</p>
      ) : null}

      <div className="gold-rule my-3.5" />

      <dl className="grid gap-1.5 text-[14px]">
        {/*
          The arrow sits BETWEEN the dates, not against the check-out (Bashar, 2026-09-13). The row
          was `justify-between` with the arrow inside the `dd`, so all the free space opened on one
          side of it and the glyph read as part of the second date rather than as the span between
          them.

          `flex-1` on the `dd` plus `mx-auto` on the arrow: auto margins absorb the free space and
          split it equally, so the gap either side of the glyph is the same whatever the two dates
          measure — a September date and a «كانون الأول» one do not move it. `px-3` is the floor for
          the day the dates are wide enough that there is no free space left to split.

          The arrow stays INSIDE the `dd`: a `<dl><div>` may hold only `dt` then `dd`, so a third
          element between them would be markup a screen reader is entitled to mis-group.
        */}
        <div className="flex items-baseline">
          <dt className="text-text2">{stay.checkInText}</dt>
          <dd className="flex flex-1 items-baseline text-text2">
            <span className="mx-auto px-3">{rangeArrow(locale)}</span>
            <span>{stay.checkOutText}</span>
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

      <dl className="mt-3 grid gap-1.5 border-t border-line pt-3 text-[14px]">
        <div className="flex items-baseline justify-between gap-3">
          {/* «الإقامة», not «ليلتان» — the row is what the rooms cost, not how long the stay is. */}
          <dt className="text-muted">{copy.accommodation}</dt>
          <dd className="tabular-nums text-text">{show(accommodation)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          {/*
            ONE line carrying «×2», not a row per type (Bashar, 2026-09-14: «so you do not write it
            in multiple lanes»). The charge is per type, so a basket with two types pays it twice —
            and a reader who sees «رسوم سفرة» twice reads it as a mistake rather than as a count.

            The multiplier is inside the CATALOGUE string, not «{label} ×{n}» assembled here: a
            translator decides where the count sits in their own phrase, and `countedTexts` resolves
            every reachable count on the server because a client component takes no formatter.
          */}
          <dt className="text-muted">
            {lines.length > 1 ? (copy.feeTimes[lines.length] ?? copy.fee) : copy.fee}
          </dt>
          <dd className="tabular-nums text-text">{show(fee)}</dd>
        </div>
      </dl>

      <div
        data-summary-total={withFee}
        className="mt-3 flex items-baseline justify-between gap-3 rounded-lg border border-[rgba(var(--goldA),0.35)] bg-[rgba(var(--goldA),0.06)] px-3 py-2.5"
      >
        <span className="text-[14px] font-bold text-text">{copy.total}</span>
        <span className="text-[17px] font-extrabold tabular-nums text-gold-read">
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
