import { Controller, Post, Delete, Body, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RATE_LIMIT_WRITE, RATE_LIMIT_AUTH } from '../throttle-config';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequestUser } from '../../auth/interfaces/request-user.interface';
import { WebPushService } from '../services/web-push.service';
import { IsString, IsNotEmpty, ValidateNested, IsUrl } from 'class-validator';
import { Type } from 'class-transformer';

class PushKeysDto {
  @IsString()
  @IsNotEmpty()
  p256dh!: string;

  @IsString()
  @IsNotEmpty()
  auth!: string;
}

class SubscribePushDto {
  @IsUrl({ require_tld: false, protocols: ['https'] })
  endpoint!: string;

  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;
}

class UnsubscribePushDto {
  @IsUrl({ require_tld: false, protocols: ['https'] })
  endpoint!: string;
}

@Controller('push')
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private pushService: WebPushService) {}

  @Post('subscribe')
  @Throttle(RATE_LIMIT_WRITE)
  subscribe(
    @CurrentUser() user: RequestUser,
    @Body() dto: SubscribePushDto,
  ) {
    return this.pushService.subscribe(user.id, dto);
  }

  @Delete('unsubscribe')
  @Throttle(RATE_LIMIT_AUTH)
  unsubscribe(
    @CurrentUser() user: RequestUser,
    @Body() dto: UnsubscribePushDto,
  ) {
    return this.pushService.unsubscribe(user.id, dto.endpoint);
  }
}
