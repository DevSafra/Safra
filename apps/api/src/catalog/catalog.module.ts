import { Controller, Get, Module, Param } from '@nestjs/common';

import { Public } from '../rbac/decorators.js';
import { CatalogService } from './catalog.service.js';

/**
 * Public catalogue. @Public() because §5.1 requires a visitor to browse and search
 * without registering — JwtAuthGuard denies by default, so this is explicit.
 */
@Controller()
class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get('cities')
  async cities() {
    return this.catalog.cities();
  }

  @Public()
  @Get('cities/:slug')
  async city(@Param('slug') slug: string) {
    return this.catalog.city(slug);
  }

  @Public()
  @Get('property-types')
  async propertyTypes() {
    return this.catalog.propertyTypes();
  }

  @Public()
  @Get('amenities')
  async amenities() {
    return this.catalog.amenities();
  }

  @Public()
  @Get('settings/public')
  async settings() {
    return this.catalog.publicSettings();
  }
}

@Module({
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
