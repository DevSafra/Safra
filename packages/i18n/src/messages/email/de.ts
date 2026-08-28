/** Transactional email copy in German, formal register (`Sie`) throughout. */
export const de = {
  bookingRecovery: {
    subject: 'Ihre SAFRA-Buchungen',
    body: 'Sie haben uns gebeten, Ihre SAFRA-Buchungsnummern zu senden.\n\n{references}\n\nÖffnen Sie eine davon in Ihrem Konto oder nennen Sie die Nummer unserem Support.\n\nFalls Sie das nicht angefordert haben, ignorieren Sie diese Nachricht — es hat sich nichts geändert und niemand hat Ihre Daten gesehen.\n\nIhr SAFRA-Team',
  },
  bookingRecoveryNone: {
    subject: 'Ihre SAFRA-Buchungen',
    body: 'Sie haben uns gebeten, Ihre SAFRA-Buchungsnummern zu senden.\n\nZu dieser E-Mail-Adresse gibt es keine Buchungen.\n\nFalls Sie mit einer anderen Adresse gebucht haben, versuchen Sie diese. Wenn Sie glauben, dass dies falsch ist, wenden Sie sich an den Support.\n\nIhr SAFRA-Team',
  },
  bookingVerification: {
    subject: 'Ihr Bestätigungscode — SAFRA',
    body: 'Ein SAFRA-Mitarbeiter möchte Ihre Identität prüfen, bevor über die Buchung {reference} gesprochen wird.\n\nBestätigungscode: {code}\n\nEr läuft in {minutes} Minuten ab. Nennen Sie ihn nur der Person, mit der Sie gerade sprechen.\n\nFalls Sie nicht mit SAFRA telefonieren, ignorieren Sie diese Nachricht und geben Sie den Code an niemanden weiter — zu Ihrer Buchung wurde nichts offengelegt.\n\nIhr SAFRA-Team',
  },
  bookingConfirmed: {
    subject: 'Ihre Buchung ist bestätigt — {reference}',
    body: 'Ihre SAFRA-Buchung ist bestätigt.\n\nBuchungsnummer: {reference}\nUnterkunft: {property}\nAnreise: {checkIn}\nAbreise: {checkOut}\n\nIhr Voucher ist angehängt, mit einem QR-Code zur Prüfung bei der Ankunft. Zeigen Sie ihn vor oder nennen Sie die Buchungsnummer.\n\nIhr SAFRA-Team',
  },
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

  /* ── Sperren und Reaktivieren eines Mitarbeiterkontos (Bashar, 2026-08-23) ── */

  /* ── Sperrung eines Partnerkontos (Bashar, 2026-08-24) ── */

  partnerFineWaived: {
    subject: 'Eine Geldstrafe auf Ihrem Konto wurde erlassen',
    body: 'Das SAFRA-Team hat die Geldstrafe auf Ihrem Konto geprüft und entschieden, sie zu erlassen.\n\nBetrag: {amount}\nDatum des Erlasses: {date}\n\nGrund:\n{reason}\n\nDieser Betrag wird Ihnen nicht berechnet. Der ursprüngliche Verstoß bleibt in Ihrem Konto verzeichnet, mit dem Erlass daneben — wir löschen den Eintrag nicht, wir ergänzen ihn, damit nachvollziehbar bleibt, was geschehen ist.\n\nVerstoß und Erlass können Sie hier einsehen:\n{url}\n\nIhr SAFRA-Team',
  },
  supportClosed: {
    subject: 'Ihre Support-Konversation {reference} wurde geschlossen',
    body: 'Die Support-Konversation {reference} wurde vom SAFRA-Team geschlossen.\n\nDie Konversation bleibt vollständig erhalten und ist jederzeit einsehbar:\n{url}\n\nFalls das Anliegen weiterbesteht oder etwas Neues aufgetreten ist, eröffnen Sie über Ihr Konto eine neue Konversation, und wir nehmen sie dort auf — frühere Konversationen löschen wir nicht, wir ergänzen sie.\n\nIhr SAFRA-Team',
  },
  disputeResolved: {
    subject: 'Entscheidung zu Ihrer Beschwerde zur Buchung {booking}',
    body: 'Wir haben Ihre Beschwerde zur Buchung {booking} geprüft und zu Ihren Gunsten entschieden.\n\nVorgangsnummer: {reference}\nEntschieden am: {date}\n\nDie Entscheidung:\n{resolution}\n\nFalls die Entscheidung eine Entschädigung umfasst, wurde sie Ihrem SAFRA-Guthaben gutgeschrieben und kann für jede künftige Buchung verwendet werden.\n\nBuchung und Vorgang finden Sie vollständig in Ihrem Konto:\n{url}\n\nEs tut uns leid, und danke für Ihre Meldung.\n\nIhr SAFRA-Team',
  },
  disputeRejected: {
    subject: 'Entscheidung zu Ihrer Beschwerde zur Buchung {booking}',
    body: 'Wir haben Ihre Beschwerde zur Buchung {booking} geprüft und konnten ihr nicht stattgeben.\n\nVorgangsnummer: {reference}\nEntschieden am: {date}\n\nDie Entscheidung:\n{resolution}\n\nWenn es etwas zu ergänzen gibt — Fotos, Nachrichten, ein Detail, das uns nicht erreicht hat — wenden Sie sich über Ihr Konto an den Support, und wir prüfen erneut.\n\nBuchung und Vorgang finden Sie in Ihrem Konto:\n{url}\n\nIhr SAFRA-Team',
  },
  disputePayoutReleased: {
    subject: 'Der Vorgang zur Buchung {booking} ist abgeschlossen',
    body: 'Der zur Buchung {booking} eröffnete Vorgang wurde abgeschlossen, und die Sperre Ihrer Auszahlung dafür wurde aufgehoben.\n\nVorgangsnummer: {reference}\nAbgeschlossen am: {date}\n\nWas das bedeutet: Die Auszahlung für diese Buchung war gesperrt, solange der Vorgang offen war, und befindet sich nun im üblichen Überweisungslauf. Durch die Eröffnung des Vorgangs wurde nichts storniert.\n\nDie Buchung finden Sie in Ihrer Partner-Konsole:\n{url}\n\nIhr SAFRA-Team',
  },
  partnerWarned: {
    subject: 'Eine Verwarnung wurde für Ihr Konto ausgesprochen',
    body: 'Für Ihr SAFRA-Partnerkonto wurde eine formelle Verwarnung ausgesprochen.\n\nDatum der Verwarnung: {date}\n\nDie Verwarnung:\n{note}\n\nEine Verwarnung ist ein Eintrag in Ihrem Konto. Sie ist mit keiner Zahlung verbunden und hat keinen Einfluss darauf, wie Ihre Inserate in der Suche platziert werden. Bestätigte Buchungen bleiben bestehen, Ihre Gäste sind nicht betroffen.\n\nDen Verstoß und alle Einzelheiten finden Sie im Partnerportal:\n{url}\n\nFür Einsprüche oder Rückfragen wenden Sie sich über den Support im Partnerportal an das SAFRA-Team.\n\nIhr SAFRA-Team',
  },
  partnerFined: {
    subject: 'Für Ihr Konto wurde eine Geldbuße erhoben',
    body: 'Für Ihr SAFRA-Partnerkonto wurde eine Geldbuße erhoben.\n\nBetrag: {amount}\nDatum der Geldbuße: {date}\n\nGrund:\n{reason}\n\nEine Geldbuße hat keinen Einfluss darauf, wie Ihre Inserate in der Suche platziert werden; bestätigte Buchungen bleiben bestehen.\n\nDen Verstoß und die Geldbuße finden Sie vollständig im Partnerportal:\n{url}\n\nFalls die Geldbuße Ihrer Ansicht nach zu Unrecht erhoben wurde, wenden Sie sich über den Support im Partnerportal an das SAFRA-Team.\n\nIhr SAFRA-Team',
  },
  partnerUnsuspended: {
    subject: 'Ihr Partnerkonto wurde wieder freigegeben',
    body: 'Die Sperrung Ihres SAFRA-Partnerkontos wurde aufgehoben, das Konto ist wieder vollständig aktiv.\n\nDatum der Aufhebung: {date}\n\nGrund:\n{reason}\n\nWas wieder möglich ist:\n- Ihre Inserate erscheinen wieder in der Suche, neue Buchungen sind möglich.\n- Auszahlungen werden fortgesetzt. Während der Sperrung eingefrorene Beträge wurden gehalten, nicht storniert.\n- Sie können neue Unterkünfte anlegen sowie bestehende veröffentlichen und bearbeiten.\n\nDie Sperrung bleibt mit der Entscheidung zur Aufhebung daneben im Konto vermerkt — wir löschen den Eintrag nicht, wir ergänzen ihn.\n\nPartnerportal:\n{url}\n\nIhr SAFRA-Team',
  },
  partnerSuspended: {
    subject: 'Ihr Partnerkonto wurde gesperrt',
    body: 'Ihr SAFRA-Partnerkonto wurde gesperrt.\n\nDatum der Sperrung: {date}\n\nGrund:\n{reason}\n\nWas das bedeutet:\n- Ihre Inserate erscheinen nicht mehr in der Suche, und es sind keine neuen Buchungen möglich.\n- **Bestätigte Buchungen bleiben bestehen, Ihre aktuellen Gäste sind nicht betroffen.** Empfangen Sie sie wie gewohnt.\n- Auszahlungen sind während der Sperrung eingefroren.\n- Sie können keine neuen Unterkünfte anlegen und bestehende weder veröffentlichen noch bearbeiten.\n\nSie können sich weiterhin im Partnerportal anmelden, Ihr Konto einsehen und diesen Grund jederzeit nachlesen:\n{url}\n\nFür Einsprüche oder Rückfragen wenden Sie sich über den Support im Partnerportal an das SAFRA-Team.\n\nIhr SAFRA-Team',
  },
  staffSuspended: {
    subject: 'Ihr SAFRA-Konsolenkonto wurde deaktiviert',
    body: 'Ihr SAFRA-Konsolenkonto wurde deaktiviert und Sie können sich nicht mehr anmelden. Alle geöffneten Sitzungen auf allen Geräten wurden beendet.\n\nDas Konto wurde nicht gelöscht und es sind keine Daten verloren gegangen. Die Deaktivierung ist umkehrbar; eine Administratorin oder ein Administrator kann das Konto jederzeit wieder aktivieren.\n\nWenn Sie glauben, dass dies versehentlich geschehen ist, wenden Sie sich bitte direkt an eine SAFRA-Administration — über die Anmeldeseite lässt sich das nicht klären.\n\nIhr SAFRA-Team',
  },
  staffReinstated: {
    subject: 'Ihr SAFRA-Konsolenkonto wurde wieder aktiviert',
    body: 'Ihr SAFRA-Konsolenkonto wurde wieder aktiviert und Sie können sich erneut anmelden:\n{url}\n\nSie müssen sich auf jedem Gerät neu anmelden, da Ihre früheren Sitzungen bei der Deaktivierung beendet wurden.\n\nIhre Rolle und Ihre Berechtigungen sind unverändert.\n\nIhr SAFRA-Team',
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

  partnerEmployeeInvitation: {
    subject: 'Einladung in das Team von {partnerName} auf SAFRA',
    body: '{partnerName} hat Sie eingeladen, auf der SAFRA-Plattform mitzuarbeiten.\n\nÖffnen Sie den folgenden Link, um Ihr Passwort zu setzen und Ihr Konto zu aktivieren. Er ist {hours} Stunden gültig:\n{url}\n\nFalls Sie diese Einladung nicht erwartet haben, ignorieren Sie diese Nachricht; es wird kein Konto für Sie angelegt.\n\nIhr SAFRA-Team',
  },

  partnerContractCountersigned: {
    subject: 'Ihre Ausfertigung des unterzeichneten Partnervertrags — {reference}',
    body: 'Beide Parteien haben den Partnervertrag unterzeichnet; er ist ab sofort in Kraft.\n\nIhre Ausfertigung liegt auf der Seite «Verträge und Dokumente» in Ihrem Partner-Dashboard und kann jederzeit heruntergeladen werden:\n{url}\n\nIhr SAFRA-Team',
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
  bookingCancelledBySafra: {
    subject: 'Ihre Buchung {reference} wurde storniert — SAFRA',
    body: 'Es tut uns leid: Der Partner hat Ihre Buchung nicht fristgerecht bestätigt, daher hat SAFRA sie storniert.\n\nReferenz: {reference}\nUnterkunft: {property}\nAnreise: {checkIn}\nAbreise: {checkOut}\n\nWir erstatten den vollen Betrag von {amount} {currency}. Die Erstattung startet automatisch und kann je nach Zahlungsart einige Tage bis zur Gutschrift dauern.\n\nZusätzlich haben wir {compensation} {currency} als Entschädigung in Ihr Guthaben gebucht.\n\nEine alternative Unterkunft für dieselben Daten finden Sie hier:\n{url}\n\nIhr SAFRA-Team',
  },
  bookingRefunded: {
    subject: 'Erstattung für Buchung {reference} gestartet — SAFRA',
    body: 'Wir haben die Erstattung Ihrer Buchung gestartet.\n\nReferenz: {reference}\nErstatteter Betrag: {amount} {currency}\n\nWas in Ihr Guthaben zurückgeht, ist sofort verfügbar. Was über Ihre Zahlungsart zurückgeht, kann einige Tage dauern.\n\nBuchungsdetails:\n{url}\n\nIhr SAFRA-Team',
  },
  bookingInvoice: {
    subject: 'Ihre Rechnung zur Buchung {reference} — SAFRA',
    body: 'Wir haben Ihre Zahlung erhalten. Dies ist die Rechnung zu Ihrer Buchung.\n\nReferenz: {reference}\nUnterkunft: {property}\nGezahlter Gesamtbetrag: {amount} {currency}\n\nRechnung hier öffnen oder herunterladen:\n{url}\n\nIhr SAFRA-Team',
  },
  bookingDeadlineReminder: {
    subject: 'Noch 30 Minuten für Buchung {reference} — SAFRA',
    body: 'Erinnerung: Die Frist zur Beantwortung dieser Buchung läuft bald ab.\n\nReferenz: {reference}\nUnterkunft: {property}\nAnreise: {checkIn}\nAbreise: {checkOut}\n\nFrist: {deadline}. Läuft sie unbeantwortet ab, wird die Buchung automatisch storniert, der Kunde vollständig erstattet und ein Verstoß «keine Reaktion» auf Ihrem Konto vermerkt.\n\nAnfrage jetzt öffnen:\n{url}\n\nIhr SAFRA-Team',
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
