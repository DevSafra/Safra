# Dependency audit exceptions

Rule 1 requires dependencies to be audited in CI and known-vulnerable packages to
fail the build. Every exception to that is listed here with its reasoning, and each
must be re-checked whenever the dependency tree changes.

CI enforces two gates:

1. **`pnpm audit --prod`** — production dependencies, **no exceptions allowed**.
   This covers everything that reaches a running server or a user's browser.
2. **`pnpm audit`** — the full tree including build tooling, honouring the
   exceptions below.

---

## GHSA-mh99-v99m-4gvg — brace-expansion, DoS via unbounded expansion

**Status:** accepted, 2026-07-29
**Severity:** high
**Path:** `eslint → minimatch@3 → brace-expansion@1`

**Why it is not fixable.** The advisory lists `>=5.0.8` as the only patched
release. ESLint 9 depends on `minimatch@3`, which requires `brace-expansion@^1.1.7`
and calls it as a CommonJS default export. brace-expansion 5 changed that export
shape, so forcing the patched version breaks ESLint outright with
`TypeError: expand is not a function` — verified, not hypothesised. No patched
release exists on the 1.x line for this specific advisory.

**Why the risk is acceptable.**

- **Not reachable from production.** `pnpm audit --prod` reports zero
  vulnerabilities. ESLint is a devDependency and ships in no bundle.
- **Exploitation requires control of our own repository.** The DoS is triggered by
  feeding a malicious glob pattern to ESLint. Anyone able to do that can already
  edit our lint config and CI workflow, so this is not the weakest link.
- **Blast radius is a hung CI job**, not data exposure or code execution.

**Removal condition.** Drop this exception as soon as ESLint stops depending on
`minimatch@3` (tracked upstream in the `@eslint/eslintrc` legacy-config path), or a
`1.1.x` release carrying the fix is published. Re-run
`pnpm audit --audit-level=moderate` after any ESLint major upgrade and delete this
entry if it no longer appears.
