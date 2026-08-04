/**
 * Arabic copy for the staff console.
 *
 * The console is Arabic-only (Bashar, 2026-08-03). SAFRA operates across Syria, Jordan
 * and Lebanon and the seeded default locale is already `ar`, so Arabic is the working
 * language of the people who use this app — not a translation of an English original.
 *
 * ## Why a module and not `next-intl`
 *
 * The customer app uses `next-intl` because it genuinely serves three languages and
 * needs locale routing, negotiation and static params. None of that applies here: there
 * is one locale, no `/[locale]` segment, and nothing to negotiate. Adding the machinery
 * would buy indirection and a build step for a single dictionary.
 *
 * Strings live here rather than inline so a second console language remains a
 * find-and-replace of this file plus a locale source, instead of an archaeology exercise
 * across every component.
 *
 * ## Server messages
 *
 * `apiError` maps what the API returns — which is English, and is a contract other
 * clients depend on — onto Arabic for display. The matching is on the English text
 * deliberately: translating the API would break the contract, and passing its English
 * through would put two languages on one screen.
 */
export const AR = {
  login: {
    title: 'مركز القيادة',
    subtitle: 'الدخول مخصص لموظفي سفرة فقط.',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    showPassword: 'إظهار كلمة المرور',
    hidePassword: 'إخفاء كلمة المرور',
    submitCredentials: 'تسجيل الدخول',
    submittingCredentials: 'جارٍ التحقق…',
    code: 'رمز المصادقة',
    codeHint:
      'أدخل الرمز من تطبيق المصادقة الثنائية. إذا فقدت جهازك، يمكنك إدخال أحد رموز الاسترداد.',
    submitCode: 'تأكيد الرمز',
    submittingCode: 'جارٍ التأكيد…',
    signingInAs: 'تسجيل الدخول باسم',
    useDifferentAccount: 'استخدام حساب آخر',
  },

  /** Copy shared by more than one console screen. */
  dashboard: {
    signOut: 'تسجيل الخروج',
    signingOut: 'جارٍ تسجيل الخروج…',
    bookingReferencePlaceholder: 'BKG-2026-000123',
    findBookingLabel: 'البحث عن حجز برقم المرجع',
    findBooking: 'بحث',
    propertiesPending: 'عقارات بانتظار المراجعة',
    countersFailed: 'تعذّر تحميل العدادات. حدّث الصفحة للمحاولة مرة أخرى.',
    queueFailed: 'تعذّر تحميل هذه القائمة.',
    sessionExpired: 'انتهت جلستك. سجّل الدخول مرة أخرى.',
    nothingWaiting: 'لا يوجد شيء بالانتظار.',
    screened: 'تم الفحص',
    notScreened: 'لم يتم الفحص',
    documents: 'مستند',
    submitted: 'قُدّم في',
  },

  /** The command-center sidebar, in the approved design's order. */
  nav: {
    heading: 'مركز قيادة سفرة',
    notBuilt: 'لم يُبنَ هذا القسم بعد',
    dashboard: 'لوحة الإدارة',
    bookings: 'الحجوزات',
    partners: 'الشركاء',
    properties: 'العقارات',
    customers: 'العملاء',
    staff: 'الموظفون',
    payments: 'الدفع والفواتير',
    wallet: 'المحفظة',
    giftCards: 'بطاقات الهدايا',
    coupons: 'الكوبونات',
    ads: 'الإعلانات',
    disputes: 'النزاعات',
    messages: 'الرسائل',
    whatsapp: 'واتساب والبريد',
    geo: 'المدن والدول والعملات',
    reports: 'التقارير',
    settings: 'الإعدادات',
    audit: 'سجل التدقيق',
  },

  /** The dashboard proper, matching the approved design's panels. */
  admin: {
    title: 'لوحة الإدارة',
    emergencyMode: '⚠ وضع الطوارئ',
    kpiRow: 'مؤشرات اليوم',
    kpiBookingsToday: 'حجوزات اليوم',
    kpiBookingsTodaySub: 'عن أمس',
    kpiPending: 'قيد التأكيد',
    kpiPendingSub: 'تنتهي مهلتها قريباً',
    kpiRevenue: 'إيراد اليوم (عمولات)',
    kpiCancelled: 'إلغاءات اليوم',
    kpiCancelledSub: 'بغرامة شريك',
    kpiDisputes: 'نزاعات مفتوحة',
    kpiDisputesSub: 'مفتوحة أو قيد المراجعة',
    kpiDisputesUnavailable: 'تعذّر تحديد العدد',
    /** Prefixes a count that qualifies the card's main figure: "منها 3 …". */
    ofWhich: 'منها',
    attention: '⚑ يحتاج انتباهك الآن',
    attentionEmpty: 'لا شيء يحتاج انتباهاً عاجلاً.',
    attentionSla: 'حجز تنتهي مهلة تأكيده خلال 30 دقيقة',
    attentionPartners: 'شريك بانتظار التحقق من الوثائق',
    attentionProperties: 'عقار بانتظار المراجعة قبل النشر',
    handle: 'معالجة',
    systemActor: 'النظام',
    latestBookings: 'أحدث الحجوزات',
    viewAll: 'عرض الكل ←',
    colReference: 'رقم الحجز',
    colProperty: 'العقار',
    colCustomer: 'العميل',
    colAmount: 'المبلغ',
    colStatus: 'الحالة',
    weekRevenue: 'إيرادات الأسبوع',
    weekRevenueSub: 'عمولة الشريك 7٪ + رسوم خدمة 1.99$ · بالدولار',
    pendingPartners: 'شركاء بانتظار الموافقة',
    pendingPartnersNote: 'لا يُنشر أي عقار قبل التحقق من الوثائق والصور والعنوان (P-002)',
    recentActivity: 'سجل التدقيق — آخر العمليات',
    noData: '—',
    today: 'اليوم',
  },

  partners: {
    subtitle: 'كل شريك بانتظار التحقق من وثائقه قبل نشر أي عقار له.',
  },

  properties: {
    subtitle: 'كل عقار بانتظار المراجعة. لا يُنشر عقار قبل الموافقة (P-002).',
  },

  /** Shared table chrome. */
  table: {
    search: 'بحث',
    exportCsv: 'تصدير CSV',
    nextPage: 'الصفحة التالية ←',
    empty: 'لا نتائج.',
    open: 'فتح الملف ←',
    manage: 'إدارة ←',
    profile: 'الملف ←',
    permissions: 'الصلاحيات ←',
    colId: 'المعرف',
    colStatus: 'الحالة',
    colAction: 'إجراء',
    colType: 'النوع',
    colCity: 'المدينة',
    colAmount: 'المبلغ',
    colDates: 'التواريخ',
    colTime: 'الوقت',
  },

  /**
   * Per-section copy, verbatim from the design handoff.
   *
   * Every `note` is a business rule an operator has to know — that a partner is never
   * hard-deleted, that a ledger row is immutable, that a dispute freezes a payout. They are
   * quoted exactly and must not be paraphrased.
   */
  sections: {
    bookings: {
      searchPlaceholder: 'بحث برقم الحجز، العقار، العميل…',
      allStatuses: 'كل الحالات',
      count: (n: string) => `${n} حجز · كل حجز له خط زمني وسجل تدقيق ورقم مرجعي (P-004)`,
      note: 'فتح أي حجز يعرض: بيانات العميل والشريك والعقار والدفع والرسائل والواتساب والبريد والخط الزمني، مع ملاحظات داخلية لا يراها العميل أو الشريك. تغيير الحالة بصلاحيات محددة فقط ويسجَّل في سجل التدقيق.',
    },

    partners: {
      title: 'سجل الشركاء',
      searchPlaceholder: 'بحث عن شريك…',
      colPartner: 'الشريك',
      colScore: 'Score',
      colTier: 'التصنيف',
      note: 'Score يبدأ من 100: الرد السريع والتقييم المرتفع يرفعانه؛ التأخر والإلغاء وعدم تحديث التوفر يخفضونه — ويؤثر على ترتيب «موصى به من سفرة». لا حذف نهائي لأي شريك (P-003): Suspend / Deactivate فقط.',
      contracts: 'عقود الشراكة',
      contractsHint:
        'ارفع العقد الموقّع بين سفرة والشريك (PDF ≤ 10MB) — يُحفظ في سجل الشريك ويُوثّق في Audit Log',
      pendingTitle: 'بانتظار الموافقة — التحقق قبل النشر (P-002)',
    },

    properties: {
      title: 'سجل العقارات',
      searchPlaceholder: 'بحث عن عقار…',
      colProperty: 'العقار',
      colPartner: 'الشريك',
      note: 'أنواع الإقامة قابلة للإضافة من هنا دون تعديل الكود. كل وحدة لها تقويم مستقل بحالات: متاح، محجوز، مغلق، تحت الصيانة.',
    },

    customers: {
      searchPlaceholder: 'بحث عن عميل…',
      colName: 'الاسم',
      colBookings: 'حجوزات',
      colWallet: 'رصيد المحفظة',
      colLast: 'آخر نشاط',
      registered: 'مسجل',
      guest: 'ضيف',
      note: 'حسابات الضيوف تُحفظ ببيانات الحجز فقط ويمكن ترقيتها لحساب دائم. لا يرى موظفو الدعم بيانات الدفع الحساسة.',
    },

    payments: {
      searchPlaceholder: 'بحث بمعرف العملية أو الحجز…',
      colLinked: 'مرتبط بـ',
      colMethod: 'الوسيلة',
      kpiCaptured: 'مقبوضات اليوم',
      kpiRefunded: 'استردادات اليوم',
      kpiPayable: 'مستحقات شركاء غير مدفوعة',
      kpiFines: 'غرامات محصلة (هذا الشهر)',
      /**
       * The design's fourth KPI is "تحويلات شركاء مجدولة" — SCHEDULED transfers. There is no
       * payouts table and payment rails are deferred, so this shows what is OWED instead and
       * says so. Presenting an obligation as a scheduled transfer would be a fabrication.
       */
      payableNote: 'إجمالي المستحق للشركاء — لا يوجد جدول تحويلات بعد',
      typePayment: 'دفع',
      typeRefund: 'استرداد',
      typeFine: 'غرامة',
      note: 'كل حركة مالية سجل ثابت غير قابل للتعديل (immutable). منع الدفع المكرر عبر idempotency key (EC-003). لا تُخزَّن بيانات البطاقات إلا وفق PCI لدى مزود الدفع.',
      payoutsMissing:
        'تحويلات الشركاء (TRF) غير معروضة: لا يوجد جدول تحويلات بعد، ومسارات الدفع مؤجلة بقرار.',
    },

    wallet: {
      searchPlaceholder: 'بحث بالعميل أو السبب…',
      colOperation: 'العملية',
      colCustomer: 'العميل',
      colReason: 'السبب',
      colBalanceAfter: 'الرصيد بعدها',
      note: 'المحفظة تخزن تعويضات العملاء (P-007) — مثل 10$ عند فشل الشريك بالرد أول مرة — وتُستخدم مع بطاقة هدية ووسيلة دفع أخرى في عملية واحدة. كل حركة لها سبب مسجَّل.',
    },

    giftcards: {
      searchPlaceholder: 'بحث بالكود أو المشتري…',
      create: '+ إنشاء بطاقة هدية',
      hint: 'الإنشاء والتعديل بصلاحيات إدارية محددة فقط — يسجَّل في سجل التدقيق',
      colCode: 'الكود',
      colValue: 'القيمة الأصلية',
      colRemaining: 'الرصيد المتبقي',
      colBuyer: 'الشراء بواسطة',
      colExpiry: 'الصلاحية',
      note: 'تُستخدم للحجوزات والمطاعم والأنشطة الشريكة. الرصيد المتبقي يبقى في البطاقة إذا فاقت قيمتها العملية. بطاقة منتهية أثناء الدفع؟ تُعاد الحسبة قبل التأكيد (EC-012).',
      /** Codes are hashed and never returned — see PromotionsService. */
      codeNote: 'يُعرض آخر أربعة أحرف فقط — الأكواد مُعمَّاة ولا تُسترجع من هنا.',
    },

    coupons: {
      searchPlaceholder: 'بحث بالكود أو النوع…',
      create: '+ كوبون جديد',
      hint: 'منفصلة تماماً عن بطاقات الهدايا · أنواعها: أول حجز، موسمية، مدينة، شريك، حملة تسويقية',
      colDiscount: 'الخصم',
      colMin: 'حد أدنى',
      colUsage: 'الاستخدام',
      colPeriod: 'الفترة',
    },

    geo: {
      countries: 'دول الإطلاق',
      addCountry: '+ إضافة دولة',
      currencies: 'العملات',
      addCurrency: '+ إضافة عملة',
      cities: 'المدن',
      addCity: '+ إضافة مدينة',
      searchPlaceholder: 'بحث عن مدينة…',
      accounting: 'العملة المحاسبية',
      noRate: 'لا سعر صرف مُعرَّف',
      colCountry: 'الدولة',
      colCategory: 'الفئة',
      colProperties: 'عقارات',
      activeCities: (n: string) => `${n} مدينة نشطة`,
      note: 'الأسعار تُعرض للعميل حسب البلد أو العملة المختارة. أسعار الصرف تُعدَّل من هنا لا من الكود (P-005).',
      citiesNote:
        'صفحة كل مدينة: أول ثلثها صور عالية الجودة، ثم وصف وتصنيفات وعروض — وتُستخدم لأهداف SEO لاحقاً.',
      fxElsewhere: 'تعديل أسعار الصرف من شاشة أسعار الصرف — بسجل تغييرات مُدقَّق.',
    },

    reports: {
      commissionRevenue: 'إيرادات العمولات',
      commissionRevenueSub: 'رسوم خدمة 1.99$ للعميل + عمولة 7٪ شريك · هذا الأسبوع',
      occupancy: 'نسبة الإشغال',
      occupancySub: 'من الأيام المسجَّلة في تقويم الوحدات',
      cancellations: 'الإلغاءات',
      cancellationsSub: 'من حجوزات الأسبوع',
      partnerResponse: 'وسيط رد الشركاء',
      partnerResponseSub: 'المهلة القصوى ساعتان قبل الإلغاء والغرامة',
      minutes: 'دقيقة',
      noPrevious: 'لا مقارنة',
      vsPrevious: 'عن الأسبوع الماضي',
    },

    staff: {
      searchPlaceholder: 'بحث بالاسم أو البريد أو الدور…',
      kpiTotal: 'إجمالي الموظفين',
      kpiTotalSub: (a: string, s: string, i: string) =>
        `${a} نشطين · ${s} معطّل · ${i} دعوة`,
      kpiSignedIn: 'دخلوا اليوم',
      kpiRoles: 'أدوار معرّفة',
      kpiRolesSub: 'من مدير عام إلى دعم',
      kpiInvites: 'دعوات معلقة',
      kpiInvitesSub: 'صالحة 48 ساعة',
      kpiTwoFactor: 'بلا مصادقة ثنائية',
      matrix: 'مصفوفة الصلاحيات',
      matrixHint:
        'ما يستطيع كل دور فعله داخل لوحة الإدارة — مقروءة من نفس الجدول الذي يفرضه الخادم',
      permission: 'الصلاحية',
      allowed: 'مسموح',
      denied: 'ممنوع',
      /**
       * The handoff's third state — ○ "بموافقة مدير" — has no equivalent in the model: a
       * permission is granted or it is not. Saying so beats drawing a symbol that implies an
       * approval workflow exists.
       */
      noApprovalTier: 'لا توجد حالة «بموافقة مدير» في النموذج: الصلاحية ممنوحة أو لا.',
      activity: 'آخر نشاط الموظفين',
      note: 'لا يُحذف حساب موظف نهائياً — يُعطّل فقط مع الاحتفاظ بأثره في سجل التدقيق. كل تغيير صلاحية يُوثّق باسم من نفّذه.',

      /** The invite form (§8.2). */
      invite: 'دعوة موظف جديد',
      inviteHint:
        'تُرسل دعوة برابط لمرة واحدة يضبط بها كلمة مروره — لا تراها أنت، ولا يعمل الحساب قبل قبول الدعوة وتمكين المصادقة الثنائية.',
      inviteEmail: 'البريد المهني',
      inviteRole: 'الدور',
      inviteSend: 'إرسال الدعوة',
      inviteSending: 'جارٍ الإرسال…',
      inviteSent: (email: string) => `أُرسلت الدعوة إلى ${email}.`,
      inviteResend: 'إعادة إرسال الدعوة',
      inviteResent: (email: string) => `أُعيد إرسال الدعوة إلى ${email}.`,
      inviteNote:
        'تُرسل دعوة بريدية صالحة 48 ساعة · التحقق الثنائي إلزامي لكل حساب موظف.',

      /** Row state and actions. */
      you: '— أنت',
      lastSignIn: (when: string) => `آخر دخول ${when}`,
      neverSignedIn: 'لم يسجّل الدخول بعد',
      invitationPending: 'دعوة معلقة',
      twoFactorMissing: 'بلا مصادقة ثنائية',
      suspended: 'معطّل',
      suspend: 'تعطيل',
      reinstate: 'إعادة تنشيط',
      roleChanged: (email: string, role: string) => `${email} أصبح ${role}.`,
      suspendedNotice: (email: string) => `عُطّل ${email} وأُنهيت جلساته.`,
      reinstatedNotice: (email: string) => `أُعيد تنشيط ${email}.`,
      actionFailed: 'تعذّر تنفيذ هذا الإجراء.',
    },

    audit: {
      immutable: 'غير قابل للحذف',
      hint: 'كل عملية إدارية أو مالية أو حساسة تُسجَّل مع IP والجهاز والموظف والوقت',
      searchPlaceholder: 'بحث بالموظف أو العملية أو الكيان…',
      colStaff: 'الموظف',
      colAction: 'العملية',
      colEntity: 'الكيان',
      colIp: 'IP',
    },

    disputes: {
      searchPlaceholder: 'بحث بالنزاع أو الحجز أو العميل…',
      kpiOpen: 'نزاعات مفتوحة',
      kpiInvestigating: 'قيد المراجعة',
      kpiOldest: 'أقدم نزاع مفتوح',
      kpiFrozen: 'مستحقات مجمّدة',
      kpiFrozenSub: 'حجوزات لا تُحوَّل حتى الإغلاق',
      kpiResolved: 'أُغلقت هذا الشهر',
      hours: 'ساعة',
      evidence: (n: string) => `${n} صورة مرفوعة`,
      open: 'فتح النزاع ←',
      frozen: 'المستحقات مجمّدة',
      note: 'فتح النزاع يجمّد استحقاق تحويل الشريك للحجز المعني حتى الإغلاق. الصور المرفوعة من العميل (EC-007) تظهر داخل ملف النزاع.',
      /** The close form. */
      close: 'إغلاق النزاع',
      outcome: 'النتيجة',
      outcomeResolved: 'لصالح العميل — تُقبل الشكوى',
      outcomeRejected: 'ترفض الشكوى',
      resolution: 'قرار الإغلاق',
      resolutionHint:
        'مطلوب — يُحفظ مع النزاع وفي سجل التدقيق، ويُقرأ لاحقاً من العميل والشريك',
      compensation: 'تعويض المحفظة (اختياري)',
      compensationHint: 'يُضاف فوراً إلى محفظة العميل بحركة مسجَّلة',
      closing: 'جارٍ الإغلاق…',
      closedBy: 'أُغلق',
      confirmClose: 'تأكيد الإغلاق',
    },

    messages: {
      searchPlaceholder: 'بحث في المحادثات…',
      subjectBooking: 'حجز',
      subjectDispute: 'نزاع',
      subjectPartner: 'شريك',
      parties: (customer: string, partner: string) => `${customer} ↔ سفرة ↔ ${partner}`,
      noMessages: 'لا رسائل بعد.',
      unread: 'غير مقروءة',
      closed: 'مغلقة',
      internalNote: 'ملاحظة داخلية',
      redacted: (n: string) => `حُجب ${n} من بيانات التواصل`,
      senderCustomer: 'العميل',
      senderPartner: 'الشريك',
      senderStaff: 'سفرة',
      senderSystem: 'النظام',
      reply: 'إرسال',
      replying: 'جارٍ الإرسال…',
      replyPlaceholder: 'اكتب رداً…',
      replyInternal: 'ملاحظة داخلية — لا يراها العميل أو الشريك',
      note: 'دردشة ثلاثية: العميل، سفرة، الشريك — سفرة تراقب وتوجّه. يُمنع تبادل أرقام هواتف أو بيانات تواصل مباشرة قبل تأكيد الحجز، وتُحجب تلقائياً.',
      redactionNote: 'الحجب يطبَّق على ردود الموظفين أيضاً، ولا يُحفظ النص الأصلي.',
    },

    comms: {
      searchPlaceholder: 'بحث بالقالب أو المعرف…',
      templates: 'القوالب — بثلاث لغات',
      templatesLocales: 'ع · EN · DE',
      notWired: 'غير مُنفَّذ',
      colChannel: 'القناة',
      colTemplate: 'القالب',
      channelWhatsapp: 'واتساب',
      channelEmail: 'بريد',
      channelInApp: 'داخل التطبيق',
      attempts: (n: string) => `${n} محاولات`,
      window: (days: string) => `آخر ${days} يوماً`,
      note: 'واتساب للتنبيهات فقط (ليس بديلاً للدعم). تأكيد الحجز يُرسل خلال مهلة أقصاها ساعتان من الدفع. حالة كل رسالة تُسجَّل: مرسلة / فشلت / قيد الانتظار، وكل بريد يرتبط بالحجز في الخط الزمني. الإرسال عبر طابور خلفي.',
      whatsappBlocked:
        'قناة واتساب موقوفة على قرار المزود (البند 192): يُسجَّل كل ما يُفترض إرساله ولا تُرسل رسالة فعلياً. البريد يعمل.',
    },

    ads: {
      searchPlaceholder: 'بحث بالمعلن أو المدينة…',
      kpiActive: 'حملات نشطة',
      kpiPaused: 'حملات متوقفة',
      kpiEnding: 'تنتهي خلال أسبوع',
      kpiImpressions: 'مشاهدات',
      kpiClicks: 'نقرات',
      colAdvertiser: 'المعلن',
      colPeriod: 'المدة',
      colImpressions: 'مشاهدات',
      colClicks: 'نقرات',
      endsIn: (days: string) => `ينتهي بعد ${days} أيام`,
      ended: 'انتهت المدة',
      pause: 'إيقاف',
      resume: 'تشغيل',
      pausing: 'جارٍ التنفيذ…',
      ctr: 'نسبة النقر',
      monthly: 'شهري',
      weekly: 'أسبوعي',
      quarterly: 'ربع سنوي',
      note: 'الإعلانات موجَّهة حسب مدينة حجز العميل، وتظهر بعد تأكيد الحجز أو داخل صفحة الحجز — موسومة دائماً «إعلان شريك» ولا تُخلط بترتيب البحث الطبيعي. رسالة واتساب واحدة غير مزعجة كحد أقصى.',
      noRanking:
        'لا يوجد ترتيب أو أولوية للإعلانات في نتائج البحث — لا في الواجهة ولا في قاعدة البيانات.',
    },

    contracts: {
      title: 'عقود الشراكة',
      hint: 'ارفع العقد الموقّع بين سفرة والشريك (PDF ≤ 10MB) — يُحفظ في سجل الشريك ويُوثّق في Audit Log',
      partner: 'الشريك',
      kind: 'نوع العقد',
      kindBase: 'عقد شراكة أساسي',
      kindCommissionAnnex: 'ملحق تعديل عمولة',
      kindRenewal: 'تجديد سنوي',
      expiry: 'تاريخ الانتهاء',
      file: 'ملف العقد',
      upload: 'رفع العقد',
      uploading: 'جارٍ الرفع…',
      view: 'عرض',
      markSigned: 'تسجيل التوقيع',
      signedOn: (date: string) => `وُقِّع ${date}`,
      uploadedBy: (date: string, who: string) => `رُفِع ${date} بواسطة ${who}`,
      validUntil: (date: string) => `ساري حتى ${date}`,
      expiringIn: (days: string) => `ينتهي خلال ${days} يوماً`,
      expired: 'منتهٍ',
      awaitingSignature: 'بانتظار توقيع الشريك',
      superseded: 'مُستبدَل',
      terminated: 'مُنهى',
      none: 'لا عقود مرفوعة لهذا الشريك.',
      pdfOnly: 'PDF فقط، وبحد أقصى 10 ميغابايت.',
      supersedeNote:
        'رفع عقد جديد من النوع نفسه يجعل السابق «مُستبدَلاً» ولا يحذفه — أي شروط كانت سارية يوم حجز مُتنازع عليه سؤال يُطرح فعلاً.',
    },

    settings: {
      title: 'Rules Engine — قيم تشغيلية قابلة للتعديل دون كود (P-005)',
      hint: 'أي تعديل هنا يتطلب صلاحية مالية ويُسجَّل في سجل التدقيق مع IP والجهاز والوقت.',
      save: 'حفظ',
      saving: 'جارٍ الحفظ…',
      change: 'تعديل',
      cancel: 'إلغاء',
      value: 'القيمة',
      amount: 'المبلغ',
      mode: 'النمط',
      enabled: 'مفعّل',
      disabled: 'معطّل',
      reason: 'سبب التعديل — يُسجَّل مع التغيير',
      lastChanged: (who: string, when: string) => `آخر تعديل: ${who} · ${when}`,
      saveFailed: 'تعذّر حفظ هذه القيمة.',
      /** Hints per value schema, so the operator knows the expected form before typing. */
      hintRate: 'كسر بين 0 و 1 — نسبة 7٪ تُكتب 0.07',
      hintPercent: 'رقم من 0 إلى 100',
      hintHourOfDay: 'ساعة من 0 إلى 23 بتوقيت المدينة',
      hintInt: 'رقم صحيح',
      feeFlat: 'ثابت — مبلغ لكل حجز',
      feePercent: 'نسبة — حصة من قيمة الإقامة',
      /** Shown for a schema this form cannot validate, naming the schema. */
      notEditable: (schema: string) =>
        `هذا الإعداد من نوع ${schema}، ولا يستطيع هذا النموذج التحقق منه. تعديله من حقل عام قد يعطّله بصمت، فيبقى تغييره قراراً يُراجع.`,
    },

    emergency: {
      title: '⚠ وضع الطوارئ (EC-009) — ظروف قاهرة',
      hint: 'يفعَّل لمدينة أو دولة عند الظروف القاهرة. صلاحية Super Admin فقط، ويُسجَّل في سجل التدقيق.',
      scope: 'النطاق',
      scopeCity: 'مدينة محددة',
      scopeCountry: 'دولة كاملة',
      target: 'المدينة / الدولة',
      reason: 'سبب التفعيل',
      reasonHint: 'مطلوب ويُحفظ في سجل التدقيق — لا يمكن التفعيل دون سبب مكتوب',
      stopBookings: 'إيقاف الحجوزات الجديدة في النطاق',
      waiveFines: 'إلغاء غرامات الشركاء مؤقتاً',
      broadcast: 'إرسال رسالة جماعية للعملاء أصحاب الحجوزات القادمة',
      suspendSla: 'تعليق مهلة تأكيد الساعتين',
      activate: 'تفعيل وضع الطوارئ',
      deactivate: 'إيقاف وضع الطوارئ',
      activeBanner: (scope: string) => `⚠ وضع الطوارئ مفعّل — ${scope}`,
      history: 'سجل التفعيلات',
      never: 'لم يُفعَّل وضع الطوارئ من قبل.',
      broadcastPending:
        'الرسالة الجماعية غير مُنفَّذة بعد: قناة واتساب بانتظار قرار المزود — يُسجَّل الاختيار ولا تُرسل رسالة.',
    },
  },

  /** The four sections with no table behind them yet. */
  unbuilt: {
    heading: 'هذا القسم غير مُنفَّذ بعد',
    disputes:
      'النزاعات تحتاج جدولاً خاصاً (DSP) مع أدلة العميل وتجميد مستحقات الشريك. الصلاحيات مُعرَّفة والجدول غير موجود، ولن تُعرض بيانات مُختلقة.',
    messages:
      'الدردشة الثلاثية (العميل ↔ سفرة ↔ الشريك) تحتاج جدولي محادثات ورسائل مع حجب بيانات التواصل.',
    comms:
      'سجل واتساب والبريد يحتاج جدول إشعارات. الإرسال نفسه موقوف على قرار مزود واتساب.',
    ads: 'الإعلانات الموجهة تحتاج جدولي معلنين وحملات مع عدّادات المشاهدات والنقرات.',
    contracts:
      'عقود الشراكة تحتاج جدولاً للعقود (النوع، الملف، تاريخ الانتهاء، من رفعه) — الموجود حالياً تاريخ توقيع واحد على الشريك فقط. نموذج رفع بلا مكان للحفظ يفقد الملف، فلا يُعرض.',
    seeRegister: 'التفاصيل وخطة التنفيذ في docs/design-gap-report.md',
  },

  /**
   * Audit actions, so the activity panel is not a list of English identifiers.
   *
   * Keyed on the value stored in `audit_log.action`, which is a machine identifier and part
   * of the record — it is deliberately NOT translated at the source. Every action present in
   * the database is listed here; an action added later falls back to its raw key, which is
   * ugly but never wrong, and reads as a prompt to add it.
   */
  auditAction: {
    'auth.registered': 'تسجيل حساب جديد',
    'auth.email_verified': 'تأكيد البريد الإلكتروني',
    'auth.login_succeeded': 'تسجيل دخول ناجح',
    'auth.login_failed': 'محاولة دخول فاشلة',
    'auth.password_reset_requested': 'طلب إعادة تعيين كلمة المرور',
    'auth.password_reset_completed': 'إعادة تعيين كلمة المرور',
    'auth.two_factor_enabled': 'تمكين المصادقة الثنائية',
    'booking.sla_expired': 'انتهاء مهلة تأكيد حجز',
    'fx_rate.set': 'تحديث سعر صرف',
    'partner.registered': 'تسجيل شريك',
    'partner.approved': 'الموافقة على شريك',
    'partner.sanctions_screened': 'فحص العقوبات لشريك',
    'partner_document.uploaded': 'رفع وثيقة شريك',
    'partner_document.viewed': 'عرض وثيقة شريك',
    'partner_document.reviewed': 'مراجعة وثيقة شريك',
    'property.approved': 'الموافقة على عقار',
    'setting.updated': 'تعديل إعداد',
    'staff.invited': 'دعوة موظف',
    'staff.invitation_accepted': 'قبول دعوة موظف',
    'staff.role_changed': 'تغيير دور موظف',
    'staff.suspended': 'إيقاف موظف',
    'wallet.adjusted': 'تعديل محفظة',
    // Added 2026-08-04 with the four new sections.
    'dispute.resolved': 'إغلاق نزاع لصالح العميل',
    'dispute.rejected': 'رفض نزاع',
    'emergency_mode.activated': 'تفعيل وضع الطوارئ',
    'emergency_mode.deactivated': 'إيقاف وضع الطوارئ',
    'ad_campaign.paused': 'إيقاف حملة إعلانية',
    'ad_campaign.resumed': 'تشغيل حملة إعلانية',
    'partner_contract.uploaded': 'رفع عقد شراكة',
    'partner_contract.signed': 'تسجيل توقيع عقد شراكة',
  } as Record<string, string>,

  /**
   * Every enum the console renders, in Arabic.
   *
   * Grouped in one place because the alternative — translating at each call site — is how
   * `pending_confirmation` ended up on screen in three different forms. Each map falls back to
   * the raw value rather than to blank: an untranslated key is ugly and obviously a gap, while
   * an empty cell reads as "no value" and is a lie.
   */
  enums: {
    propertyStatus: {
      draft: 'مسودة',
      pending_review: 'قيد المراجعة',
      rejected: 'مرفوض',
      approved: 'معتمد',
      published: 'منشور',
      suspended: 'موقوف مؤقتاً',
      archived: 'مؤرشف',
    } as Record<string, string>,

    verification: {
      pending: 'بانتظار التحقق',
      in_review: 'قيد المراجعة',
      approved: 'معتمد',
      rejected: 'مرفوض',
    } as Record<string, string>,

    partnerTier: {
      new: 'جديد',
      needs_improvement: 'يحتاج تحسين',
      silver: 'فضي',
      gold: 'ذهبي',
    } as Record<string, string>,

    paymentMethod: {
      visa: 'Visa',
      mastercard: 'Mastercard',
      sham_cash: 'Sham Cash',
      klarna: 'Klarna',
      gift_card: 'بطاقة هدية',
      wallet: 'محفظة',
      bank_transfer: 'تحويل مصرفي',
    } as Record<string, string>,

    paymentStatus: {
      initiated: 'بدأت',
      requires_action: 'تحتاج إجراء',
      authorized: 'مُصرَّح بها',
      captured: 'ناجحة',
      failed: 'فشلت',
      expired: 'منتهية',
      refunded: 'مستردة',
      partially_refunded: 'مستردة جزئياً',
      pending: 'قيد المعالجة',
      processing: 'قيد المعالجة',
      completed: 'مكتمل',
      collected: 'محصلة',
      waived: 'ملغاة',
    } as Record<string, string>,

    violationKind: {
      no_response: 'عدم الرد',
      rejected_after_payment: 'رفض بعد الدفع',
      stale_calendar: 'تقويم غير محدَّث',
      inaccurate_listing: 'وصف غير مطابق',
      no_show: 'عدم استقبال',
    } as Record<string, string>,

    walletReason: {
      sla_compensation: 'تعويض مهلة',
      refund: 'استرداد',
      booking_payment: 'استخدام في حجز',
      admin_adjustment: 'تعديل إداري',
      gift_card_transfer: 'تحويل بطاقة هدية',
      profile_claim: 'ضم حساب ضيف',
    } as Record<string, string>,

    giftCardStatus: {
      active: 'نشطة',
      used: 'مستخدمة',
      expired: 'منتهية',
      cancelled: 'ملغاة',
    } as Record<string, string>,

    couponType: {
      first_booking: 'أول حجز',
      seasonal: 'موسمية',
      city: 'مدينة',
      partner: 'شريك',
      campaign: 'حملة تسويقية',
    } as Record<string, string>,

    disputeKind: {
      property_unavailable: 'العقار غير متاح (EC-006)',
      not_as_described: 'غير مطابق للوصف (EC-007)',
      partner_no_response: 'الشريك لم يرد (EC-008)',
      complaint: 'شكوى',
    } as Record<string, string>,

    disputeStatus: {
      open: 'مفتوح',
      investigating: 'قيد المراجعة',
      resolved: 'مغلق — لصالح العميل',
      rejected: 'مغلق — مرفوض',
    } as Record<string, string>,

    notificationStatus: {
      queued: 'قيد الانتظار',
      sent: 'مرسلة',
      delivered: 'وصلت',
      failed: 'فشلت',
    } as Record<string, string>,

    adStatus: {
      draft: 'مسودة',
      active: 'نشط',
      paused: 'متوقف',
      expired: 'منتهٍ',
    } as Record<string, string>,

    advertiserKind: {
      restaurant: 'مطعم',
      activity: 'نشاط',
      shop: 'متجر',
      transport: 'نقل',
      other: 'أخرى',
    } as Record<string, string>,

    cityCategory: {
      coastal: 'ساحلية',
      mountain: 'جبلية',
      desert: 'صحراوية',
      historic: 'تاريخية',
    } as Record<string, string>,
  },

  /** Booking statuses, so the table does not show raw enum values. */
  bookingStatus: {
    pending_payment: 'بانتظار الدفع',
    pending_confirmation: 'قيد التأكيد',
    confirmed: 'مؤكد',
    checked_in: 'تم الوصول',
    completed: 'مكتمل',
    cancelled: 'ملغى',
    disputed: 'متنازع عليه',
  } as Record<string, string>,

  /** Role names, so `super_admin` does not appear raw next to Arabic text. */
  roles: {
    super_admin: 'مدير عام',
    operations_manager: 'مدير عمليات',
    finance_officer: 'مسؤول مالي',
    support_agent: 'موظف دعم',
  } as Record<string, string>,

  errors: {
    credentials: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    codeFormat: 'تنسيق الرمز غير صحيح. أدخل ستة أرقام أو رمز استرداد.',
    notStaff: 'هذا الحساب لا يملك صلاحية الدخول إلى مركز القيادة.',
    locked: 'هذا الحساب مقفل مؤقتاً. حاول مرة أخرى بعد قليل.',
    tooMany: 'محاولات كثيرة. انتظر دقيقة ثم حاول مرة أخرى.',
    unreachable: 'تعذّر الوصول إلى الخادم. حاول مرة أخرى.',
    unknown: 'حدث خطأ ما. حاول مرة أخرى.',
  },
} as const;

/** The Arabic booking status, falling back to the raw value rather than blank. */
export function bookingStatus(status: string): string {
  return AR.bookingStatus[status] ?? status.replace(/_/g, ' ');
}

/**
 * Looks a value up in one of the enum maps.
 *
 * Falls back to the raw key with underscores spaced out, which is deliberately ugly: an
 * untranslated status should look like a missing translation, not like a design choice.
 */
export function label(
  map: Record<string, string>,
  value: string | null | undefined,
): string {
  if (!value) return AR.admin.noData;

  return map[value] ?? value.replace(/_/g, ' ');
}

/** A city's `categories` array arrives pre-joined; translate each part. */
export function cityCategories(joined: string): string {
  return joined
    .split(' · ')
    .map((part) => AR.enums.cityCategory[part] ?? part)
    .join(' · ');
}

/** The Arabic name for an audit action, falling back to the raw key rather than blank. */
export function auditAction(action: string): string {
  return AR.auditAction[action] ?? action.replace(/[._]/g, ' ');
}

/** The Arabic name for a role, falling back to the raw value rather than blank. */
export function roleName(role: string | undefined): string {
  if (!role) return '';

  return AR.roles[role] ?? role.replace(/_/g, ' ');
}

/**
 * Maps an English API message onto Arabic.
 *
 * Matched loosely on purpose: the API's exact wording is not a UI contract and will be
 * reworded, and an unmatched message falls through to a generic Arabic string rather
 * than surfacing English in an Arabic interface.
 */
export function apiError(message: string | null): string {
  if (!message) return AR.errors.unknown;

  if (/authenticator code required/i.test(message)) return AR.login.codeHint;
  if (/invalid authenticator code/i.test(message)) return 'رمز المصادقة غير صحيح.';
  if (/invalid recovery code/i.test(message)) return 'رمز الاسترداد غير صحيح.';
  if (/invalid email or password/i.test(message)) return AR.errors.credentials;
  if (/temporarily locked/i.test(message)) return AR.errors.locked;
  if (/too many/i.test(message)) return AR.errors.tooMany;

  return AR.errors.unknown;
}
