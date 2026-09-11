'use client';

import { AmenityIcon } from '@/components/icons';
import { useBookingSelection, type BasketRoom } from '@/components/booking-selection';

/**
 * One room type, prepared by the server.
 *
 * ## Why a view model rather than the raw units
 *
 * This is a client component — it has to be, because choosing a room updates the card beside it —
 * and a server component may not pass FUNCTIONS across that boundary. Every price here is currency
 * converted and fee-inclusive, every count is pluralised into Arabic's six forms, and every amenity
 * code is resolved to a word: all things the page already does with the fee rule, the FX rates and
 * the catalogues in hand.
 *
 * Doing it server-side is also why a row and the summary card can never print two different numbers
 * for one stay — there is one calculation, and both read its result.
 */
export interface RoomView {
  readonly unitId: string;
  readonly name: string;
  /** The cheapest room of the property, named as such only when there is something to be cheaper than. */
  readonly cheapest: boolean;
  readonly soldOut: boolean;
  /** «٦ غرف متبقية», or null when this is the only one of its kind. */
  readonly leftText: string | null;
  readonly occupancyText: string;
  readonly termsText: string;
  readonly policyText: string;
  /**
   * The CODE beside the name, because the chip draws an icon from it.
   *
   * It was `readonly string[]` — names only, resolved on the server where the catalogue lives. The
   * name still is; what the code adds is the one thing a translated string cannot carry, which is
   * which amenity it is.
   */
  readonly amenities: readonly { readonly code: string; readonly name: string }[];
  readonly perNightText: string;
  /** «$72 لليلة · ليلتان» — how the headline total was reached. */
  readonly stayCaption: string;
  /** Three lines that add to the total — see `ChosenRoom`. */
  readonly roomLineLabel: string;
  readonly roomLineAmount: string;
  readonly feeAmount: string;
  readonly totalText: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly checkInText: string;
  readonly checkOutText: string;
  readonly nights: number;
  readonly nightsText: string;
  readonly maxGuests: number;
  readonly minNights: number;
  readonly capacityText: string;
  readonly maxRooms: number;
  /** Whole-stay accommodation for ONE room, in the unit's own currency. */
  readonly perRoomAmount: string;
  readonly currencyCode: string;
  /** True when this type's minimum stay is longer than the window the guest asked for. */
  readonly tooShort: boolean;
  readonly tooShortText: string | null;
}

/**
 * The rooms a guest chooses between, and the point at which they choose one.
 *
 * ## Choosing is not booking
 *
 * Pressing a room used to go straight to checkout, so a guest committed to a price they had only
 * glanced at in a row. It now fills the summary card beside the page and «احجز الآن» there is the
 * commitment — two acts, which is how every hotel site a guest has already used behaves.
 *
 * ## Interchangeable rooms are ONE row, with a count
 *
 * A hotel with six identical doubles is six rows in `units` — one per physical room, because the
 * exclusion constraint keys on `unit_id`. That is right in the database and wrong on a page: a
 * guest met six indistinguishable «غرفة مزدوجة قياسية» and picked one at random. The grouping is
 * done server-side; what arrives here is one entry per type with the number still free.
 */
export function UnitSelector({
  rooms,
  copy,
}: {
  readonly rooms: readonly RoomView[];
  readonly copy: {
    readonly title: string;
    readonly note: string;
    readonly one: string;
    readonly book: string;
    /** «في الحجز · غرفتان», indexed by the count. See the card's note on why not a function. */
    readonly inBasketTexts: readonly string[];
    readonly cheapest: string;
    readonly soldOut: string;
    readonly amenitiesLabel: string;
    readonly amenitiesNone: string;
    readonly cancellation: string;
    readonly stayTotalLabel: string;
  };
}) {
  const { add, countOf, hasRoom } = useBookingSelection();

  if (rooms.length === 0) return null;

  const many = rooms.length > 1;

  return (
    <section id="units" className="scroll-mt-24">
      <h2 className="font-display text-xl text-text">{copy.title}</h2>
      <p className="mt-1 text-sm text-muted">{many ? copy.note : copy.one}</p>

      <ul className="mt-4 grid gap-3">
        {rooms.map((room) => {
          /* How many of this type are already in the basket, if any. */
          const inBasket = countOf(room.unitId);

          return (
            <li
              key={room.unitId}
              /*
                A bordered row, not a card in a grid of cards. These are compared against each other
                down a single column — occupancy under occupancy, price under price — which a row
                does and a tile does not. The chosen one is marked on the row as well as in the card,
                so a guest scrolling the list can see where their choice came from.
              */
              className={`rounded-card border p-4 transition-colors sm:p-5 ${
                inBasket > 0
                  ? 'border-gold bg-[rgba(var(--goldA),0.05)]'
                  : 'border-line bg-card'
              }`}
            >
              <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className="font-display text-lg text-text">{room.name}</h3>
                    {many && room.cheapest ? (
                      <span className="rounded-full border border-[rgba(var(--goldA),0.4)] px-2 py-0.5 text-[13px] font-semibold text-gold-read">
                        {copy.cheapest}
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-1.5 text-sm text-muted">{room.occupancyText}</p>

                  {room.leftText ? (
                    <p className="mt-1 text-xs font-semibold text-gold-read">
                      {room.leftText}
                    </p>
                  ) : null}

                  <p className="mt-1 text-xs text-faint">{room.termsText}</p>
                  <p className="mt-1 text-xs text-faint">
                    {copy.cancellation}: {room.policyText}
                  </p>

                  {/*
                    Chips with no heading of their own.

                    «مرافق هذه الوحدة» above two pills cost a whole line in every row and told a
                    reader nothing they could not see — a kettle and a balcony announce themselves.
                    The label survives as `aria-label`, so the list is still named for anybody who
                    cannot see the shape of it.

                    Each chip carries its own drawing (Bashar, 2026-09-11), from the same set the
                    building's list uses — so «تكييف» is one mark whether it belongs to the room or
                    to the hotel, which is the whole reason to key icons by code rather than draw
                    them per screen.
                  */}
                  {room.amenities.length > 0 ? (
                    <ul
                      aria-label={copy.amenitiesLabel}
                      className="mt-2.5 flex flex-wrap gap-1.5"
                    >
                      {room.amenities.map((amenity) => (
                        <li
                          key={amenity.code}
                          className="flex items-center gap-1.5 rounded-lg border border-line2 px-2.5 py-1 text-[14px] text-text2"
                        >
                          {/*
                            `aria-hidden`, like the building's list: the name is in the same chip,
                            and a reader hearing «تكييف تكييف» is worse served than one hearing it
                            once. The drawings are the same set, so a room's air conditioning and
                            the building's are the same mark.
                          */}
                          <span aria-hidden className="shrink-0 text-gold-read">
                            <AmenityIcon code={amenity.code} />
                          </span>
                          {amenity.name}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2.5 text-[14px] text-faint">{copy.amenitiesNone}</p>
                  )}
                </div>

                {/*
                  The price column, divided from the description rather than boxed inside it.

                  A bordered panel here would be a card inside a card. A single logical border does
                  the same separating work, and it only appears from `sm` up — below that the row is
                  one column and a divider across it would read as a horizontal rule.
                */}
                <div className="flex flex-col items-stretch gap-1 border-line2 sm:w-48 sm:items-end sm:border-s sm:ps-5">
                  {/*
                    THE STAY TOTAL, not the nightly rate.

                    «الأسعار للمدة المختارة» sits at the top of this list promising exactly that, and
                    the figure under it was per-night: a two-night search showed «$73.99» on a room
                    that costs $145.99. They agreed only for one-night stays, which is why the page
                    looked right. The nightly rate stays underneath, because it is how a guest
                    compares rooms — it just is not the number the sentence above promised.
                  */}
                  <span className="text-[13px] text-faint sm:text-end">
                    {copy.stayTotalLabel}
                  </span>
                  <p className="text-xl font-extrabold tabular-nums text-gold sm:text-end">
                    {room.totalText}
                  </p>
                  <p className="text-[13px] text-muted sm:text-end">{room.stayCaption}</p>

                  {room.tooShort ? (
                    /*
                      Shown, and not addable — with the reason.

                      A booking has ONE stay, so a suite that takes two nights cannot join a
                      one-night basket. Hiding it would tell a guest the hotel has no suite;
                      offering a control that checkout refuses is the failure this review keeps
                      finding. So the row states the minimum and what to do about it, and the room
                      stays visible because knowing it exists is worth something.
                    */
                    <p className="mt-2 text-center text-[13px] font-semibold leading-relaxed text-warn sm:text-end">
                      {room.tooShortText}
                    </p>
                  ) : room.soldOut ? (
                    /*
                      Described, not offered. The type stays on the page — a guest who cannot see
                      the suite does not learn the hotel has one — but nothing here pretends it can
                      be booked, which is what a link to a taken room did.
                    */
                    <p className="mt-2 text-center text-sm font-semibold text-warn sm:text-end">
                      {copy.soldOut}
                    </p>
                  ) : (
                    /*
                      SECONDARY, deliberately.

                      Four filled gold buttons down one column gave the page four primary actions
                      and no hierarchy — and none of them is the primary action anyway: this one
                      CHOOSES a room, and «احجز الآن» in the summary commits to it. One filled
                      button on the page, and it is the one that spends money.
                    */
                    /*
                      ADDS to the basket rather than replacing it.

                      It used to be a link to checkout, then a control that selected one room and
                      discarded whatever was chosen before — so a family needing two doubles and a
                      suite lost the doubles the moment they added the suite. Pressing it again
                      adds another of the same type, which is what «أضف» means on a basket.

                      Disabled at the basket's own ceiling rather than silently doing nothing: the
                      row says why, because a control that stops answering reads as broken.
                    */
                    <button
                      type="button"
                      disabled={!hasRoom && inBasket === 0}
                      onClick={() => add(toBasketRoom(room))}
                      className={`mt-2 block w-full cursor-pointer rounded-lg border px-4 py-2.5 text-center text-sm font-semibold transition-colors duration-200 ease-out-strong active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${
                        inBasket > 0
                          ? 'border-gold bg-[rgba(var(--goldA),0.15)] text-gold-read'
                          : 'border-[rgba(var(--goldA),0.45)] text-gold-read hover:bg-[rgba(var(--goldA),0.08)]'
                      }`}
                    >
                      {inBasket > 0
                        ? (copy.inBasketTexts[inBasket] ?? copy.book)
                        : copy.book}
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** What the basket needs, taken from what the row already displayed. */
function toBasketRoom(room: RoomView): BasketRoom {
  return {
    unitId: room.unitId,
    name: room.name,
    maxGuests: room.maxGuests,
    minNights: room.minNights,
    maxRooms: room.maxRooms,
    /*
      The unit's OWN currency, unconverted. The basket adds the lines up and converts once at the
      end — converting each line and adding the results rounds per line and disagrees with the
      charge.
    */
    perRoomAmount: room.perRoomAmount,
    currencyCode: room.currencyCode,
    policyText: room.policyText,
    amenities: room.amenities,
  };
}
