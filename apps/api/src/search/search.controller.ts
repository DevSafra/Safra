import { Controller, Get, Query } from '@nestjs/common';

import { type SearchQuery, searchQuerySchema } from '@safra/contracts';

import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { Public } from '../rbac/decorators.js';
import { SearchFacetsService, type SearchFacets } from './search-facets.service.js';
import { SearchService, type SearchResult } from './search.service.js';

/**
 * Public search (SRS §5.1: "a visitor searches without registering").
 *
 * @Public() is required because JwtAuthGuard denies by default. The guard still
 * decodes a token when one is present, so a signed-in customer can later be
 * personalised without this route ever failing for an anonymous visitor.
 */
@Controller('search')
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly facetCounts: SearchFacetsService,
  ) {}

  @Public()
  @Get()
  async find(
    @Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQuery,
  ): Promise<SearchResult> {
    return this.search.search(query);
  }

  /**
   * The counts beside every sidebar filter, for the same query the results were fetched with.
   *
   * The same schema as the search, so a URL that searches also counts; the paging fields are
   * accepted and ignored, because counts describe the whole result set rather than one page.
   */
  @Public()
  @Get('facets')
  async facets(
    @Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQuery,
  ): Promise<SearchFacets> {
    return this.facetCounts.facets(query);
  }
}
