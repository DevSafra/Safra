import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { tap } from 'rxjs';

import { AuditService } from './audit.service.js';
import type { AccessTokenClaims } from '../../auth/token.service.js';

export const AUDITED_KEY = 'safra:audited';
export const AUDIT_EXEMPT_KEY = 'safra:audit_exempt';

export interface AuditedOptions {
  /** e.g. "booking.cancelled". Namespaced by resource, past tense. */
  action: string;
  subjectType: string;
  /** Route param holding the subject's id or reference. Defaults to `reference`. */
  subjectParam?: string;
}

/**
 * Marks a route for automatic auditing.
 *
 * The row is written AFTER the handler succeeds, so a rejected request does not
 * appear as a completed action.
 */
export const Audited = (options: AuditedOptions) => SetMetadata(AUDITED_KEY, options);

/**
 * Declares that a mutating route intentionally needs no audit row.
 *
 * Requires a reason so the exemption is a decision on the record rather than an
 * oversight — the interceptor warns about unmarked mutations, and this is how a
 * legitimate one silences that warning.
 */
export const AuditExempt = (reason: string) => SetMetadata(AUDIT_EXEMPT_KEY, reason);

/**
 * Writes audit rows for routes marked @Audited, and — more importantly — warns
 * about mutating routes that are marked neither @Audited nor @AuditExempt.
 *
 * SRS §15 requires an audit trail for every administrative action, payment, refund,
 * status change, price edit and partner decision. Relying on each call site to
 * remember means the first forgotten one is invisible: there is no failing test for
 * an audit row nobody wrote. This interceptor turns that silence into a startup-time
 * warning in the logs.
 *
 * Services that need the audit row INSIDE their own transaction still call
 * AuditService.record(tx) directly, and mark the route @AuditExempt with that
 * reason — a transactional write is strictly better than this interceptor's
 * after-the-fact one, because it cannot be orphaned from the change it describes.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);
  /** Warn once per route, not once per request. */
  private readonly warned = new Set<string>();

  private static readonly MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AccessTokenClaims }>();

    const audited = this.reflector.getAllAndOverride<AuditedOptions | undefined>(
      AUDITED_KEY,
      [context.getHandler(), context.getClass()],
    );

    const exemptReason = this.reflector.getAllAndOverride<string | undefined>(
      AUDIT_EXEMPT_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!audited && !exemptReason && AuditInterceptor.MUTATING.has(request.method)) {
      // Express attaches `route` at runtime and its types do not model it, so the
      // path is narrowed rather than read off an `any`.
      const routePath =
        typeof (request as { route?: { path?: unknown } }).route?.path === 'string'
          ? (request as { route: { path: string } }).route.path
          : request.path;
      const route = `${request.method} ${routePath}`;

      if (!this.warned.has(route)) {
        this.warned.add(route);
        this.logger.warn(
          `${route} mutates state but is neither @Audited nor @AuditExempt. SRS §15 requires an audit trail — add one or declare why it is not needed.`,
        );
      }
    }

    if (!audited) {
      return next.handle();
    }

    return next.handle().pipe(
      tap((result: unknown) => {
        const params = request.params as Record<string, string | undefined>;
        const subjectKey = audited.subjectParam ?? 'reference';

        this.audit.recordDetached({
          actorUserId: request.user?.sub,
          actorRole: request.user?.role,
          action: audited.action,
          subjectType: audited.subjectType,
          subjectId: null,
          // The route param identifies the subject; the response body carries the
          // outcome. Both are redacted before storage.
          after: AuditService.redact({
            [subjectKey]: params[subjectKey],
            result: summarise(result),
          }),
          ipAddress: request.ip,
          userAgent: request.get('user-agent'),
        });
      }),
    );
  }
}

/**
 * Keeps the audit payload small.
 *
 * A full response body would bloat the table and risk copying sensitive fields into
 * it; the identifying keys are what an investigation actually needs.
 */
function summarise(result: unknown): unknown {
  if (result === null || typeof result !== 'object') return result;

  const KEEP = ['id', 'reference', 'status', 'verification', 'archived', 'daysAffected'];
  const source = result as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  for (const key of KEEP) {
    if (key in source) output[key] = source[key];
  }

  return Object.keys(output).length > 0 ? output : { ok: true };
}
