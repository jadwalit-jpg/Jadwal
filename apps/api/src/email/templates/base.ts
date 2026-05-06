/**
 * Base HTML email template wrapper for all Jadwal emails.
 *
 * Uses table-based layout with inline CSS for maximum email client compatibility.
 * Never use <style> tags — many clients strip them.
 */

/** Escape user-provided strings to prevent HTML injection in emails. */
export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/** Render a CTA button as a table-based element (Outlook-safe). */
export function ctaButton(text: string, href: string): string {
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: 24px auto;">
      <tr>
        <td style="border-radius: 8px; background-color: #0284c7;">
          <a href="${escapeHtml(href)}" target="_blank" style="display: inline-block; padding: 14px 32px; font-family: Arial, sans-serif; font-size: 16px; font-weight: bold; color: #ffffff; text-decoration: none; border-radius: 8px;">
            ${escapeHtml(text)}
          </a>
        </td>
      </tr>
    </table>`;
}

/**
 * Wraps email content in the Jadwal branded HTML shell.
 *
 * @param content - The inner HTML content (already rendered by a specific template)
 * @param previewText - Hidden preheader text shown in inbox previews
 */
export function baseTemplate(content: string, previewText?: string): string {
  const preheader = previewText
    ? `<span style="display:none;font-size:1px;color:#f3f4f6;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(previewText)}</span>`
    : '';

  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>Jadwal</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: Arial, sans-serif; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">
  ${preheader}

  <!-- Outer wrapper -->
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f3f4f6;">
    <tr>
      <td align="center" style="padding: 24px 16px;">

        <!-- Main card -->
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width: 600px; width: 100%; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">

          <!-- Header bar -->
          <tr>
            <td align="center" style="background-color: #0f172a; padding: 24px 32px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center" style="font-family: Arial, sans-serif; font-size: 28px; font-weight: bold; color: #ffffff; letter-spacing: 1px;">
                    <img src="https://jadwal.qa/android-chrome-192x192.png" width="56" height="56" alt="Jadwal" style="display: block; margin: 0 auto 12px; border: 0; border-radius: 12px;">
                    Jadwal <span style="font-size: 22px; color: #7dd3fc;">&#1580;&#1583;&#1608;&#1604;</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content area -->
          <tr>
            <td style="background-color: #ffffff; padding: 32px 32px 24px 32px;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 20px 32px; border-top: 1px solid #e5e7eb;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td align="center" style="font-family: Arial, sans-serif; font-size: 12px; color: #9ca3af; line-height: 20px;">
                    &copy; 2026 AL Jadwal. All rights reserved.<br>
                    <span style="color: #d1d5db;">You received this transactional email because you have an account on Jadwal. We don&#x27;t send marketing emails.</span><br>
                    <a href="https://jadwal.qa/profile" style="color: #9ca3af; text-decoration: underline;">Manage your account &amp; email preferences</a><br>
                    <span style="color: #d1d5db;">AL Jadwal &middot; Apt 18, Floor 1, Building 60, Street 840, Zone 39, Doha, Qatar</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
        <!-- /Main card -->

      </td>
    </tr>
  </table>
  <!-- /Outer wrapper -->
</body>
</html>`;
}
