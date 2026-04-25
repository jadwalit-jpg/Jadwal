import { Controller, Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RATE_LIMIT_READ } from './common/throttle-config';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /**
   * Health endpoint. Explicitly throttled with RATE_LIMIT_READ so misconfigured
   * monitors, external health-check bots, or a malicious scanner can't flood
   * the instance. Legitimate liveness probes from the ALB are typically ≤ 6/min,
   * well under the 15/min cap.
   */
  @Get('health')
  @Throttle(RATE_LIMIT_READ)
  getHealth(): string {
    return this.appService.getHealth();
  }
}
