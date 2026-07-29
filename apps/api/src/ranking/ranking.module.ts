import { Controller, Module, Post } from '@nestjs/common';

import { PERMISSIONS as P } from '@safra/contracts';

import { RequirePermissions } from '../rbac/decorators.js';
import { RecommendationService } from './recommendation.service.js';

/**
 * Admin-triggered recompute.
 *
 * Nightly scheduling belongs on the BullMQ queue that arrives with Phase 5 (§14
 * requires a background queue for heavy work). Until then this endpoint exists so
 * the score is operable rather than stale — and it is gated behind SETTINGS_UPDATE
 * because rewriting every listing's rank is a platform-level action.
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
  providers: [RecommendationService],
  exports: [RecommendationService],
})
export class RankingModule {}
