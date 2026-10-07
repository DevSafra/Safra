/**
 * The partnership agreement, as a document SAFRA generates rather than a file somebody uploads.
 *
 * ## The wording is the final contract, verbatim
 *
 * Replaced on 2026-10-07 with «اتفاقية شراكة تجارية وتسويق وإدارة حجوزات الإقامة», the Arabic
 * text Bashar supplied as `_عقد_Safrra_النهائي_عربي_موحد_جاهز_للطباعة.docx`, word for word and in
 * its order: the cover table, the two parties, twenty-six articles, the cancellation table and the
 * signature page. The design is SAFRA's own — the lockup, the type, the tables — and only the
 * content changed. Its blanks («____») stay blanks: they are filled by hand on the printed copy,
 * as the document intends, and the commission in particular is deliberately absent (article 7).
 *
 * One correction to the source, on Bashar's instruction (2026-10-07): the document spells the name
 * «Safrra»; the platform's name is «Safra», and every occurrence here is written that way.
 *
 * The document is Arabic only. Article 25 says so («حررت الاتفاقية باللغة العربية … وتكون العربية
 * المرجع»), so the English that sat under each placeholder clause is gone rather than translated:
 * a translation printed beside the operative text would be a second version to disagree with it.
 *
 * ## Why HTML rendered by a browser, and not a PDF library
 *
 * The same reason the receipt gives (`O-fin-2`): `pdfkit` and `pdf-lib` do no contextual glyph
 * shaping and no bidirectional layout, so Arabic comes out as disconnected left-to-right
 * letterforms — perfect to anyone testing in English and unusable for the audience.
 *
 * ## Determinism is a requirement here, not a preference
 *
 * The generated PDF is hashed, and every returned scan records which hash it was signed against —
 * so a partner who signed a superseded revision is a discrepancy the record can show. That is only
 * worth anything if the same terms render to the same bytes, so nothing on the page may vary
 * between two renderings: no generation timestamp, no random id, no locale-dependent number
 * format. Everything is derived from data already fixed by the caller, and there is no `new Date()`
 * in this file.
 *
 * ## Signing is on PAPER
 *
 * Electronic signatures are not accepted in Syria (Bashar, 2026-08-21), so this document is
 * printed, signed and stamped by hand and scanned back. The signature page is the contract's own.
 */

import { SAFRA_LOCKUP_MARKUP } from '../brand/logo-markup.js';

export interface ContractTerms {
  /** §13.2 reference, printed so a paper copy can be matched to a record. */
  readonly partnerReference: string;
  readonly partnerLegalName: string;
  readonly partnerDisplayName: string;
  /** The date the document states, supplied by the caller so rendering stays pure. */
  readonly issuedOn: string;
}

/** A blank to be filled in by hand, as the source document draws it. */
const LINE = '____________________________';
const SHORT = '________________';
const DATE = '____ / ____ / ______';
const BLANK = '__________';

/** Escapes text for HTML. Every interpolated value goes through it; see the note in `render`. */
function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A label/value table, the shape the source uses for the cover, the parties and the notices. */
function fields(rows: readonly (readonly [string, string])[]): string {
  return `<table class="fields">${rows
    .map(([label, value]) => `<tr><th>${label}</th><td>${value}</td></tr>`)
    .join('')}</table>`;
}

/** A grid with a header row: the commission schedule, the cancellation policy, the record. */
function grid(head: readonly string[], rows: readonly (readonly string[])[]): string {
  return `<table class="grid"><thead><tr>${head
    .map((cell) => `<th>${cell}</th>`)
    .join('')}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

/**
 * Tick boxes, each kept WITH its word (Bashar, 2026-10-07).
 *
 * Written as one run of text, the line wrapped wherever it liked and left «☐» at the end of one
 * line with «أخرى» alone on the next, so the box read as belonging to nothing. Each «☐ label» pair
 * is unbreakable now; the line may wrap only between pairs.
 */
function options(labels: readonly string[]): string {
  return labels.map((label) => `<span class="option">☐ ${label}</span>`).join(' ');
}

function bullets(items: readonly string[]): string {
  return `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;
}

/** A numbered sub-clause («6.1 …»): the number set apart so the eye can find it. */
function clauses(items: readonly (readonly [string, string])[]): string {
  return items
    .map(([number, text]) => `<p class="clause"><b class="num">${number}</b> ${text}</p>`)
    .join('');
}

function article(title: string, body: string): string {
  return `<section class="article"><h2>${title}</h2>${body}</section>`;
}

/** One party's block on the signature page, exactly the fields the source lists. */
function signatory(heading: string): string {
  const line = (label: string) =>
    `<p class="label">${label}</p><p class="line">________________________________________</p>`;

  return `<div class="party">
      <p class="who">${heading}</p>
      ${line('الاسم الكامل / اسم الممثل المفوض:')}
      ${line('الصفة:')}
      ${line('رقم الهوية / السجل التجاري / رقم الترخيص:')}
      ${line('رقم الهاتف:')}
      ${line('البريد الإلكتروني:')}
      ${line('التوقيع:')}
      <p class="label">الختم الرسمي:</p>
      <div class="stamp">مساحة الختم</div>
      <p class="label">التاريخ:</p>
      <p class="line">${DATE}</p>
    </div>`;
}

/**
 * The agreement itself, verbatim from the source document.
 *
 * Static text written here, never data, so it is not escaped; the only values a caller supplies
 * are the identity line under the title, and those go through `escape` in `renderContractHtml`.
 */
const AGREEMENT = `
  ${fields([
    ['رقم الاتفاقية', LINE],
    ['تاريخ التوقيع', DATE],
    ['تاريخ النفاذ', DATE],
    ['مدة الاتفاقية', LINE],
  ])}

  <p class="notice">العمولة غير محددة في متن الاتفاقية، وتصبح نافذة فقط بعد اعتمادها كتابةً أو إلكترونياً من الطرفين.</p>

  ${article(
    'تمهيد وأطراف الاتفاقية',
    `<p>حيث إن Safra (سفرة) منصة رقمية متخصصة في حجوزات الإقامة والخدمات السياحية والترفيهية، وتهدف إلى ربط العملاء بالشركاء من خلال نظام حجز ودفع ودعم مركزي؛ وحيث إن الطرف الثاني يملك أو يدير منشأة أو وحدة إقامة ويرغب في تسويقها واستقبال الحجوزات من خلال سفرة؛ فقد اتفق الطرفان على تنظيم العلاقة التجارية والتشغيلية والمالية وفق هذه الاتفاقية والسياسات الواردة فيها.</p>

    <h3>أولاً: الطرف الأول — سفرة</h3>
    ${fields([
      ['الاسم التجاري', 'Safra | سفرة'],
      ['الصفة القانونية', LINE],
      ['رقم التسجيل/الترخيص', LINE],
      ['العنوان', LINE],
      ['البريد الإلكتروني', LINE],
      ['الهاتف', LINE],
      ['الممثل المفوض', LINE],
    ])}

    <h3>ثانياً: الطرف الثاني — الشريك</h3>
    ${fields([
      ['اسم الشريك/المنشأة', LINE],
      ['الصفة', options(['مالك', 'مدير/مشغل', 'مفوض قانوناً'])],
      [
        'نوع النشاط',
        options([
          'فندق',
          'شقة مفروشة',
          'فيلا',
          'مزرعة',
          'شاليه',
          'بيت ريفي',
          'مخيم',
          'أخرى',
        ]),
      ],
      ['رقم الهوية/السجل/الترخيص', LINE],
      ['العنوان', LINE],
      ['الهاتف', LINE],
      ['البريد الإلكتروني', LINE],
      ['الممثل المفوض', LINE],
      ['حساب التحويل المالي', LINE],
    ])}

    <p>ويشار إلى الطرف الأول لاحقاً بـ«سفرة» أو «المنصة»، وإلى الطرف الثاني بـ«الشريك»، ويشار إليهما مجتمعين بـ«الطرفين».</p>`,
  )}

  ${article(
    '1. التعريفات',
    `<p><b>المنصة:</b> موقع Safra وأنظمتها ولوحة الشريك وقنوات الإشعارات والدعم والحجز والدفع المرتبطة بها.</p>
    <p><b>العقار:</b> أي منشأة أو وحدة إقامة يعتمدها فريق سفرة للنشر، بما في ذلك الفندق والشقة والفيلا والمزرعة والشاليه والبيت الريفي والمخيم.</p>
    <p><b>الحجز:</b> طلب إقامة ينشئه العميل عبر سفرة، ولا يعد مؤكداً إلا بعد استكمال الدفع وتأكيد التوفر وفق آلية الحجز.</p>
    <p><b>قيمة الحجز:</b> القيمة الخاصة بخدمة الإقامة والخدمات التي تظهر ضمن ملخص الحجز قبل إتمام الدفع، وفق طريقة العرض المعتمدة.</p>
    <p><b>العمولة:</b> المقابل المستحق لسفرة عن الحجز أو الخدمة، وتبقى نسبتها أو قيمتها مفتوحة إلى حين اعتمادها وفق المادة 7.</p>
    <p><b>السياسة:</b> قواعد الإلغاء والاسترداد وعدم الحضور والتعديل والتشغيل المبينة في هذه الاتفاقية.</p>`,
  )}

  ${article(
    '2. طبيعة العلاقة',
    `<p>هذه الاتفاقية اتفاق تعاون تجاري وتسويق ووساطة وإدارة حجوزات، ولا تنشئ بذاتها شركة أو مشروعاً مشتركاً أو علاقة عمل أو وكالة عامة بين الطرفين.</p>
    <p>تتولى سفرة تشغيل واجهة الحجز والدفع والدعم والتواصل التشغيلي ضمن نطاق خدماتها، بينما يبقى الشريك مسؤولاً عن تقديم خدمة الإقامة الفعلية، وصحة المعلومات، والتوفر، والسلامة، والتجهيز، والنظافة، والمرافق، والالتزام بالتراخيص والأنظمة الخاصة بنشاطه.</p>
    <p>لا يملك أي طرف إلزام الطرف الآخر بأي التزام خارج هذه الاتفاقية أو تفويض خطي/إلكتروني معتمد.</p>`,
  )}

  ${article(
    '3. الترخيص والامتثال',
    bullets([
      'يلتزم كل طرف بالحصول على التراخيص والموافقات اللازمة قانوناً لممارسة نشاطه.',
      'يلتزم الشريك بتقديم وثائق الهوية والصفة وحق التشغيل وأي تراخيص مطلوبة قبل تفعيل العقار، ويضمن استمرار صلاحيتها.',
      'يحق لسفرة رفض النشر أو تعليق العقار إذا كانت الوثائق ناقصة أو منتهية أو ظهرت أسباب معقولة تتعلق بالقانونية أو السلامة أو حماية العملاء.',
      'لا يعتبر إدراج العقار على سفرة بديلاً عن أي ترخيص أو موافقة حكومية لازمة.',
      'يلتزم الطرفان بالأنظمة المتعلقة بحماية المستهلك، والمدفوعات، والضرائب والرسوم، والبيانات، وأي متطلبات تنظيمية واجبة التطبيق.',
    ]),
  )}

  ${article(
    '4. التزامات سفرة',
    bullets([
      'تشغيل المنصة وإتاحة أدوات الحجز والإشعارات ولوحة الشريك وفق الإمكانات المتاحة.',
      'إدارة طلبات الحجز والتواصل مع الشريك بشأن التأكيد أو الرفض.',
      'عرض السعر والرسوم وشروط الإلغاء المعتمدة للعميل قبل إتمام الدفع.',
      'إرسال تأكيد الحجز والقسيمة ورقم الحجز أو رمز QR بعد التأكيد.',
      'استقبال شكاوى العملاء والنزاعات ومتابعتها ضمن نطاق خدمات سفرة.',
      'إجراء التسويات وتحويل مستحقات الشريك بعد تحقق شروط الاستحقاق.',
      'عدم إظهار بيانات البطاقات أو بيانات الدفع الحساسة للشريك.',
      'حفظ السجلات التشغيلية والمالية اللازمة لتتبع الحجوزات والتسويات والنزاعات.',
    ]),
  )}

  ${article(
    '5. التزامات الشريك',
    bullets([
      'تقديم معلومات صحيحة ودقيقة وكاملة عن العقار والأسعار والتوفر والمرافق والصور وسياسات الإلغاء.',
      'تحديث التقويم والتوفر والأسعار باستمرار، وإغلاق الوحدة فور تأجيرها خارج سفرة أو عدم توفرها.',
      'الرد على طلبات الحجز خلال المهلة المحددة، والمهلة الافتراضية ساعتان من وقت الدفع ما لم تعتمد سفرة خلاف ذلك.',
      'عدم تأكيد أي حجز غير متاح أو مخالف للبيانات المنشورة.',
      'تقديم الخدمة بالمستوى والوصف والمرافق والسعر الذي تم تأكيده للعميل.',
      'عدم تحصيل مبالغ إضافية غير معلنة أو غير معتمدة قبل الحجز، إلا ما يسمح به النظام والسياسة والقانون.',
      'التعاون الفوري مع سفرة في حالات الإلغاء أو عدم التوفر أو الشكاوى أو النزاعات.',
      'تحمل مسؤولية صحة الصور والأوصاف والمعلومات والحق القانوني في استخدامها.',
      'إبلاغ سفرة فوراً بأي تغيير يؤثر على الحجوزات المؤكدة.',
    ]),
  )}

  ${article(
    '6. آلية الحجز والتأكيد',
    clauses([
      [
        '6.1',
        'وفق النموذج التشغيلي المعتمد، لا يعد الحجز فورياً؛ يدفع العميل كامل المبلغ، ثم يصبح الحجز «قيد التأكيد» إلى حين موافقة الشريك.',
      ],
      [
        '6.2',
        'المهلة الافتراضية لتأكيد الحجز ساعتان من وقت الدفع. ويجوز لسفرة تعديل المهلة تشغيلياً بحسب نوع العقار أو وقت الحجز أو حالة الطوارئ، على أن تكون القاعدة ظاهرة في النظام أو معلنة للشريك.',
      ],
      [
        '6.3',
        'عند موافقة الشريك، تؤكد سفرة الحجز للعميل وترسل القسيمة ورقم الحجز/رمز QR عبر القنوات المعتمدة.',
      ],
      [
        '6.4',
        'عند رفض الشريك أو عدم رده أو ثبوت عدم توفر الوحدة، يحق لسفرة إلغاء الحجز واسترداد المبلغ للعميل وعرض بدائل.',
      ],
      [
        '6.5',
        'عند الوصول، يستخدم العميل رقم الحجز أو رمز QR للتحقق من الحجز. وتظل سفرة قناة الدعم الأساسية للحالات التشغيلية والنزاعات.',
      ],
    ]),
  )}

  ${article(
    '7. العمولة — مفتوحة',
    `${clauses([
      [
        '7.1',
        'اتفق الطرفان صراحةً على أن العمولة غير محددة في متن هذه الاتفاقية، ولا تعتبر أي نسبة أو قيمة عمولة نافذة إلا بعد اعتمادها كتابةً أو إلكترونياً من الطرفين.',
      ],
      [
        '7.2',
        'يمكن اعتماد عمولة مختلفة حسب نوع العقار أو الموسم أو الخدمة أو أي تصنيف تجاري آخر، بشرط توثيق النسبة أو القيمة وأساس الاحتساب وتاريخ النفاذ.',
      ],
      [
        '7.3',
        'عند اعتماد العمولة، يجوز لسفرة خصمها من المبالغ المحصلة قبل تحويل صافي مستحقات الشريك، وفق التسوية المعتمدة.',
      ],
      [
        '7.4',
        'إذا لم يتم اعتماد العمولة، فلا تستحق سفرة عمولة عن أي فترة سابقة على اعتمادها، ما لم يوجد اتفاق مكتوب مستقل.',
      ],
    ])}
    ${grid(
      ['البند', 'النسبة/القيمة', 'أساس الاحتساب', 'تاريخ النفاذ', 'ملاحظات'],
      Array.from({ length: 4 }, () => Array.from({ length: 5 }, () => SHORT)),
    )}`,
  )}

  ${article(
    '8. الدفع والتسوية المالية',
    bullets([
      'يدفع العميل كامل مبلغ الحجز مقدماً عبر وسائل الدفع التي تعتمدها سفرة.',
      'تحتفظ سفرة بسجل مالي لكل عملية يشمل الدفع والعمولة والاسترداد والتحويل والغرامات عند وجودها.',
      'تحول سفرة صافي مستحقات الشريك بعد تحقق شروط الاستحقاق وبعد خصم العمولة والمبالغ المستردة أو الغرامات أو التكاليف التي يحق خصمها بموجب هذه الاتفاقية.',
      'موعد التسوية الدوري: ____________________.',
      'مدة التحويل بعد الاستحقاق: ____________________.',
      'يحق لسفرة تعليق مبلغ معقول مؤقتاً عند وجود نزاع مالي أو استرداد أو اعتراض على عملية دفع مرتبطة بالحجز.',
      'يتحمل كل طرف الرسوم المصرفية أو رسوم بوابة الدفع التي تخصه وفق التسوية المعتمدة.',
      'يتحمل الشريك مسؤولية صحة بيانات الحساب المالي، وأي تأخير ناتج عن بيانات خاطئة أو ناقصة.',
    ]),
  )}

  ${article(
    '9. الإلغاء والاسترداد وعدم الحضور والتعديل',
    clauses([
      [
        '9.1',
        'يلتزم الشريك باعتماد سياسة واضحة للإلغاء والاسترداد لكل عرض أو حجز، وتظهر للعميل قبل إتمام الدفع.',
      ],
      [
        '9.2',
        'لا يجوز للشريك تطبيق شروط تختلف عن السياسة التي وافق عليها العميل في الحجز، إلا بموافقة سفرة أو في حالة يوجب فيها القانون أو الظرف الاستثنائي خلاف ذلك.',
      ],
      [
        '9.3',
        'عند إلغاء العميل، يحدد الاسترداد وفق سياسة الحجز المعروضة والمقبولة قبل الدفع.',
      ],
      [
        '9.4',
        'عند إلغاء الشريك بعد التأكيد أو عدم توفر العقار عند الوصول، تتولى سفرة حماية العميل من خلال الاسترداد أو البديل المناسب، ويجوز لها تحميل الشريك التكاليف المباشرة المثبتة الناتجة عن إخلاله، وفق القانون وهذه الاتفاقية.',
      ],
      ['9.5', 'في حالة عدم الحضور (No-show)، تطبق السياسة الظاهرة للعميل قبل الدفع.'],
      [
        '9.6',
        'عند تعديل الحجز، يعاد احتساب السعر والرسوم والعمولة وأثر الإلغاء وفق القواعد السارية على الحجز المعدل.',
      ],
    ]),
  )}

  ${article(
    '10. سياسة الإلغاء والاسترداد المعتمدة',
    grid(
      ['الحالة', 'القاعدة الأساسية', 'الاسترداد', 'الملاحظات'],
      [
        [
          'إلغاء مجاني',
          'حتى الموعد المحدد في الحجز',
          '100% من المبلغ القابل للاسترداد',
          'وفق الشروط الظاهرة للعميل',
        ],
        [
          'إلغاء بعد انتهاء المهلة',
          'بعد الموعد المحدد',
          'وفق النسبة/المبلغ الظاهر للحجز',
          'قد يخصم مبلغ أو نسبة وفق السياسة',
        ],
        [
          'عدم الحضور',
          'عدم وصول العميل دون تعديل/إلغاء مقبول',
          'وفق سياسة الحجز',
          'لا تطبق قاعدة مختلفة بعد الحجز',
        ],
        [
          'إلغاء الشريك',
          'عدم قدرة الشريك على تنفيذ الحجز',
          'استرداد كامل أو بديل مناسب',
          'مع حق سفرة في تطبيق الجزاءات والتكاليف المستحقة',
        ],
        [
          'عدم توفر الوحدة عند الوصول',
          'الوحدة غير متاحة أو غير مطابقة جوهرياً',
          'استرداد/بديل وفق الحالة',
          'فتح نزاع وتوثيق الواقعة',
        ],
        [
          'قوة قاهرة/إغلاق رسمي',
          'تعذر التنفيذ لسبب خارج السيطرة',
          'وفق القانون والسياسة الطارئة',
          'يجوز تفعيل وضع الطوارئ',
        ],
      ],
    ),
  )}

  ${article(
    '11. تعويض العميل والغرامات التشغيلية',
    clauses([
      [
        '11.1',
        'إذا لم يرد الشريك خلال المهلة أو تسبب في فشل الحجز، يحق لسفرة إلغاء الحجز وإعادة المبلغ للعميل وتقديم بدائل، وتطبيق الغرامة المعتمدة.',
      ],
      [
        '11.2',
        `الغرامة الافتراضية لأول مخالفة لعدم الرد: ${BLANK}. ويجوز اعتماد غرامة مختلفة أو تصعيد تدريجي وفق سجل المخالفات.`,
      ],
      [
        '11.3',
        'يجوز لسفرة خصم الغرامات أو التكاليف المستحقة من مستحقات الشريك، بعد توثيق سببها.',
      ],
      [
        '11.4',
        'لا تمنع الغرامة من مطالبة الشريك بالتكاليف المباشرة المثبتة التي نتجت عن إخلاله، إذا كان ذلك جائزاً قانوناً.',
      ],
      ['11.5', 'يحق لسفرة تعليق أو خفض ظهور العقار أو إيقافه عند تكرار المخالفات.'],
    ]),
  )}

  ${article(
    '12. عدم الالتفاف على سفرة',
    bullets([
      'لا يجوز للشريك استخدام بيانات أو معلومات عميل حصل عليها من خلال سفرة لإتمام حجز خارج المنصة بقصد تجاوز رسوم أو عمولة سفرة.',
      'لا يجوز تبادل وسائل التواصل المباشر قبل تأكيد الحجز إلا من خلال القنوات التي تسمح بها سفرة أو عندما تقتضي الضرورة التشغيلية ذلك.',
      'بعد تأكيد الحجز، يجوز تبادل البيانات اللازمة لتنفيذ الإقامة فقط، دون استخدامها لتسويق مستقل غير مصرح به.',
      'إذا نص اتفاق مالي مستقل على فترة حماية للحجوزات والعملاء المحالين من سفرة، يلتزم الشريك بتلك الفترة بالقدر المسموح به قانوناً.',
      `مدة الحماية التجارية — إن اعتمدت: ${BLANK} شهراً.`,
    ]),
  )}

  ${article(
    '13. بيانات العملاء والخصوصية',
    bullets([
      'تستخدم بيانات العميل فقط لتنفيذ الحجز وخدمة الإقامة والتواصل التشغيلي المرتبط به.',
      'يحظر بيع بيانات العملاء أو مشاركتها مع طرف ثالث غير مصرح له.',
      'يلتزم الشريك باتخاذ إجراءات مناسبة لمنع الوصول غير المصرح به أو الفقد أو التسرب.',
      'يجب إبلاغ سفرة فوراً عن أي حادث أمني أو تسرب بيانات مرتبط بعميل سفرة.',
      'تحتفظ سفرة بالسجلات اللازمة للحجز والتسوية والنزاعات والامتثال وفق سياساتها وإجراءاتها.',
    ]),
  )}

  ${article(
    '14. المحتوى والصور والعلامة التجارية',
    bullets([
      'يمنح الشريك سفرة حقاً غير حصري لاستخدام الصور والأوصاف والبيانات التي يقدمها لأغراض العرض والتسويق والحجز طوال مدة العلاقة.',
      'يضمن الشريك أنه يملك أو يملك الإذن القانوني لاستخدام المحتوى المقدم.',
      'يجوز لسفرة تنسيق أو اختصار أو ترجمة المحتوى بما يلزم لعرضه على المنصة دون تغيير جوهر المعلومات.',
      'لا يجوز للشريك استخدام علامة Safra أو الإيحاء بأنه ممثل حصري عنها دون موافقة مكتوبة.',
    ]),
  )}

  ${article(
    '15. الشكاوى والنزاعات',
    clauses([
      [
        '15.1',
        'تستقبل سفرة شكاوى العملاء وتوثقها وتطلب من الشريك الرد والمستندات اللازمة.',
      ],
      ['15.2', 'يلتزم الشريك بالرد خلال المدة التي تحددها سفرة في الإشعار.'],
      [
        '15.3',
        'عند وجود مشكلة جوهرية عند الوصول، يجوز لسفرة عرض بديل أو استرداد أو حل آخر مناسب وفق الحالة والسياسة.',
      ],
      [
        '15.4',
        'لا يعني تدخل سفرة في حل النزاع تحملها تلقائياً مسؤولية خدمة الإقامة التي يقدمها الشريك.',
      ],
      [
        '15.5',
        'توثق الإجراءات والقرارات في سجل الحجز والنزاع، وتكون السجلات التشغيلية المرجع الداخلي للحادثة.',
      ],
    ]),
  )}

  ${article(
    '16. المسؤولية والتعويض',
    bullets([
      'يتحمل الشريك المسؤولية عن صحة بيانات العقار وتوفره وسلامته وتجهيزه وجودة الخدمة التي يقدمها للعميل.',
      'يتحمل كل طرف المسؤولية عن أفعاله وأخطائه وإهماله ومخالفاته القانونية.',
      'إذا تحملت سفرة تكاليف مباشرة ومعقولة نتيجة إخلال ثابت من الشريك، يحق لها خصمها من مستحقاته بعد توثيق السبب.',
      'لا يعفي أي بند من هذه الاتفاقية أي طرف من مسؤولية لا يجوز قانوناً الإعفاء منها أو الحد منها.',
      'أي تعويض يخضع للضرر المثبت والقواعد القانونية الواجبة التطبيق.',
    ]),
  )}

  ${article(
    '17. التعليق والإيقاف',
    bullets([
      'يجوز لسفرة تعليق العقار أو حساب الشريك عند نقص الوثائق، أو الخطر على العملاء، أو تكرار الإلغاءات، أو عدم تحديث التوفر، أو الشكاوى الجوهرية.',
      'يجوز اتخاذ إجراء فوري في الحالات التي تتطلب حماية العميل أو المنصة، مع توثيق السبب.',
      'لا يؤثر التعليق أو الإنهاء على الحجوزات المؤكدة أو الالتزامات المالية السابقة إلا بالقدر الذي تقتضيه المعالجة.',
      'يجوز إعادة التفعيل بعد تصحيح سبب الإيقاف والتحقق منه.',
    ]),
  )}

  ${article(
    '18. التقييم والأداء',
    `<p>يجوز لسفرة اعتماد مؤشرات أداء داخلية للشريك تشمل سرعة الاستجابة، دقة البيانات، نسبة الإلغاء، الشكاوى، جودة الخدمة، وتحديث التوفر، وأن تستخدمها في ترتيب العقار أو ظهوره أو تصنيفه داخل المنصة.</p>
    <p>وتعتمد مواصفات Safra الحالية على تقييم داخلي يتأثر بسرعة الرد، والتقييمات، ودقة البيانات، والإلغاءات، والشكاوى، وتحديث التوفر.</p>`,
  )}

  ${article(
    '19. السجلات الإلكترونية',
    bullets([
      'تعد سجلات الحجز والدفع والتسوية والإشعارات والمراسلات الموثقة في أنظمة سفرة أدلة تشغيلية وتجارية بالقدر الذي يسمح به القانون.',
      'يجب أن تكون العمليات المالية والإدارية الحساسة قابلة للتتبع عبر سجل زمني وسجل تدقيق.',
      'لا يجوز حذف السجلات الجوهرية حذفاً نهائياً إذا كانت لازمة للمحاسبة أو النزاع أو الامتثال.',
      'تكون آخر نسخة معتمدة وموثقة من الشروط أو العمولة أو السياسة هي المرجع عند التعديل.',
    ]),
  )}

  ${article(
    '20. مدة الاتفاقية والإنهاء',
    clauses([
      [
        '20.1',
        `تبدأ الاتفاقية من تاريخ النفاذ وتستمر لمدة ${BLANK}، وتتجدد لمدة مماثلة ما لم يخطر أحد الطرفين الآخر بعدم التجديد قبل ${BLANK} يوماً.`,
      ],
      [
        '20.2',
        `يجوز لأي طرف إنهاء الاتفاقية بإشعار خطي مدته ${BLANK} يوماً، مع المحافظة على معالجة الحجوزات المؤكدة والتسويات المستحقة.`,
      ],
      [
        '20.3',
        'يجوز الإنهاء الفوري عند التزوير، أو النشاط غير القانوني، أو إساءة استخدام بيانات العملاء، أو الإخلال الجسيم أو المتكرر بالتوفر أو الحجوزات، أو أي سبب جوهري آخر يجيزه القانون.',
      ],
      [
        '20.4',
        'تبقى بنود السرية والبيانات والحقوق المالية والنزاعات والالتزامات الناشئة قبل الإنهاء سارية بالقدر اللازم.',
      ],
    ]),
  )}

  ${article(
    '21. القوة القاهرة والطوارئ',
    '<p>لا يكون أي طرف مسؤولاً عن التأخير أو عدم التنفيذ الناتج عن ظرف خارج عن سيطرته المعقولة، مثل الكوارث أو الإغلاق الرسمي أو الحرب أو الاضطرابات أو القيود الحكومية أو الانقطاع التقني واسع النطاق، شريطة الإخطار والتعاون في تقليل الضرر. ويجوز لسفرة تفعيل إجراءات الطوارئ أو إيقاف الحجوزات أو تعديل بعض الإجراءات التشغيلية مؤقتاً.</p>',
  )}

  ${article(
    '22. القانون الواجب التطبيق والاختصاص',
    `<p>تخضع هذه الاتفاقية للقوانين النافذة في الجمهورية العربية السورية، بالقدر الذي تكون فيه العلاقة والنشاط محل الاتفاق خاضعين للاختصاص السوري، وتختص المحاكم السورية المختصة مكانياً ونوعياً بالنظر في النزاعات، ما لم يتفق الطرفان كتابةً على وسيلة تسوية أخرى جائزة قانوناً.</p>
    <p>ويتعين قبل التوقيع النهائي التحقق من الصفة القانونية والتراخيص المناسبة لنشاط كل طرف، ومن المتطلبات التنظيمية الخاصة بالحجز السياحي والدفع الإلكتروني وحماية المستهلك والبيانات.</p>`,
  )}

  ${article(
    '23. الإشعارات',
    `${fields([
      ['بريد سفرة المعتمد', LINE],
      ['بريد الشريك المعتمد', LINE],
      ['عنوان المراسلات', LINE],
      ['رقم التواصل التشغيلي', LINE],
    ])}
    <p>تكون الإشعارات التعاقدية صحيحة إذا أرسلت إلى وسيلة الاتصال المعتمدة المبينة أعلاه، ويمكن إثبات إرسالها أو استلامها، ما لم يوجب القانون شكلاً آخر.</p>`,
  )}

  ${article(
    '24. أولوية الوثائق والتعديلات',
    `<p>هذه الاتفاقية هي الوثيقة الأساسية بين الطرفين، والسياسات الواردة فيها جزء لا يتجزأ منها وليست ملحقاً مستقلاً. ويجوز تعديل العمولة أو سياسة الإلغاء أو الغرامات أو المدد التشغيلية بموافقة مكتوبة أو إلكترونية موثقة من الطرفين.</p>
    <p>عند وجود تعارض، تكون الأولوية للنص الخاص بالحالة محل التعارض في هذه الاتفاقية، ثم لأي تعديل لاحق معتمد، ثم للبيانات الظاهرة في الحجز المؤكد إذا كانت أكثر تحديداً للحالة.</p>`,
  )}

  ${article(
    '25. أحكام عامة',
    bullets([
      'إذا أصبح أي بند غير نافذ قانوناً، تبقى بقية البنود نافذة بالقدر الممكن.',
      'عدم استعمال أحد الطرفين لحقه في واقعة معينة لا يعد تنازلاً دائماً عنه.',
      'لا يجوز للشريك نقل التزاماته الجوهرية إلى طرف آخر دون موافقة سفرة، مع مراعاة القانون.',
      'العناوين للتنظيم ولا تؤثر في تفسير النصوص.',
      'حررت الاتفاقية باللغة العربية، ويجوز إعداد ترجمة تشغيلية، وتكون العربية المرجع ما لم يتفق الطرفان كتابةً على خلاف ذلك.',
    ]),
  )}

  ${article(
    '26. الإقرار والتوقيع',
    `<p>يقر الطرفان بأنهما قرآ الاتفاقية والسياسات الواردة فيها وفهما الالتزامات والحقوق المترتبة عليها، وأن البيانات التي قدماها صحيحة، وأن العمولة لا تكون نافذة إلا بعد اعتمادها وفق المادة 7.</p>
    <p>كما يقر الشريك بأن مسؤولية التوفر وصحة المعلومات وتنفيذ خدمة الإقامة تقع عليه، وأن الحجز المؤكد عبر سفرة يمثل التزاماً تشغيلياً يجب التعامل معه وفق شروط الحجز والسياسات المعتمدة.</p>
    <p class="legal">ملاحظة قانونية: هذه الصياغة مسودة تعاقدية نهائية من ناحية الهيكل التجاري، ويجب مراجعتها من محامٍ سوري قبل التوقيع، خصوصاً بشأن الترخيص، الدفع الإلكتروني، الغرامات، حماية المستهلك والبيانات، والاختصاص القضائي.</p>`,
  )}

  <section class="signing">
    <h2>صفحة التوقيع والاعتماد</h2>
    <p class="signing-title">اتفاقية الشراكة التجارية وتسويق وإدارة الحجوزات</p>
    <p>يُعد توقيع الطرفين أدناه إقراراً بقراءة الاتفاقية وفهم أحكامها وقبول الالتزام بها.</p>
    ${grid(['رقم الاتفاقية', 'تاريخ الاتفاقية', 'تاريخ النفاذ', 'النسخة'], [[SHORT, DATE, DATE, '1.0']])}
    <div class="parties">
      ${signatory('الطرف الأول / Safra | سفرة')}
      ${signatory('الطرف الثاني / الشريك / المنشأة')}
    </div>
    <p>إقرار الطرفين: يقر كل طرف بأن الشخص الموقع عنه مخول بالتوقيع، وأن البيانات المثبتة أعلاه صحيحة، وأن هذه الصفحة جزء لا يتجزأ من الاتفاقية.</p>
    <p class="done">تم التوقيع والختم على هذه الاتفاقية من الطرفين.</p>
  </section>
`;

/**
 * The running header and footer of every printed page, as the source document has them: the name
 * at the top, the agreement's title and the page number at the foot.
 *
 * Chromium draws these in the page MARGIN, in a separate document that inherits nothing, so every
 * style is inline and the font size is explicit (its default is too small to read). `pageNumber`
 * is the one class Chromium fills in. Neither varies between two renders, so the hash holds.
 */
export const CONTRACT_PAGE_HEADER = `<div style="width:100%;font-size:8pt;color:#8a6a24;text-align:center;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;">Safra  |  سفرة</div>`;

export const CONTRACT_PAGE_FOOTER = `<div dir="rtl" style="width:100%;font-size:8pt;color:#666;text-align:center;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;">اتفاقية شراكة تجارية وتسويق وإدارة حجوزات — Safra  |  صفحة <span class="pageNumber"></span></div>`;

/**
 * The contract as a self-contained HTML document, ready to be printed to PDF.
 *
 * ## Everything a caller supplies is escaped
 *
 * `partnerLegalName` and `partnerDisplayName` are partner-controlled: they arrive from the
 * application form the partner filled in themselves. Interpolating them raw would let a partner
 * put markup — or a `<style>` that hides a clause — into a document SAFRA then signs. Escaped at
 * every insertion, without exception.
 *
 * ## No external resources
 *
 * No stylesheet, no font, no image loaded over the network. A contract whose appearance depends on
 * a CDN being up is a contract that renders differently depending on when you open it, and the
 * bytes are what both parties sign.
 */
export function renderContractHtml(terms: ContractTerms): string {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>${escape(terms.partnerReference)}</title>
<style>
  @page { size: A4; margin: 20mm 18mm; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; line-height: 1.75; font-size: 10.5pt; }
  .masthead { text-align: center; }
  .logo { margin: 0 0 4mm; }
  h1 { font-size: 19pt; line-height: 1.35; margin: 0 0 1.5mm; }
  .between { margin: 0 0 1mm; color: #333; font-size: 11pt; }
  .sub { color: #555; font-size: 9.5pt; margin: 0 0 6mm; }
  h2 { font-size: 12pt; margin: 7mm 0 2.5mm; padding-bottom: 1.5mm; border-bottom: 1px solid #c9a24d; page-break-after: avoid; }
  h3 { font-size: 10.5pt; margin: 4mm 0 1.5mm; color: #333; page-break-after: avoid; }
  p { margin: 0 0 2mm; }
  .notice { border: 1px solid #c9a24d; background: #fbf6ea; padding: 3mm 4mm; margin: 4mm 0 2mm; font-weight: 700; text-align: center; }
  table { width: 100%; border-collapse: collapse; margin: 2mm 0 3mm; page-break-inside: avoid; }
  table.fields th { text-align: start; width: 34%; font-weight: 600; color: #444; padding: 1.6mm 0; vertical-align: top; border-bottom: 1px solid #e6e2d8; }
  table.fields td { padding: 1.6mm 0; border-bottom: 1px solid #e6e2d8; }
  .option { white-space: nowrap; margin-inline-end: 3mm; }
  table.grid th, table.grid td { border: 1px solid #d8d2c4; padding: 1.8mm 2mm; text-align: start; vertical-align: top; font-size: 9.5pt; }
  table.grid th { background: #f4efe2; font-weight: 700; }
  ul { padding-inline-start: 6mm; margin: 0 0 2mm; }
  ul li { margin-bottom: 1.5mm; }
  .clause { padding-inline-start: 9mm; text-indent: -9mm; }
  .clause .num { display: inline-block; width: 9mm; text-indent: 0; font-weight: 700; }
  .legal { margin-top: 3mm; font-size: 9.5pt; color: #555; }
  .signing { page-break-before: always; }
  .signing-title { font-weight: 700; }
  .parties { display: flex; gap: 8mm; margin: 4mm 0; page-break-inside: avoid; }
  .party { flex: 1; border: 1px solid #d8d2c4; padding: 3mm 4mm; font-size: 9.5pt; }
  .party .who { font-weight: 700; font-size: 10.5pt; margin-bottom: 2mm; }
  .party .label { margin: 1.5mm 0 0; color: #444; }
  .party .line { margin: 0; letter-spacing: -0.5px; }
  .stamp { border: 1px dashed #b9b2a2; height: 22mm; margin: 1mm 0 2mm; display: flex; align-items: center; justify-content: center; color: #8a8478; }
  .done { font-weight: 700; margin-top: 3mm; }
</style>
</head>
<body>
  <!-- Centred, as the source document's title block is (Bashar, 2026-10-07). -->
  <header class="masthead">
    <div class="logo">${SAFRA_LOCKUP_MARKUP}</div>
    <h1>اتفاقية شراكة تجارية<br>وتسويق وإدارة حجوزات الإقامة</h1>
    <p class="between">بين منصة سفرة (Safra) وشريك الإقامة</p>
    <!--
      SAFRA's own line, not the contract's: which partner and which record this printed copy was
      generated for, so a returned scan can be matched to its row. Escaped — the names are the
      partner's own words.
    -->
    <p class="sub">${escape(terms.partnerLegalName)} · ${escape(terms.partnerDisplayName)} · ${escape(terms.partnerReference)} · ${escape(terms.issuedOn)}</p>
  </header>
  ${AGREEMENT}
</body>
</html>`;
}
