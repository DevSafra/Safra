/**
 * لوحة الشريك — every word a partner reads, in Arabic.
 *
 * Structured and named like `messages/admin/ar.ts`, because the two are read the same way and a
 * second shape would be a second thing to learn. The copy itself is the design handoff's (§7),
 * verbatim where the handoff quotes it.
 *
 * Arabic only, like the console, and for the same reason: the partners this serves are in Syria
 * and the surrounding region. When a second language arrives it is one file plus one line in
 * `partner.ts`, and the compiler checks it key by key.
 */
export const ar = {
  /** The document title and the wordmark line. */
  brand: 'سفرة — لوحة الشريك',

  /** الدعم — a partner asking SAFRA for help (Bashar, 2026-08-12). */
  support: {
    title: 'الدعم',
    intro: 'اطرح مشكلتك وسيتابعها فريق سفرة معك هنا.',
    openTitle: 'طلب دعم جديد',
    bodyLabel: 'اشرح المشكلة',
    bodyHint: 'عشرة أحرف على الأقل. لا تكتب رقم هاتف أو بريداً — تُحجب تلقائياً ولن تصل.',
    submit: 'إرسال الطلب',
    submitting: 'جارٍ الإرسال…',
    failed: 'تعذّر إرسال الطلب الآن. يرجى المحاولة مرة أخرى.',
    mineTitle: 'طلباتي',
    none: 'لا توجد طلبات دعم بعد.',
    openLabel: 'مفتوح',
    closedLabel: 'مغلق',
    messages: 'الرسائل: {count}',
    replyLabel: 'ردّك',
    replySubmit: 'إرسال',
    closedNote: 'هذا الطلب مغلق. افتح طلباً جديداً إذا احتجت المساعدة مرة أخرى.',
    redacted: 'حُجبت {count} من بيانات الاتصال في هذه الرسالة.',
    senderPartner: 'أنت',
    senderStaff: 'فريق سفرة',
    senderSystem: 'النظام',
    back: 'رجوع',
  },

  nav: {
    heading: 'لوحة الشريك',
    dashboard: 'لوحة التحكم',
    properties: 'عقاراتي',
    calendars: 'التقويمات',
    reviews: 'التقييمات',
    payouts: 'مستحقاتي',
    supportPage: 'الدعم',
    /** The handoff's sidebar footer, verbatim. */
    support: 'الدعم: partners@safra.com',
    showSidebar: 'إظهار قائمة التنقل',
    hideSidebar: 'إخفاء قائمة التنقل',
    signOut: 'تسجيل الخروج',
    /**
     * The theme toggle names the DESTINATION, not the current state.
     *
     * «الوضع الداكن» while dark is active is ambiguous read aloud — it could be reporting a state
     * or offering an action. These say which way the button goes. Worded identically to the
     * console's, because a partner and a staff member pressing the same control should hear the
     * same sentence.
     */
    themeToLight: 'التبديل إلى الوضع الفاتح',
    themeToDark: 'التبديل إلى الوضع الداكن',
  },

  login: {
    title: 'لوحة الشريك',
    subtitle: 'الدخول مخصص لشركاء سفرة.',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    /* The eye toggle's accessible names. `PasswordField` requires them rather than defaulting,
       so a default that is wrong in two of three languages cannot slip through. */
    showPassword: 'إظهار كلمة المرور',
    hidePassword: 'إخفاء كلمة المرور',
    submit: 'تسجيل الدخول',
    signingIn: 'جارٍ الدخول…',
    /**
     * One message for a wrong email and a wrong password alike.
     *
     * Telling somebody which half was wrong turns the form into an account-existence oracle:
     * a different answer for a real address is how a list of partners gets enumerated.
     */
    failed: 'بيانات الدخول غير صحيحة.',
    notAPartner: 'هذا الحساب ليس حساب شريك.',
    unreachable: 'تعذّر الوصول إلى الخادم. حاول مرة أخرى.',

    /**
     * The second step, for a partner who has already enrolled.
     *
     * `codeLabel` covers both kinds of secret on purpose. Six digits is an authenticator code and
     * anything else is a recovery code; asking somebody which one they are holding is a question
     * they should not have to answer while locked out.
     */
    codeTitle: 'رمز التحقق',
    codeLabel: 'رمز المُصادِق المكوَّن من ٦ أرقام، أو أحد رموز الاسترداد.',
    codeSubmit: 'تأكيد',
    codeChecking: 'جارٍ التحقق…',
    codeBack: 'رجوع',
    codeFailed: 'الرمز غير مقبول. تحقّق من تطبيق المُصادِق وحاول مرة أخرى.',

    /**
     * A locked account and a throttled one are NOT «بيانات الدخول غير صحيحة».
     *
     * Telling somebody their password is wrong when the real answer is "too many attempts" sends
     * them to try again, which spends another attempt and locks the account faster. Both messages
     * name the wait, because a person who knows to come back in a quarter of an hour stops
     * hammering the form.
     */
    locked: 'أُقفل الحساب مؤقتًا بعد عدة محاولات فاشلة. حاول بعد ١٥ دقيقة.',
    tooMany: 'محاولات كثيرة خلال وقت قصير. انتظر دقيقة ثم حاول مرة أخرى.',
    codeFormat:
      'صيغة الرمز غير صحيحة. أدخل ٦ أرقام أو رمز استرداد بالشكل XXXX-XXXX-XXXX.',
  },

  /**
   * المصادقة الثنائية — mandatory for every partner (Bashar, 2026-08-07).
   *
   * The copy leads with WHY rather than with the instruction, because a partner meeting this
   * screen did not ask for it: they tried to open their dashboard and were sent here instead.
   * A screen that only says "enter a code" reads as a fault in the product.
   */
  twoFactor: {
    title: 'تفعيل المصادقة الثنائية',
    why: 'حسابك يتحكّم بإعلاناتك وأسعارك وتقويم إشغالك، ويعرض مستحقاتك المالية. لذلك المصادقة الثنائية إلزامية لكل الشركاء — ولا يمكن استخدام لوحة الشريك قبل تفعيلها.',
    step1:
      'افتح تطبيق مُصادِق (Google Authenticator أو Microsoft Authenticator أو ما شابه).',
    step2: 'أضف حسابًا جديدًا يدويًا وألصق المفتاح أدناه.',
    step3: 'أدخل الرمز المكوَّن من ٦ أرقام الذي يعرضه التطبيق.',
    setupKey: 'مفتاح الإعداد',
    loading: 'جارٍ التحميل…',
    sixDigitCode: 'الرمز المكوَّن من ٦ أرقام',
    submit: 'تفعيل المصادقة الثنائية',
    checking: 'جارٍ التحقق…',
    enabled: 'تم تفعيل المصادقة الثنائية على حسابك.',
    saveRecoveryCodes: 'احفظ رموز الاسترداد هذه الآن.',
    /* Stated plainly because it is true and irreversible: the API stores only Argon2id hashes. */
    recoveryCodesNote:
      'تُعرض مرة واحدة فقط ولا يمكن استرجاعها. كل رمز يصلح لمرة واحدة، ويُغنيك عن تطبيق المُصادِق إذا فقدت هاتفك. إذا فقدتها جميعًا فطريق العودة الوحيد هو مراسلة سفرة لإعادة التعيين.',
    savedContinue: 'حفظتها — متابعة',
    startFailed: 'تعذّر بدء التفعيل. أعد تحميل الصفحة للمحاولة مرة أخرى.',
    codeRejected: 'الرمز غير مقبول. تحقّق من تطبيق المُصادِق وحاول مرة أخرى.',
    failed: 'حدث خطأ. حاول مرة أخرى.',
    unreachable: 'تعذّر الوصول إلى الخادم.',
    signOut: 'تسجيل الخروج',
  },

  dashboard: {
    title: 'لوحة التحكم',
    loadFailed: 'تعذّر تحميل البيانات.',
    sessionExpired: 'انتهت الجلسة. سجّل الدخول مرة أخرى.',

    /**
     * The four §7.1 KPI cards.
     *
     * `noData` is «—» and not «٠». A partner with no units has not achieved zero occupancy, they
     * have no occupancy — and a confident zero on a card about somebody's business reads as a
     * verdict. The API returns null for exactly these cases; this is what null looks like.
     */
    kpiEarnings: 'أرباح هذا الشهر (بعد العمولة)',
    kpiEarningsUp: '↑ {percent}٪ عن الشهر الماضي',
    kpiEarningsDown: '↓ {percent}٪ عن الشهر الماضي',
    kpiEarningsFlat: 'كالشهر الماضي',
    kpiEarningsNoCompare: 'لا مقارنة — لا حجوزات الشهر الماضي',
    kpiBookings: 'حجوزات مؤكدة نشطة',
    kpiBookingsArriving: '{n} وصول هذا الأسبوع',
    kpiBookingsNoneArriving: 'لا وصول هذا الأسبوع',
    kpiOccupancy: 'نسبة الإشغال',
    kpiOccupancyDetail: '{booked} من {available} ليلة',
    kpiResponse: 'متوسط سرعة الرد',
    kpiResponseMinutes: '{n} دقيقة',
    kpiResponseSample: 'عن {n} حجزًا خلال ٩٠ يومًا',
    noData: '—',
    noDataYet: 'لا بيانات بعد',

    /** طلبات حجز بانتظار ردك — the queue with the clock and the fine attached. */
    requestsTitle: 'طلبات حجز بانتظار ردك',
    requestsRule: 'مهلة ساعتين — الغرامة ١٠$ عند عدم الرد',
    requestsEmpty: 'لا طلبات بانتظار ردك.',
    requestsNights: '{n} ليلة',
    requestsGuests: '{n} ضيف',
    requestsLeft: 'متبقٍ {time}',
    requestsOverdue: 'انتهت المهلة',
    requestsNoDeadline: 'بلا مهلة مسجّلة',
    accept: 'قبول',
    reject: 'رفض',
    rejectReason: 'سبب الرفض — يُرسل إلى سفرة ويُبلَّغ به الضيف.',
    rejectConfirm: 'تأكيد الرفض',
    cancel: 'إلغاء',
    working: 'جارٍ التنفيذ…',
    decisionFailed: 'تعذّر تسجيل القرار.',
    unreachable: 'تعذّر الوصول إلى الخادم.',
    /** The handoff's footnote, verbatim. */
    requestsNote: 'لا تظهر لك أي بيانات دفع للعميل. التواصل مع الضيف يتم عبر سفرة فقط.',

    /** التقويم — one unit, this month. */
    calendarTitle: 'تقويم {month} — كل وحداتك',
    calendarDefaultPrice: '{count} وحدة · تبدأ من {price}',
    /* One square per day, describing the portfolio rather than a single room. */
    calendarDayFull: 'لا وحدة متاحة',
    calendarDaySome: '{available} من {total} متاحة',
    calendarDayFree: 'كل الوحدات متاحة',
    calendarDayDetail: '{date} · محجوز {booked} · مغلق {blocked} · متاح {available}',
    /*
      A discoverability line, not decoration. The squares became LINKS so a partner can act on a day,
      and a link that looks exactly like the read-only square it replaced is a feature nobody finds.
      One sentence is cheaper than teaching it.
    */
    calendarClickHint: 'اضغط أي يوم لإدارة إتاحة الوحدات فيه.',
    legendPortfolioFree: 'كل الوحدات متاحة',
    legendPortfolioSome: 'متاح جزئيًا',
    legendPortfolioFull: 'لا شيء متاح',
    calendarPerUnit: 'لتعديل الأسعار والإتاحة، افتح تقويم الوحدة من عقاراتي.',
    calendarNoUnits: 'لا وحدات بعد، فلا تقويم لعرضه.',
    legendAvailable: 'متاح',
    legendBooked: 'محجوز',
    legendBlocked: 'مغلق',
    legendMaintenance: 'صيانة',
    /** The handoff's reminder, verbatim. */
    calendarReminder:
      'تذكير: أجّرت الوحدة خارج سفرة؟ أغلق التاريخ فوراً. عدم تحديث التقويم يخفّض تقييمك الداخلي.',

    /** المخالفات والتنبيهات. */
    alertsTitle: 'المخالفات والتنبيهات',
    alertsEmpty: 'لا مخالفات ولا تنبيهات.',
    /*
      «سُجّلت», not «خُصمت».

      The handoff's line reads "غرامة 10$ خُصمت من المستحقات", and that is the intended behaviour —
      but nothing deducts it yet: `partner_violations` records the fine and `partner_payouts.
      fine_amount` is still zero on every payout. Saying "deducted" would tell a partner their
      transfer is smaller than it is, and they would reconcile against a figure that never moved.
      The wording goes back to the handoff's the moment the deduction is wired (see O-partner-2).
    */
    alertFine: 'غرامة {amount} مسجَّلة',
    alertOnBooking: 'على الحجز {reference}',

    /**
     * The payout line — and the reason there are two of them.
     *
     * «مجدول» is a transfer with a date. «قيد التجميع» is an open accrual period. Both are real
     * rows in `partner_payouts`; neither is a sum of what bookings owe. Two separate strings
     * because one string with a variable status is exactly how an accrual comes to be described
     * as a scheduled transfer.
     */
    payoutScheduled: 'تحويل مستحقات {amount} مجدول يوم {date}',
    payoutAccruing: 'مستحقات قيد التجميع: {amount} — لم يُجدوَل تحويلها بعد',
    payoutNone: 'لا تحويلات مجدولة حاليًا.',
  },

  /** Violation kinds, keyed on the `violation_kind` enum. */
  violationKind: {
    no_response: 'تأخر الرد على طلب حجز',
    rejected_after_payment: 'رفض الحجز بعد الدفع',
    stale_calendar: 'تقويم غير محدَّث',
    inaccurate_listing: 'بيانات إعلان غير دقيقة',
    no_show: 'عدم استقبال الضيف',
  } as Record<string, string>,

  /**
   * Month names for the calendar heading.
   *
   * Written out rather than taken from `Intl`, and this is a deliberate exception to the project
   * rule that says use `Intl` for months: `Intl` with an `ar` locale returns the Gregorian months
   * under their Levantine OR their Egyptian names depending on the runtime's data, and the handoff
   * uses the Levantine set («آب», not «أغسطس»). A partner reading «أغسطس» on one machine and
   * «آب» on another would reasonably think they were different products.
   */
  months: [
    'كانون الثاني',
    'شباط',
    'آذار',
    'نيسان',
    'أيار',
    'حزيران',
    'تموز',
    'آب',
    'أيلول',
    'تشرين الأول',
    'تشرين الثاني',
    'كانون الأول',
  ],

  /**
   * تعديل العقار — the edit form, and the honest screen when there is nothing to edit.
   *
   * A published listing CANNOT be structurally edited: SAFRA verified the address, the
   * photographs and the documents against each other (§8.1), and letting the address change
   * afterwards would leave the «موثّق» badge standing over a claim nobody checked. The screen says
   * that, and names what IS editable, rather than showing a form whose submit is refused.
   */
  editProperty: {
    title: 'تعديل العقار',
    back: 'رجوع إلى العقارات',
    section: 'بيانات العقار',
    /* Why the form is not shown, and what to do instead. */
    lockedTitle: 'هذا العقار منشور، ولا يمكن تعديل بياناته الأساسية',
    lockedWhy:
      'راجعت سفرة العنوان والوثائق والصور معًا قبل النشر. تغيير العنوان أو المدينة بعد ذلك يُبطل تلك المراجعة بينما تبقى علامة التوثيق ظاهرة.',
    lockedWhatYouCan:
      'ما زال بإمكانك تعديل الأسعار والإتاحة من التقويم، وإدارة الصور، في أي وقت.',
    lockedContact: 'لتغيير العنوان أو المدينة، راسل سفرة من صفحة الرسائل.',
    goCalendar: 'فتح التقويم',
    goImages: 'إدارة الصور',
    rejectedTitle: 'سبب رفض العقار',
    /* Fields. Arabic is required; the other two are optional and labelled as such. */
    nameAr: 'اسم العقار بالعربية',
    nameEn: 'الاسم بالإنجليزية (اختياري)',
    nameDe: 'الاسم بالألمانية (اختياري)',
    descriptionAr: 'الوصف بالعربية',
    descriptionEn: 'الوصف بالإنجليزية (اختياري)',
    descriptionDe: 'الوصف بالألمانية (اختياري)',
    address: 'العنوان',
    city: 'المدينة',
    type: 'النوع',
    policy: 'سياسة الإلغاء',
    latitude: 'خط العرض (اختياري)',
    longitude: 'خط الطول (اختياري)',
    coordinatesHint: 'بالدرجات العشرية، مثل 33.5138',
    save: 'حفظ التعديلات',
    saving: 'جارٍ الحفظ…',
    saved: 'حُفظت التعديلات.',
    failed: 'تعذّر حفظ التعديلات. راجع الحقول وحاول مرة أخرى.',
    unreachable: 'تعذّر الوصول إلى الخادم.',
    units: 'الوحدات',
    unitsEmpty: 'لا وحدات بعد.',
    unitGuests: '{n} ضيف',
    unitNights: 'أقل مدة {n} ليلة',
    unitInactive: 'موقوفة',
    openUnitCalendar: 'تقويم هذه الوحدة',
    /* The unit editor. Every unit on one screen, each saved on its own. */
    unitName: 'اسم الوحدة',
    unitGuestsField: 'عدد الضيوف',
    unitBedrooms: 'غرف النوم',
    unitBeds: 'الأسرّة',
    unitBathrooms: 'الحمّامات',
    unitPrice: 'السعر الأساسي لليلة',
    unitMinNights: 'أقل عدد ليالٍ',
    unitMaxNights: 'أكثر عدد ليالٍ (اختياري)',
    unitActive: 'معروضة للحجز',
    unitInactiveNote:
      'الوحدة الموقوفة تختفي من البحث ولا تُحجز، وتبقى حجوزاتها القائمة كما هي. لإغلاق تواريخ محددة استخدم التقويم بدل إيقاف الوحدة.',
    unitSave: 'حفظ الوحدة',
    unitSaving: 'جارٍ الحفظ…',
    unitSaved: 'حُفظت الوحدة.',
    unitFailed: 'تعذّر حفظ الوحدة. راجع الحقول وحاول مرة أخرى.',
    unitsNote:
      'الأسعار والإتاحة تبقى قابلة للتعديل في كل الحالات، حتى بعد نشر العقار — فهي مسؤوليتك المستمرة (P-006).',
  },

  /**
   * تقويم الإتاحة — one unit's month, and the range editor that changes it.
   *
   * ## «محجوز» is not in the editor
   *
   * A partner may set «متاح», «مغلق» or «صيانة». `booked` is DERIVED from real bookings, and a
   * partner able to write it by hand could mark a unit booked with no booking behind it — hiding
   * inventory from سفرة while appearing compliant (§8.4). To take dates off sale they close them,
   * which is what the endpoint accepts and what this form offers.
   */
  unitCalendar: {
    title: 'تقويم الإتاحة',
    back: 'رجوع إلى العقارات',
    unit: 'الوحدة',
    noUnits: 'لا وحدات في هذا العقار بعد، فلا تقويم لعرضه.',
    month: 'الشهر',
    previousMonth: 'الشهر السابق',
    nextMonth: 'الشهر التالي',
    legend: 'الدليل',
    perNight: '/ ليلة',
    basePrice: 'السعر الأساسي',
    minNightsShort: 'أقل مدة',
    /* The range editor. */
    editorTitle: 'تعديل مدة',
    from: 'من تاريخ',
    to: 'إلى تاريخ',
    status: 'الحالة',
    statusUnchanged: 'دون تغيير',
    price: 'سعر الليلة',
    priceUnchanged: 'دون تغيير',
    priceClear: 'العودة إلى السعر الأساسي',
    minNights: 'أقل عدد ليالٍ',
    note: 'ملاحظة (لك وحدك)',
    apply: 'تطبيق على المدة',
    applying: 'جارٍ التطبيق…',
    applied: 'طُبِّق التغيير على المدة المحددة.',
    failed: 'تعذّر تطبيق التغيير. راجع التواريخ وحاول مرة أخرى.',
    unreachable: 'تعذّر الوصول إلى الخادم.',
    bookedWarning:
      'الليالي المحجوزة لا تتغير. الحجز واقعٌ قائم، والتقويم لا يلغيه — ألغِ الحجز نفسه إن لزم.',
    noteHint: 'لا تظهر الملاحظة للضيوف.',
  },

  /**
   * التقويمات — every unit's month on one screen, grouped by property (Bashar, 2026-08-10).
   *
   * The editor's own labels are NOT repeated here: this screen renders the same range editor as
   * تقويم الإتاحة, so it reads `unitCalendar` for every field. Two copies of «تطبيق على المدة» would
   * drift the first time somebody reworded one of them.
   */
  calendars: {
    title: 'التقويمات',
    intro: 'كل وحدة وتقويمها. أغلق التواريخ التي لم تعد متاحة، أو غيّر سعر ليلة.',
    /** `{month}` is a month name and `{year}` a year — never joined in code, see docs/i18n.md. */
    monthOf: '{month} {year}',
    noProperties: 'لا عقارات بعد، فلا تقويم لعرضه.',
    noUnits: 'لا وحدات في هذا العقار بعد.',
    /* An off-sale unit is listed rather than hidden, so it needs to say why it is greyed. */
    inactive: 'موقوفة عن البيع',
    loadMore: 'عرض عقارات أخرى',
    /*
      A cursor only moves forward, so without this the reader who pressed «عرض عقارات أخرى» has no way
      back except the browser's own button — and the month arrows carry the cursor with them, so they
      do not escape it either.
    */
    firstPage: 'العودة إلى أول العقارات',
    /** The `<caption>` every month grid needs — «تقويم {unit} لشهر {month}». */
    gridCaption: 'تقويم {unit} لشهر {month}',
    today: 'اليوم',
    unitCount: 'وحدة',
  },

  properties: {
    /** The handoff's §7.2 header, verbatim. */
    title: 'عروضي المنشورة على سفرة',
    note: 'التعديلات تمر بمراجعة سفرة قبل النشر',
    count: '{n} عقار',
    empty: 'لا عقارات بعد.',
    perNight: '/ ليلة',
    units: '{n} وحدة',
    reviews: 'من {n} تقييماً',
    /** Shown where a listing has no photo yet, in place of the 140px image. */
    noPhoto: 'لا صورة بعد',
    from: 'من',
    edit: 'تعديل',
    calendar: 'التقويم',

    /** The §7.2 add-property form, with the handoff's own labels and note. */
    addOpen: '+ إضافة عقار',
    addClose: '× إغلاق النموذج',
    fName: 'اسم العقار',
    fType: 'النوع',
    fCity: 'المدينة',
    fPrice: 'السعر لليلة ($)',
    fUnits: 'عدد الوحدات',
    fGuests: 'عدد الضيوف لكل وحدة',
    fPolicy: 'سياسة الإلغاء',
    fAddress: 'العنوان',
    fDescription: 'الوصف',
    attributesLabel:
      'صفات الرحلة — نفس صفات صفحة الإقامات؛ اختر حتى 4 لتظهر للزوار وتُستخدم في الفلترة',
    attributesTooMany: 'اخترت أكثر من ٤ صفات. أزل واحدة قبل الإرسال.',
    submit: 'إرسال للمراجعة',
    submitting: 'جارٍ الإرسال…',
    cancelForm: 'إلغاء',
    /** P-002, quoted by the handoff. */
    reviewNote: 'تراجعه سفرة خلال 48 ساعة (P-002) قبل ظهوره للزوار.',
    created: 'أُرسل العقار للمراجعة. يظهر أدناه كمسودة حتى تعتمده سفرة.',
    createFailed: 'تعذّر إنشاء العقار. راجع الحقول وحاول مرة أخرى.',
    unreachable: 'تعذّر الوصول إلى الخادم.',
    /*
      The three image slots §7.2 draws are absent, and the note says why rather than showing
      dead boxes: an image is uploaded against a property that already exists.
    */
    imagesLater:
      'تُضاف الصور بعد إنشاء العقار، من شاشة الصور. لا يمكن رفع صورة لعقار لم يُنشأ بعد.',
    manageImages: 'الصور',
  },

  /**
   * صور العقار — the media manager (§5.6 gallery, §7.2).
   *
   * The copy is explicit that nothing is ever deleted: an image is ARCHIVED, and the reason is
   * that a photograph is evidence of what a listing claimed on the day somebody booked it. A
   * dispute about "the room looked nothing like the photo" is unanswerable if the photo is gone.
   */
  images: {
    title: 'صور العقار',
    /*
      The cover is the FLAGGED image, not the first one.

      This sentence used to say the first image in the order was the cover. It never was: the
      order and the cover are separate columns, and «اجعلها صورة الغلاف» is what sets the cover.
      A partner who reordered their gallery to change what search results show would have watched
      nothing happen and had no way to find out why — the screen had told them the wrong mechanism.
    */
    note: 'صورة الغلاف هي التي تظهر في نتائج البحث، وتُختار بزر «اجعلها صورة الغلاف» لا بالترتيب. تُعالَج كل صورة وتُزال منها بيانات الموقع قبل النشر.',
    empty: 'لا صور بعد. ارفع أول صورة لهذا العقار.',
    count: '{n} من {max} صورة',
    upload: 'رفع صور',
    uploading: 'جارٍ الرفع…',
    cover: 'صورة الغلاف',
    makeCover: 'اجعلها صورة الغلاف',
    moveUp: 'تقديم',
    moveDown: 'تأخير',
    archive: 'أرشفة',
    archiveConfirm: 'تُؤرشَف الصورة ولا تُحذف — تبقى سجلاً لما عرضه الإعلان. متابعة؟',
    /**
     * Alt text, per language.
     *
     * All three, not just Arabic. The customer site serves ar/en/de and the alt attribute is
     * chosen by the READER's locale — an English visitor to a listing described only in Arabic
     * gets `alt=""`, which is the same as no description at all. Editing one language and storing
     * three was a UI that quietly discarded two thirds of the field.
     *
     * Every one is optional. A partner writing Arabic should not be blocked on also writing
     * German, and an empty alt is honest for a photograph the surrounding copy already names.
     */
    altLabel: 'وصف الصورة لقارئ الشاشة (اختياري)',
    altAr: 'بالعربية',
    altEn: 'بالإنجليزية',
    altDe: 'بالألمانية',
    altSave: 'حفظ الوصف',
    altSaved: 'حُفظ',
    backToProperties: 'رجوع إلى عقاراتي',
    /* Each failure says which one it was: a partner who cannot tell them apart retries the wrong thing. */
    /* Several at once: what landed, and what the limit refused. */
    uploadedSome: 'رُفعت {done} من {total} صور. تحقق من الصور المتبقية وأعد المحاولة.',
    limitReached: 'بلغت الحد الأقصى وهو {max} صورة لهذا العقار.',
    uploadFailed: 'تعذّر رفع الصورة. تأكد أنها صورة صالحة وأصغر من ١٠ ميغابايت.',
    lastImage: 'لا يمكن أرشفة الصورة الأخيرة لعقار منشور. ارفع صورة بديلة أولاً.',
    failed: 'تعذّر تنفيذ الطلب.',
    unreachable: 'تعذّر الوصول إلى الخادم.',
  },

  /** Property state, as the handoff's §7.2 pills name it. */
  /**
   * Availability day states, keyed on `availability_days.status`.
   *
   * «محجوز» is present because a day can BE booked, and absent from the editor's select because a
   * partner may not SET it — the two are different questions and the catalogue answers only the
   * first. See the note on `unitCalendar`.
   */
  dayStatus: {
    available: 'متاح',
    booked: 'محجوز',
    closed: 'مغلق',
    maintenance: 'صيانة',
  } as Record<string, string>,

  propertyStatus: {
    published: 'منشور',
    pending_review: 'قيد المراجعة',
    approved: 'معتمد',
    draft: 'مسودة',
    rejected: 'مرفوض',
    suspended: 'موقوف',
    archived: 'مؤرشف',
  } as Record<string, string>,

  /**
   * صفات الرحلة — the ONE shared vocabulary (§5.6 and the acceptance checklist).
   *
   * The keys are `TRIP_ATTRIBUTES` from `@safra/contracts`, the same list the public search, the
   * filters and the property page use. The handoff is explicit that it must not be forked, so
   * this is a translation of that list and never a second one.
   */
  tripAttribute: {
    sea: 'بحر',
    mountain: 'جبل',
    history: 'تاريخ',
    nature: 'طبيعة',
    families: 'عائلات',
    honeymoon: 'شهر عسل',
    pool: 'مسبح',
    parking: 'موقف',
    internet: 'إنترنت',
    business: 'أعمال',
  } as Record<string, string>,

  /**
   * Property types, keyed on `property_types.code`.
   *
   * The card's meta line printed «دمشق · hotel · 2 وحدة» — the code, raw, on an Arabic screen.
   * The table has `name_ar`, so the alternative was to select it; a catalogue is used instead
   * because these are a closed vocabulary the UI names, like every other enum in the project.
   */
  propertyType: {
    hotel: 'فندق',
    apartment: 'شقة',
    chalet: 'شاليه',
    villa: 'فيلا',
    farm: 'مزرعة',
    camp: 'مخيم',
    rural_house: 'بيت ريفي',
  } as Record<string, string>,

  /**
   * مستحقاتي — the partner's own view of their transfers.
   *
   * The copy distinguishes «مستحق» (what SAFRA owes) from «تحويل» (money that moved) throughout,
   * because this is the screen where a partner decides whether to expect a payment. A word used
   * loosely here becomes somebody planning around money that has not been sent.
   */
  payouts: {
    title: 'مستحقاتي',
    note: 'يُضاف الحجز إلى مستحقاتك بعد اكتمال الإقامة وتحصيل الدفع. أي حجز عليه نزاع مفتوح يبقى مجمّدًا حتى يُغلق النزاع.',
    empty: 'لا مستحقات مسجّلة بعد.',
    colReference: 'المرجع',
    colPeriod: 'الفترة',
    colBookings: 'الحجوزات',
    colNet: 'الصافي',
    colStatus: 'الحالة',
    colDate: 'التاريخ',
    gross: 'الإجمالي',
    fine: 'الغرامات',
    net: 'الصافي المستحق',
    scheduledFor: 'موعد التحويل',
    paidAt: 'تاريخ الدفع',
    paidReference: 'مرجع الحوالة',
    holdReason: 'سبب التعليق',
    coveredBookings: 'الحجوزات المشمولة',
    noBookings: 'لا حجوزات على هذه الفترة بعد.',
    colBooking: 'الحجز',
    colProperty: 'العقار',
    colStay: 'الإقامة',
    colAmount: 'المبلغ',
    back: 'رجوع',
    /* Read-only, and the screen says why rather than leaving a partner hunting for a button. */
    readOnly:
      'هذه الصفحة للاطّلاع فقط. جدولة التحويلات وتنفيذها يتمّان من سفرة؛ لأي استفسار راسل partners@safra.com.',
  },

  /** Payout state, in the partner's language. Same values and same colours as the console. */
  payoutStatus: {
    accruing: 'قيد التجميع',
    pending_release: 'بانتظار الإفراج',
    on_hold: 'معلَّق',
    scheduled: 'مجدول',
    paid: 'مدفوع',
    cancelled: 'ملغى',
  } as Record<string, string>,

  reviews: {
    title: 'تقييمات ضيوفي',
    /** P-006, quoted by the handoff verbatim. */
    rule: 'لا يمكن حذف تقييم — يمكنك الرد عليه أو الإبلاغ عنه (P-006)',
    /** The §7.3 header figure. Shown only when there is an average to show. */
    summary: 'المعدل العام ★ {average} من {n} تقييماً',
    summaryEmpty: 'لا تقييمات بعد.',
    empty: 'لا تقييمات بعد. تظهر هنا بعد أن يقيّم ضيوفك إقاماتهم المكتملة.',

    reply: 'الرد',
    report: 'إبلاغ',
    replyLabel: 'ردّك — يظهر للجميع تحت التقييم، ولا يمكن تعديله بعد النشر.',
    replySubmit: 'نشر الرد',
    replied: 'ردّك',
    alreadyReplied: 'سبق أن رددت على هذا التقييم.',
    reportLabel:
      'لماذا تُبلغ عن هذا التقييم؟ يصل النص إلى سفرة ولا يظهر للضيف. عشرة أحرف على الأقل.',
    reportSubmit: 'إرسال البلاغ',
    /* Stated plainly: reporting is not removal, and a partner should not expect it to be. */
    reportPending: 'بلاغك قيد المراجعة لدى سفرة. التقييم يبقى ظاهراً حتى يصدر القرار.',
    reportUpheld: 'قبلت سفرة بلاغك وأُخفي التقييم.',
    reportDismissed: 'راجعت سفرة بلاغك وأبقت التقييم ظاهراً.',
    hidden: 'مُخفى',
    hiddenNote: 'أخفت سفرة هذا التقييم. يبقى في سجلّك ولا يُحتسب في معدّلك.',

    cancel: 'إلغاء',
    working: 'جارٍ الإرسال…',
    failed: 'تعذّر تنفيذ الطلب.',
    unreachable: 'تعذّر الوصول إلى الخادم.',
  },
} as const;
