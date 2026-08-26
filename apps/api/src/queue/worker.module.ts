import { Module } from '@nestjs/common';

import { BookingsModule } from '../bookings/bookings.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { PayoutModule } from '../payouts/payout.module.js';
import { RankingModule } from '../ranking/ranking.module.js';
import { SanctionsModule } from '../sanctions/sanctions.module.js';
import { MailService } from '../mail/mail.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { NotificationRedriveService } from '../notifications/notification-redrive.service.js';
import { DeadLetterService } from './dead-letter.service.js';
import { MailProcessor } from './mail.processor.js';
import { MediaProcessor } from './media.processor.js';
import { AuthModule } from '../auth/auth.module.js';
import { ScheduledProcessor } from './scheduled.processor.js';
import { ScheduledRegistrar } from './scheduled.registrar.js';
import { ExportProcessor } from './export.processor.js';
import { AdminModule } from '../admin/admin.module.js';
import { GiftCardModule } from '../gift-cards/gift-card.module.js';

/**
 * The worker side of every queue, resolvable from `AppModule`.
 *
 * ## Why it exists separately from `QueueModule`
 *
 * `QueueModule` is global and holds the PRODUCER — a connection and a `Queue` handle, which every
 * module that sends a notification injects. This holds the CONSUMERS, which only `worker.ts` resolves.
 * Keeping them apart means the API process does not construct a processor it will never call, and the
 * dependency runs one way: producers know nothing about how a job is executed.
 *
 * ## Why it provides its own NotificationService
 *
 * Three feature modules already provide one each, which is how Nest works — a provider is per module
 * unless it is exported and imported. The worker is not one of those modules and must not import a
 * feature module to reach a service, so it has its own. All four instances share the same database
 * pool and the same global queue, so there is one queue and one table regardless.
 */
@Module({
  /*
    The five feature modules whose schedulers `ScheduledProcessor` calls.

    IMPORTED, never re-provided. `docs/background-jobs-design.md` says a migrated scheduler moves
    its body into a processor UNCHANGED, and the safest reading is that there is exactly one body:
    the processor calls the same `SlaService` the rest of the application holds, over the same
    settings cache and the same connection pool. Providing them here would build a second set, and
    two `SlaService` instances sweeping the same bookings is precisely the thing the advisory lock
    exists to prevent — reintroduced inside one process, where the lock cannot see it.
  */
  imports: [
    BookingsModule,
    PayoutModule,
    RankingModule,
    SanctionsModule,
    PaymentsModule,
    /* For `CredentialRetentionService` — the nightly sweep of dead codes and tokens. */
    AuthModule,
    /* For `BookingExportService` — the one query that decides what an export contains. */
    AdminModule,
    /* For `GiftCardExpiryService` — the hourly pass that retires cards past their expiry. */
    GiftCardModule,
  ],
  /*
    `ImageService` and `StorageService` are deliberately ABSENT.

    `StorageModule` is `@Global()`, so both are already resolvable here — and providing them again
    would give this module its own `ImageService` over its own storage binding. That binding is
    chosen from configuration (S3 when credentials exist, local disk otherwise), so a second one is
    not a duplicate but a potential DISAGREEMENT: the worker writing variants to disk while the API
    serves URLs from S3, which reads as an image that processed successfully and cannot be fetched.

    The three below are provided because they are per-module by construction — see the note above.
  */
  providers: [
    MailProcessor,
    MediaProcessor,
    ScheduledProcessor,
    ExportProcessor,
    /*
      The REGISTRAR is a producer and runs in the API, not the worker: declaring a schedule is the
      same kind of act as enqueueing a mail. It lives in this module because that is where the
      queue tokens are already reachable, and it is harmless in the worker process — declaring an
      identical schedule is idempotent by construction.
    */
    ScheduledRegistrar,
    DeadLetterService,
    NotificationService,
    NotificationRedriveService,
    MailService,
  ],
  exports: [
    MailProcessor,
    MediaProcessor,
    ScheduledProcessor,
    ExportProcessor,
    DeadLetterService,
  ],
})
export class WorkerModule {}
