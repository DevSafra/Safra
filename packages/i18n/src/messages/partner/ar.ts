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

  nav: {
    heading: 'لوحة الشريك',
    dashboard: 'لوحة التحكم',
    properties: 'عقاراتي',
    reviews: 'التقييمات',
    /** The handoff's sidebar footer, verbatim. */
    support: 'الدعم: partners@safra.com',
    showSidebar: 'إظهار قائمة التنقل',
    hideSidebar: 'إخفاء قائمة التنقل',
    signOut: 'تسجيل الخروج',
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
    notBuilt: 'لم يُبنَ هذا القسم بعد',
  },

  /** Property state, as the handoff's §7.2 pills name it. */
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

  reviews: {
    title: 'تقييمات ضيوفي',
    /** P-006, quoted by the handoff. */
    rule: 'لا يمكن حذف تقييم — يمكنك الرد عليه أو الإبلاغ عنه (P-006)',
    notBuilt: 'التقييمات لم تُبنَ بعد — لا يوجد جدول تقييمات في قاعدة البيانات.',
  },
} as const;
