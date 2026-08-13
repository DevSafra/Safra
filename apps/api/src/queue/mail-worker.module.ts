import { Module } from '@nestjs/common';

import { MailService } from '../mail/mail.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { DeadLetterService } from './dead-letter.service.js';
import { MailProcessor } from './mail.processor.js';

/**
 * The worker side of the `mail` queue, resolvable from `AppModule`.
 *
 * ## Why it exists separately from `QueueModule`
 *
 * `QueueModule` is global and holds the PRODUCER — a connection and a `Queue` handle, which every
 * module that sends a notification injects. This holds the CONSUMER, which only `worker.ts` resolves.
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
  providers: [MailProcessor, DeadLetterService, NotificationService, MailService],
  exports: [MailProcessor, DeadLetterService],
})
export class MailWorkerModule {}
