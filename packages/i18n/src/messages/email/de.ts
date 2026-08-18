/** Transactional email copy in German, formal register (`Sie`) throughout. */
export const de = {
  passwordReset: {
    subject: 'SAFRA-Passwort zurücksetzen',
    body: 'Sie haben angefordert, das Passwort für Ihr SAFRA-Konto zurückzusetzen.\n\nÖffnen Sie diesen Link, um ein neues zu wählen:\n{url}\n\nDer Link läuft in {expiresInMinutes} Minuten ab und ist einmal verwendbar.\n\nFalls Sie das nicht angefordert haben, ignorieren Sie diese E-Mail — an Ihrem Konto hat sich nichts geändert.\n\nIhr SAFRA-Team',
  },
  emailVerification: {
    subject: 'Bestätigen Sie Ihre E-Mail-Adresse — SAFRA',
    body: 'Willkommen bei SAFRA.\n\nBestätigen Sie Ihre E-Mail-Adresse über diesen Link:\n{url}\n\nDer Link läuft in {expiresInHours} Stunden ab.\n\nNach der Bestätigung können wir Buchungen, die Sie bereits als Gast mit dieser Adresse getätigt haben, Ihrem Konto zuordnen.\n\nIhr SAFRA-Team',
  },
  accountExists: {
    subject: 'Registrierungsversuch — SAFRA',
    body: 'Jemand hat versucht, mit dieser E-Mail-Adresse ein SAFRA-Konto zu erstellen — Sie haben bereits eines.\n\nWaren Sie das, melden Sie sich hier an:\n{signInUrl}\n\nPasswort vergessen? Hier zurücksetzen:\n{resetUrl}\n\nWaren Sie es nicht, ist nichts zu tun — an Ihrem Konto hat sich nichts geändert und niemand hat Ihre Daten gesehen.\n\nIhr SAFRA-Team',
  },
  /** The staff roles, for the invitation. See `ar.ts` for why the template takes a code. */
  roles: {
    super_admin: 'Hauptadministrator',
    operations_manager: 'Betriebsleitung',
    finance_officer: 'Finanzbeauftragte Person',
    support_agent: 'Support-Mitarbeitende Person',
  } as Record<string, string>,

  staffInvitation: {
    subject: 'Einladung zur SAFRA-Administrationskonsole',
    body: 'Sie wurden zur SAFRA-Administrationskonsole eingeladen als: {roleLabel}.\n\nÖffnen Sie diesen Link, um Ihr Passwort festzulegen:\n{url}\n\nDer Link läuft in {expiresInHours} Stunden ab und ist einmal verwendbar.\n\nNach dem Festlegen des Passworts müssen Sie die Zwei-Faktor-Authentifizierung aktivieren, bevor das Konto genutzt werden kann.\n\nFalls Sie diese Einladung nicht erwartet haben, öffnen Sie den Link nicht und informieren Sie das SAFRA-Team.\n\nIhr SAFRA-Team',
  },

  reviewReceived: {
    subject: 'Neue Bewertung für {property} — SAFRA',
    body: 'Ein Gast, der in {property} übernachtet hat, hat eine Bewertung hinterlassen.\n\nBewertung: {rating} von 5\n\nSie können sie in Ihrem Partner-Dashboard lesen und beantworten:\n{url}\n\nIhre Antwort erscheint öffentlich unter der Bewertung. Eine Bewertung kann weder gelöscht noch geändert werden — weder vom Gast noch von SAFRA (Grundsatz P-006) — eine Antwort ist daher die einzige Möglichkeit, Ihre Sicht darzustellen.\n\nIhr SAFRA-Team',
  },
  reviewReplied: {
    subject: 'Der Gastgeber hat auf Ihre Bewertung von {property} geantwortet — SAFRA',
    body: 'Der Gastgeber hat auf Ihre Bewertung von {property} geantwortet.\n\nSie können die Antwort auf der Unterkunftsseite lesen:\n{url}\n\nIhr SAFRA-Team',
  },
  bookingNeedsAction: {
    subject: 'Eine Buchung wartet auf Sie — {reference}',
    body: 'Eine neue Buchungsanfrage wartet auf Ihre Entscheidung.\n\nReferenz: {reference}\nUnterkunft: {property}\nAnreise: {checkIn}\nAbreise: {checkOut}\n\nSie haben bis {deadline} Zeit zu antworten. Eine Anfrage, die bis dahin unbeantwortet bleibt, wird automatisch storniert und ein Verstoß wegen "keine Antwort" wird Ihrem Konto zugeordnet.\n\nAnfrage hier öffnen:\n{url}\n\nIhr SAFRA-Team',
  },
  giftCardPurchased: {
    subject: 'Ihre Geschenkkarte {reference} — SAFRA',
    body: 'Eine Geschenkkarte über {amount} wurde ausgestellt.\n\nKartencode:\n{code}\n\nKartennummer: {reference}\n\nBewahren Sie diesen Code sicher auf. Wer ihn besitzt, kann das Guthaben seiner Wallet hinzufügen, und wir können ihn nicht erneut senden — wir speichern keine Kopie.\n\nZum Einlösen: öffnen Sie «Geschenkkarten» in Ihrem Konto und geben Sie den Code ein:\n{url}\n\nIhr SAFRA-Team',
  },
  supportReplied: {
    subject: 'Das Support-Team hat auf Ihre Anfrage geantwortet — {reference}',
    body: 'Das SAFRA-Support-Team hat auf Ihre Support-Anfrage geantwortet.\n\nReferenz: {reference}\n\nÖffnen Sie das Gespräch, um die Antwort zu lesen und fortzusetzen:\n{url}\n\nWir versenden keine Nachrichtentexte per E-Mail; das vollständige Gespräch finden Sie in Ihrem Konto.\n\nIhr SAFRA-Team',
  },
  /** Die Wiederzustellungs-Nachricht — Begründung siehe englische Fassung. */
  waiting: {
    subject: 'In Ihrem SAFRA-Konto wartet eine Aktualisierung',
    body: 'In Ihrem SAFRA-Konto gab es eine Aktualisierung, über die wir Sie damals nicht per E-Mail informieren konnten.\n\nÖffnen Sie diese Seite, um sie zu sehen:\n{url}\n\nWir wiederholen die Details nicht per E-Mail — sie stehen in Ihrem Konto.\n\nIhr SAFRA-Team',
  },
} as const;
