import { Module } from '@nestjs/common';

import { FavouritesController } from './favourites.controller.js';
import { FavouritesService } from './favourites.service.js';

@Module({
  controllers: [FavouritesController],
  providers: [FavouritesService],
})
export class FavouritesModule {}
