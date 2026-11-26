import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CustomerInteractionController } from './customer-interaction.controller';
import { OffersController } from './offers.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ReviewRequestService } from './review-request.service';

@Module({
  imports: [PrismaModule],
  controllers: [CatalogController, CustomerInteractionController, OffersController],
  providers: [ReviewRequestService],
})
export class CatalogModule {}
