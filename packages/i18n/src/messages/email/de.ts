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
  staffInvitation: {
    subject: 'Einladung zur SAFRA-Administrationskonsole',
    body: 'Sie wurden zur SAFRA-Administrationskonsole eingeladen als: {roleLabel}.\n\nÖffnen Sie diesen Link, um Ihr Passwort festzulegen:\n{url}\n\nDer Link läuft in {expiresInHours} Stunden ab und ist einmal verwendbar.\n\nNach dem Festlegen des Passworts müssen Sie die Zwei-Faktor-Authentifizierung aktivieren, bevor das Konto genutzt werden kann.\n\nFalls Sie diese Einladung nicht erwartet haben, öffnen Sie den Link nicht und informieren Sie das SAFRA-Team.\n\nIhr SAFRA-Team',
  },
} as const;
