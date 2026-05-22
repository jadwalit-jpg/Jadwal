import { Controller, Get, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { RATE_LIMIT_CALLBACK } from '../common/throttle-config';
import { Request } from 'express';
import { GeoService } from './geo.service';

@Controller('geo')
@Throttle(RATE_LIMIT_CALLBACK)
export class GeoController {
  constructor(private geoService: GeoService) {}

  @Public()
  @Get('detect')
  detect(@Req() req: Request) {
    // Single source of truth for proxy trust lives in main.ts via
    // TRUST_PROXY_HOPS. After that, req.ip is the real client IP and
    // cf-connecting-ip is the more authoritative source (single-valued,
    // signed by Cloudflare's SG-locked edge). Don't roll our own XFF
    // parser here — that would silently bypass the hop-count check.
    const cfIp = req.headers['cf-connecting-ip'];
    let ip = (typeof cfIp === 'string' && cfIp.trim().length > 0)
      ? cfIp.trim()
      : (req.ip ?? req.socket.remoteAddress ?? '');

    // Strip IPv4-mapped IPv6 prefix (::ffff:127.0.0.1 → 127.0.0.1) for
    // GeoIP lookups that expect bare IPv4.
    ip = ip.replace(/^::ffff:/, '');

    return this.geoService.detectLocation(ip);
  }
}
