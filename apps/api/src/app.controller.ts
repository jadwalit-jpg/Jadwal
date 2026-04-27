import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /**
   * Health endpoint — bypasses the global throttler entirely.
   *
   * ALB target-group probes hit this every 30 s from a small pool of internal
   * AWS IPs. With multi-AZ + cross-zone load balancing the same backend can
   * receive probes from 4–8 distinct ALB nodes; under sustained load + a 15/min
   * per-IP cap that's already tight, and any future bump to the probe interval
   * or task count tips it into 429s — flapping the very tasks the probe exists
   * to protect.
   *
   * Throttling adds zero security here either: the response is a static string
   * with no DB / Redis / network IO, so flooding it doesn't cost the API
   * anything. Best practice is to leave health probes unthrottled.
   */
  @Get('health')
  @SkipThrottle()
  getHealth(): string {
    return this.appService.getHealth();
  }
}
