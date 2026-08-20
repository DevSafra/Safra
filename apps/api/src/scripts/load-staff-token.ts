import { authenticator } from 'otplib';

/**
 * Prints an access token for the load-test staff account, and nothing else.
 *
 * ## Why a script rather than a curl in the documentation
 *
 * Scenario 3 needs `LOAD_STAFF_TOKEN`. Getting one by hand is three steps that all have to happen
 * inside thirty seconds: read the TOTP secret, generate a code, POST it with the password before the
 * code expires. A documented curl pipeline would be copied wrong once and then blamed on the
 * scenario — the run would report 401s and read as an authorisation defect.
 *
 * Output is the bare token on stdout so it can be captured directly:
 *
 *   export LOAD_STAFF_TOKEN="$(pnpm -s load:token)"
 *
 * Everything explanatory goes to stderr, which is why a failure here is readable but never ends up
 * inside the variable.
 *
 * ## It refuses to talk to anything but a local API
 *
 * The credentials are the fixed, printed ones from `prepare-load-accounts.ts`. Sending them at a
 * deployed host would be sending a known password over the wire at a real environment, so the host
 * is checked rather than trusted. Override with `LOAD_API_URL` only for a host that is genuinely a
 * load target.
 */
const API = process.env['LOAD_API_URL'] ?? 'http://localhost:4000';

const EMAIL = process.env['LOAD_STAFF_EMAIL'] ?? 'load-staff@safra.test';
const PASSWORD = process.env['LOAD_STAFF_PASSWORD'] ?? 'Load-Test-Staff-Passw0rd!';
const SECRET = process.env['LOAD_STAFF_TOTP_SECRET'] ?? 'KRSXG5CTMVRXEZLUMU2TAMBQGAYA';

function assertLocal(url: string): void {
  const { hostname } = new URL(url);

  if (!['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostname)) {
    throw new Error(
      `Refusing to send the fixed load-test password to "${hostname}". This account's credentials ` +
        'are written into the repository; they belong to a throwaway database and nowhere else.',
    );
  }
}

async function main(): Promise<void> {
  assertLocal(API);

  /*
    A code with a couple of seconds left is a code the server will reject by the time the request
    lands, and the failure looks like a wrong password. Waiting for the next window is cheaper than
    explaining that.
  */
  if (authenticator.timeRemaining() <= 3) {
    await new Promise((resolve) => {
      setTimeout(resolve, (authenticator.timeRemaining() + 1) * 1000);
    });
  }

  const response = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: EMAIL,
      password: PASSWORD,
      totpCode: authenticator.generate(SECRET),
    }),
  });

  const body = (await response.json().catch(() => null)) as {
    accessToken?: string;
    code?: string;
  } | null;

  if (!response.ok || !body?.accessToken) {
    throw new Error(
      `Sign-in answered ${response.status}${body?.code ? ` (${body.code})` : ''}.\n` +
        'Check that the API is running against the LOAD database and that pnpm load:accounts has ' +
        'been run against it.',
    );
  }

  process.stdout.write(body.accessToken);
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
