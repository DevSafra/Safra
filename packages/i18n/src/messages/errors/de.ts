/**
 * The German error copy.
 *
 * Formal register (`Sie`) throughout, matching the customer app's German catalogue — a booking
 * site handling someone's money does not address them informally.
 */
export const de = {
  'request.malformed_body': 'Ungültige Anfrage.',
  'request.validation_failed': 'Bitte prüfen Sie die markierten Felder.',
  'request.body_too_large':
    'Diese Datei überschreitet das Limit. Wählen Sie eine kleinere.',
  'request.cursor_invalid':
    'Die nächste Seite konnte nicht geladen werden. Bitte von vorn beginnen.',
  'request.not_found': 'Nicht gefunden.',
  'request.upstream_unreachable':
    'Der Server ist nicht erreichbar. Bitte erneut versuchen.',
  'request.unknown': 'Etwas ist schiefgelaufen. Bitte erneut versuchen.',
  'request.too_many':
    'Zu viele Anfragen. Bitte einen Moment warten und erneut versuchen.',
  'request.capacity':
    'Der Dienst ist derzeit ausgelastet. Bitte in einem Moment erneut versuchen.',
  'auth.required': 'Anmeldung erforderlich.',
  'auth.credentials_invalid': 'E-Mail-Adresse oder Passwort ist falsch.',
  'auth.password_incorrect': 'Das Passwort ist falsch.',
  'auth.locked':
    'Konto nach mehreren Fehlversuchen vorübergehend gesperrt. Bitte später erneut versuchen.',
  'auth.too_many_attempts':
    'Zu viele Versuche. Bitte einen Moment warten und erneut versuchen.',
  'auth.email_code_sent':
    'Wir haben Ihnen einen sechsstelligen Code per E-Mail gesendet. Geben Sie ihn ein, um die Anmeldung abzuschließen.',
  'auth.email_code_invalid':
    'Dieser Code ist falsch oder abgelaufen. Fordern Sie einen neuen an.',
  'auth.email_code_too_many':
    'Zu viele Codes in kurzer Zeit angefordert. Bitte warten Sie und versuchen Sie es erneut.',
  'auth.code_required':
    'Bitte den Code aus Ihrer Authenticator-App eingeben. Falls Sie kein Gerät haben, können Sie einen Wiederherstellungscode verwenden.',
  'auth.code_invalid': 'Der Authenticator-Code ist falsch.',
  'auth.code_malformed':
    'Ungültiges Format. Bitte sechs Ziffern oder einen Wiederherstellungscode eingeben.',
  'auth.recovery_code_invalid': 'Der Wiederherstellungscode ist falsch.',
  'auth.no_authenticator': 'Für dieses Konto ist keine Authenticator-App eingerichtet.',
  'auth.two_factor_already_enabled':
    'Die Zwei-Faktor-Authentifizierung ist bereits aktiviert.',
  'auth.two_factor_not_enabled': 'Die Zwei-Faktor-Authentifizierung ist nicht aktiviert.',
  'auth.email_taken': 'Mit dieser E-Mail-Adresse existiert bereits ein Konto.',
  'auth.confirmation_link_invalid':
    'Dieser Bestätigungslink ist ungültig oder abgelaufen.',
  'auth.reset_link_invalid': 'Dieser Link zum Zurücksetzen ist ungültig oder abgelaufen.',
  'auth.token_invalid': 'Der Token ist ungültig oder abgelaufen.',
  'auth.session_expired': 'Ihre Sitzung ist abgelaufen. Bitte erneut anmelden.',
  'auth.session_missing': 'Keine aktive Sitzung.',
  'auth.not_staff':
    'Dies ist kein Mitarbeiterkonto und kann nicht für die Anmeldung im Kommandozentrum verwendet werden.',
  'auth.not_partner':
    'Dieses Konto hat keinen Zugang zum Partner-Dashboard. Falls Sie eine Partner-Einladung oder eine Einladung zur Mitarbeit bei einem Partner erhalten haben, öffnen Sie zuerst deren Link in Ihrer E-Mail, um das Konto zu aktivieren.',
  'auth.staff_account':
    'Dies ist ein Mitarbeiterkonto. Bitte melden Sie sich stattdessen im SAFRA-Kommandozentrum an.',
  'permission.denied': 'Sie haben keinen Zugriff auf diese Ressource.',
  'scope.outside': 'Dieser Datensatz liegt außerhalb Ihres zugewiesenen Bereichs.',
  'staff.not_found': 'Mitarbeiter nicht gefunden.',
  'payout.frozen_by_suspension':
    'Die Auszahlung ist gesperrt, solange das Konto gesperrt ist.',
  'partner.suspended':
    'Das Partnerkonto ist gesperrt, daher ist diese Aktion nicht möglich.',
  'partner.already_suspended': 'Dieses Konto ist bereits gesperrt.',
  'partner.not_suspended': 'Dieses Konto ist nicht gesperrt.',
  'violation.not_found': 'Dieser Verstoß wurde nicht gefunden.',
  'violation.stage_invalid': 'Der Verstoß kann nicht in diese Phase wechseln.',
  'violation.not_fined': 'Für diesen Verstoß liegt keine Geldstrafe vor.',
  'violation.already_waived': 'Diese Geldstrafe wurde bereits erlassen.',
  'audit_entry.not_found': 'Dieser Eintrag wurde nicht gefunden.',
  'staff.role_invalid': 'Das ist keine Mitarbeiterrolle.',
  'staff.cannot_suspend_self': 'Sie können Ihr eigenes Konto nicht deaktivieren.',
  'staff.cannot_change_own_scope': 'Sie können Ihren eigenen Bereich nicht ändern.',
  'staff.role_not_scopable': 'Diese Rolle kann nicht eingeschränkt werden.',
  'staff.cities_unrecognised': 'Eine oder mehrere Städte wurden nicht erkannt.',
  'booking.not_found': 'Buchung nicht gefunden.',
  'booking.verification_failed':
    'Dieser Bestätigungscode ist ungültig oder abgelaufen. Senden Sie einen neuen.',
  'booking.not_payable': 'Diese Buchung kann nicht mehr bezahlt werden.',
  'booking.stay_too_long': 'Ein Aufenthalt darf {maxNights} Nächte nicht überschreiten.',
  'booking.no_refundable_amount':
    'Für diese Buchung ist kein erstattungsfähiger Betrag vorhanden.',
  'booking.draft_not_refundable':
    'Eine Buchung im Entwurf hat keine Zahlung zum Erstatten.',
  'booking.dates_just_taken':
    'Diese Daten wurden gerade vergeben. Bitte andere Daten wählen.',
  'booking.same_day_closed':
    'Buchungen für heute sind in dieser Stadt geschlossen. Erstes verfügbares Datum: {date}.',
  'booking.arrival_in_past':
    'Das Anreisedatum liegt in der Vergangenheit. Erstes verfügbares Datum: {date}.',
  'payment.unavailable':
    'Die Zahlung ist vorübergehend nicht verfügbar. Bitte erneut versuchen.',
  'partner.not_found': 'Partner nicht gefunden.',

  // ── Partnerauszahlungen (§7.1) ────────────────────────────────────────────
  'payout.not_found': 'Diese Auszahlung wurde nicht gefunden.',
  'payout.not_accruing':
    'Dieser Zeitraum ist nicht offen und kann nicht geschlossen werden.',
  'payout.not_releasable':
    'Diese Auszahlung kann im aktuellen Zustand nicht freigegeben werden.',
  'payout.not_scheduled': 'Diese Auszahlung ist noch nicht terminiert.',
  'payout.not_held': 'Diese Auszahlung ist nicht gesperrt.',
  'payout.already_paid':
    'Diese Auszahlung wurde bezahlt und kann nicht geändert werden. Buchen Sie stattdessen eine Gegenbuchung.',
  'payout.already_final':
    'Diese Auszahlung ist abgeschlossen und kann nicht geändert werden.',
  'payout.nothing_to_pay': 'In diesem Zeitraum ist nichts auszuzahlen.',
  'payout.frozen_by_dispute':
    'Ein offener Fall sperrt die Auszahlung für diese Buchungen.',
  'payout.partner_not_screened':
    'Diese Auszahlung kann erst nach der Sanktionsprüfung des Partners freigegeben werden.',
  'partner.already_verified': 'Der Partner ist bereits verifiziert.',
  'partner.profile_missing': 'Dieses Konto ist keinem Partnerprofil zugeordnet.',
  'partner.type_unknown': 'Unbekannter Partnertyp.',
  'property.not_found': 'Objekt nicht gefunden.',
  'property.type_unknown': 'Unbekannter Objekttyp.',
  'property.amenities_unknown': 'Eine oder mehrere Ausstattungsmerkmale sind unbekannt.',
  'property.slug_not_derivable':
    'Es konnte keine eindeutige Adresse gebildet werden. Bitte den Namen leicht abwandeln.',
  'unit.not_found': 'Einheit nicht gefunden.',
  'unit.not_found_or_range_empty': 'Einheit nicht gefunden oder der Zeitraum ist leer.',
  'document.not_found': 'Dokument nicht gefunden.',
  'upload.file_missing': 'Es wurde keine Datei hochgeladen.',
  'upload.file_empty': 'Die hochgeladene Datei ist leer.',
  'upload.file_too_large': 'Die Datei ist größer als {maxMb} MB.',
  'upload.not_an_image': 'Die Datei konnte nicht als Bild gelesen werden.',
  'upload.image_unreadable': 'Dieses Bild konnte nicht gelesen werden.',
  'upload.image_too_large': 'Die Bildabmessungen sind zu groß.',
  'image.not_found': 'Bild nicht gefunden.',
  'contract.not_found': 'Vertrag nicht gefunden.',
  'contract.pdf_required': 'Ein Vertrag muss eine PDF-Datei mit maximal 10 MB sein.',
  'contract.not_signable':
    'Dieser Vertrag kann in seinem aktuellen Zustand nicht unterzeichnet werden.',
  'contract.not_reopenable':
    'Nur ein vollständig unterzeichneter Vertrag kann wieder geöffnet werden.',
  'contract.joint_not_allowed':
    'Eine von beiden Seiten unterzeichnete Kopie kann nur w\u00e4hrend der Aufnahme eines Partners hinterlegt werden. Nutzen Sie den regul\u00e4ren Weg: SAFRA-Kopie hochladen, dann auf die Unterschrift des Partners warten.',
  'employee_role.name_taken':
    'Eine Rolle mit diesem Namen existiert bereits. Bitte einen anderen wählen.',
  'employee_role.not_found': 'Diese Rolle wurde nicht gefunden.',
  'employee_role.in_use':
    'Eine Rolle, die Mitarbeitende noch innehaben, kann nicht entfernt werden. Weisen Sie ihnen zuerst eine andere Rolle zu.',
  'employee.not_found': 'Diese mitarbeitende Person wurde nicht gefunden.',
  'employee.already_employed': 'Diese Adresse arbeitet bereits für einen Partner.',
  'employee.email_is_staff': 'Diese Adresse gehört zu einem SAFRA-Mitarbeiterkonto.',
  'employee.email_is_owner': 'Diese Adresse gehört zum Konto des Partners selbst.',
  'employee.invitation_invalid':
    'Dieser Einladungslink ist ungültig oder abgelaufen. Bitten Sie den Partner um eine neue Einladung.',
  'staff_role.name_taken':
    'Eine Rolle mit diesem Namen existiert bereits. Bitte einen anderen wählen.',
  'staff_role.not_found': 'Diese Rolle wurde nicht gefunden.',
  'staff_role.system':
    'Dies ist eine Systemrolle und kann weder geändert noch entfernt werden.',
  'staff_role.in_use':
    'Eine Rolle, die Mitarbeitende noch innehaben, kann nicht entfernt werden. Weisen Sie ihnen zuerst eine andere Rolle zu.',
  'staff.last_super_admin':
    'Dies ist der letzte aktive Super-Admin. Ernennen Sie zuerst einen weiteren, sonst kann die Plattform nicht mehr verwaltet werden.',
  'contract.not_awaiting_signature':
    'Nur ein Vertrag, der auf die Signatur wartet, kann als signiert markiert werden.',
  'dispute.not_found': 'Streitfall nicht gefunden.',
  'dispute.already_closed': 'Dieser Streitfall ist bereits geschlossen.',
  'dispute.booking_not_disputable':
    'Für diese Buchung kann kein Streitfall eröffnet werden. Das ist nur bei einer bezahlten Buchung möglich.',
  'dispute.already_open':
    'Sie haben zu dieser Buchung bereits einen offenen Streitfall aus demselben Grund.',
  'conversation.not_found_or_closed': 'Unterhaltung nicht gefunden oder geschlossen.',
  'conversation.recipient_not_found': 'Empfänger nicht gefunden.',
  'campaign.not_found': 'Kampagne nicht gefunden.',
  'gift_card.code_invalid':
    'Dieser Geschenkkarten-Code ist ungültig. Bitte prüfen und erneut versuchen.',
  'ad.target_url_invalid':
    'Dieser Link ist ungültig — er muss mit http oder https beginnen.',
  'ad.window_order': 'Das Enddatum muss nach dem Startdatum liegen.',
  'ad.price_needs_currency':
    'Ein Preis benötigt eine Währung, und eine Währung einen Preis.',
  'advertiser.not_found': 'Werbetreibender nicht gefunden.',
  'ad_invoice.not_found': 'Rechnung nicht gefunden.',
  'ad_invoice.not_due': 'Diese Rechnung ist nicht fällig.',
  'coupon.invalid': 'Dieser Code ist ungültig.',
  'coupon.not_started': 'Dieser Gutschein ist noch nicht gültig.',
  'coupon.expired': 'Dieser Gutschein ist abgelaufen.',
  'coupon.inactive': 'Dieser Gutschein ist nicht aktiv.',
  'coupon.exhausted': 'Dieser Gutschein wurde bereits vollständig eingelöst.',
  'coupon.customer_limit': 'Sie haben diesen Gutschein bereits maximal oft verwendet.',
  'coupon.minimum_not_met': 'Die Buchung liegt unter dem Mindestwert dieses Gutscheins.',
  'coupon.not_for_city': 'Dieser Gutschein gilt nicht in dieser Stadt.',
  'coupon.not_for_partner': 'Dieser Gutschein gilt nicht für diese Unterkunft.',
  'coupon.first_booking_only': 'Dieser Gutschein gilt nur für die erste Buchung.',
  'coupon.currency_mismatch': 'Die Währung des Gutscheins weicht von der Buchung ab.',
  'coupon.code_taken': 'Dieser Code wird bereits verwendet.',
  'coupon.already_decided':
    'Über diesen Gutschein wurde bereits entschieden. Eine Annahme ist endgültig.',
  'coupon.not_found': 'Gutschein nicht gefunden.',
  'coupon.window_order': 'Das Enddatum muss nach dem Startdatum liegen.',
  'coupon.percent_range': 'Ein Prozentsatz muss zwischen 1 und 100 liegen.',
  'coupon.fixed_needs_currency': 'Ein Gutschein mit festem Wert benötigt eine Währung.',
  'gift_card.already_used': 'Diese Geschenkkarte wurde bereits eingelöst.',
  'gift_card.expired': 'Diese Geschenkkarte ist abgelaufen.',
  'gift_card.cancelled':
    'Diese Geschenkkarte wurde storniert. Bitte wenden Sie sich an den Support.',
  'gift_card.not_cancellable':
    'Diese Karte kann nicht storniert werden — sie ist bereits eingelöst, abgelaufen oder storniert.',
  'gift_card.not_found': 'Geschenkkarte nicht gefunden.',
  'gift_card.cash_only':
    'Ihr aktuelles Guthaben reicht für diese Karte nicht aus. Eine Geschenkkarte kann nur mit eigenem Guthaben gekauft werden — nicht mit Geschenkkarten-Guthaben und nicht mit einer Gutschrift von SAFRA.',
  'gift_card.amount_invalid':
    'Bitte einen der verfügbaren Geschenkkarten-Beträge wählen.',
  'wallet.insufficient_balance': 'Ihr Guthaben reicht dafür nicht aus.',
  'support.message_too_short': 'Bitte beschreiben Sie das Problem etwas genauer.',
  'support.ticket_not_found': 'Diese Support-Anfrage wurde nicht gefunden.',
  'support.ticket_closed':
    'Diese Support-Anfrage ist geschlossen. Bitte eröffnen Sie eine neue.',
  'validation.too_long': 'Dieser Wert ist zu lang.',
  'validation.out_of_range': 'Der Wert liegt außerhalb des zulässigen Bereichs.',
  'validation.code_invalid':
    'Die Kennung muss mit einem Kleinbuchstaben beginnen und darf nur Kleinbuchstaben, Ziffern und Unterstriche enthalten.',
  'property_type.code_taken':
    'Diese Kennung wird bereits von einer anderen Unterkunftsart verwendet.',
  'property_type.not_found': 'Keine Unterkunftsart mit dieser Kennung.',
  'wallet.not_found': 'Dieser Kunde hat kein Guthabenkonto.',
  'wallet.amount_not_positive': 'Eine Guthabenbuchung muss einen positiven Betrag haben.',
  'customer.profile_missing': 'Dieses Konto hat kein Kundenprofil.',
  'customer.not_found': 'Kundenprofil nicht gefunden.',
  'geo.city_unknown': 'Unbekannte Stadt.',
  'geo.city_not_found': 'Stadt nicht gefunden.',
  'geo.country_not_found': 'Land nicht gefunden.',
  'geo.category_not_found': 'Kategorie nicht gefunden.',
  'geo.category_in_use':
    'Diese Kategorie ist {n} Städten zugeordnet — deaktivieren statt entfernen.',
  'geo.city_in_use':
    'Eine Stadt, auf die {n} Datensätze verweisen (Unterkünfte, Buchungen, Partner…), kann nicht gelöscht werden. Deaktivieren Sie sie stattdessen.',
  'geo.country_in_use':
    'Ein Land mit {n} Städten kann nicht gelöscht werden. Löschen Sie zuerst seine Städte oder deaktivieren Sie es.',
  'geo.currency_in_use':
    'Eine Währung, die von {n} Datensätzen verwendet wird, kann nicht gelöscht werden. Deaktivieren Sie sie stattdessen.',
  'geo.currency_accounting':
    'Die Buchungswährung kann nicht gelöscht werden — jeder Journaleintrag lautet auf sie.',
  'geo.code_taken': 'Dieser Code wird bereits verwendet.',
  'geo.slug_taken': 'Dieser Bezeichner wird in diesem Land bereits verwendet.',
  'geo.timezone_invalid': 'Keine gültige Zeitzone.',
  'geo.slug_format':
    'Ein Bezeichner darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten.',
  'geo.country_code_format': 'Ein Ländercode besteht aus zwei Großbuchstaben.',
  'geo.currency_unknown': 'Unbekannte Währung.',
  'setting.value_flat_or_percent': '{key} muss „flat“ oder „percent“ sein.',
  'setting.value_sanctions_policy':
    'Der Wert von {key} muss required, advisory oder off sein.',
  'setting.value_percent_range': '{key} muss eine Zahl zwischen 0 und 100 sein.',
  'setting.value_positive_int': '{key} muss eine ganze Zahl von mindestens 1 sein.',
  'setting.value_hour_of_day': '{key} muss eine Stunde zwischen 0 und 23 sein.',
  'setting.value_boolean': '{key} muss wahr oder falsch sein.',
  'setting.no_updatable_fields': 'Es wurden keine änderbaren Felder übermittelt.',
  'emergency.activation_failed': 'Der Notfallmodus konnte nicht aktiviert werden.',
  'validation.email_invalid': 'Bitte eine gültige E-Mail-Adresse eingeben.',
  'validation.required': 'Dieses Feld ist erforderlich.',
  'validation.password_too_short':
    'Das Passwort muss mindestens {min} Zeichen lang sein.',
  'validation.password_composition':
    'Ihr Passwort braucht einen Groß- und einen Kleinbuchstaben, eine Zahl, ein Sonderzeichen und mindestens 12 Zeichen.',
  'validation.password_common':
    'Dieses Passwort gehört zu den meistgenutzten und wird zuerst erraten. Bitte ein anderes wählen — vier zusammenhanglose Wörter eignen sich gut.',
  'validation.password_predictable':
    'Dieses Passwort ist vorhersehbar: wiederholte oder aufeinanderfolgende Zeichen. Länge allein hilft nicht, wenn das Muster offensichtlich ist.',
  'validation.password_contains_identity':
    'Verwenden Sie nicht Ihre E-Mail-Adresse, Ihren Namen oder den Namen dieser Website im Passwort.',
  'validation.code_six_digits': 'Der Authenticator-Code besteht aus 6 Ziffern.',
  'validation.date_format': 'Datum im Format JJJJ-MM-TT.',
  'validation.date_unreal': 'Dieses Datum existiert nicht.',
  'validation.departure_after_arrival':
    'Das Abreisedatum muss nach dem Anreisedatum liegen.',
  'validation.end_before_start': 'Das Enddatum darf nicht vor dem Startdatum liegen.',
  'validation.range_too_long': 'Ein Zeitraum darf {maxDays} Tage nicht überschreiten.',
  'validation.amount_positive': 'Der Betrag muss größer als null sein.',
  'validation.reason_required':
    'Eine Begründung ist erforderlich — dies ist der Prüfeintrag.',
  'validation.rejection_reason_required':
    'Eine Ablehnung muss eine Begründung enthalten.',
  'validation.latitude_range': 'Der Breitengrad muss zwischen -90 und 90 liegen.',
  'validation.latitude_format': 'Der Breitengrad muss in Dezimalgrad angegeben werden.',
  'validation.longitude_range': 'Der Längengrad muss zwischen -180 und 180 liegen.',
  'validation.longitude_format': 'Der Längengrad muss in Dezimalgrad angegeben werden.',
  'validation.nights_min_max':
    'Die maximale Anzahl Nächte darf nicht unter der minimalen liegen.',
  'validation.booking_reference': 'Ungültige Buchungsnummer.',
  'validation.url_invalid': 'Geben Sie eine gültige URL ein, die mit https:// beginnt.',
  'validation.token_malformed': 'Ungültiger Link.',
  'validation.access_token_malformed': 'Ungültiges Zugriffstoken.',
  'validation.scope_all_cities_conflict':
    'Ein Bereich über alle Städte kann keine Städteliste enthalten.',
  'request.in_progress':
    'Diese Anfrage wird bereits verarbeitet. Bitte erneut versuchen.',
  'request.still_processing':
    'Die Anfrage wird noch verarbeitet. Bitte in Kürze erneut versuchen.',
  'auth.unavailable':
    'Die Anmeldung ist vorübergehend nicht möglich. Bitte den Support kontaktieren.',
  'auth.code_invalid_check_app':
    'Der Code ist ungültig. Bitte Ihre Authenticator-App prüfen.',
  'auth.two_factor_setup_required':
    'Bitte die Einrichtung starten, bevor die Zwei-Faktor-Authentifizierung aktiviert wird.',
  'auth.two_factor_already_enabled_reenrol':
    'Die Zwei-Faktor-Authentifizierung ist bereits aktiviert. Bitte zuerst deaktivieren, um sie neu einzurichten.',
  'auth.two_factor_role_ineligible':
    'Die Zwei-Faktor-Authentifizierung steht für diese Kontoart nicht zur Verfügung.',
  'partner.two_factor_target_not_partner':
    'Dieses Konto ist kein Partnerkonto. Zurücksetzungen an dieser Stelle gelten nur für Partnerkonten.',
  'validation.review_rating_range': 'Eine Bewertung muss zwischen 1 und 5 liegen.',
  'image.order_mismatch':
    'Die Bildreihenfolge muss genau die aktuellen Bilder dieser Unterkunft enthalten.',
  'image.last_one':
    'Ein veröffentlichtes Inserat braucht mindestens ein Bild. Bitte zuerst ein Ersatzbild hochladen.',
  'review.not_found': 'Bewertung nicht gefunden.',
  'review.stay_not_completed':
    'Eine Bewertung ist erst nach abgeschlossenem Aufenthalt möglich.',
  'review.already_written': 'Für diese Buchung liegt bereits eine Bewertung vor.',
  'review.not_your_booking': 'Diese Buchung können Sie nicht bewerten.',
  'review.already_replied': 'Sie haben auf diese Bewertung bereits geantwortet.',
  'review.already_reported': 'Diese Bewertung wurde bereits gemeldet.',
  'review.not_reported':
    'Diese Bewertung wurde nicht gemeldet, es ist nichts zu entscheiden.',
  'partner.two_factor_no_account':
    'Dieser Partner hat kein Anmeldekonto, daher gibt es keinen zweiten Faktor zum Zurücksetzen.',
  'staff.role_invalid_console':
    'Das ist keine Mitarbeiterrolle. Dieser Endpunkt erstellt ausschließlich Konsolenkonten.',
  'staff.email_taken':
    'Mit dieser E-Mail-Adresse existiert bereits ein Konto. Bitte dessen Rolle ändern statt es einzuladen.',
  'staff.already_activated':
    'Dieses Konto ist bereits aktiviert. Bitte stattdessen das Passwort zurücksetzen.',
  'staff.invitation_invalid':
    'Dieser Einladungslink ist ungültig oder wurde bereits verwendet.',
  'staff.cannot_change_own_role':
    'Sie können Ihre eigene Rolle nicht ändern. Bitte einen anderen Super-Admin fragen.',
  'booking.departure_after_arrival':
    'Die Abreise muss mindestens eine Nacht nach der Anreise liegen.',
  'booking.arrival_minimum_nights':
    'Anreisen am {date} erfordern mindestens {nights} Nächte.',
  'booking.no_captured_payment':
    'Für diese Buchung wurde keine Zahlung eingezogen, es gibt nichts zu erstatten.',
  'booking.not_payable_in_status':
    'Diese Buchung kann in ihrem aktuellen Status nicht bezahlt werden.',
  'payment.refund_unavailable':
    'Rückerstattungen über das ursprüngliche Zahlungsmittel sind vorübergehend nicht möglich.',
  'pricing.unavailable':
    'Die Preisberechnung ist vorübergehend nicht möglich. Bitte in Kürze erneut versuchen.',
  'wallet.wrong_account':
    'Bitte melden Sie sich mit dem Konto an, zu dem diese Buchung gehört, um Ihr Guthaben zu verwenden.',
  'wallet.balance_changed':
    'Ihr Guthaben hat sich während der Vorbereitung dieser Zahlung geändert. Bitte erneut versuchen.',
  'partner_application.not_found': 'Diese Partnerschaftsanfrage wurde nicht gefunden.',
  'partner_application.already_open':
    'Zu dieser E-Mail-Adresse liegt bereits eine offene Anfrage vor. Wir melden uns.',
  'partner_application.already_decided': 'Über diese Anfrage wurde bereits entschieden.',
  'partner_application.no_account':
    'Zu dieser Anfrage gehört kein Konto; sie kann nicht angenommen werden.',
  'partner_application.email_is_staff':
    'Diese E-Mail-Adresse gehört zu einem Mitarbeiterkonto und kann nicht in ein Partnerkonto umgewandelt werden.',
  'partner_application.email_is_partner': 'Diese E-Mail-Adresse ist bereits Partner.',
  'partner_onboarding.email_is_staff':
    'Diese E-Mail-Adresse gehört zu einem Mitarbeiterkonto und kann nicht als Partner registriert werden.',
  'partner_onboarding.email_is_partner':
    'Diese E-Mail-Adresse ist bereits Partner. Sie finden ihn im Partnerregister.',
  'partner_onboarding.already_activated':
    'Der Partner hat die Einladung bereits angenommen und ein Passwort gesetzt. Zum Zurücksetzen bitte „Passwort vergessen“ verwenden.',
  'partner_onboarding.application_open':
    'Zu dieser E-Mail-Adresse liegt eine offene Partnerschaftsanfrage vor. Bitte diese in der Anfrageliste abschließen, statt einen neuen Partner zu registrieren.',
  'partner.invitation_invalid':
    'Dieser Einladungslink ist ungültig oder wurde bereits verwendet.',
  'partner.not_verified':
    'Dieser Partner ist noch nicht verifiziert. Bitte den Partner verifizieren, bevor seine Objekte veröffentlicht werden.',
  'partner.sanctions_screening_required':
    'Vor der Verifizierung eines Partners muss die Sanktionsprüfung erfasst sein.',
  'property.unit_required':
    'Bitte mindestens eine Einheit hinzufügen, bevor Sie zur Prüfung einreichen.',
  'property.not_structurally_editable':
    'Ein veröffentlichtes Objekt kann strukturell nicht bearbeitet werden. Bitte wenden Sie sich an den SAFRA-Support.',
  'property.not_submittable':
    'Nur ein Objekt im Entwurf oder ein abgelehntes Objekt kann zur Prüfung eingereicht werden.',
  'property.not_reviewable':
    'Nur ein Objekt, das auf Prüfung wartet, kann geprüft werden.',
  'property.image_limit': 'Ein Objekt darf höchstens {max} Bilder haben.',
  'property.cancellation_policy_unknown': 'Unbekannte Stornierungsbedingung.',
  'geo.city_image_limit': 'Eine Stadt darf höchstens {max} Bilder haben.',
  'unit.unavailable_on': 'Die Einheit ist am {date} nicht verfügbar.',
  'unit.guest_limit':
    'Diese Einheit bietet Platz für {max} Gäste; angefragt wurden {requested}.',
  'unit.max_nights': 'Diese Einheit erlaubt höchstens {max} Nächte.',
  'unit.min_nights': 'Diese Einheit erfordert mindestens {min} Nächte.',
  'document.limit_reached':
    'Ein Partner darf höchstens {max} Dokumente hinterlegen. Bitte zuerst eines entfernen.',
  'document.type_unsupported':
    'Für Verifizierungsdokumente werden nur PDF-, JPEG- und PNG-Dateien akzeptiert.',
  'upload.image_type_unsupported':
    'Es werden nur JPEG-, PNG-, WebP-, AVIF-, HEIF- oder TIFF-Bilder akzeptiert.',
  'upload.image_too_small': 'Bilder müssen mindestens {min}x{min} Pixel groß sein.',
  'upload.image_processing_failed':
    'Dieses Bild konnte nicht verarbeitet werden. Bitte erneut hochladen.',
  'export.not_found': 'Kein Export mit dieser Referenz.',
  'export.not_ready': 'Dieser Export wird noch erstellt. Bitte gleich neu laden.',
  'export.failed': 'Dieser Export konnte nicht erstellt werden. Bitte erneut anfordern.',
  'export.expired': 'Diese Datei ist abgelaufen. Bitte einen neuen Export anfordern.',
  'setting.unknown':
    'Diese Einstellung existiert nicht. Einstellungen werden vorab angelegt, nicht hier erstellt.',
  'setting.value_rate':
    '{key} ist ein Satz und muss eine Zahl zwischen 0 und 1 sein (7% ist 0,07).',
  'campaign.expired':
    'Diese Kampagne ist abgelaufen. Bitte eine neue Kampagne für einen neuen Zeitraum anlegen.',
  'validation.password_too_long': 'Das Passwort darf höchstens {max} Zeichen lang sein.',
  'validation.phone_format':
    'Die Telefonnummer muss im internationalen Format angegeben werden, z. B. +963933123456.',
  'validation.phone_invalid':
    'Diese Nummer ist im gewählten Land nicht gültig. Prüfen Sie sie oder wählen Sie ein anderes Land.',
  'validation.recovery_code_format':
    'Das Format des Wiederherstellungscodes ist XXXX-XXXX-XXXX.',
  'validation.decimal_string': 'Bitte einen Betrag wie 10.00 eingeben.',
  'validation.currency_code': 'Muss ein dreibuchstabiger ISO-4217-Währungscode sein.',
  'validation.rate_positive': 'Der Kurs muss größer als null sein.',
  'validation.rate_syp_fixed':
    'Der Kurs SYP zu SYP ist immer 1 und kann nicht gesetzt werden.',
  'validation.price_range': 'Der Mindestpreis darf den Höchstpreis nicht überschreiten.',
  'validation.one_field_required': 'Bitte mindestens ein Feld zum Ändern angeben.',
  'validation.password_unchanged':
    'Das neue Passwort muss sich vom aktuellen unterscheiden.',
  'validation.rejection_notes_required':
    'Eine Ablehnung erfordert Hinweise dazu, was geändert werden muss.',
  'validation.sanctions_body_too_small':
    'Diese Datei ist zu klein für eine konsolidierte Sanktionsliste; der Download wirkt abgeschnitten.',
  'validation.sanctions_source':
    'Unbekannte Listenquelle. Geben Sie an, welche Liste importiert wird.',
  'booking.transition_invalid':
    'Eine Buchung kann von ihrem aktuellen Status nicht in diesen Status wechseln.',
  'request.idempotency_key_reused':
    'Dieser Idempotenzschlüssel wurde bereits für eine andere Anfrage verwendet.',

  /* `O-api-2`, 2026-08-25 — the last refusals that answered a bare English sentence. */
  'wallet.balance_below_amount':
    'Ihr Guthaben beträgt {balance} {currency} und liegt damit unter den benötigten {requested} {currency}.',
  'wallet.not_withdrawable':
    'Der auszahlbare Teil Ihres Guthabens beträgt {withdrawable} {currency} und liegt damit unter den benötigten {requested} {currency}. {restricted} {currency} sind eine Gutschrift von SAFRA: auf der Plattform einsetzbar, aber nicht auszahlbar.',
  'auth.two_factor_enrolment_required':
    'Für dieses Konto ist eine Zwei-Faktor-Authentisierung erforderlich. Richten Sie sie ein, bevor Sie fortfahren.',
  'setting.value_not_positive_money':
    '{key} muss ein positiver Betrag sein — eine Zahl oder ein Betrag mit Währung.',
  'setting.schema_not_editable':
    '{key} hat das Schema "{schema}", das dieser Editor nicht prüfen kann. Ändern Sie es bewusst und nicht über dieses Formular.',
  'sanctions.list_unavailable':
    'Screening nicht möglich: Die Sanktionsliste fehlt oder ist veraltet. Aktualisieren Sie sie vor dem Screening.',
} as const;
