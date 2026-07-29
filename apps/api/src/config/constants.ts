/**
 * Route constants shared between bootstrap and the controllers.
 *
 * The refresh cookie's Path MUST match the real URL of the refresh endpoint,
 * including the global prefix, or the browser never sends it and every session
 * silently dies at the first rotation. Deriving both from one constant is what
 * stops the prefix and the cookie path drifting apart.
 */
export const API_PREFIX = 'api/v1';

/** Refresh tokens are scoped to the auth routes and sent nowhere else. */
export const REFRESH_COOKIE_NAME = 'safra_refresh';
export const REFRESH_COOKIE_PATH = `/${API_PREFIX}/auth`;
