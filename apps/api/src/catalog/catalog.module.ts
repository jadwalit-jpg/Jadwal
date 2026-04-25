import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CustomerInteractionController } from './customer-interaction.controller';
import { OffersController } from './offers.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CatalogController, CustomerInteractionController, OffersController],
})
export class CatalogModule {}
