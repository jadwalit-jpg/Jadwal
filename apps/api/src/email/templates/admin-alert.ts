import { baseTemplate, escapeHtml } from './base';

/**
 * Hardcoded subjects per alert type. Mapping lives next to the template so
 * adding a new alert type only touches this file + the union type below.
 *
 * Subjects deliberately do NOT include user-controlled strings — that is the
 * whole point of typing `sendAdminAlert`. Free-form context goes in the body
 * via `details` / `note`, where it is HTML-escaped + length-capped before
 * rendering.
 */
export const ADMIN_ALERT_SUBJECTS = {
  DATABASE_ERROR:        'Jadwal alert:Database error',
  PAYMENT_DRIFT:         'Jadwal alert:Payment drift detected',
  SECURITY_EVENT:        'Jadwal alert:Security event',
  DEPLOYMENT_FAILURE:    'Jadwal alert:Deployment failure',
  BOUNCE_RATE_HIGH:      'Jadwal alert:SES bounce rate alert',
  COMPLAINT_RATE_HIGH:   'Jadwal alert:SES complaint rate alert',
  RATE_LIMIT_BREACH:     'Jadwal alert:Sustained rate limit breach',
  CRON_FAILURE:          'Jadwal alert:Background job failure',
} as const;

export type AdminAlertType = keyof typeof ADMIN_ALERT_SUBJECTS;

export interface AdminAlertData {
  type: AdminAlertType;
  /**
   * Sanitized + capped key/value pairs. Keys are rendered as-is (callers must
   * use static identifiers, not user input). Values are HTML-escaped and
   * truncated by the service before reaching the template.
   */
  details?: Record<string, string>;
  /**
   * Free-form context line. Sanitized + capped at 500 chars by the service.
   * Use for short narrative ("rotation cron failed at step 3"), not stack
   * traces or PII.
   */
  note?: string;
  /** ISO 8601 timestamp the alert was generated. Service sets this. */
  generatedAt: string;
}

/**
 * Renders the admin alert email body. Inputs MUST be pre-sanitized by
 * `EmailService.sendAdminAlert` — this template trusts the strings it
 * receives and only adds HTML escaping as a defence-in-depth layer.
 */
export function adminAlertTemplate(data: AdminAlertData): string {
  const detailRows = data.details
    ? Object.entries(data.details)
        .map(
          ([k, v]) => `
            <tr>
              <td style="padding: 6px 12px 6px 0; font-family: 'Courier New', monospace; font-size: 13px; color: #6b7280; vertical-align: top; white-space: nowrap;">
                ${escapeHtml(k)}
              </td>
              <td style="padding: 6px 0; font-family: 'Courier New', monospace; font-size: 13px; color: #111827; vertical-align: top; word-break: break-all;">
                ${escapeHtml(v)}
              </td>
            </tr>`,
        )
        .join('')
    : '';

  const detailsBlock = detailRows
    ? `
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f9fafb; border-radius: 8px; padding: 12px 16px; margin: 16px 0;">
        ${detailRows}
      </table>`
    : '';

  const noteBlock = data.note
    ? `<p style="font-family: Arial, sans-serif; font-size: 14px; color: #4b5563; line-height: 22px; margin: 16px 0;">${escapeHtml(data.note)}</p>`
    : '';

  const content = `
    <p style="font-family: Arial, sans-serif; font-size: 12px; color: #b91c1c; letter-spacing: 1px; text-transform: uppercase; margin: 0 0 8px 0;">
      Operational alert
    </p>
    <h2 style="font-family: Arial, sans-serif; font-size: 22px; color: #111827; margin: 0 0 12px 0;">
      ${escapeHtml(ADMIN_ALERT_SUBJECTS[data.type])}
    </h2>
    <p style="font-family: Arial, sans-serif; font-size: 13px; color: #6b7280; margin: 0;">
      Type: <strong style="color: #111827;">${escapeHtml(data.type)}</strong> &middot;
      Generated: ${escapeHtml(data.generatedAt)}
    </p>
    ${detailsBlock}
    ${noteBlock}
    <p style="font-family: Arial, sans-serif; font-size: 12px; color: #9ca3af; margin: 24px 0 0 0;">
      This message was generated automatically by the Jadwal platform. No reply needed.
    </p>`;

  return baseTemplate(content, ADMIN_ALERT_SUBJECTS[data.type]);
}
