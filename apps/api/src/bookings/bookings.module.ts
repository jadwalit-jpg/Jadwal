import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BookingsController } from './bookings.controller';
import { AvailabilityController } from './availability.controller';
import { BookingsService } from './bookings.service';
import { PrismaModule } from '../prisma/prisma.module';
// RedisModule is @Global() — RedisLockService is auto-available without import

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [BookingsController, AvailabilityController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
