import { authenticator } from 'otplib';

/**
 * Prints a current TOTP code for the local staff account.
 *
 * Exists because the alternative is asking someone for a six-digit number that expires
 * in under thirty seconds. `pnpm code` from the repository root.
 *
 * Development only: it reads a plaintext secret from `.env` and has no place anywhere
 * near a real environment. `DEV_OPS_TOTP_SECRET` is read by nothing else.
 */
const secret = process.env['DEV_OPS_TOTP_SECRET'];

if (!secret) {
  console.error(
    '\nDEV_OPS_TOTP_SECRET is not set.\n\n' +
      'It lives in the git-ignored .env at the repository root. Run from there:\n' +
      '  pnpm code\n',
  );
  process.exit(1);
}

const remaining = authenticator.timeRemaining();

console.log(`\n  ${authenticator.generate(secret)}\n`);
console.log(`  valid for ${remaining}s — regenerate if it expires before you submit\n`);

// A code with two seconds left will be rejected by the time it is typed.
if (remaining <= 5) {
  console.log('  (that one is nearly expired — run it again)\n');
}
