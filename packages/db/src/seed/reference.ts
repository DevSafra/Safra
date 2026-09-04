/**
 * Reference data seed — the rows the platform cannot function without.
 *
 * This is NOT demo content. Currencies, countries, cities, property types,
 * amenities and cancellation policies are all admin-editable tables (P-005), so
 * this file only establishes the launch baseline the SRS specifies. Everything
 * here is idempotent on its natural key, so re-running a deploy is safe.
 *
 * Cities carry a real IANA timezone because the same-day booking cutoff (§5.3) is
 * 17:00 in the CITY's local time — not the server's and not the visitor's.
 */

export interface CurrencySeed {
  code: string;
  nameAr: string;
  nameEn: string;
  nameDe: string;
  symbol: string;
  decimals: number;
}

/**
 * §1.4: SYP is the internal accounting currency; USD is the pricing anchor.
 *
 * ## Three, and only three (Bashar, 2026-08-30)
 *
 * JOD and LBP were seeded and neither could ever price anything: `fx_rates` holds one pair,
 * USD→SYP, and `rateBetween` REFUSES rather than defaulting to 1 for a pair it cannot reach. So a
 * Jordanian visitor met «الأردن · JOD» on the geography screen and a booking that could not be
 * quoted — a currency offered by the platform and refused by it. Bashar had already said not to
 * invent rates for them; this removes the offer instead.
 *
 * They are not deleted from an existing database — `0017_currencies_syp_usd_eur.sql` retires them
 * with `deleted_at`, because a row is cheaper to keep than a foreign key is to unpick, and nothing
 * referenced either beyond Jordan's display currency.
 */
export const CURRENCIES: CurrencySeed[] = [
  {
    code: 'SYP',
    nameAr: 'ليرة سورية',
    nameEn: 'Syrian Pound',
    nameDe: 'Syrisches Pfund',
    symbol: 'ل.س',
    decimals: 2,
  },
  {
    code: 'USD',
    nameAr: 'دولار أمريكي',
    nameEn: 'US Dollar',
    nameDe: 'US-Dollar',
    symbol: '$',
    decimals: 2,
  },
  {
    code: 'EUR',
    nameAr: 'يورو',
    nameEn: 'Euro',
    nameDe: 'Euro',
    symbol: '€',
    decimals: 2,
  },
];

export interface CountrySeed {
  code: string;
  nameAr: string;
  nameEn: string;
  nameDe: string;
  displayCurrency: string;
  isLaunchMarket: boolean;
}

/** §1.3: Syria, Jordan and Lebanon at launch. Others are explicitly out of scope. */
export const COUNTRIES: CountrySeed[] = [
  {
    code: 'SY',
    nameAr: 'سوريا',
    nameEn: 'Syria',
    nameDe: 'Syrien',
    displayCurrency: 'USD',
    isLaunchMarket: true,
  },
  {
    code: 'JO',
    nameAr: 'الأردن',
    nameEn: 'Jordan',
    nameDe: 'Jordanien',
    /* USD, like the other two: JOD has no rate and cannot price a booking. See `CURRENCIES`. */
    displayCurrency: 'USD',
    isLaunchMarket: true,
  },
  {
    code: 'LB',
    nameAr: 'لبنان',
    nameEn: 'Lebanon',
    nameDe: 'Libanon',
    displayCurrency: 'USD',
    isLaunchMarket: true,
  },
];

export type CityCategorySeed = 'coastal' | 'mountain' | 'desert' | 'historic';

export interface CitySeed {
  country: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  nameDe: string;
  timezone: string;
  categories: CityCategorySeed[];
  latitude: string;
  longitude: string;
  descriptionAr: string;
  tagsAr: string[];
  sortOrder: number;
}

/**
 * The nine cities from the approved prototype, with its Arabic copy preserved —
 * that text was signed off as part of the design and is the launch content.
 */
export const CITIES: CitySeed[] = [
  {
    country: 'SY',
    slug: 'damascus',
    nameAr: 'دمشق',
    nameEn: 'Damascus',
    nameDe: 'Damaskus',
    timezone: 'Asia/Damascus',
    categories: ['historic'],
    latitude: '33.5138',
    longitude: '36.2765',
    descriptionAr:
      'أقدم عاصمة مأهولة في العالم. أزقة المدينة القديمة، بيوت عربية بباحات داخلية، وياسمين يتسلق الجدران. الإقامات تتنوع بين فنادق تراثية وشقق مفروشة قرب باب توما والشعلان.',
    tagsAr: ['المدينة القديمة', 'سوق الحميدية', 'الجامع الأموي', 'جبل قاسيون'],
    sortOrder: 1,
  },
  {
    country: 'SY',
    slug: 'aleppo',
    nameAr: 'حلب',
    nameEn: 'Aleppo',
    nameDe: 'Aleppo',
    timezone: 'Asia/Damascus',
    categories: ['historic'],
    latitude: '36.2021',
    longitude: '37.1343',
    descriptionAr:
      'مدينة القلعة والأسواق المسقوفة. بيوت حلبية تراثية رُمّمت بعناية تستقبل الضيوف حول باحاتها، ومطبخ يُعد الأشهر في المشرق.',
    tagsAr: ['القلعة', 'الأسواق المسقوفة', 'بيوت الأجنحة', 'المطبخ الحلبي'],
    sortOrder: 2,
  },
  {
    country: 'SY',
    slug: 'latakia',
    nameAr: 'اللاذقية',
    nameEn: 'Latakia',
    nameDe: 'Latakia',
    timezone: 'Asia/Damascus',
    categories: ['coastal'],
    latitude: '35.5317',
    longitude: '35.7915',
    descriptionAr:
      'عاصمة الساحل السوري. فلل وشاليهات على البحر مباشرة، وقرب من غابات صلنفة وكسب لمن يريد الجمع بين البحر والجبل في رحلة واحدة.',
    tagsAr: ['الشاطئ الأزرق', 'أوغاريت', 'الكورنيش الجنوبي'],
    sortOrder: 3,
  },
  {
    country: 'SY',
    slug: 'tartus',
    nameAr: 'طرطوس',
    nameEn: 'Tartus',
    nameDe: 'Tartus',
    timezone: 'Asia/Damascus',
    categories: ['coastal'],
    latitude: '34.8890',
    longitude: '35.8866',
    descriptionAr:
      'مدينة ساحلية هادئة قبالة جزيرة أرواد. شاليهات عائلية وشقق مطلة على الميناء، وأسعار ألطف من جارتها الشمالية.',
    tagsAr: ['جزيرة أرواد', 'الكورنيش', 'المدينة القديمة'],
    sortOrder: 4,
  },
  {
    country: 'SY',
    slug: 'kasab',
    nameAr: 'كسب',
    nameEn: 'Kasab',
    nameDe: 'Kasab',
    timezone: 'Asia/Damascus',
    categories: ['mountain'],
    latitude: '35.9333',
    longitude: '35.9833',
    descriptionAr:
      'بلدة جبلية على الحدود الشمالية تغفو بين غابات الصنوبر والغار. مزارع وبيوت ريفية بإطلالات على البحر من علوّ 800 متر — وجهة شهر العسل الأولى.',
    tagsAr: ['غابات الصنوبر', 'الضباب الصباحي', 'مسارات المشي'],
    sortOrder: 5,
  },
  {
    country: 'SY',
    slug: 'palmyra',
    nameAr: 'تدمر',
    nameEn: 'Palmyra',
    nameDe: 'Palmyra',
    timezone: 'Asia/Damascus',
    categories: ['desert', 'historic'],
    latitude: '34.5520',
    longitude: '38.2687',
    descriptionAr:
      'عروس الصحراء وممر القوافل القديم. مخيمات نجمية بين النخيل والأعمدة، حيث تُرى المجرّة بالعين المجردة.',
    tagsAr: ['الأعمدة الرومانية', 'قوس النصر', 'سماء الصحراء'],
    sortOrder: 6,
  },
  {
    country: 'JO',
    slug: 'aqaba',
    nameAr: 'العقبة',
    nameEn: 'Aqaba',
    nameDe: 'Akaba',
    timezone: 'Asia/Amman',
    categories: ['coastal'],
    latitude: '29.5321',
    longitude: '35.0063',
    descriptionAr:
      'بوابة الأردن على البحر الأحمر. فنادق وشقق قرب الشاطئ، وغوص بين الشعاب المرجانية، على بعد ساعة من رمال وادي رم.',
    tagsAr: ['البحر الأحمر', 'الغوص والشعاب', 'وادي رم قريباً'],
    sortOrder: 7,
  },
  {
    country: 'JO',
    slug: 'petra',
    nameAr: 'البتراء',
    nameEn: 'Petra',
    nameDe: 'Petra',
    timezone: 'Asia/Amman',
    categories: ['desert', 'historic'],
    latitude: '30.3285',
    longitude: '35.4444',
    descriptionAr:
      'المدينة الوردية المنحوتة في الصخر. مخيمات بدوية ونُزل تطل على جبال وادي موسى، وتجربة «البتراء ليلاً» على ضوء الشموع.',
    tagsAr: ['الخزنة', 'السيق', 'ليالي البتراء'],
    sortOrder: 8,
  },
  {
    country: 'LB',
    slug: 'tripoli',
    nameAr: 'طرابلس',
    nameEn: 'Tripoli',
    nameDe: 'Tripoli',
    timezone: 'Asia/Beirut',
    categories: ['coastal'],
    latitude: '34.4367',
    longitude: '35.8497',
    descriptionAr:
      'عاصمة الشمال اللبناني: قلعة مملوكية، خانات عثمانية، وأشهر حلويات الساحل. شقق مفروشة في الميناء وإطلالات على جزر النخيل.',
    tagsAr: ['قلعة طرابلس', 'خانات المدينة', 'حلويات عربية'],
    sortOrder: 9,
  },
];

export interface PropertyTypeSeed {
  code: string;
  nameAr: string;
  nameEn: string;
  nameDe: string;
  hasMultipleUnits: boolean;
  glyph: string;
  sortOrder: number;
}

/** §8.2. `hasMultipleUnits` drives whether the partner UI manages rooms. */
export const PROPERTY_TYPES: PropertyTypeSeed[] = [
  {
    code: 'hotel',
    nameAr: 'فندق',
    nameEn: 'Hotel',
    nameDe: 'Hotel',
    hasMultipleUnits: true,
    glyph: '🏨',
    sortOrder: 1,
  },
  {
    code: 'apartment',
    nameAr: 'شقة مفروشة',
    nameEn: 'Furnished apartment',
    nameDe: 'Möblierte Wohnung',
    hasMultipleUnits: false,
    glyph: '🏢',
    sortOrder: 2,
  },
  {
    code: 'villa',
    nameAr: 'فيلا',
    nameEn: 'Villa',
    nameDe: 'Villa',
    hasMultipleUnits: false,
    glyph: '🏡',
    sortOrder: 3,
  },
  {
    code: 'farm',
    nameAr: 'مزرعة',
    nameEn: 'Farm',
    nameDe: 'Bauernhof',
    hasMultipleUnits: false,
    glyph: '🌾',
    sortOrder: 4,
  },
  {
    code: 'chalet',
    nameAr: 'شاليه',
    nameEn: 'Chalet',
    nameDe: 'Chalet',
    hasMultipleUnits: false,
    glyph: '🏖️',
    sortOrder: 5,
  },
  {
    code: 'rural_house',
    nameAr: 'بيت ريفي',
    nameEn: 'Rural house',
    nameDe: 'Landhaus',
    hasMultipleUnits: false,
    glyph: '🏘️',
    sortOrder: 6,
  },
  {
    code: 'camp',
    nameAr: 'مخيم',
    nameEn: 'Camp',
    nameDe: 'Camp',
    hasMultipleUnits: true,
    glyph: '⛺',
    sortOrder: 7,
  },
];

export interface AmenitySeed {
  code: string;
  nameAr: string;
  nameEn: string;
  nameDe: string;
  category: string;
  isFilterable: boolean;
  sortOrder: number;
}

/** §5.5 names the required filters; these are exactly those, plus prototype extras. */
export const AMENITIES: AmenitySeed[] = [
  {
    code: 'wifi',
    nameAr: 'إنترنت',
    nameEn: 'Internet',
    nameDe: 'Internet',
    category: 'facilities',
    isFilterable: true,
    sortOrder: 1,
  },
  {
    code: 'parking',
    nameAr: 'موقف سيارات',
    nameEn: 'Parking',
    nameDe: 'Parkplatz',
    category: 'facilities',
    isFilterable: true,
    sortOrder: 2,
  },
  {
    code: 'pool',
    nameAr: 'مسبح',
    nameEn: 'Pool',
    nameDe: 'Pool',
    category: 'facilities',
    isFilterable: true,
    sortOrder: 3,
  },
  {
    code: 'breakfast',
    nameAr: 'إفطار',
    nameEn: 'Breakfast',
    nameDe: 'Frühstück',
    category: 'facilities',
    isFilterable: true,
    sortOrder: 4,
  },
  {
    code: 'air_conditioning',
    nameAr: 'تكييف',
    nameEn: 'Air conditioning',
    nameDe: 'Klimaanlage',
    category: 'facilities',
    isFilterable: true,
    sortOrder: 5,
  },
  {
    code: 'kitchen',
    nameAr: 'مطبخ',
    nameEn: 'Kitchen',
    nameDe: 'Küche',
    category: 'facilities',
    isFilterable: true,
    sortOrder: 6,
  },
  {
    code: 'heating',
    nameAr: 'تدفئة',
    nameEn: 'Heating',
    nameDe: 'Heizung',
    category: 'facilities',
    isFilterable: true,
    sortOrder: 7,
  },
  {
    code: 'reception_24h',
    nameAr: 'استقبال 24 ساعة',
    nameEn: '24h reception',
    nameDe: '24h-Rezeption',
    category: 'facilities',
    isFilterable: true,
    sortOrder: 8,
  },
  {
    code: 'sea_view',
    nameAr: 'إطلالة على البحر',
    nameEn: 'Sea view',
    nameDe: 'Meerblick',
    category: 'facilities',
    isFilterable: true,
    sortOrder: 9,
  },
  {
    code: 'pets_allowed',
    nameAr: 'يسمح بالحيوانات',
    nameEn: 'Pets allowed',
    nameDe: 'Haustiere erlaubt',
    category: 'rules',
    isFilterable: true,
    sortOrder: 10,
  },
  {
    code: 'family_friendly',
    nameAr: 'مناسب للعائلات',
    nameEn: 'Family friendly',
    nameDe: 'Familienfreundlich',
    category: 'rules',
    isFilterable: true,
    sortOrder: 11,
  },
  {
    code: 'accessible',
    nameAr: 'مناسب لذوي الاحتياجات',
    nameEn: 'Accessible',
    nameDe: 'Barrierefrei',
    category: 'accessibility',
    isFilterable: true,
    sortOrder: 12,
  },
];

export interface CancellationPolicySeed {
  code: string;
  nameAr: string;
  nameEn: string;
  nameDe: string;
  descriptionAr: string;
  descriptionEn: string;
  descriptionDe: string;
  tiers: { hoursBeforeCheckIn: number; refundPercent: number }[];
  minRefundPercent: number;
}

/**
 * §7.4: partners choose from SAFRA-approved policies rather than writing their own,
 * and no policy may refund below 50% except by explicit admin exception. The
 * database CHECK constraint enforces the floor independently of this data.
 */
export const CANCELLATION_POLICIES: CancellationPolicySeed[] = [
  {
    code: 'flex',
    nameAr: 'مرن',
    nameEn: 'Flexible',
    nameDe: 'Flexibel',
    descriptionAr: 'إلغاء مجاني حتى 48 ساعة قبل الوصول، ثم استرداد 50٪.',
    descriptionEn: 'Free cancellation up to 48 hours before check-in, then 50% refund.',
    descriptionDe:
      'Kostenlose Stornierung bis 48 Stunden vor Anreise, danach 50 % Rückerstattung.',
    tiers: [
      { hoursBeforeCheckIn: 48, refundPercent: 100 },
      { hoursBeforeCheckIn: 0, refundPercent: 50 },
    ],
    minRefundPercent: 50,
  },
  {
    code: 'moderate',
    nameAr: 'متوسط',
    nameEn: 'Moderate',
    nameDe: 'Moderat',
    descriptionAr: 'إلغاء مجاني حتى 5 أيام قبل الوصول، ثم استرداد 50٪.',
    descriptionEn: 'Free cancellation up to 5 days before check-in, then 50% refund.',
    descriptionDe:
      'Kostenlose Stornierung bis 5 Tage vor Anreise, danach 50 % Rückerstattung.',
    tiers: [
      { hoursBeforeCheckIn: 120, refundPercent: 100 },
      { hoursBeforeCheckIn: 0, refundPercent: 50 },
    ],
    minRefundPercent: 50,
  },
  {
    code: 'strict',
    nameAr: 'صارم',
    nameEn: 'Strict',
    nameDe: 'Streng',
    descriptionAr: 'استرداد 50٪ حتى 7 أيام قبل الوصول، وهو الحد الأدنى المسموح في سفرة.',
    descriptionEn: '50% refund up to 7 days before check-in — the minimum SAFRA permits.',
    descriptionDe:
      '50 % Rückerstattung bis 7 Tage vor Anreise — das von SAFRA erlaubte Minimum.',
    tiers: [{ hoursBeforeCheckIn: 168, refundPercent: 50 }],
    minRefundPercent: 50,
  },
];

export interface PartnerTypeSeed {
  code: string;
  nameAr: string;
  nameEn: string;
  nameDe: string;
  capabilities: string[];
}

/**
 * §12: mobility must be addable without rebuilding. It is seeded now, inactive at
 * the application level, precisely to prove the architecture allows it.
 */
export const PARTNER_TYPES: PartnerTypeSeed[] = [
  {
    code: 'accommodation',
    nameAr: 'شريك إقامة',
    nameEn: 'Accommodation partner',
    nameDe: 'Unterkunftspartner',
    capabilities: ['properties', 'calendar', 'bookings'],
  },
  {
    code: 'restaurant',
    nameAr: 'شريك مطعم',
    nameEn: 'Restaurant partner',
    nameDe: 'Restaurantpartner',
    capabilities: ['ads'],
  },
  {
    code: 'activity',
    nameAr: 'شريك نشاط',
    nameEn: 'Activity partner',
    nameDe: 'Aktivitätspartner',
    capabilities: ['ads', 'activities'],
  },
  {
    code: 'mobility',
    nameAr: 'شريك تنقل',
    nameEn: 'Mobility partner',
    nameDe: 'Mobilitätspartner',
    capabilities: ['vehicles', 'routes'],
  },
];

/**
 * §3 P-005 and §2.1: every operational value the admin must be able to change
 * without a deploy. Bookings snapshot the ones they use, so editing these never
 * rewrites history.
 */
export const SETTINGS: {
  key: string;
  value: unknown;
  valueSchema: string;
  descriptionAr: string;
  descriptionEn: string;
}[] = [
  /**
   * §3 P-005 and §2.1: every operational value the admin edits from the Rules
   * Engine settings page, with the units that page shows.
   *
   * NOTE on the customer fee: it is a FLAT amount ($1.99), not a percentage. The
   * approved settings screen labels it "رسوم ثابتة تضاف على كل حجز" (a fixed fee
   * added to every booking), while only the PARTNER side is a 7% commission. An
   * earlier reading of SRS §2.1 had both sides at 7%; the settings page is the
   * authority and this is the corrected model.
   *
   * `customer_fee_mode` exists so the admin can switch to a percentage later
   * without a deploy — bookings snapshot the mode and value they used, so history
   * stays correct across a change.
   */
  {
    key: 'commission.customer_fee_mode',
    value: 'flat',
    valueSchema: 'feeMode',
    descriptionAr: 'طريقة حساب رسوم خدمة العميل',
    descriptionEn: 'Customer fee mode: flat or percent',
  },
  {
    key: 'commission.customer_fee_value',
    value: 1.99,
    valueSchema: 'money',
    descriptionAr: 'رسوم خدمة العميل — رسوم ثابتة تضاف على كل حجز',
    descriptionEn: 'Customer service fee, flat amount added to every booking',
  },
  {
    /*
      Whether the fee is NAMED to the customer, as opposed to charged. `false` because that is what
      the platform does today (Bashar, 2026-09-03) — a seeded `true` would re-expose the fee on
      every screen the next time somebody ran the seed. See `@safra/contracts/customer-fee.ts`.
    */
    key: 'commission.customer_fee_visible',
    value: false,
    valueSchema: 'boolean',
    descriptionAr: 'إظهار رسوم الخدمة كبند منفصل للعميل',
    descriptionEn: 'Show the SAFRA service fee as its own line to the customer',
  },
  {
    key: 'commission.partner_rate',
    value: 0.07,
    valueSchema: 'rate',
    descriptionAr: 'عمولة الشريك — تخصم من مستحقاته قبل التحويل',
    descriptionEn: 'Partner commission, deducted before payout (§2.1)',
  },
  {
    key: 'booking.confirmation_window_minutes',
    value: 120,
    valueSchema: 'positiveInt',
    /*
      The «(ساعتان)» is gone: a label must not state the VALUE beside it.

      It was true for 120 and becomes a lie the moment somebody sets 180 — and the screen prints
      «120 دقيقة» next to it now, so the label was also saying it twice.
    */
    descriptionAr: 'مهلة الشريك لتأكيد الحجز',
    descriptionEn: 'Partner confirmation SLA in minutes (§6.4)',
  },
  {
    key: 'booking.same_day_cutoff_hour',
    value: 17,
    valueSchema: 'hourOfDay',
    descriptionAr: 'إغلاق حجز اليوم نفسه — بتوقيت المدينة',
    descriptionEn: 'Same-day booking cutoff, city-local (§5.3)',
  },
  /*
    The switch for the rule above (Bashar, 2026-09-04).

    TRUE by default, deliberately: «existing behaviour should remain the safe default unless the
    administrator explicitly changes it». Off, the cutoff stops applying entirely — the global hour
    and every per-city hour with it — and the first bookable date becomes the city's local today.
    Yesterday stays unbookable either way; that is a separate rule with a separate reason.
  */
  {
    key: 'booking.same_day_cutoff_enabled',
    value: true,
    valueSchema: 'boolean',
    descriptionAr: 'تفعيل إغلاق حجز اليوم نفسه',
    descriptionEn: 'Whether the same-day booking cutoff applies at all (§5.3)',
  },
  {
    key: 'booking.pending_payment_timeout_minutes',
    value: 30,
    valueSchema: 'positiveInt',
    /*
      No English inside an Arabic sentence.

      It read «مهلة Pending Payment» — the name of a booking status, in English, in the middle of
      the label an operator reads on الإعدادات (Bashar, 2026-08-31). The console names its settings
      from `@safra/i18n` now and this column is only the fallback, but a fallback that reaches a
      screen reaches it in the reader's language too. `post/0019` backfills the seeded row.
    */
    descriptionAr: 'مهلة انتظار الدفع — يُلغى الحجز تلقائياً إن لم يكتمل',
    descriptionEn: 'Pending payment expiry; booking auto-cancels (EC-001)',
  },
  {
    key: 'partner.first_violation_fine',
    value: 10,
    valueSchema: 'money',
    descriptionAr: 'غرامة عدم الرد (أول مخالفة)',
    descriptionEn: 'No-response fine, first violation (§6.4)',
  },
  {
    key: 'wallet.sla_compensation',
    value: 10,
    valueSchema: 'money',
    descriptionAr: 'تعويض محفظة العميل عند خيبة الأمل (P-007)',
    descriptionEn: 'Customer wallet compensation on partner failure (P-007)',
  },
  /**
   * Whether every money setting is dollars regardless of its own currency.
   *
   * On by default, which is what makes §6.4 fair: with it off, a fine of "10"
   * applied in the booking's currency costs a partner ~$14 on a JOD booking and $10
   * on a USD one for identical conduct. Turning it off is the escape hatch for a
   * market that genuinely needs local amounts, not the default.
   */
  {
    key: 'money.always_usd',
    value: true,
    valueSchema: 'boolean',
    descriptionAr: 'اعتبار كل القيم المالية بالدولار الأمريكي',
    descriptionEn: 'Treat every money setting as USD, whatever currency it names',
  },
  /**
   * Off by default. Rate changes move every SYP figure on the platform, so widening
   * who may make them is a decision rather than a default (roadmap 150f).
   */
  {
    key: 'rbac.finance_can_manage_fx',
    value: false,
    valueSchema: 'boolean',
    descriptionAr: 'السماح لمسؤول المالية بإدارة أسعار الصرف',
    descriptionEn: 'Grant fx_rate.manage to finance_officer while enabled',
  },
  /**
   * How hard sanctions screening bites (Bashar, 2026-08-21).
   *
   * `advisory` by default: screening runs and is recorded, and it blocks nothing. Set `required`
   * to restore the hard gate on partner approval and partner payout, `off` to stop offering it.
   *
   * The value and the reasoning behind it live in `@safra/contracts/compliance`, and the review
   * that produced the choice is `docs/sanctions-screening-review.md`. The three values are NOT
   * repeated here — `sanctionsPolicy` is validated against that contract, so a fourth invented
   * here would be refused by the editor rather than quietly stored.
   */
  {
    key: 'compliance.sanctions_screening',
    value: 'advisory',
    valueSchema: 'sanctionsPolicy',
    descriptionAr: 'إلزامية فحص العقوبات: مُلزِم أو استرشادي أو معطّل',
    descriptionEn: 'Sanctions screening policy: required, advisory or off',
  },
  {
    key: 'refund.minimum_percent',
    value: 50,
    valueSchema: 'percent',
    descriptionAr: 'الحد الأدنى للاسترداد',
    descriptionEn: 'Refund floor across all policies (§7.4)',
  },
  {
    /**
     * Which gateway serves which country, in preference order (ADR 0002).
     *
     * Only `manual_transfer` is listed because it is the only rail
     * `Safra Technologies GmbH` can operate with no third-party agreement. The four
     * approved customer-facing methods (Visa, Mastercard, Klarna, Sham Cash) each
     * need one first: the card schemes need an acquirer, Klarna a merchant
     * agreement, Sham Cash a Syrian collection relationship. Until then
     * `GET /payments/methods` correctly returns an empty list rather than
     * advertising a rail that cannot be served.
     *
     * A provider is added HERE, not in code — that is the point of the abstraction.
     */
    key: 'payment.provider_routing',
    value: { SY: ['manual_transfer'], '*': ['manual_transfer'] },
    valueSchema: 'json',
    descriptionAr: 'توجيه مزودي الدفع حسب البلد — بترتيب الأولوية',
    descriptionEn: 'Payment provider routing per country, in preference order (§7.1)',
  },
  {
    key: 'payment.merchant_of_record',
    value: 'Safra Technologies GmbH',
    valueSchema: 'string',
    descriptionAr: 'الجهة التعاقدية التي تحصّل المدفوعات',
    descriptionEn: 'Contracting entity that collects payment (ADR 0002)',
  },
  {
    key: 'search.max_nights',
    value: 90,
    valueSchema: 'positiveInt',
    descriptionAr: 'أقصى عدد ليالٍ للحجز',
    descriptionEn: 'Maximum nights per booking',
  },
];
