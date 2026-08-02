/**
 * The injection token, in its own file.
 *
 * `RedisModule` provides `RedisThrottlerStorage`, and that class injects `REDIS`. With
 * the token declared in the module, those two files import each other — and under ESM
 * the decorator runs before the cycle resolves, so the process dies at boot with
 * "Cannot access 'REDIS' before initialization". A leaf module both can import breaks
 * the cycle.
 *
 * This is only reachable by starting the application: a unit test that constructs the
 * storage directly never touches the module, which is exactly how it got missed.
 */
export const REDIS = Symbol('REDIS');
