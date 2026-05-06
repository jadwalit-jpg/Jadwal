import { IsOptional, IsString, Length, Matches } from 'class-validator';

/**
 * One-click unsubscribe request body / query params (RFC 8058).
 *
 * Gmail and other receivers may include `List-Unsubscribe=One-Click` as a
 * form field per RFC 8058 §3.1. We accept it but don't require it — the
 * signed token is the only authentication that matters.
 */
export class UnsubscribeDto {
  // base64url alphabet = [A-Za-z0-9_-]; lengths range ~80-200 chars in practice.
  // Conservative bounds reject pathological inputs without hard-failing on edge cases.
  @IsString()
  @Length(20, 1024)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'token must be base64url-encoded',
  })
  t!: string;

  // RFC 8058 form field. Gmail/Yahoo include this on the POST.
  // Optional + ignored — we don't gate behavior on it.
  @IsOptional()
  @IsString()
  @Length(1, 64)
  'List-Unsubscribe'?: string;
}
