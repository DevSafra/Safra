/**
 * Shared UI shared by `apps/web`, `apps/admin` and `apps/partner`.
 *
 * Deliberately small. A component earns a place here only when more than one app needs it
 * AND consistency between them is a requirement rather than a nicety — `PasswordField` is
 * here because "every password field has a show/hide toggle" is a project rule, and a
 * rule enforced by a shared component cannot drift the way a convention does.
 *
 * The sidebar and theme controls arrived here on the same argument: "the sidebar collapses at
 * every size, the hamburger is always available, and the account controls sit at the foot of the
 * sidebar" is a standing instruction that now covers both staff surfaces. Each carries its copy
 * and its element ids in as props, so no user-facing text lives in this package.
 */
export * from './ornaments.js';
export * from './status.js';
export * from './theme.js';
export * from './password-field.js';
export * from './password-match.js';
export * from './sidebar.js';
export * from './sidebar-toggle.js';
export * from './sidebar-backdrop.js';
export * from './theme-toggle.js';
