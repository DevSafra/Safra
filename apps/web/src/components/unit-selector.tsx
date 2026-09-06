'use client';

import { useBookingSelection, type ChosenRoom } from '@/components/booking-selection';

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
  readonly amenityNames: readonly string[];
  readonly perNightText: string;
  /** Three lines that add to the total — see `ChosenRoom`. */
  readonly roomLineLabel: string;
  readonly roomLineAmount: string;
  readonly feeAmount: string;
  readonly totalText: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly nightsText: string;
  readonly maxGuests: number;
  readonly minNights: number;
  readonly capacityText: string;
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
    readonly chosen: string;
    readonly cheapest: string;
    readonly soldOut: string;
    readonly amenitiesLabel: string;
    readonly amenitiesNone: string;
    readonly cancellation: string;
  };
}) {
  const { chosen, choose } = useBookingSelection();

  if (rooms.length === 0) return null;

  const many = rooms.length > 1;

  return (
    <section id="units" className="scroll-mt-24">
      <h2 className="font-display text-xl text-text">{copy.title}</h2>
      <p className="mt-1 text-sm text-muted">{many ? copy.note : copy.one}</p>

      <ul className="mt-4 grid gap-3">
        {rooms.map((room) => {
          const isChosen = chosen?.unitId === room.unitId;

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
                isChosen
                  ? 'border-gold bg-[rgba(var(--goldA),0.05)]'
                  : 'border-line bg-card'
              }`}
            >
              <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className="font-display text-lg text-text">{room.name}</h3>
                    {many && room.cheapest ? (
                      <span className="rounded-full border border-[rgba(var(--goldA),0.4)] px-2 py-0.5 text-[11px] font-semibold text-gold">
                        {copy.cheapest}
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-1.5 text-sm text-muted">{room.occupancyText}</p>

                  {room.leftText ? (
                    <p className="mt-1 text-xs font-semibold text-gold">
                      {room.leftText}
                    </p>
                  ) : null}

                  <p className="mt-1 text-xs text-faint">{room.termsText}</p>
                  <p className="mt-1 text-xs text-faint">
                    {copy.cancellation}: {room.policyText}
                  </p>

                  <div className="mt-3">
                    <h4 className="text-[12px] font-semibold text-text2">
                      {copy.amenitiesLabel}
                    </h4>
                    {room.amenityNames.length > 0 ? (
                      <ul className="mt-1.5 flex flex-wrap gap-1.5">
                        {room.amenityNames.map((name) => (
                          <li
                            key={name}
                            className="rounded-lg border border-line2 px-2.5 py-1 text-[12.5px] text-text2"
                          >
                            {name}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-[12.5px] text-faint">
                        {copy.amenitiesNone}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-col items-stretch gap-2 sm:w-44 sm:items-end">
                  <p className="text-lg font-extrabold tabular-nums text-gold sm:text-end">
                    {room.perNightText}
                  </p>

                  {room.soldOut ? (
                    /*
                      Described, not offered. The type stays on the page — a guest who cannot see
                      the suite does not learn the hotel has one — but nothing here pretends it can
                      be booked, which is what a link to a taken room did.
                    */
                    <p className="text-center text-sm font-semibold text-warn sm:text-end">
                      {copy.soldOut}
                    </p>
                  ) : (
                    <button
                      type="button"
                      aria-pressed={isChosen}
                      onClick={() => choose(toChosen(room))}
                      className={`block w-full cursor-pointer rounded-lg px-4 py-2.5 text-center text-sm font-semibold transition-opacity hover:opacity-90 ${
                        isChosen
                          ? 'border border-gold bg-[rgba(var(--goldA),0.15)] text-gold'
                          : 'btn-gold'
                      }`}
                    >
                      {isChosen ? copy.chosen : copy.book}
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

/** What the card needs, taken from what the row already displayed. */
function toChosen(room: RoomView): ChosenRoom {
  return {
    unitId: room.unitId,
    name: room.name,
    maxGuests: room.maxGuests,
    minNights: room.minNights,
    capacityText: room.capacityText,
    amenityNames: room.amenityNames,
    roomLineLabel: room.roomLineLabel,
    roomLineAmount: room.roomLineAmount,
    feeAmount: room.feeAmount,
    total: room.totalText,
    checkIn: room.checkIn,
    checkOut: room.checkOut,
    nightsText: room.nightsText,
    policyText: room.policyText,
  };
}
