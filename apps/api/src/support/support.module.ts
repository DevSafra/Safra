import { Module } from '@nestjs/common';

import { SupportController } from './support.controller.js';
import { SupportService } from './support.service.js';

/**
 * الدعم — the asking side of a support thread.
 *
 * No `MessagingModule` import: the two services share TABLES, not code. The console's side returns
 * internal notes and takes a staff scope; this one must never do either, and a shared base class would
 * make that one override away from being wrong.
 */
@Module({
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
