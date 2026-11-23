import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { GatewayWatchService } from './gateway-watch.service';

@Global()
@Module({
  imports: [ConfigModule],
  controllers: [PaymentController],
  providers: [PaymentService, GatewayWatchService],
  exports: [PaymentService],
})
export class PaymentModule {}
