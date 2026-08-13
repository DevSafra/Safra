import { Controller, Module, Post } from '@nestjs/common';

import { PERMISSIONS as P } from '@safra/contracts';

import { RequirePermissions } from '../rbac/decorators.js';
import { RecommendationService } from './recommendation.service.js';
import { RankingScheduler } from './ranking.scheduler.js';

/**
 * Manual recompute, on top of the nightly RankingScheduler run.
 *
 * Exists so staff can force a refresh after bulk-importing listings or retuning
 * weights, rather than waiting for 03:00. Gated behind SETTINGS_UPDATE because
 * rewriting every listing's rank is a platform-level action.
 */
@Controller('admin/ranking')
class RankingController {
  constructor(private readonly recommendation: RecommendationService) {}

  @Post('recompute')
  @RequirePermissions(P.SETTINGS_UPDATE)
  async recompute() {
    const scores = await this.recommendation.recomputeAll();
    const badges = await this.recommendation.refreshBadges();
    return { scoresUpdated: scores.updated, badgesUpdated: badges.updated };
  }
}

@Module({
  controllers: [RankingController],
  providers: [RecommendationService, RankingScheduler],
  exports: [RecommendationService, RankingScheduler],
})
export class RankingModule {}
