import { authenticator } from 'otplib';

/**
 * Prints a current TOTP code for the fixture partner accounts.
 *
 * The same convenience `dev-totp.ts` provides for the staff account, and it exists for the same
 * reason: partner 2FA is mandatory, so signing in as a partner during development means producing
 * a code, and typing one out of a phone that is not enrolled is not possible.
 *
 * Local development only. `TESTBED_PARTNER_TOTP_SECRET` is read by nothing else, and the accounts
 * it unlocks exist only in a local `safra` database.
 */
const secret =
  process.env['TESTBED_PARTNER_TOTP_SECRET'] ?? 'KRSXG5CTMVRXEZLUMU2TAMBQGAYA';

console.log(`\n  ${authenticator.generate(secret)}`);
console.log(`  valid for ${authenticator.timeRemaining()}s\n`);
