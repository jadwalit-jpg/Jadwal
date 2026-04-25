import { ExceptionFilter, Catch, ArgumentsHost } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Response } from 'express';

@Catch(ThrottlerException)
export class ThrottlerExceptionFilter implements ExceptionFilter {
  catch(exception: ThrottlerException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const retryAfter = response.getHeader('Retry-After');
    const waitSeconds = retryAfter ? Number(retryAfter) : 60;

    response.status(429).json({
      statusCode: 429,
      message: 'Too many requests. Please try again later.',
      retryAfterSeconds: waitSeconds,
    });
  }
}
