import { Controller, Get, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { RATE_LIMIT_CALLBACK } from '../common/throttle-config';
import { Request } from 'express';
import { isIP } from 'net';
import { GeoService } from './geo.service';

// Private/loopback IP patterns
const PRIVATE_IP = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|::1|fc|fd|fe80)/;

@Controller('geo')
@Throttle(RATE_LIMIT_CALLBACK)
export class GeoController {
  private trustProxy: boolean;

  constructor(
    private geoService: GeoService,
    private config: ConfigService,
  ) {
    this.trustProxy = this.config.get('TRUST_PROXY', 'false') === 'true';
  }

  @Get('detect')
  detect(@Req() req: Request) {
    let ip = req.ip ?? req.socket.remoteAddress ?? '';

    // Only trust X-Forwarded-For behind a verified proxy (Cloudflare, ALB)
    if (this.trustProxy) {
      const forwarded = req.headers['x-forwarded-for'];
      if (typeof forwarded === 'string') {
        const candidate = forwarded.split(',')[0].trim();
        // Validate: must be a real IP and not private/loopback
        if (isIP(candidate) && !PRIVATE_IP.test(candidate)) {
          ip = candidate;
        }
      }
    }

    // Strip IPv6 prefix if needed (::ffff:127.0.0.1 → 127.0.0.1)
    ip = ip.replace(/^::ffff:/, '');

    return this.geoService.detectLocation(ip);
  }
}
