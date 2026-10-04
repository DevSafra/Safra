/**
 * The six service drawings on the home page (Bashar, 2026-10-04: «Draw gold vector icons», in
 * place of the rendered 3D gold of screenshot «14.59.04»).
 *
 * ## Gold as a material, not a flat colour
 *
 * The reference's objects are gold you could pick up, so each drawing is lit: a vertical
 * gradient from a pale top to a deep base, a darker edge, and a soft white sheen on the faces
 * that would catch the light. One palette for all six, written once below, because six golds that
 * differ slightly read as six suppliers.
 *
 * Fixed values rather than theme tokens, deliberately: this is an illustration, and the metal
 * reads the same on the white card and the night one. Both were measured against the card.
 *
 * ## Gradient ids
 *
 * Every drawing names its own (`svc-<code>-…`), and each appears once on the page. A shared id
 * would make whichever `<defs>` came first paint all six.
 */
export type ServiceCode = 'rides' | 'stay' | 'medical' | 'trips' | 'umrah' | 'realEstate';

const GOLD = {
  light: '#fbe3a6',
  mid: '#e6b04a',
  deep: '#b07a22',
  edge: '#7e5414',
} as const;

function Metal({ id }: { readonly id: string }) {
  return (
    <defs>
      <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={GOLD.light} />
        <stop offset="0.45" stopColor={GOLD.mid} />
        <stop offset="1" stopColor={GOLD.deep} />
      </linearGradient>
      <linearGradient id={`${id}-shade`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={GOLD.mid} />
        <stop offset="1" stopColor={GOLD.edge} />
      </linearGradient>
    </defs>
  );
}

function Frame({
  id,
  className,
  children,
}: {
  readonly id: string;
  readonly className?: string | undefined;
  readonly children: React.ReactNode;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
      focusable="false"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <Metal id={id} />
      {children}
    </svg>
  );
}

const SHEEN = { fill: '#ffffff', opacity: 0.35 } as const;

function Rides({ className }: { readonly className?: string | undefined }) {
  const id = 'svc-rides';
  return (
    <Frame id={id} className={className}>
      {/* Wheels first, under the body. */}
      <rect x="11" y="40" width="10" height="13" rx="3" fill={GOLD.edge} />
      <rect x="43" y="40" width="10" height="13" rx="3" fill={GOLD.edge} />
      {/* Mirrors. */}
      <ellipse cx="9" cy="27" rx="3.5" ry="2.2" fill={`url(#${id}-shade)`} />
      <ellipse cx="55" cy="27" rx="3.5" ry="2.2" fill={`url(#${id}-shade)`} />
      {/* Cabin and windscreen. */}
      <path
        d="M16 26 L20.5 15.5 Q22 12 26 12 H38 Q42 12 43.5 15.5 L48 26 Z"
        fill={`url(#${id}-gold)`}
        stroke={GOLD.edge}
        strokeWidth="1.2"
      />
      <path
        d="M20 25 L23.5 16.8 Q24.4 15 26.5 15 H37.5 Q39.6 15 40.5 16.8 L44 25 Z"
        fill={GOLD.deep}
      />
      <path d="M23 24 L25.6 17.6 Q26.1 16.6 27.4 16.6 H31 L27 24 Z" {...SHEEN} />
      {/* Body. */}
      <rect
        x="7"
        y="24"
        width="50"
        height="20"
        rx="8"
        fill={`url(#${id}-gold)`}
        stroke={GOLD.edge}
        strokeWidth="1.2"
      />
      <rect x="10" y="26" width="44" height="4" rx="2" {...SHEEN} />
      {/* Headlamps and grille. */}
      <circle
        cx="15.5"
        cy="34"
        r="3.6"
        fill={GOLD.light}
        stroke={GOLD.edge}
        strokeWidth="1"
      />
      <circle
        cx="48.5"
        cy="34"
        r="3.6"
        fill={GOLD.light}
        stroke={GOLD.edge}
        strokeWidth="1"
      />
      <rect x="23" y="31.5" width="18" height="6" rx="2" fill={GOLD.deep} />
      <path d="M26 34.5h12" stroke={GOLD.light} strokeWidth="1" opacity="0.7" />
    </Frame>
  );
}

function Stay({ className }: { readonly className?: string | undefined }) {
  const id = 'svc-stay';
  const star = (cx: number, cy: number, r: number) => {
    const points = Array.from({ length: 10 }, (_, i) => {
      const angle = (Math.PI / 5) * i - Math.PI / 2;
      const radius = i % 2 === 0 ? r : r * 0.45;
      return `${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`;
    });
    return (
      <polygon
        points={points.join(' ')}
        fill={`url(#${id}-gold)`}
        stroke={GOLD.edge}
        strokeWidth="0.8"
      />
    );
  };
  return (
    <Frame id={id} className={className}>
      {star(21, 9.5, 4.2)}
      {star(32, 6.5, 4.8)}
      {star(43, 9.5, 4.2)}
      <rect
        x="17"
        y="16"
        width="30"
        height="40"
        rx="2"
        fill={`url(#${id}-gold)`}
        stroke={GOLD.edge}
        strokeWidth="1.2"
      />
      <rect x="19" y="18" width="5" height="36" rx="1" {...SHEEN} />
      {/* Windows: three across, four up. */}
      {[21.5, 30, 38.5].flatMap((x) =>
        [20.5, 27.5, 34.5, 41.5].map((y) => (
          <rect
            key={`${x}-${y}`}
            x={x}
            y={y}
            width="4.5"
            height="4.5"
            rx="0.8"
            fill={GOLD.deep}
          />
        )),
      )}
      {/* Door. */}
      <rect x="28.5" y="47" width="7" height="9" rx="1" fill={GOLD.edge} />
      {/* The plinth it stands on. */}
      <rect x="11" y="55" width="42" height="4" rx="2" fill={`url(#${id}-shade)`} />
    </Frame>
  );
}

function Medical({ className }: { readonly className?: string | undefined }) {
  const id = 'svc-medical';
  return (
    <Frame id={id} className={className}>
      <path
        d="M32 56 C14 44 6 34 6 23.5 C6 15 12.5 9 20.5 9 C25.6 9 29.6 11.8 32 15.8 C34.4 11.8 38.4 9 43.5 9 C51.5 9 58 15 58 23.5 C58 34 50 44 32 56 Z"
        fill={`url(#${id}-gold)`}
        stroke={GOLD.edge}
        strokeWidth="1.2"
      />
      <path
        d="M11 22 C11 16.5 15 13 20 13 C23 13 25.5 14.3 27 16.5 C21 16 15 18.5 11 22 Z"
        {...SHEEN}
      />
      {/* The cross, white as the reference draws it. */}
      <path
        d="M28.5 20 h7 v7.5 h7.5 v7 h-7.5 v7.5 h-7 v-7.5 H21 v-7 h7.5 Z"
        fill="#ffffff"
        stroke={GOLD.edge}
        strokeWidth="0.8"
      />
    </Frame>
  );
}

function Trips({ className }: { readonly className?: string | undefined }) {
  const id = 'svc-trips';
  return (
    <Frame id={id} className={className}>
      <rect
        x="4"
        y="15"
        width="56"
        height="31"
        rx="6"
        fill={`url(#${id}-gold)`}
        stroke={GOLD.edge}
        strokeWidth="1.2"
      />
      <rect x="6" y="17" width="52" height="3" rx="1.5" {...SHEEN} />
      {/* Side windows, then the windscreen at the front. */}
      {[8, 18, 28, 38].map((x) => (
        <rect key={x} x={x} y="21" width="8" height="10" rx="1.5" fill={GOLD.deep} />
      ))}
      <path d="M48 21 H54 Q57 21 57 24 V31 H48 Z" fill={GOLD.deep} />
      <rect x="4" y="34" width="56" height="3" fill={GOLD.deep} opacity="0.55" />
      <rect x="55" y="39" width="4" height="3" rx="1" fill={GOLD.light} />
      {/* Wheels. */}
      {[17, 47].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="46" r="6.5" fill={GOLD.edge} />
          <circle cx={cx} cy="46" r="2.8" fill={GOLD.mid} />
        </g>
      ))}
    </Frame>
  );
}

function Umrah({ className }: { readonly className?: string | undefined }) {
  const id = 'svc-umrah';
  return (
    <Frame id={id} className={className}>
      {/* Top, front and side faces, lit from above and the left. */}
      <path
        d="M12 21 L28 14 L53 18.5 L37 26 Z"
        fill={GOLD.light}
        stroke={GOLD.edge}
        strokeWidth="1.2"
      />
      <path
        d="M12 21 L37 26 V57 L12 52 Z"
        fill={`url(#${id}-gold)`}
        stroke={GOLD.edge}
        strokeWidth="1.2"
      />
      <path
        d="M37 26 L53 18.5 V49.5 L37 57 Z"
        fill={`url(#${id}-shade)`}
        stroke={GOLD.edge}
        strokeWidth="1.2"
      />
      {/* The band round the upper third. */}
      <path
        d="M12 27 L37 32 V36.5 L12 31.5 Z"
        fill={GOLD.light}
        stroke={GOLD.edge}
        strokeWidth="0.8"
      />
      <path
        d="M37 32 L53 24.5 V29 L37 36.5 Z"
        fill={GOLD.mid}
        stroke={GOLD.edge}
        strokeWidth="0.8"
      />
      {[16, 21, 26, 31].map((x, i) => (
        <circle key={x} cx={x} cy={29.6 + i * 0.95} r="0.8" fill={GOLD.deep} />
      ))}
      {/* The door, raised on the front face. */}
      <path
        d="M21 41 L29 42.6 V55.4 L21 53.8 Z"
        fill={GOLD.light}
        stroke={GOLD.edge}
        strokeWidth="1"
      />
      <path d="M14 34 L17 34.6 V49 L14 48.4 Z" {...SHEEN} />
    </Frame>
  );
}

function RealEstate({ className }: { readonly className?: string | undefined }) {
  const id = 'svc-realestate';
  return (
    <Frame id={id} className={className}>
      <rect
        x="41"
        y="11"
        width="6.5"
        height="12"
        rx="1"
        fill={`url(#${id}-shade)`}
        stroke={GOLD.edge}
        strokeWidth="1"
      />
      <rect
        x="14"
        y="29"
        width="36"
        height="27"
        rx="1.5"
        fill={`url(#${id}-gold)`}
        stroke={GOLD.edge}
        strokeWidth="1.2"
      />
      <path
        d="M5 31.5 L32 8 L59 31.5 L54 36 L32 17 L10 36 Z"
        fill={`url(#${id}-gold)`}
        stroke={GOLD.edge}
        strokeWidth="1.2"
      />
      <path d="M12 30.5 L32 13 L34.5 15 L14.5 32.5 Z" {...SHEEN} />
      {/* The window, with its cross. */}
      <rect
        x="24"
        y="35"
        width="16"
        height="15"
        rx="1.5"
        fill={GOLD.light}
        stroke={GOLD.edge}
        strokeWidth="1.2"
      />
      <path d="M32 35 V50 M24 42.5 H40" stroke={GOLD.edge} strokeWidth="1.6" />
      <rect x="11" y="55" width="42" height="3.5" rx="1.75" fill={`url(#${id}-shade)`} />
    </Frame>
  );
}

const DRAWINGS: Record<
  ServiceCode,
  (props: { className?: string | undefined }) => React.ReactElement
> = {
  rides: Rides,
  stay: Stay,
  medical: Medical,
  trips: Trips,
  umrah: Umrah,
  realEstate: RealEstate,
};

export function ServiceIcon({
  code,
  className,
}: {
  readonly code: ServiceCode;
  readonly className?: string;
}) {
  const Drawing = DRAWINGS[code];
  return <Drawing className={className} />;
}
