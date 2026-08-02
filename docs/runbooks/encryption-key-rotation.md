# Runbook — Rotating `FIELD_ENCRYPTION_KEY`

**Applies to:** staff TOTP secrets, and any future field-encrypted column.
**Verified end to end on 2026-08-02** against a running API and a real database: a full
rotation was performed, a staff member signed in throughout, and the retired key was
removed afterwards without locking anyone out.

---

## What this key protects, and why rotation used to be impossible

`FIELD_ENCRYPTION_KEY` encrypts staff TOTP seeds at rest with AES-256-GCM, so a stolen
database dump does not hand over everybody's second factor.

Until 2026-08-02 there was **one** key and nothing that re-encrypted. Changing it made
every stored secret undecryptable, and because a staff account cannot sign in without
its second factor, that locked **every** staff member out of the console at once.
Recovery was circular: resetting someone's 2FA requires a super admin, who was also
locked out. In effect the key could never be rotated — an unacceptable property for the
key protecting second factors, since the usual reason to rotate is that you think it
leaked.

Two keys are now supported. Decryption tries the current key, then the retired one.
Encryption always uses the current key, so secrets migrate to it as they are used.

---

## Rotate

Six steps. **Steps 4 and 6 are deliberately separate deploys** — removing the previous
key in the same change that introduces the new one is exactly the mistake that causes
the lockout this design exists to prevent.

```bash
# 1. Generate the new key
openssl rand -hex 32
```

```bash
# 2 and 3. In the secret manager:
FIELD_ENCRYPTION_KEY_PREVIOUS=<the key currently in use>
FIELD_ENCRYPTION_KEY=<the new key from step 1>
```

**4. Deploy.** Both keys decrypt; only the new one encrypts. Nobody is locked out, and
every staff member who signs in has their secret quietly rewritten under the new key.

```bash
# 5. Migrate the accounts that have not signed in
pnpm rotate:encryption-key --dry-run   # report only
pnpm rotate:encryption-key             # perform it
```

Expect: `N re-encrypted, M already current, 0 unreadable`, followed by
`Nothing remains under the previous key.`

**6. Remove `FIELD_ENCRYPTION_KEY_PREVIOUS`** and deploy again. Only do this after
step 5 reports `0 unreadable`.

### Verifying it worked

Sign in as a staff account after step 6. If it succeeds, nothing is left under the old
key — that sign-in is the proof, because the old key is no longer configured.

---

## If something goes wrong

| Symptom                                                                          | Cause                                                                                                       | Action                                                                                                                          |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Staff logins return **503**, log says `Cannot decrypt the stored TOTP secret`    | The configured keys do not match what encrypted the row — usually step 6 done before step 5                 | Put the previous key back and deploy. Logins recover immediately. Then run step 5                                               |
| `rotate:encryption-key` reports rows as **unreadable**                           | Those secrets were encrypted with a key that is no longer configured — a rotation that skipped a generation | Restore the missing key if it still exists. Otherwise reset those accounts' second factor: they cannot be recovered by rotation |
| Boot fails: `FIELD_ENCRYPTION_KEY_PREVIOUS is identical to FIELD_ENCRYPTION_KEY` | Both set to the same value — a rotation that did not happen                                                 | Set the previous key to the one actually being retired, or unset it                                                             |

**A 503 is not data loss.** The ciphertext is intact; only the key is wrong. Restoring
the correct key restores access. Do not restore the database for this.

---

## Ownership

| Responsibility                                      | Owner                                                     | Cadence                  |
| --------------------------------------------------- | --------------------------------------------------------- | ------------------------ |
| Hold the key in the secret manager                  | Platform engineering                                      | —                        |
| Decide to rotate                                    | Platform engineering, or Compliance on suspected exposure | Annually, or on incident |
| Execute the rotation                                | Platform engineering                                      | Per rotation             |
| Confirm step 5 reports zero remaining before step 6 | Platform engineering                                      | Per rotation             |

**Rotate on:** suspected exposure, a departure with production secret access, or an
annual schedule if policy requires one.

---

## Notes for whoever changes this next

- **No key identifier in the ciphertext.** Adding one would change the stored format
  and require migrating every row _before_ rotation could work — a chicken-and-egg
  problem. Trying two keys costs one failed GCM tag check on unmigrated values:
  microseconds, and only until re-encryption completes.
- **Lazy re-encryption never fails a login.** If the rewrite fails, it is logged and the
  sign-in still succeeds; the value stays readable under the retired key and the next
  sign-in retries. A key-management task must not be able to deny access.
- **Only TOTP secrets are field-encrypted today.** Partner payout account numbers are
  intended to be (see `FieldEncryptionService`) but do not exist yet — payouts are
  deferred. When they arrive, add them to `rotate-encryption-key.ts`, or a rotation
  will silently leave them behind.
