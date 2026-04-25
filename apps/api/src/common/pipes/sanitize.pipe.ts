import { PipeTransform, Injectable, ArgumentMetadata } from '@nestjs/common';

/**
 * Global pipe that sanitizes all incoming string values.
 * Strips HTML tags, script injections, and dangerous patterns.
 */
@Injectable()
export class SanitizePipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata) {
    // Sanitize body, query params, and route params — not custom decorators
    if (metadata.type !== 'body' && metadata.type !== 'query' && metadata.type !== 'param') {
      return value;
    }
    if (typeof value === 'string') return this.sanitizeString(value);
    if (typeof value === 'object' && value !== null) return this.sanitizeObject(value as Record<string, unknown>);
    return value;
  }

  private sanitizeString(str: string): string {
    return str
      .replace(/[\u202A-\u202E\u2066-\u2069\u200F\u200E]/g, '') // strip bidi overrides (Arabic text-direction attacks)
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // strip <script> blocks
      .replace(/<[^>]*>/g, '')         // strip all HTML tags
      .replace(/javascript\s*:/gi, '') // strip JS protocol
      .replace(/on\w+\s*=/gi, '')      // strip event handlers (onclick=, onerror=, etc.)
      .replace(/data\s*:\s*text\/html/gi, '') // strip data:text/html
      .trim();
  }

  private sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === 'string') {
        sanitized[key] = this.sanitizeString(val);
      } else if (Array.isArray(val)) {
        sanitized[key] = val.map((item) =>
          typeof item === 'string'
            ? this.sanitizeString(item)
            : typeof item === 'object' && item !== null
              ? this.sanitizeObject(item as Record<string, unknown>)
              : item,
        );
      } else if (typeof val === 'object' && val !== null) {
        sanitized[key] = this.sanitizeObject(val as Record<string, unknown>);
      } else {
        sanitized[key] = val;
      }
    }
    return sanitized;
  }
}
