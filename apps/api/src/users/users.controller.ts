import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RATE_LIMIT_WRITE, RATE_LIMIT_READ } from '../common/throttle-config';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/interfaces/request-user.interface';

/**
 * Customer profile endpoints.
 *
 * GET   /users/profile  — get own profile + booking stats
 * PATCH /users/profile  — update fullName and/or phone
 * GET   /users/points   — get loyalty points balance + redemption config
 */
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('profile')
  @Throttle(RATE_LIMIT_READ)
  getProfile(@CurrentUser() user: RequestUser) {
    return this.usersService.getProfile(user.id);
  }

  @Patch('profile')
  @Throttle(RATE_LIMIT_WRITE)
  updateProfile(@CurrentUser() user: RequestUser, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user.id, dto);
  }

  @Get('points')
  @Throttle(RATE_LIMIT_READ)
  getPoints(@CurrentUser() user: RequestUser) {
    return this.usersService.getPoints(user.id);
  }
}
