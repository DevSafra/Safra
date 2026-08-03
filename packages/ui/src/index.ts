/**
 * Shared UI shared by `apps/web` and `apps/admin`.
 *
 * Deliberately small. A component earns a place here only when both apps need it AND
 * consistency between them is a requirement rather than a nicety — `PasswordField` is
 * here because "every password field has a show/hide toggle" is a project rule, and a
 * rule enforced by a shared component cannot drift the way a convention does.
 */
export * from './password-field.js';
