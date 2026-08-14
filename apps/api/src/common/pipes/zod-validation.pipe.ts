import { BadRequestException, HttpStatus, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

import { ERROR, errorParamsOf, isErrorCode } from '@safra/contracts';
import { errorMessage } from '@safra/i18n';

/**
 * Validates a request payload against a Zod schema from `@safra/contracts`.
 *
 * Returns the PARSED value, not the original: coercions, trimming and lower-casing declared in
 * the schema are what downstream code receives, so `Bashar@Example.COM ` and
 * `bashar@example.com` cannot become two accounts.
 *
 * Failures return field-level detail because these are the user's own input. Nothing about
 * server state is included (rule 1: generic errors to clients).
 *
 * ## Every field error carries a code
 *
 * The schemas set their `message` to an `ERROR.VALIDATION_*` code rather than to English prose,
 * so each issue goes out as `{ field, code, message }`. The client resolves the code against the
 * reader's locale; the English text rides along for logs and for clients that have not been
 * taught the codes.
 *
 * This is the one place where a code might NOT be one of ours: Zod emits its own default message
 * for a constraint that was written without one (`Expected string, received number`). Those are
 * passed through as text and paired with a generic code, because inventing a specific one would
 * claim a precision that is not there — and a schema that reaches a user with a Zod default is a
 * schema missing a message, which is a thing to fix rather than to translate.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ERROR.REQUEST_VALIDATION_FAILED,
        message: errorMessage(ERROR.REQUEST_VALIDATION_FAILED, 'en'),
        errors: result.error.issues.map((issue) => {
          const code = isErrorCode(issue.message)
            ? issue.message
            : ERROR.VALIDATION_REQUIRED;
          const params = errorParamsOf(issue);

          return {
            field: issue.path.join('.') || '(root)',
            code,
            /* Forwarded so the client can fill the same placeholders in the reader's language. */
            ...(params ? { params } : {}),
            /*
              `message` stays the client-facing field text for anything not taught the codes.
              For a Zod default it is Zod's own wording, which is the honest thing to show: it
              describes the shape mismatch and names no server state.
            */
            message: isErrorCode(issue.message)
              ? errorMessage(code, 'en', params)
              : issue.message,
          };
        }),
      });
    }

    return result.data;
  }
}
