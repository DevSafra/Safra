import type { OutgoingMail } from './mail.service.js';

/**
 * Transactional email copy, in the three locales SAFRA supports (§1.4, §10.3).
 *
 * Plain text only, for now and deliberately. An HTML template that has not been
 * tested across clients renders worse than text in the ones that matter, and these
 * two messages carry a single link each — there is nothing for HTML to add that
 * would justify maintaining a second copy of the wording in every language.
 *
 * Kept out of `MailService` so the service stays about DELIVERY. When §10.3's full
 * template set arrives this file is what grows, or is replaced by whatever renders
 * them — the service does not change either way.
 */
type Locale = 'ar' | 'en' | 'de';

function pick(locale: string): Locale {
  return locale === 'en' || locale === 'de' ? locale : 'ar';
}

/**
 * How long the customer has, stated in the email itself.
 *
 * A reset link that has quietly expired is one of the most common support contacts
 * on any platform, and it is entirely avoidable by saying so up front.
 */
export function passwordResetMail(input: {
  to: string;
  url: string;
  locale: string;
  expiresInMinutes: number;
}): OutgoingMail {
  const { url, expiresInMinutes } = input;

  const copy = {
    ar: {
      subject: 'إعادة تعيين كلمة المرور — سفرة',
      body:
        `لقد طلبت إعادة تعيين كلمة المرور لحسابك في سفرة.\n\n` +
        `افتح الرابط التالي لاختيار كلمة مرور جديدة:\n${url}\n\n` +
        `تنتهي صلاحية الرابط خلال ${expiresInMinutes} دقيقة ويمكن استخدامه مرة واحدة فقط.\n\n` +
        `إذا لم تطلب ذلك، تجاهل هذه الرسالة — لم يتغير أي شيء في حسابك.\n\n` +
        `فريق سفرة`,
    },
    en: {
      subject: 'Reset your SAFRA password',
      body:
        `You asked to reset the password for your SAFRA account.\n\n` +
        `Open this link to choose a new one:\n${url}\n\n` +
        `The link expires in ${expiresInMinutes} minutes and can be used once.\n\n` +
        `If you did not ask for this, ignore this email — nothing about your ` +
        `account has changed.\n\n` +
        `The SAFRA team`,
    },
    de: {
      subject: 'SAFRA-Passwort zurücksetzen',
      body:
        `Sie haben angefordert, das Passwort für Ihr SAFRA-Konto zurückzusetzen.\n\n` +
        `Öffnen Sie diesen Link, um ein neues zu wählen:\n${url}\n\n` +
        `Der Link läuft in ${expiresInMinutes} Minuten ab und ist einmal verwendbar.\n\n` +
        `Falls Sie das nicht angefordert haben, ignorieren Sie diese E-Mail — an ` +
        `Ihrem Konto hat sich nichts geändert.\n\n` +
        `Ihr SAFRA-Team`,
    },
  }[pick(input.locale)];

  return { to: input.to, subject: copy.subject, text: copy.body };
}

export function emailVerificationMail(input: {
  to: string;
  url: string;
  locale: string;
  expiresInHours: number;
}): OutgoingMail {
  const { url, expiresInHours } = input;

  const copy = {
    ar: {
      subject: 'أكّد بريدك الإلكتروني — سفرة',
      body:
        `مرحبًا بك في سفرة.\n\n` +
        `أكّد بريدك الإلكتروني عبر الرابط التالي:\n${url}\n\n` +
        `تنتهي صلاحية الرابط خلال ${expiresInHours} ساعة.\n\n` +
        `التأكيد يتيح لنا ربط أي حجوزات سابقة قمت بها كضيف بالبريد نفسه.\n\n` +
        `فريق سفرة`,
    },
    en: {
      subject: 'Confirm your email address — SAFRA',
      body:
        `Welcome to SAFRA.\n\n` +
        `Confirm your email address with this link:\n${url}\n\n` +
        `The link expires in ${expiresInHours} hours.\n\n` +
        `Confirming lets us attach any bookings you already made as a guest with ` +
        `this address to your account.\n\n` +
        `The SAFRA team`,
    },
    de: {
      subject: 'Bestätigen Sie Ihre E-Mail-Adresse — SAFRA',
      body:
        `Willkommen bei SAFRA.\n\n` +
        `Bestätigen Sie Ihre E-Mail-Adresse über diesen Link:\n${url}\n\n` +
        `Der Link läuft in ${expiresInHours} Stunden ab.\n\n` +
        `Nach der Bestätigung können wir Buchungen, die Sie bereits als Gast mit ` +
        `dieser Adresse getätigt haben, Ihrem Konto zuordnen.\n\n` +
        `Ihr SAFRA-Team`,
    },
  }[pick(input.locale)];

  return { to: input.to, subject: copy.subject, text: copy.body };
}

/**
 * A staff invitation.
 *
 * Deliberately says what the account is FOR and who to contact if it is unexpected.
 * An unexplained "set your password" email to a work address is indistinguishable
 * from a phishing attempt, and the people receiving this one have privileged access —
 * they are exactly the population worth training not to click unexplained links.
 */
export function staffInvitationMail(input: {
  to: string;
  url: string;
  roleLabel: string;
  locale: string;
  expiresInHours: number;
}): OutgoingMail {
  const { url, roleLabel, expiresInHours } = input;

  const copy = {
    ar: {
      subject: 'دعوة للانضمام إلى فريق سفرة',
      body:
        `تمت دعوتك للانضمام إلى لوحة تحكم سفرة بصفة: ${roleLabel}.\n\n` +
        `افتح الرابط التالي لتعيين كلمة المرور الخاصة بك:\n${url}\n\n` +
        `تنتهي صلاحية الرابط خلال ${expiresInHours} ساعة ويمكن استخدامه مرة واحدة فقط.\n\n` +
        `بعد تعيين كلمة المرور سيُطلب منك تفعيل المصادقة الثنائية قبل استخدام الحساب.\n\n` +
        `إذا لم تكن تتوقع هذه الدعوة، لا تفتح الرابط وأبلغ فريق سفرة.\n\n` +
        `فريق سفرة`,
    },
    en: {
      subject: 'You have been invited to the SAFRA admin console',
      body:
        `You have been invited to the SAFRA admin console as: ${roleLabel}.\n\n` +
        `Open this link to set your password:\n${url}\n\n` +
        `The link expires in ${expiresInHours} hours and can be used once.\n\n` +
        `After setting a password you will be required to enable two-factor ` +
        `authentication before the account can be used.\n\n` +
        `If you were not expecting this invitation, do not open the link and tell ` +
        `the SAFRA team.\n\n` +
        `The SAFRA team`,
    },
    de: {
      subject: 'Einladung zur SAFRA-Administrationskonsole',
      body:
        `Sie wurden zur SAFRA-Administrationskonsole eingeladen als: ${roleLabel}.\n\n` +
        `Öffnen Sie diesen Link, um Ihr Passwort festzulegen:\n${url}\n\n` +
        `Der Link läuft in ${expiresInHours} Stunden ab und ist einmal verwendbar.\n\n` +
        `Nach dem Festlegen des Passworts müssen Sie die Zwei-Faktor-Authentifizierung ` +
        `aktivieren, bevor das Konto genutzt werden kann.\n\n` +
        `Falls Sie diese Einladung nicht erwartet haben, öffnen Sie den Link nicht und ` +
        `informieren Sie das SAFRA-Team.\n\n` +
        `Ihr SAFRA-Team`,
    },
  }[pick(input.locale)];

  return { to: input.to, subject: copy.subject, text: copy.body };
}
