/**
 * Session handling shared by `apps/web` and `apps/admin`.
 *
 * Everything here is runtime-agnostic — no `next/headers`, no Node built-ins — so it
 * can be imported from middleware on the Edge runtime as well as from a server
 * component. Each app keeps its own thin reader for the ambient request, because
 * that is the part which needs `next/headers` and the part least likely to drift.
 */
export * from './session.js';
export * from './auth-api.js';
export * from './redirect.js';
export * from './request-origin.js';
export * from './csp.js';

/* Where a browser fetches listing photography — shared so the two apps cannot drift. */
export * from './media.js';
