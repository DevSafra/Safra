import { Module } from '@nestjs/common';

import { DisputeController } from './dispute.controller.js';
import { DisputeRequestService } from './dispute-request.service.js';

/** النزاعات for customers. The console's own dispute service lives in `AdminModule`. */
@Module({
  controllers: [DisputeController],
  providers: [DisputeRequestService],
})
export class DisputeModule {}
