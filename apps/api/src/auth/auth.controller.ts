import { Controller, Post, Body, Res, Req, UseGuards, Get, Delete, Param, Query, UnauthorizedException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Response, Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { RATE_LIMIT_AUTH, RATE_LIMIT_STRICT, RATE_LIMIT_WRITE, RATE_LIMIT_READ, RATE_LIMIT_INTERACTION } from '../common/throttle-config';
import { GoogleAuthGuard, OAUTH_STATE_COOKIE, OAUTH_STATE_COOKIE_PATH } from './guards/google-auth.guard';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { RequestUser } from './interfaces/request-user.interface';
import { GoogleProfile } from './strategies/google.strategy';
import { RegisterDto } from './dto/register.dto';
import { RegisterVendorDto } from './dto/register-vendor.dto';
import { LoginDto } from './dto/login.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { hasAcceptedCurrentTerms } from '../common/terms';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  @Public()
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

  @Public()
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

  @Public()
  @Post('resend-verification')
  @Throttle(RATE_LIMIT_STRICT)
  async resendVerification(@Body() dto: ResendVerificationDto, @Req() req: Request) {
    return this.authService.resendVerification(dto.email, req);
  }

  @Public()
  @Post('register/vendor')
  @Throttle(RATE_LIMIT_STRICT)
  async registerVendor(@Body() dto: RegisterVendorDto, @Req() req: Request) {
    return this.authService.registerVendor(dto, req);
  }

  @Public()
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

  @Public()
  @Post('refresh')
  // Refresh endpoint must be @Public(): the access-token JWT may already
  // be expired (that's why the client is calling refresh). Auth here is
  // by the RefreshToken cookie, which auth.service.refreshTokens
  // validates against the DB.
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
  async getSessions(
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Query() query: PaginationDto,
  ) {
    if (user.role === 'CUSTOMER') {
      throw new ForbiddenException('Sessions management is not available for customers');
    }

    const currentTokenHash = req.cookies?.RefreshToken
      ? this.authService.getTokenHash(req.cookies.RefreshToken)
      : null;

    // Bounded list — refresh-token table grows with login activity (1 row
    // per device). MAX_SESSIONS_PER_USER = 5 today (see auth.service.ts),
    // so default 50 / max 200 from PaginationDto is way more than any user
    // realistically has — but caps blast radius if MAX_SESSIONS_PER_USER
    // is ever raised or a cleanup job lags.
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
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
      // Stable pagination — id tie-breaker on lastUsedAt.
      orderBy: [{ lastUsedAt: 'desc' }, { id: 'desc' }],
      take: limit,
      skip: (page - 1) * limit,
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

  // ─── W.127 PDPL / GDPR self-service account management ──────────────────

  /**
   * Export every piece of data AL Jadwal stores about the calling user.
   * Returns inline JSON (Content-Disposition: attachment) so the browser
   * triggers a download. Rate-limited per-IP at STRICT (3/min) plus a
   * per-user 24h cooldown inside the service. Excludes auth secrets
   * (password hash, refresh tokens, verification tokens, OTP hashes) —
   * those are not user-owned data.
   */
  @Get('account/export')
  @Throttle(RATE_LIMIT_STRICT)
  @UseGuards(JwtAuthGuard)
  async exportAccount(@CurrentUser() user: RequestUser, @Req() req: Request, @Res({ passthrough: true }) response: Response) {
    const data = await this.authService.exportAccountData(user.id, req);
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Content-Disposition', `attachment; filename="jadwal-account-export-${user.id}.json"`);
    response.setHeader('Cache-Control', 'no-store');
    return data;
  }

  /**
   * Self-service account deletion. Anonymises PII, revokes all sessions,
   * clears derived state, preserves financial records (bookings /
   * payments / loyalty ledger / reviews) with an anonymised user
   * reference for legal retention. Vendor accounts are excluded — they
   * route to support so we don't orphan customer bookings.
   *
   * Confirmation: caller must send `confirmation: "DELETE"` (case-
   * insensitive, trimmed). STRICT throttle (3/min/IP) bounds abuse;
   * the per-user Redis cooldown was removed when we switched off the
   * password gate (no brute-force surface to defend against now).
   */
  @Delete('account')
  @Throttle(RATE_LIMIT_STRICT)
  @UseGuards(JwtAuthGuard)
  async deleteAccount(
    @CurrentUser() user: RequestUser,
    @Body() dto: DeleteAccountDto,
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.deleteOwnAccount(user.id, dto.confirmation, response, req);
    return { message: 'Account deleted' };
  }

  // ─── Google OAuth ────────────────────────────────────────────────────────
  //
  // Both endpoints are explicitly throttled at RATE_LIMIT_AUTH (5/min/IP). Without
  // an explicit @Throttle they would fall back to the global short/long buckets
  // (20/min, 100/10min) — generous for an auth-completing endpoint that mints
  // session cookies. RATE_LIMIT_AUTH brings them in line with the rest of /auth/*.

  @Public()
  @Get('google')
  @Throttle(RATE_LIMIT_AUTH)
  @UseGuards(GoogleAuthGuard)
  googleAuth() {
    // GoogleAuthGuard embeds callbackUrl in OAuth state, then Passport redirects to Google.
    // @Public() skips the global JwtAuthGuard; GoogleAuthGuard still runs.
  }

  @Public()
  @Get('google/callback')
  @Throttle(RATE_LIMIT_AUTH)
  @UseGuards(GoogleAuthGuard)
  async googleCallback(@Req() req: Request, @Res() response: Response) {
    const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');

    // Decode the callbackUrl we embedded in OAuth state before redirecting to Google
    let callbackUrl = '/';
    let stateNonce = '';
    try {
      const rawState = (req.query as Record<string, string>).state ?? '';
      if (rawState) {
        const parsed: unknown = JSON.parse(Buffer.from(rawState, 'base64url').toString());
        const raw = (parsed as Record<string, string>)?.callbackUrl ?? '';
        stateNonce = (parsed as Record<string, string>)?.nonce ?? '';
        // Re-validate on the way back — second line of defence against open redirect.
        // Mirrors `sanitizeCallbackUrl` in google-auth.guard.ts: rejects `/\foo`
        // (Chrome/Firefox normalize backslash → forward slash, bypassing `//` check)
        // and any embedded backslash anywhere (defence in depth across URL parsers).
        if (
          raw.startsWith('/') &&
          !raw.startsWith('//') &&
          !raw.startsWith('/\\') &&
          !raw.includes(':') &&
          !raw.includes('\\')
        ) {
          callbackUrl = raw;
        }
      }
    } catch { /* malformed state — fall back to home */ }

    // Anti-CSRF: the nonce echoed back in `state` MUST match the cookie set at
    // initiation. Missing / mismatch = a forged or cross-browser flow (login-CSRF
    // / forced-login) → reject before minting any session. Always clear the
    // one-time cookie. (Lax cookie set in google-auth.guard.ts.)
    const cookieNonce = (req.cookies as Record<string, string> | undefined)?.[OAUTH_STATE_COOKIE] ?? '';
    response.clearCookie(OAUTH_STATE_COOKIE, { path: OAUTH_STATE_COOKIE_PATH });
    if (!stateNonce || !cookieNonce || stateNonce !== cookieNonce) {
      return response.redirect(`${frontendUrl}/login?error=oauth_failed`);
    }

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
      select: { id: true, email: true, fullName: true, role: true, phone: true, termsAcceptedAt: true, termsAcceptedVersion: true },
    });
    if (!dbUser) throw new UnauthorizedException();

    // Drives the one-time post-login consent gate: true when the user has never
    // accepted, or accepted an older TERMS_VERSION.
    const needsTermsAcceptance = !hasAcceptedCurrentTerms(dbUser);

    if (dbUser.role === 'VENDOR') {
      const vendor = await this.prisma.client.vendor.findUnique({
        where: { userId: user.id },
        select: { id: true, businessNameEn: true, businessNameAr: true, slug: true, status: true, countryId: true },
      });
      return { ...dbUser, vendor, needsTermsAcceptance };
    }

    return { ...dbUser, needsTermsAcceptance };
  }

  // Records the current user's acceptance of the latest Terms — called by the
  // post-login consent gate (Google-OAuth signups, pre-feature accounts, and
  // anyone after a TERMS_VERSION bump). Email/password + vendor signups accept
  // at registration, so they never need this.
  @Post('accept-terms')
  @Throttle(RATE_LIMIT_WRITE)
  @UseGuards(JwtAuthGuard)
  async acceptTerms(@CurrentUser() user: RequestUser) {
    return this.authService.acceptTerms(user.id);
  }

  // ─── Password Reset ─────────────────────────────────────────────────────

  @Public()
  @Post('forgot-password')
  @Throttle(RATE_LIMIT_STRICT)
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    return this.authService.forgotPassword(dto.email, req);
  }

  @Public()
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
