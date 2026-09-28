import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';

import {
  PERMISSIONS as P,
  faqQuestionCreateSchema,
  faqQuestionUpdateSchema,
  generalFaqCreateSchema,
  generalFaqUpdateSchema,
  type FaqQuestionCreateInput,
  type FaqQuestionUpdateInput,
  type GeneralFaqCreateInput,
  type GeneralFaqUpdateInput,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import { FaqService } from './faq.service.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * الأسئلة الشائعة — the super admin's half of both FAQs (Bashar, 2026-09-28).
 *
 * Two resources that look alike and are not: `questions` are asked here and answered by PARTNERS
 * on their own listings; `general` entries are asked and answered here, and no partner route can
 * reach them. The separation is the authorization — see `faq.service.ts`.
 *
 * `SETTINGS_READ` opens the lists, the same authority كتالوج المنصّة uses, because an operator
 * explaining a page needs to see what it asks. `CATALOGUE_MANAGE` is what changes one.
 *
 * `@AuditExempt` on every write: the service records inside the same transaction as the change, so
 * the interceptor must not write a second, weaker row beside it.
 */
@Controller('admin/faq')
export class FaqController {
  constructor(private readonly faq: FaqService) {}

  // ── Questions partners answer ─────────────────────────────────────────────

  @Get('questions')
  @RequirePermissions(P.SETTINGS_READ)
  async questions() {
    return { questions: await this.faq.questions() };
  }

  @Post('questions')
  @RequirePermissions(P.CATALOGUE_MANAGE)
  @AuditExempt('FaqService records faq_question.created inside the transaction.')
  async createQuestion(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(faqQuestionCreateSchema)) body: FaqQuestionCreateInput,
  ) {
    return this.faq.createQuestion(user, body);
  }

  @Patch('questions/:id')
  @RequirePermissions(P.CATALOGUE_MANAGE)
  @AuditExempt('FaqService records faq_question.updated inside the transaction.')
  async updateQuestion(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(faqQuestionUpdateSchema)) body: FaqQuestionUpdateInput,
  ) {
    return this.faq.updateQuestion(user, id, body);
  }

  @Delete('questions/:id')
  @RequirePermissions(P.CATALOGUE_MANAGE)
  @AuditExempt('FaqService records faq_question.deleted inside the transaction.')
  async deleteQuestion(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.faq.deleteQuestion(user, id);
  }

  // ── Entries SAFRA answers itself ──────────────────────────────────────────

  @Get('general')
  @RequirePermissions(P.SETTINGS_READ)
  async general() {
    return { entries: await this.faq.generalEntries() };
  }

  @Post('general')
  @RequirePermissions(P.CATALOGUE_MANAGE)
  @AuditExempt('FaqService records faq_general.created inside the transaction.')
  async createGeneral(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(generalFaqCreateSchema)) body: GeneralFaqCreateInput,
  ) {
    return this.faq.createGeneral(user, body);
  }

  @Patch('general/:id')
  @RequirePermissions(P.CATALOGUE_MANAGE)
  @AuditExempt('FaqService records faq_general.updated inside the transaction.')
  async updateGeneral(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(generalFaqUpdateSchema)) body: GeneralFaqUpdateInput,
  ) {
    return this.faq.updateGeneral(user, id, body);
  }

  @Delete('general/:id')
  @RequirePermissions(P.CATALOGUE_MANAGE)
  @AuditExempt('FaqService records faq_general.deleted inside the transaction.')
  async deleteGeneral(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.faq.deleteGeneral(user, id);
  }
}
