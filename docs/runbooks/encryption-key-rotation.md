# Runbook: rotating `FIELD_ENCRYPTION_KEY`

**Applies to:** every field-encrypted column (five today, listed below).
**Last checked against the code:** 2026-10-06. The procedure was first performed end to end on
2026-08-02, when it covered only the TOTP column; the four other columns were added to the
rotation on 2026-10-06 and that half has been proved by an integration test, not yet by a
rotation of a running environment.

---

## What the key protects

`FIELD_ENCRYPTION_KEY` (64 hex characters, 32 bytes) is the AES-256-GCM key for every value
written through `FieldEncryptionService`. The complete list is `ROTATED_COLUMNS` in
`apps/api/src/common/crypto/field-key-rotation.ts`:

| Column                                             | What it is                                                                | Read back when                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------- |
| `users.totp_secret_encrypted`                      | Staff and partner TOTP seeds                                              | Every sign-in with a second factor, 2FA changes |
| `partner_payout_accounts.account_number_encrypted` | A partner's payout account number                                         | A partner edits their payout account            |
| `safra_payout_accounts.account_number_encrypted`   | SAFRA's own payout account numbers                                        | Not decrypted by any screen today               |
| `payments.payer_account_encrypted`                 | The account a bank transfer came FROM                                     | Finance settles a bank-transfer refund          |
| `refunds.destination_account_encrypted`            | Where a bank-transfer refund was sent: a COPY of the payment's ciphertext | Never decrypted; compared as a string           |

`apps/api/src/common/crypto/field-key-rotation.test.ts` fails if the schema gains an
`*_encrypted` column, or the API a new `encrypt()` call, that the rotation does not cover.

Two variables, both in the secret manager:

| Variable                        | Meaning                                                              |
| ------------------------------- | -------------------------------------------------------------------- |
| `FIELD_ENCRYPTION_KEY`          | The CURRENT key. Encrypts everything new; tried first on decryption. |
| `FIELD_ENCRYPTION_KEY_PREVIOUS` | Optional. The key being retired. Decrypts only, never encrypts.      |

The API refuses to boot if either is not 64 hex characters, or if both are set to the same
value. There is no key identifier in the ciphertext: decryption tries the current key, then the
previous one.

---

## Rotate

Steps 4 and 7 are **separate deploys**. Removing the previous key in the same change that
introduces the new one makes every value above unreadable at once: staff cannot sign in, and
bank-transfer refunds cannot be settled.

**1. Generate the new key.** Straight into the secret manager; never into a ticket, a chat or a
terminal log.

```bash
openssl rand -hex 32
```

**2.** Set `FIELD_ENCRYPTION_KEY_PREVIOUS` to the key currently in use.

**3.** Set `FIELD_ENCRYPTION_KEY` to the new key.

**4. Deploy, migrations included.** The migration step re-applies every `post/` file, and
`post/0027_bank_transfer_refund.sql` is what lets the rotation rewrite the set-once payer and
refund ciphertext. A rotation run against a database whose `post/` stage predates 2026-10-06
fails on the first bank-transfer payment with `the account the money came from is recorded and
cannot change`; that is the cue to run migrations, not a data problem.

After this deploy both keys decrypt and only the new one encrypts. Nobody is locked out. A TOTP
seed is rewritten under the new key whenever its owner signs in; nothing else migrates by itself.

**5. Re-encrypt everything else**, with the new environment (both variables set):

```bash
# From a checkout, with the production environment loaded:
pnpm rotate:encryption-key --dry-run   # report only, writes nothing
pnpm rotate:encryption-key             # perform it

# Inside the API image, which ships compiled code and no tsx (read off apps/api/Dockerfile;
# not yet run in a container):
node dist/scripts/rotate-encryption-key.js --dry-run
node dist/scripts/rotate-encryption-key.js
```

It prints one line per column:

```
users.totp_secret_encrypted: 3 re-encrypted, 9 already current, 0 unreadable.
...
refunds.destination_account_encrypted: 40 re-encrypted, 0 already current, 0 unreadable.
```

It is safe to interrupt and to re-run: every write is per row, conditional on the value it read,
and a value already under the new key is left alone. A payment and the refunds copied from it are
rewritten in one transaction with one new ciphertext, so the database's "refunded to the same
account" comparison still holds. It exits non-zero if any row is unreadable.

**6. Verify before removing anything.** Run the dry run again:

```bash
pnpm rotate:encryption-key --dry-run
```

Every line must read `0 would be re-encrypted, … 0 unreadable`, followed by
`Nothing remains under the previous key. Safe to remove FIELD_ENCRYPTION_KEY_PREVIOUS in the
next deploy.` If any line shows rows still to re-encrypt, run step 5 again. If any shows
unreadable rows, stop: see the table below. Do not go on to step 7.

**7. Remove `FIELD_ENCRYPTION_KEY_PREVIOUS`** and deploy again.

**8. Verify after.** Sign in to the console as a staff account with a second factor. With the old
key gone, a successful sign-in proves that account's seed is under the new key. The dry run in
step 6 is what proves the other columns; once the previous key is removed the script has nothing
to compare and says so.

---

## Roll back

**A 503 is not data loss.** Ciphertext is never destroyed by a rotation; only the configured keys
decide what can be read. Do not restore the database for any symptom on this page.

| Where you are                                 | To undo                                                                                                                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| After step 7, something cannot decrypt        | Put `FIELD_ENCRYPTION_KEY_PREVIOUS` back to the retired key and deploy. Everything is readable again at once. Then repeat steps 5 and 6.                                                                                                    |
| Between steps 4 and 7, abandoning the new key | Do NOT simply set `FIELD_ENCRYPTION_KEY` back to the old key: rows rewritten since step 4 are under the new one. Rotate in reverse: `FIELD_ENCRYPTION_KEY` = old key, `FIELD_ENCRYPTION_KEY_PREVIOUS` = new key, deploy, then steps 5 to 8. |
| The new key leaked as well                    | Treat it as a fresh rotation to a third key, started only after this one has finished step 6, so that never more than two keys are needed at once.                                                                                          |

---

## If something goes wrong

| Symptom                                                                                      | Cause                                                                                                                                                 | Action                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staff sign-ins return **503**, the log says `Cannot decrypt the stored TOTP secret for user` | The configured keys do not open that seed, usually step 7 done before steps 5 and 6                                                                   | Roll back as above. Sign-ins recover on the deploy.                                                                                                                                                                                                                                                                                                             |
| Settling a bank-transfer refund fails with a server error                                    | The payment's sender account is under a key that is no longer configured                                                                              | Same: restore the previous key, then steps 5 and 6.                                                                                                                                                                                                                                                                                                             |
| The script lists `UNREADABLE: <column> row <id>`                                             | That row was encrypted with a key that is neither current nor previous: a skipped generation, or a row written by an environment with a different key | Restore that key if it still exists and rotate from it. Otherwise: a `users` row, reset that person's second factor; a payout account, have the number entered again; a payment or refund, the sender account is set once and cannot be re-entered, so a bank-transfer refund of that payment cannot be settled. Never go on to step 7 while any row is listed. |
| The script stops with `the account the money came from is recorded and cannot change`        | The deploy in step 4 did not run migrations, so the database has the old `post/0027`                                                                  | Run migrations, then step 5 again.                                                                                                                                                                                                                                                                                                                              |
| Boot fails: `FIELD_ENCRYPTION_KEY_PREVIOUS is identical to FIELD_ENCRYPTION_KEY`             | Both set to the same value: a rotation that did not happen                                                                                            | Set the previous key to the one actually being retired, or unset it.                                                                                                                                                                                                                                                                                            |
| The script prints `FIELD_ENCRYPTION_KEY_PREVIOUS is not set`                                 | Run before step 2, or after step 7                                                                                                                    | Before: set it. After: nothing to do.                                                                                                                                                                                                                                                                                                                           |

---

## Ownership

| Responsibility                                         | Owner                                                     | Cadence                  |
| ------------------------------------------------------ | --------------------------------------------------------- | ------------------------ |
| Hold the key in the secret manager                     | Platform engineering                                      |                          |
| Decide to rotate                                       | Platform engineering, or Compliance on suspected exposure | Annually, or on incident |
| Execute the rotation                                   | Platform engineering                                      | Per rotation             |
| Confirm step 6 reports nothing remaining before step 7 | Platform engineering                                      | Per rotation             |

**Rotate on:** suspected exposure, a departure with production secret access, or an annual
schedule if policy requires one.

---

## Notes for whoever changes this next

- **A new encrypted column is added to `ROTATED_COLUMNS` and to `rotateFieldEncryption` in the
  same change.** The sweep test fails until it is; the integration test
  (`field-key-rotation.integration.test.ts`) needs a fixture row for it, and fails if one column has
  none.
- **The refund destination is a copy, not an encryption.** If a new column copies ciphertext from
  another, rotate the pair together, as `rotatePayerAccounts` does: re-encrypting each on its own
  gives them different IVs and breaks any comparison between them.
- **The set-once triggers have one exception,** the session setting `safra.field_key_rotation`,
  which only the rotation sets and only for its own transaction. Under it the ciphertext may change
  but the last four (and a refund's bank reference) may not, so a rotation can only re-encrypt the
  same account.
- **Lazy re-encryption never fails a sign-in.** If the rewrite fails it is logged and the sign-in
  still succeeds; the value stays readable under the retired key and the next sign-in or the script
  retries. A key-management task must not be able to deny access.
