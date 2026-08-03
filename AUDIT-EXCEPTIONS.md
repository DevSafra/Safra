# Dependency audit exceptions

**There are currently none.** `pnpm audit` reports no known vulnerabilities at any
severity, with no advisories suppressed, across both the production tree and the full
tree including build tooling. Verified 2026-08-03.

Rule 1 requires dependencies to be audited in CI and known-vulnerable packages to fail
the build. Any future exception must be listed here with its reasoning, and re-checked
whenever the dependency tree changes.

CI enforces two gates:

1. **`pnpm audit --prod`** — production dependencies, **no exceptions allowed**.
   This covers everything that reaches a running server or a user's browser.
2. **`pnpm audit`** — the full tree including build tooling.

---

## Resolved

### GHSA-mh99-v99m-4gvg — brace-expansion, DoS via unbounded expansion

**Accepted 2026-07-29. Removed 2026-08-03 — no longer applicable.**

It was accepted because the advisory listed `>=5.0.8` as the only patched release, and
ESLint depends on `minimatch@3`, which requires `brace-expansion@^1.1.7` and calls it as
a CommonJS default export. brace-expansion 5 changed that export shape, so forcing the
patched version broke ESLint outright with `TypeError: expand is not a function`. The
recorded removal condition was "a `1.1.x` release carrying the fix is published".

That condition was met. `brace-expansion@1.1.18` fixes it on the 1.x line, so the
exception is gone rather than merely still justified.

---

## A trap worth knowing before adding an override

The overrides for this package are bounded to their major on purpose:

```json
"brace-expansion@1": ">=1.1.18 <2",
"brace-expansion@5": ">=5.0.9 <6"
```

Writing `">=1.1.18"` without the upper bound looks equivalent and is not: the range also
matches 5.x, so pnpm resolved the ESLint dependency to brace-expansion 5 and reintroduced
the exact incompatibility described above. Observed on 2026-08-03. Always bound a
version-scoped override to its major.
