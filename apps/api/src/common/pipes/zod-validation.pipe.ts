import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Validates a request payload against a Zod schema from @safra/contracts.
 *
 * Returns the PARSED value, not the original: coercions, trimming and
 * lower-casing declared in the schema are what downstream code receives, so
 * `Bashar@Example.COM ` and `bashar@example.com` cannot become two accounts.
 *
 * Failures return field-level messages because these are the user's own input.
 * Nothing about server state is included (rule 1: generic errors to clients).
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed.',
        errors: result.error.issues.map((issue) => ({
          field: issue.path.join('.') || '(root)',
          message: issue.message,
        })),
      });
    }

    return result.data;
  }
}
