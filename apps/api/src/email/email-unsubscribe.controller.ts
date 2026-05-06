import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { RATE_LIMIT_AUTH } from '../common/throttle-config';
import { SecurityLoggerService } from '../common/services/security-logger.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailSuppressionService } from './email-suppression.service';
import { EmailUnsubscribeTokenService } from './email-unsubscribe-token.service';
import { UnsubscribeDto } from './dto/unsubscribe.dto';

/**
 * RFC 8058 one-click unsubscribe + browser landing page.
 *
 * Mounted at /email/unsubscribe (full URL: https://jadwal.qa/api/email/unsubscribe).
 *
 * Two routes:
 *   POST  /email/unsubscribe   — RFC 8058 one-click target. Triggered by Gmail/
 *                                 Yahoo bulk-sender unsubscribe button. Performs
 *                                 the actual suppression-list add.
 *   GET   /email/unsubscribe   — Browser landing page. Verifies the token (so
 *                                 expired/forged tokens don't render the form)
 *                                 then shows a single button that POSTs.
 *                                 Does NOT unsubscribe — defends against email
 *                                 link prefetchers (Gmail bots, antivirus
 *                                 scanners, link-preview engines) that follow
 *                                 GET-requests automatically.
 *
 * Both routes are public (no auth) — the signed token IS the auth per RFC 8058.
 * Both routes are throttled at RATE_LIMIT_AUTH (5/min per IP) — token verification
 * is cheap and forgery is cryptographically infeasible, but rate-limit is cheap
 * defense-in-depth against burst replay attempts.
 */
@Controller('email/unsubscribe')
export class EmailUnsubscribeController {
  private readonly logger = new Logger(EmailUnsubscribeController.name);

  constructor(
    private readonly tokens: EmailUnsubscribeTokenService,
    private readonly suppression: EmailSuppressionService,
    private readonly prisma: PrismaService,
    private readonly securityLogger: SecurityLoggerService,
  ) {}

  /**
   * RFC 8058 §3.1 mandates this be POST. Gmail/Yahoo will only register a
   * sender as "supports one-click unsubscribe" if they observe a POST that
   * returns 2xx. Returning a non-2xx (or worse, requiring auth) is read as
   * "broken implementation" and they punt the email to spam more aggressively.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle(RATE_LIMIT_AUTH)
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async unsubscribePost(
    @Body() body: Partial<UnsubscribeDto>,
    @Query('t') queryToken?: string,
  ): Promise<string> {
    // Token can arrive in body (Gmail one-click POST) or query (some receivers).
    // Body wins when present — RFC 8058 places it there.
    const token = (body.t ?? queryToken ?? '').trim();
    if (!token) {
      // Plain-text 400 — don't render an HTML form here, this endpoint is
      // server-to-server.
      throw new BadRequestException('Missing token');
    }

    return this.processUnsubscribe(token);
  }

  /**
   * Browser landing — recipient clicked the visible "Manage preferences"
   * link or pasted the URL into a browser. We render a tiny self-contained
   * HTML page (inline CSS, no external JS, no shared layout) confirming
   * the token is valid and showing a single button that POSTs back.
   *
   * No suppression action happens on GET. Email-link prefetchers (Gmail
   * bots, antivirus scanners, link-preview generators) issue GET — letting
   * GET trigger the suppression would unsubscribe users on prefetch.
   */
  @Get()
  @Throttle(RATE_LIMIT_AUTH)
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  // Self-contained CSP for this response — the email-unsubscribe page does
  // not load any external resources, so 'self' for default-src + inline
  // styles is enough. This deliberately overrides the global app CSP so
  // the page renders correctly even if email-receiver browsers are slow.
  @Header(
    'Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  )
  async unsubscribeGet(@Query('t') queryToken: string | undefined, @Res() res: Response): Promise<void> {
    const token = (queryToken ?? '').trim();
    if (!token) {
      res.status(HttpStatus.BAD_REQUEST).send(this.renderErrorPage('Missing token'));
      return;
    }

    // Verify, but DON'T act on it — we render either the confirmation form
    // (valid token) or an error page (invalid/expired). Same response shape
    // either way to avoid leaking which tokens are valid (the form renders
    // the token back as a hidden field; that doesn't leak anything new
    // since the recipient already has the token in the URL bar).
    const verified = this.tokens.verify(token);
    if (!verified.ok) {
      res.status(HttpStatus.BAD_REQUEST).send(this.renderErrorPage('This unsubscribe link is invalid or has expired.'));
      return;
    }

    res.status(HttpStatus.OK).type('html').send(this.renderConfirmPage(token));
  }

  /**
   * Shared processing: verify token → look up user → confirm email matches
   * → suppress → audit log. Idempotent (suppression upsert handles re-clicks).
   *
   * Returns plain-text body so RFC 8058 compliant receivers see a clean
   * "Unsubscribed." string. Idempotency is preserved on all branches.
   */
  private async processUnsubscribe(token: string): Promise<string> {
    const verified = this.tokens.verify(token);
    if (!verified.ok) {
      // 400 (not 401) — the receiver-side bot doesn't know what 401 means
      // for an unsubscribe; 400 is the universal "your request is malformed"
      // response that all bulk senders interpret as a signal to NOT register
      // this sender as one-click capable. Use this sparingly.
      throw new BadRequestException('Invalid or expired unsubscribe token');
    }

    // Look up the user. Token's `userId` is the database PK.
    const user = await this.prisma.client.user.findUnique({
      where: { id: verified.userId },
      select: { id: true, email: true },
    });

    // Treat missing-user as success (don't 404 — the recipient's intent is
    // clear: "stop emailing me", and we have nothing to actually unsubscribe).
    // RFC 8058 favors over-success on idempotent unsubscribe operations.
    if (!user || !user.email) {
      this.logger.warn('unsubscribe: user not found or email cleared');
      return 'Unsubscribed.';
    }

    // Confirm the token's emailHash matches the current user.email. If the
    // user changed their email after the token was issued, the old hash
    // will not match — reject. This prevents an old token from suppressing
    // a new email address.
    if (!this.tokens.matchesEmail(verified.emailHash, user.email)) {
      this.logger.warn(`unsubscribe: emailHash mismatch userId=${verified.userId}`);
      throw new BadRequestException('Invalid or expired unsubscribe token');
    }

    // Add to suppression list. Reason='manual' so it shows up alongside
    // admin-driven entries in the existing email_suppressions reporting.
    // EmailSuppressionService.suppress is idempotent (upsert) — re-clicks
    // are safe.
    await this.suppression.suppress(user.email, 'manual', undefined, 'user_unsubscribe');

    // Audit log. SecurityLoggerService masks the email before storing.
    await this.securityLogger.log({
      event: 'EMAIL_UNSUBSCRIBE',
      userId: user.id,
      email: user.email,
      details: 'one-click unsubscribe via List-Unsubscribe header',
    });

    return 'Unsubscribed.';
  }

  /**
   * Minimal HTML for the GET landing page. Self-contained: no external
   * fonts, no JS, no images. Inline CSS only. Safe to render across
   * webmail clients that show this in a preview pane.
   */
  private renderConfirmPage(token: string): string {
    // Token is base64url alphabet only (DTO + verify enforce this), so
    // it's safe to render directly inside a `value="..."`. No HTML special
    // chars possible. Defense-in-depth: HTML-escape anyway.
    const safeToken = token.replace(/[<>"&]/g, (c) =>
      ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', '&': '&amp;' })[c] as string,
    );
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Unsubscribe — Jadwal</title>
  <style>
    body { margin:0; padding:32px 16px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background:#f3f4f6; color:#111827; }
    .card { max-width:480px; margin:0 auto; background:#ffffff; border-radius:12px; padding:32px; box-shadow:0 1px 3px rgba(0,0,0,0.08); text-align:center; }
    h1 { margin:0 0 12px; font-size:22px; color:#0f172a; }
    p { margin:0 0 24px; font-size:15px; color:#374151; line-height:1.5; }
    button { background:#0284c7; color:#ffffff; border:0; border-radius:8px; padding:14px 28px; font-size:15px; font-weight:600; cursor:pointer; }
    button:hover { background:#0369a1; }
    .meta { margin-top:24px; font-size:12px; color:#9ca3af; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Unsubscribe from Jadwal emails?</h1>
    <p>Click the button below to confirm. We will stop sending all transactional emails to your address.</p>
    <form method="POST" action="/api/email/unsubscribe">
      <input type="hidden" name="t" value="${safeToken}">
      <input type="hidden" name="List-Unsubscribe" value="One-Click">
      <button type="submit">Confirm unsubscribe</button>
    </form>
    <p class="meta">If you did not click an unsubscribe link, you can safely close this page.</p>
  </div>
</body>
</html>`;
  }

  private renderErrorPage(message: string): string {
    const safe = message.replace(/[<>"&]/g, (c) =>
      ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', '&': '&amp;' })[c] as string,
    );
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Unsubscribe — Jadwal</title>
  <style>
    body { margin:0; padding:32px 16px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background:#f3f4f6; color:#111827; }
    .card { max-width:480px; margin:0 auto; background:#ffffff; border-radius:12px; padding:32px; box-shadow:0 1px 3px rgba(0,0,0,0.08); text-align:center; }
    h1 { margin:0 0 12px; font-size:22px; color:#0f172a; }
    p { margin:0; font-size:15px; color:#374151; line-height:1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Unsubscribe link not valid</h1>
    <p>${safe}</p>
  </div>
</body>
</html>`;
  }
}
