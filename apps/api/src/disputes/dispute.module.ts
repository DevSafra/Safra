import { Module } from '@nestjs/common';

import { AdminModule } from '../admin/admin.module.js';
import { AuditService } from '../common/audit/audit.service.js';
import { DisputeController } from './dispute.controller.js';
import { DisputeRequestService } from './dispute-request.service.js';
import { DisputeEvidenceService } from './dispute-evidence.service.js';

/**
 * النزاعات for customers. The console's own dispute service lives in `AdminModule`.
 *
 * `DisputeEvidenceService` is provided in BOTH — it serves two routes with two different
 * authorisations, the customer's «my own dispute» and the console's city scope, and the class holds
 * one of each. `QueueModule` and `StorageModule` are global, so the image pipeline it needs is
 * already reachable from here.
 */
@Module({
  /*
    `AdminModule` for its `DisputeNotifier` — the customer's own open path must tell the partner,
    and it is the same message the console's path sends. AdminModule imports nothing from here, so
    the edge is one-way.
  */
  imports: [AdminModule],
  controllers: [DisputeController],
  /*
    `AuditService` is provided here rather than imported: it is a thin writer over the database and
    every module that records anything provides its own, which `AdminModule` and `AuthModule`
    already do. A shared instance would buy nothing — it holds no state.
  */
  providers: [DisputeRequestService, DisputeEvidenceService, AuditService],
})
export class DisputeModule {}
