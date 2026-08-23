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

  /* ── Partner werden (Bashar, 2026-08-19) ── */

  partnerApplicationReceived: {
    subject: 'Ihre Partneranfrage ist eingegangen — {reference}',
    body: 'Vielen Dank für Ihr Interesse an einer Partnerschaft mit SAFRA.\n\nIhre Anfragenummer: {reference}\n\nUnser Team ruft Sie unter der angegebenen Nummer an, um die Angaben zu Ihrem Betrieb zu bestätigen. Nach diesem Gespräch wird die Anfrage geprüft; bei einer Zusage senden wir Ihnen den Partnervertrag und einen Link, um Ihr Partnerkonto anzulegen.\n\nBewahren Sie die Anfragenummer auf — damit finden wir Ihre Anfrage, wenn Sie sich bei uns melden.\n\nDie Schritte und die benötigten Unterlagen finden Sie hier:\n{url}\n\nIhr SAFRA-Team',
  },
  partnerApplicationRejected: {
    subject: 'Zu Ihrer Partneranfrage — {reference}',
    body: 'Vielen Dank für Ihre Zeit und Ihr Interesse an SAFRA.\n\nNach Prüfung der Anfrage {reference} können wir derzeit nicht fortfahren.\n\nGrund:\n{reason}\n\nSollte sich daran etwas ändern, können Sie sich hier gerne erneut bewerben:\n{url}\n\nIhr SAFRA-Team',
  },
  partnerLoginCode: {
    subject: 'Ihr Anmeldecode — SAFRA',
    body: 'Ihr Code für das Partnerportal:\n\n{code}\n\nEr läuft in {expiresInMinutes} Minuten ab und kann einmal verwendet werden.\n\nWenn Sie sich nicht anmelden wollten, ignorieren Sie diese Nachricht und ändern Sie Ihr Passwort — wer diesen Code angefordert hat, kennt Ihr aktuelles.\n\nDas SAFRA-Team fragt Sie niemals nach diesem Code, weder telefonisch noch per Nachricht.\n\nIhr SAFRA-Team',
  },

  partnerInvitation: {
    subject: 'Ihre Partneranfrage wurde angenommen — Partnerkonto anlegen',
    body: 'Die Partneranfrage {reference} wurde angenommen. Willkommen bei SAFRA.\n\nÖffnen Sie den folgenden Link, um das Passwort für Ihr Konto zu setzen:\n{url}\n\nDer Link läuft in {expiresInHours} Stunden ab und kann nur einmal verwendet werden. Nach dem Setzen des Passworts können Sie sich sofort anmelden. Bei jeder Anmeldung senden wir einen sechsstelligen Code an diese Adresse, den Sie zum Abschluss eingeben.\n\nWir senden Ihnen niemals ein Passwort per Nachricht. Erhalten Sie eines, stammt es nicht von uns.\n\nIhr Konto bleibt in Prüfung, bis unser Team Ihre Unterlagen und den unterzeichneten Vertrag geprüft hat. Bis dahin können Sie die Angaben zu Ihren Objekten vorbereiten; Preise, Termine und Bilder können Sie noch nicht hinzufügen.\n\nWenn Sie sich nicht als Partner beworben haben, öffnen Sie den Link nicht und informieren Sie uns.\n\nIhr SAFRA-Team',
  },

  /** The contract KINDS, in the reader's language — `partner_contract_kind` in the schema. */
  contractKinds: {
    base: 'Partnerschaftsvertrag',
    commission_annex: 'Provisionsnachtrag',
    renewal: 'Jahresverlängerung',
  } as Record<string, string>,

  partnerApproved: {
    subject: 'Ihr SAFRA-Konto ist freigegeben — {reference}',
    body: 'Herzlichen Glückwunsch — Ihr Konto wurde geprüft und Sie sind nun freigegebener SAFRA-Partner.\n\nDas Partnerportal steht Ihnen vollständig offen: Sie können Einheiten, Preise, Verfügbarkeiten und Fotos hinterlegen und Ihre Inserate zur Prüfung einreichen.\n\nPartnerportal öffnen:\n{url}\n\nIhr SAFRA-Team',
  },

  partnerContractAwaitingSignature: {
    subject: 'Ihr Partnervertrag liegt zur Unterschrift bereit — {reference}',
    body: 'SAFRA hat den Partnervertrag unterzeichnet und Ihnen zugesandt.\n\nÖffnen Sie «العقود والمستندات» im Partnerportal, laden Sie den Vertrag herunter, unterschreiben Sie ihn handschriftlich und laden Sie die unterschriebene Fassung auf derselben Seite wieder hoch.\n\n{url}\n\nDer Vertrag tritt in Kraft, sobald Ihre unterschriebene Fassung eingegangen ist.\n\nIhr SAFRA-Team',
  },

  partnerContractReturned: {
    subject: 'Partner hat den Vertrag unterschrieben zurückgesandt — {reference}',
    body: 'Der Partner {displayName} ({reference}) hat den Partnervertrag handschriftlich unterschrieben zurückgesandt; er ist nun in Kraft.\n\nPartner öffnen und die unterschriebene Fassung prüfen:\n{url}\n\nSAFRA-Konsole',
  },

  partnerDocumentsComplete: {
    subject: 'Partnerdokumente zur Prüfung — {reference}',
    body: 'Der Partner {displayName} ({reference}) hat alle erforderlichen Dokumente eingereicht; sie warten auf Prüfung.\n\nEingereichte Dokumente: {documentCount}\n\nPartner öffnen und prüfen:\n{url}\n\nSAFRA-Konsole',
  },

  partnerContractReady: {
    subject: 'Ihr Partnervertrag liegt zur Unterschrift bereit — {partner}',
    body: 'Unser Team hat Ihren Partnervertrag hochgeladen ({kind}).\n\nSie können ihn in Ihrem Partner-Dashboard lesen und herunterladen:\n{url}\n\nSenden Sie die unterschriebene Fassung anschließend an unser Team zurück, damit die Unterschrift erfasst wird und der Vertrag in Kraft tritt.\n\nIhr SAFRA-Team',
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
  giftCardReceived: {
    subject: 'Eine SAFRA-Geschenkkarte wartet auf Sie',
    body: 'Hallo,\n\njemand hat Ihnen eine SAFRA-Geschenkkarte über {amount} gekauft.\n\nKartencode:\n{code}\n\nKartennummer: {reference}\n\nBewahren Sie diesen Code sicher auf. Wer ihn besitzt, kann das Guthaben seiner Wallet hinzufügen, und wir können ihn nicht erneut senden — wir speichern keine Kopie.\n\nSo fügen Sie ihn Ihrer Wallet hinzu:\n{url}\n\nIhr SAFRA-Team',
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
