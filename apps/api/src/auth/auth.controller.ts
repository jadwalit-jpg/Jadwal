import { Controller, Post, Body, Res, Req, UseGuards, Get, Delete, Param, Query, UnauthorizedException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Response, Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { RATE_LIMIT_AUTH, RATE_LIMIT_STRICT, RATE_LIMIT_WRITE, RATE_LIMIT_READ, RATE_LIMIT_INTERACTION } from '../common/throttle-config';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { RequestUser } from './interfaces/request-user.interface';
import { GoogleProfile } from './strategies/google.strategy';
import { RegisterDto } from './dto/register.dto';
import { RegisterVendorDto } from './dto/register-vendor.dto';
import { LoginDto } from './dto/login.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { SendPhoneOtpDto } from './dto/send-phone-otp.dto';
import { VerifyPhoneOtpDto } from './dto/verify-phone-otp.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  @Post('register')
  // STRICT (3/min) per-IP — bumped from AUTH on the live-prod hardening
  // pass. Account creation is high-value to attackers (bot signup → review
  // spam, coupon farming, payment-fraud setup). The IP-cycling vector is
  // closed by EmailQuotaService.tryConsumePerIp (per-IP daily cap on email
  // sends, applied inside sendVerificationEmail).
  @Throttle(RATE_LIMIT_STRICT)
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.registerAndLogin(dto, req);
  }

  @Get('verify-email')
  @Throttle(RATE_LIMIT_AUTH)
  async verifyEmail(
    @Query('token') token: string,
    @Res({ passthrough: true }) response: Response,
    @Req() req: Request,
  ) {
    // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos
    // Bounded literal character class, fixed `{64}` quantifier — safe.
    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      // Match auth.service wording so attackers can't distinguish a malformed
      // token (rejected here) from a non-existent / expired one (rejected
      // downstream). Single message for the whole verify-link failure mode.
      throw new BadRequestException('Invalid or expired verification link. Please request a new one.');
    }
    return this.authService.verifyEmail(token, response, req);
  }

  @Post('resend-verification')
  @Throttle(RATE_LIMIT_STRICT)
  async resendVerification(@Body() dto: ResendVerificationDto, @Req() req: Request) {
    return this.authService.resendVerification(dto.email, req);
  }

  @Post('register/vendor')
  @Throttle(RATE_LIMIT_STRICT)
  async registerVendor(@Body() dto: RegisterVendorDto) {
    return this.authService.registerVendor(dto);
  }

  @Post('login')
  // STRICT (3/min) on login — credential-stuffing attacks rely on
  // high-throughput login attempts. Per-account lockout (5 fails) +
  // per-IP STRICT (3/min) double-gates the path.
  @Throttle(RATE_LIMIT_STRICT)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
    @Req() req: Request,
  ) {
    return this.authService.loginWithCheck(dto.email, dto.password, response, req);
  }

  @Post('refresh')
  @Throttle(RATE_LIMIT_WRITE)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = req.cookies?.RefreshToken;
    if (!refreshToken) {
      // Generic "session expired" — never confirm which specific
      // refresh-token state failed (missing / invalid / expired / rotated).
      throw new UnauthorizedException('Session expired — please log in again');
    }
    return this.authService.refreshTokens(refreshToken, response, req);
  }

  @Post('logout')
  @Throttle(RATE_LIMIT_WRITE)
  @UseGuards(JwtAuthGuard)
  async logout(
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = req.cookies?.RefreshToken;
    await this.authService.logout(refreshToken, user?.id, response, req);
    return { message: 'Logged out successfully' };
  }

  // ─── Active Sessions (admin + vendor only) ──────────────────────────────

  @Get('sessions')
  @Throttle(RATE_LIMIT_READ)
  @UseGuards(JwtAuthGuard)
  async getSessions(@CurrentUser() user: RequestUser, @Req() req: Request) {
    if (user.role === 'CUSTOMER') {
      throw new ForbiddenException('Sessions management is not available for customers');
    }

    const currentTokenHash = req.cookies?.RefreshToken
      ? this.authService.getTokenHash(req.cookies.RefreshToken)
      : null;

    const sessions = await this.prisma.client.refreshToken.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        tokenHash: true,
      },
      orderBy: { lastUsedAt: 'desc' },
    });

    return sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      expiresAt: s.expiresAt,
      isCurrent: s.tokenHash === currentTokenHash,
    }));
  }

  @Delete('sessions/:sessionId')
  @Throttle(RATE_LIMIT_WRITE)
  @UseGuards(JwtAuthGuard)
  async revokeSession(@CurrentUser() user: RequestUser, @Param('sessionId') sessionId: string) {
    if (user.role === 'CUSTOMER') {
      throw new ForbiddenException('Sessions management is not available for customers');
    }

    // Only allow revoking own sessions (prevent cross-user access)
    const session = await this.prisma.client.refreshToken.findUnique({
      where: { id: sessionId },
      select: { userId: true },
    });
    if (!session || session.userId !== user.id) {
      throw new ForbiddenException('Cannot revoke this session');
    }

    await this.prisma.client.refreshToken.delete({ where: { id: sessionId } });
    return { message: 'Session revoked' };
  }

  @Delete('sessions')
  @Throttle(RATE_LIMIT_AUTH)
  @UseGuards(JwtAuthGuard)
  async revokeAllOtherSessions(@CurrentUser() user: RequestUser, @Req() req: Request) {
    if (user.role === 'CUSTOMER') {
      throw new ForbiddenException('Sessions management is not available for customers');
    }

    const currentTokenHash = req.cookies?.RefreshToken
      ? this.authService.getTokenHash(req.cookies.RefreshToken)
      : null;

    // Delete all sessions EXCEPT the current one
    const { count } = await this.prisma.client.refreshToken.deleteMany({
      where: {
        userId: user.id,
        ...(currentTokenHash ? { tokenHash: { not: currentTokenHash } } : {}),
      },
    });

    return { message: `${count} session(s) revoked` };
  }

  // ─── Google OAuth ────────────────────────────────────────────────────────

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleAuth() {
    // GoogleAuthGuard embeds callbackUrl in OAuth state, then Passport redirects to Google
  }

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleCallback(@Req() req: Request, @Res() response: Response) {
    const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');

    // Decode the callbackUrl we embedded in OAuth state before redirecting to Google
    let callbackUrl = '/';
    try {
      const rawState = (req.query as Record<string, string>).state ?? '';
      if (rawState) {
        const parsed: unknown = JSON.parse(Buffer.from(rawState, 'base64url').toString());
        const raw = (parsed as Record<string, string>)?.callbackUrl ?? '';
        // Re-validate on the way back — second line of defence against open redirect
        if (raw.startsWith('/') && !raw.startsWith('//') && !raw.includes(':')) {
          callbackUrl = raw;
        }
      }
    } catch { /* malformed state — fall back to home */ }

    try {
      const userData = await this.authService.handleGoogleAuth(req.user as GoogleProfile, response, req);
      if (userData.role === 'ADMIN') return response.redirect(`${frontendUrl}/admin/dashboard`);
      if (userData.role === 'VENDOR') return response.redirect(`${frontendUrl}/vendor/dashboard`);
      return response.redirect(`${frontendUrl}${callbackUrl}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code =
        message.includes('deactivated') ? 'deactivated' :
        message.includes('suspended') ? 'suspended' :
        'oauth_failed';
      return response.redirect(`${frontendUrl}/login?error=${code}`);
    }
  }

  // ─── Profile ─────────────────────────────────────────────────────────────

  @Get('me')
  @Throttle(RATE_LIMIT_INTERACTION)
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser() user: RequestUser) {
    const dbUser = await this.prisma.client.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, fullName: true, role: true, phone: true, phoneVerified: true },
    });
    if (!dbUser) throw new UnauthorizedException();

    if (dbUser.role === 'VENDOR') {
      const vendor = await this.prisma.client.vendor.findUnique({
        where: { userId: user.id },
        select: { id: true, businessNameEn: true, businessNameAr: true, slug: true, status: true, countryId: true },
      });
      return { ...dbUser, vendor };
    }

    return dbUser;
  }

  // ─── Phone OTP ──────────────────────────────────────────────────────────

  @Post('phone/send-otp')
  @Throttle(RATE_LIMIT_STRICT)
  @UseGuards(JwtAuthGuard)
  async sendPhoneOtp(
    @CurrentUser() user: RequestUser,
    @Body() dto: SendPhoneOtpDto,
  ) {
    return this.authService.sendPhoneOtp(user.id, dto.phone);
  }

  @Post('phone/verify-otp')
  // STRICT (3/min) — phone OTP is 6-digit numeric (1M space). At 5/min
  // a brute-force tries 7200 codes/day = 0.7% chance of hitting per
  // day. At 3/min that drops to 4320 codes/day = 0.43% per day. Pair
  // with per-account counter to hard-fail after N wrong codes.
  @Throttle(RATE_LIMIT_STRICT)
  @UseGuards(JwtAuthGuard)
  async verifyPhoneOtp(
    @CurrentUser() user: RequestUser,
    @Body() dto: VerifyPhoneOtpDto,
  ) {
    return this.authService.verifyPhoneOtp(user.id, dto.code);
  }

  // ─── Password Reset ─────────────────────────────────────────────────────

  @Post('forgot-password')
  @Throttle(RATE_LIMIT_STRICT)
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    return this.authService.forgotPassword(dto.email, req);
  }

  @Post('reset-password')
  // STRICT (3/min) — reset uses a one-time token, but tightening
  // per-IP throttle prevents token brute-forcing if the token entropy
  // ever turns out lower than expected.
  @Throttle(RATE_LIMIT_STRICT)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  // ─── Authenticated Change Password ──────────────────────────────────────
  // Logged-in user rotates their own password. Requires currentPassword
  // (proof of session ownership beyond the cookie). Keeps the calling
  // session alive; revokes every OTHER refresh token so any compromised
  // session on another device dies on rotation.
  @Post('change-password')
  @Throttle(RATE_LIMIT_STRICT)
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @CurrentUser() user: RequestUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ) {
    const refreshToken = req.cookies?.RefreshToken;
    return this.authService.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
      refreshToken,
      req,
    );
  }
}
