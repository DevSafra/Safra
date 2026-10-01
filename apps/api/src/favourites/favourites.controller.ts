import { Body, Controller, Delete, Get, Post, Query } from '@nestjs/common';

import {
  cursorQuerySchema,
  type CursorQuery,
  FAVOURITE_STATUS_BATCH,
} from '@safra/contracts';
import { z } from 'zod';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../rbac/decorators.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { FavouritesService } from './favourites.service.js';

/**
 * المفضلة (handoff §6).
 *
 * Every handler derives the customer from the VERIFIED token and takes no customer id, so "show me
 * somebody else's favourites" and "save this to their account" are questions this controller cannot be
 * asked. There is no permission decorator because there is no permission to hold: saving a listing is
 * something any signed-in customer may do, and the absence of a customer profile on the token is what
 * refuses a partner or a staff member.
 *
 * The slug arrives in the BODY rather than the path for the writes. A slug can contain characters that
 * would need escaping in a path segment, and a body keeps the schema doing the validating.
 */
const slugBodySchema = z.object({ slug: z.string().min(1).max(200) }).strict();

type SlugBody = z.infer<typeof slugBodySchema>;

/** The same one field, arriving as a query string on the read. */
const slugQuerySchema = slugBodySchema;

/** Up to one page of results: 60 is the search's own page ceiling. Repeated or single. */
const slugsQuerySchema = z
  .object({
    slugs: z.preprocess(
      (value: unknown): unknown[] =>
        value === undefined ? [] : Array.isArray(value) ? (value as unknown[]) : [value],
      z.array(z.string().min(1).max(200)).max(FAVOURITE_STATUS_BATCH),
    ),
  })
  .strict();

type SlugsQuery = z.infer<typeof slugsQuerySchema>;

@Controller('favourites')
export class FavouritesController {
  constructor(private readonly favourites: FavouritesService) {}

  @Get()
  @AuditExempt('A customer reading their own saved listings; changes nothing.')
  async list(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(new ZodValidationPipe(cursorQuerySchema)) query: CursorQuery,
  ) {
    return this.favourites.list(user, query);
  }

  /**
   * Whether one listing is saved — declared BEFORE any other GET so nothing shadows it.
   *
   * The property page is cached, so it cannot carry this; the button asks for itself after mounting.
   */
  @Get('status')
  @AuditExempt('Reading whether you saved one listing; changes nothing.')
  async status(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(new ZodValidationPipe(slugQuerySchema)) query: SlugBody,
  ) {
    return this.favourites.status(user, query.slug);
  }

  @Get('statuses')
  @AuditExempt('Reading which of a page of listings you saved; changes nothing.')
  async statuses(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(new ZodValidationPipe(slugsQuerySchema)) query: SlugsQuery,
  ) {
    return this.favourites.statuses(user, query.slugs);
  }

  @Post()
  @AuditExempt('Saving a listing to your own shortlist is not an auditable decision.')
  async save(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(slugBodySchema)) body: SlugBody,
  ) {
    return this.favourites.save(user, body.slug);
  }

  @Delete()
  @AuditExempt('Removing your own saved listing; the row is soft deleted and survives.')
  async remove(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(slugBodySchema)) body: SlugBody,
  ) {
    return this.favourites.remove(user, body.slug);
  }
}
