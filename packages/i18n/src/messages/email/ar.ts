/**
 * Transactional email copy in Arabic — the source of truth the other two translate from.
 *
 * ## Why each body is one string with `\n` escapes
 *
 * They were concatenated template literals in `mail.templates.ts`, split across source lines to
 * stay inside the line-length limit. That made every paragraph break a decision of the SOURCE
 * FORMATTING rather than of the copy, and a translator adjusting a sentence had to reflow the
 * concatenation. One string per body is what the recipient actually receives.
 *
 * Plain text only, deliberately — see `mail.templates.ts`. An email carrying a single link has
 * nothing for HTML to add that would justify a second copy of the wording per language.
 */
export const ar = {
  passwordReset: {
    subject: 'إعادة تعيين كلمة المرور — سفرة',
    body: 'لقد طلبت إعادة تعيين كلمة المرور لحسابك في سفرة.\n\nافتح الرابط التالي لاختيار كلمة مرور جديدة:\n{url}\n\nتنتهي صلاحية الرابط خلال {expiresInMinutes} دقيقة ويمكن استخدامه مرة واحدة فقط.\n\nإذا لم تطلب ذلك، تجاهل هذه الرسالة — لم يتغير أي شيء في حسابك.\n\nفريق سفرة',
  },
  emailVerification: {
    subject: 'أكّد بريدك الإلكتروني — سفرة',
    body: 'مرحبًا بك في سفرة.\n\nأكّد بريدك الإلكتروني عبر الرابط التالي:\n{url}\n\nتنتهي صلاحية الرابط خلال {expiresInHours} ساعة.\n\nالتأكيد يتيح لنا ربط أي حجوزات سابقة قمت بها كضيف بالبريد نفسه.\n\nفريق سفرة',
  },
  staffInvitation: {
    subject: 'دعوة للانضمام إلى فريق سفرة',
    body: 'تمت دعوتك للانضمام إلى لوحة تحكم سفرة بصفة: {roleLabel}.\n\nافتح الرابط التالي لتعيين كلمة المرور الخاصة بك:\n{url}\n\nتنتهي صلاحية الرابط خلال {expiresInHours} ساعة ويمكن استخدامه مرة واحدة فقط.\n\nبعد تعيين كلمة المرور سيُطلب منك تفعيل المصادقة الثنائية قبل استخدام الحساب.\n\nإذا لم تكن تتوقع هذه الدعوة، لا تفتح الرابط وأبلغ فريق سفرة.\n\nفريق سفرة',
  },
} as const;
