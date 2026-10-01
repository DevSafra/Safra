import { Module } from '@nestjs/common';

import { SearchController } from './search.controller.js';
import { SearchFacetsService } from './search-facets.service.js';
import { SearchService } from './search.service.js';

@Module({
  controllers: [SearchController],
  providers: [SearchService, SearchFacetsService],
  exports: [SearchService],
})
export class SearchModule {}
