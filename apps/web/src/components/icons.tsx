/**
 * The customer site's icons, drawn here.
 *
 * ## Why they are authored and not installed
 *
 * The three icons this file started as lived inside `search-form.tsx`, with a comment giving the
 * reason: a package for a handful of glyphs costs a bundle, a lockfile entry and an audit surface
 * on the app with the strictest performance budget. That reasoning still holds; what changed is
 * that there are now icons on more than one screen, and two files each holding "the" stroke width
 * is how one of them ends up at 1.5 while the other is at 1.6 — a difference nobody can name and
 * everybody can see. `ICON` is the single spec, and every glyph below is built from it.
 *
 * ## Why they are not emoji
 *
 * The home page drew its stay types from `property_types.glyph`, which staff fill with 🏨 🏢 🏡.
 * An emoji is rendered by the OPERATING SYSTEM: it arrives in Apple's colour, Google's colour or
 * Microsoft's, at a weight and a palette this design does not choose, beside type it does not
 * match — seven of them in a row is seven different illustration styles. The named types are drawn
 * here instead, in one weight, in `currentColor`.
 *
 * **`glyph` is still read**, and that is deliberate rather than leftover: staff add property types
 * from the console, a type added next month has no drawing here, and falling back to the emoji
 * they chose is better than falling back to a shape that says nothing. `StayIcon` is the last
 * resort, for a type with no drawing AND no glyph.
 *
 * ## Sizing
 *
 * `1.15em`, so an icon tracks the type beside it rather than a pixel value that stops matching the
 * first time the label changes size. `aria-hidden` is set by the CALLER, because only the caller
 * knows whether the icon repeats a visible label or replaces one.
 */

/** The one spec. Every icon in this file spreads it and adds nothing but a path. */
const ICON = {
  width: '1.15em',
  height: '1.15em',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/* ── Search bar ──────────────────────────────────────────────────────────── */

export function PinIcon() {
  return (
    <svg {...ICON}>
      <path d="M20 10c0 5.2-8 12-8 12s-8-6.8-8-12a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="2.6" />
    </svg>
  );
}

export function GuestsIcon() {
  return (
    <svg {...ICON}>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
    </svg>
  );
}

/* ── What SAFRA is answerable for ────────────────────────────────────────── */

/** A shield with a check: nothing is listed before it has been verified. */
export function VerifiedIcon() {
  return (
    <svg {...ICON}>
      <path d="M12 2.8 5 5.6v5.6c0 4.4 2.9 7.7 7 9.6 4.1-1.9 7-5.2 7-9.6V5.6Z" />
      <path d="m8.9 11.9 2.2 2.2 4-4.4" />
    </svg>
  );
}

/** A card in a wallet: the money goes to SAFRA, not to the property. */
export function WalletIcon() {
  return (
    <svg {...ICON}>
      <path d="M3 8.2A2.2 2.2 0 0 1 5.2 6h11.3" />
      <rect x="2.4" y="8.2" width="19.2" height="11.4" rx="2.4" />
      <path d="M16.6 13.9h2.6" />
    </svg>
  );
}

/** A cycle around a plus: the compensation is added back, automatically. */
export function CompensationIcon() {
  return (
    <svg {...ICON}>
      <path d="M3.6 12a8.4 8.4 0 1 0 2.6-6.1" />
      <path d="M3.3 4.4v4.2h4.2" />
      <path d="M12 9.6v4.8M9.6 12h4.8" />
    </svg>
  );
}

/* ── Types of stay ───────────────────────────────────────────────────────── */

function HotelIcon() {
  return (
    <svg {...ICON}>
      <rect x="4.2" y="3.2" width="15.6" height="17.3" rx="1.6" />
      <path d="M2.2 20.5h19.6" />
      <path d="M7.8 7.3h1.8M14.4 7.3h1.8M7.8 11.3h1.8M14.4 11.3h1.8" />
      <path d="M10 20.5v-4.6h4v4.6" />
    </svg>
  );
}

function ApartmentIcon() {
  return (
    <svg {...ICON}>
      <rect x="3.6" y="2.8" width="8.6" height="17.7" rx="1.2" />
      <rect x="12.2" y="8.6" width="8.2" height="11.9" rx="1.2" />
      <path d="M6.3 6.6h3.2M6.3 10.6h3.2M6.3 14.6h3.2M14.9 12.6h2.8M14.9 16.6h2.8" />
      <path d="M2.2 20.5h19.6" />
    </svg>
  );
}

function VillaIcon() {
  return (
    <svg {...ICON}>
      <path d="M3.4 11.6 12 6.6l8.6 5" />
      <path d="M5.2 11.2v9.3h13.6v-9.3" />
      <path d="M8 20.5v-4.4h3.6v4.4" />
      <path d="M14.4 15.4h2.6" />
      <path d="M2.2 20.5h19.6" />
    </svg>
  );
}

function FarmIcon() {
  return (
    <svg {...ICON}>
      <path d="M2.6 11.9 9.2 6.9l6.6 5v8.6H2.6Z" />
      <path d="M6.4 20.5v-4.4h5.6v4.4" />
      <path d="M18 20.5v-8.3a1.9 1.9 0 0 1 3.8 0v8.3Z" />
      <path d="M18 15.1h3.8" />
    </svg>
  );
}

function ChaletIcon() {
  return (
    <svg {...ICON}>
      <path d="M12 3.4 3.2 11.6h17.6Z" />
      <path d="M5.6 11.6v8.9h12.8v-8.9" />
      <path d="M4.2 15.6h15.6" />
      <path d="M9.9 20.5v-4.2h4.2v4.2" />
    </svg>
  );
}

function RuralHouseIcon() {
  return (
    <svg {...ICON}>
      <path d="M2.9 11.9 12 4.4l9.1 7.5" />
      <path d="M5.4 10.2v10.3h13.2V10.2" />
      <path d="M9.9 20.5v-5.4h4.2v5.4" />
      <path d="M16.4 7.2V4.6h2.3v4.5" />
    </svg>
  );
}

function CampIcon() {
  return (
    <svg {...ICON}>
      <path d="M12 3.6 21 20.5H3Z" />
      <path d="M12 3.6v16.9" />
      <path d="m8.5 20.5 3.5-8.6 3.5 8.6" />
    </svg>
  );
}

/** The last resort: a bed. Used for a stay type nobody has drawn and nobody has given a glyph. */
export function StayIcon() {
  return (
    <svg {...ICON}>
      <path d="M2.8 18.4V7.6" />
      <path d="M2.8 12.4h18.4v6" />
      <path d="M21.2 15.4H2.8" />
      <path d="M6.6 12.4v-2.6h5.2v2.6" />
    </svg>
  );
}

/**
 * The drawings, keyed by the code the API sends.
 *
 * A `Record<string, …>` rather than a union of the seven codes that exist today: `property_types`
 * is a TABLE, staff add rows to it, and a map typed to the current contents would make adding a
 * kind of property a compile error in the customer app. The lookup answers `undefined` for a code
 * with no drawing, and the caller falls back — which is the behaviour a growing table needs.
 */
export const STAY_TYPE_ICONS: Record<string, () => React.JSX.Element> = {
  hotel: HotelIcon,
  apartment: ApartmentIcon,
  villa: VillaIcon,
  farm: FarmIcon,
  chalet: ChaletIcon,
  rural_house: RuralHouseIcon,
  camp: CampIcon,
};

/* ── Amenities ───────────────────────────────────────────────────────────────
 *
 * One drawing per amenity CODE, in the spec above.
 *
 * The property page carried a note explaining why it had no icons: the `amenities` catalogue has
 * an `icon` column, it is populated for 0 of 12 rows, and the honest alternatives were twelve
 * identical marks or none — twelve identical ticks being decoration pretending to be information.
 * Bashar asked for icons on 2026-09-11, and the answer that note anticipated is this one: draw
 * them, so each says what it means.
 *
 * Keyed by `code` rather than by the `icon` column, deliberately. That column would put the choice
 * in an operator's hands as a free-text name, where a typo is an invisible blank; a code is what
 * the catalogue already guarantees. An amenity added tomorrow gets `AmenityFallback` — a mark that
 * claims nothing — until somebody draws it.
 */

function WifiIcon() {
  return (
    <svg {...ICON}>
      <path d="M2.6 8.6a14.6 14.6 0 0 1 18.8 0" />
      <path d="M5.6 12.1a10.2 10.2 0 0 1 12.8 0" />
      <path d="M8.6 15.6a5.8 5.8 0 0 1 6.8 0" />
      <circle cx="12" cy="19.1" r="1.05" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** The universal parking mark: a P in a rounded square, which reads at 18px where a car does not. */
function ParkingIcon() {
  return (
    <svg {...ICON}>
      <rect x="3.4" y="3.4" width="17.2" height="17.2" rx="4.2" />
      <path d="M9.9 16.8V7.6h3.3a2.85 2.85 0 0 1 0 5.7H9.9" />
    </svg>
  );
}

function PoolIcon() {
  return (
    <svg {...ICON}>
      <path d="M8.2 15.2V6.6a2.4 2.4 0 0 1 4.8 0" />
      <path d="M8.2 10.3H13" />
      <path d="M2.8 18.4c1.45 0 1.45-1.15 2.9-1.15s1.45 1.15 2.9 1.15 1.45-1.15 2.9-1.15 1.45 1.15 2.9 1.15 1.45-1.15 2.9-1.15 1.45 1.15 2.9 1.15" />
    </svg>
  );
}

function BreakfastIcon() {
  return (
    <svg {...ICON}>
      <path d="M4.6 9.2h10.6v4.9a4.1 4.1 0 0 1-4.1 4.1H8.7a4.1 4.1 0 0 1-4.1-4.1Z" />
      <path d="M15.2 10.6h1.7a2.55 2.55 0 0 1 0 5.1h-1.7" />
      <path d="M3.4 20.6h13.2" />
      <path d="M8.1 6.2c0-.85.95-.85.95-1.8M11.6 6.2c0-.85.95-.85.95-1.8" />
    </svg>
  );
}

function AirConditioningIcon() {
  return (
    <svg {...ICON}>
      <path d="M12 2.9v18.2M4.1 7.4l15.8 9.2M19.9 7.4 4.1 16.6" />
      <path d="m9.8 4.7 2.2 1.9 2.2-1.9M9.8 19.3l2.2-1.9 2.2 1.9" />
    </svg>
  );
}

function KitchenIcon() {
  return (
    <svg {...ICON}>
      <path d="M5 10.2h14v4.6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4Z" />
      <path d="M3.2 10.2h17.6" />
      <path d="M8.8 7.4V5.2M12 7.4V5.2M15.2 7.4V5.2" />
    </svg>
  );
}

function HeatingIcon() {
  return (
    <svg {...ICON}>
      <rect x="4.4" y="5.8" width="15.2" height="11.4" rx="2.2" />
      <path d="M8.2 5.8v11.4M12 5.8v11.4M15.8 5.8v11.4" />
      <path d="M7 19.6v1.6M17 19.6v1.6" />
    </svg>
  );
}

/** A clock, not a bell: the label already says «استقبال», and what it adds is «24 ساعة». */
function ReceptionIcon() {
  return (
    <svg {...ICON}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 6.9V12l3.3 2.1" />
    </svg>
  );
}

function SeaViewIcon() {
  return (
    <svg {...ICON}>
      <circle cx="12" cy="8.4" r="3.3" />
      <path d="M2.8 17c1.45 0 1.45-1.15 2.9-1.15S7.15 17 8.6 17s1.45-1.15 2.9-1.15S12.95 17 14.4 17s1.45-1.15 2.9-1.15S18.75 17 20.2 17" />
      <path d="M2.8 20.6c1.45 0 1.45-1.15 2.9-1.15s1.45 1.15 2.9 1.15 1.45-1.15 2.9-1.15 1.45 1.15 2.9 1.15 1.45-1.15 2.9-1.15 1.45 1.15 2.9 1.15" />
    </svg>
  );
}

function PetsIcon() {
  return (
    <svg {...ICON}>
      <ellipse cx="7.2" cy="9.4" rx="1.75" ry="2.25" />
      <ellipse cx="12" cy="7.7" rx="1.85" ry="2.45" />
      <ellipse cx="16.8" cy="9.4" rx="1.75" ry="2.25" />
      <path d="M12 12.6c-2.8 0-5.1 2-5.1 4.2 0 1.6 1.3 2.6 2.9 2.6h4.4c1.6 0 2.9-1 2.9-2.6 0-2.2-2.3-4.2-5.1-4.2Z" />
    </svg>
  );
}

function FamilyIcon() {
  return (
    <svg {...ICON}>
      <circle cx="8.4" cy="6.4" r="2.3" />
      <path d="M4.8 20.4v-4.3a3.6 3.6 0 0 1 7.2 0v4.3" />
      <circle cx="16.9" cy="10.2" r="1.8" />
      <path d="M14.1 20.4v-3.2a2.8 2.8 0 0 1 5.6 0v3.2" />
    </svg>
  );
}

function AccessibleIcon() {
  return (
    <svg {...ICON}>
      <circle cx="12.7" cy="4.5" r="1.95" />
      <path d="M10.9 8.2v4.6h4.4l2.5 5.5" />
      <path d="M15.4 14.6a5.2 5.2 0 1 1-5.7-3.2" />
    </svg>
  );
}

/** An amenity with no drawing yet. A ring claims nothing, which is the point. */
function AmenityFallback() {
  return (
    <svg {...ICON}>
      <circle cx="12" cy="12" r="4.2" />
    </svg>
  );
}

const AMENITY_ICONS: Record<string, () => React.JSX.Element> = {
  wifi: WifiIcon,
  parking: ParkingIcon,
  pool: PoolIcon,
  breakfast: BreakfastIcon,
  air_conditioning: AirConditioningIcon,
  kitchen: KitchenIcon,
  heating: HeatingIcon,
  reception_24h: ReceptionIcon,
  sea_view: SeaViewIcon,
  pets_allowed: PetsIcon,
  family_friendly: FamilyIcon,
  accessible: AccessibleIcon,
};

/**
 * The drawing for one amenity code.
 *
 * `aria-hidden` is the caller's to set, per this file's convention — here the label sits beside it,
 * so the icon repeats what a screen reader already reads and must be hidden from one.
 */
export function AmenityIcon({ code }: { readonly code: string }) {
  const Glyph = AMENITY_ICONS[code] ?? AmenityFallback;

  return <Glyph />;
}
