import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Payload posted by the web-app `<ErrorBoundary>` when a render error fires
 * in the user's browser. All fields are length-capped both here AND truncated
 * again in the controller — defense in depth against a misbehaving client
 * spamming oversized payloads into CloudWatch (logs cost $0.50/GB ingested).
 *
 * Field caps were sized against typical real-world stacks: a React render
 * stack rarely exceeds 4 KB, but minified-and-source-mapped traces can.
 */
export class ClientErrorDto {
  @IsString()
  @MaxLength(1000)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  stack?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  componentStack?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  userAgent?: string;

  /**
   * Opaque user id from the client (the JWT subject). Used only for
   * correlating support requests with logged errors. NOT trusted as an
   * auth signal — the endpoint is unauthenticated because errors can fire
   * before login, and even if a value is provided we never grant
   * privileges off it. Capped short to prevent log injection.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;
}
