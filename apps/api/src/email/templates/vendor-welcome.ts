import { baseTemplate, escapeHtml, ctaButton } from './base';

export interface VendorWelcomeData {
  vendorName: string;
  businessName: string;
}

export function vendorWelcomeTemplate(data: VendorWelcomeData): string {
  const name = escapeHtml(data.vendorName);
  const business = escapeHtml(data.businessName);

  const content = `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 22px; font-weight: bold; color: #111827; padding-bottom: 8px;">
          Congratulations, ${name}!
        </td>
      </tr>
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 15px; color: #374151; padding-bottom: 24px; line-height: 22px;">
          Your vendor account for <strong>${business}</strong> has been approved. You&#x27;re all set to start listing activities on Jadwal.
        </td>
      </tr>
    </table>

    <!-- Next steps -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; margin-bottom: 8px;">
      <tr>
        <td style="background-color: #f0f9ff; padding: 14px 16px; font-family: Arial, sans-serif; font-size: 15px; font-weight: bold; color: #0c4a6e; border-bottom: 1px solid #e0f2fe;">
          Next Steps
        </td>
      </tr>
      <tr>
        <td style="padding: 16px; font-family: Arial, sans-serif; font-size: 14px; color: #374151; line-height: 24px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="padding: 4px 0; font-size: 14px; color: #374151; vertical-align: top; width: 28px;">1.</td>
              <td style="padding: 4px 0; font-size: 14px; color: #374151;"><strong>Create your first activity</strong> &mdash; add photos, set pricing and availability</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; font-size: 14px; color: #374151; vertical-align: top; width: 28px;">2.</td>
              <td style="padding: 4px 0; font-size: 14px; color: #374151;"><strong>Set up bank details</strong> &mdash; so you can receive payouts for bookings</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; font-size: 14px; color: #374151; vertical-align: top; width: 28px;">3.</td>
              <td style="padding: 4px 0; font-size: 14px; color: #374151;"><strong>Go live</strong> &mdash; publish your activity and start accepting customers</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    ${ctaButton('Go to Vendor Dashboard', '{{APP_URL}}/vendor/dashboard')}

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="font-family: Arial, sans-serif; font-size: 13px; color: #9ca3af; text-align: center; padding-top: 8px;">
          Need help? Reply to this email and our team will assist you.
        </td>
      </tr>
    </table>`;

  return baseTemplate(content, `Your vendor account for ${business} is approved!`);
}
