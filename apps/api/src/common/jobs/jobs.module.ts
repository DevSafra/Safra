import { Global, Module } from '@nestjs/common';

import { JobRunService } from './job-run.service.js';

/**
 * What every recurring job needs, provided once for the whole application.
 *
 * Global because the five jobs live in five feature modules, and `JobRunService` was provided by
 * three of them independently — three instances of a stateless helper, and a fourth needed every
 * time another job started recording its runs.
 *
 * It also held `CronGate` between BullMQ phases 4 and 6: a boolean saying whether the recurring
 * jobs fired from `@Cron` decorators or from the `scheduled` queue, so a rollback was an
 * environment change rather than a deploy. Phase 6 removed the decorators, so there is nothing
 * left to choose between and the gate is gone with them.
 */
@Global()
@Module({ providers: [JobRunService], exports: [JobRunService] })
export class JobsModule {}
