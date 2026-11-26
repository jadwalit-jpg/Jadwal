/**
 * The customer's "payment received, being confirmed with your bank" banner:
 * title, text, and a WhatsApp link prefilled with the booking reference.
 */
import { render, screen } from '@testing-library/react';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string } & Record<string, unknown>) => {
      const base = opts?.defaultValue ?? key;
      return opts ? base.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(opts[k] ?? '')) : base;
    },
  }),
}));

import { BankConfirmingBanner } from '../../src/components/bank-confirming-banner';

describe('BankConfirmingBanner', () => {
  it('says the payment was received and is being confirmed, and tells the customer not to pay again', () => {
    render(<BankConfirmingBanner bookingRef="JDWL-83AFB737" />);
    const banner = screen.getByTestId('bank-confirming-banner');
    expect(banner).toHaveTextContent('Payment received');
    expect(banner).toHaveTextContent('confirming it with your bank');
    expect(banner).toHaveTextContent('Please do not pay again');
  });

  it('links to WhatsApp with the booking reference in the message', () => {
    render(<BankConfirmingBanner bookingRef="JDWL-83AFB737" />);
    const link = screen.getByTestId('bank-confirming-whatsapp') as HTMLAnchorElement;
    expect(link).toHaveTextContent('Chat with us on WhatsApp');
    expect(link.href).toMatch(/^https:\/\/wa\.me\/97477499399\?text=/);
    expect(decodeURIComponent(link.href)).toContain('JDWL-83AFB737');
    expect(link.target).toBe('_blank');
    expect(link.className).toMatch(/min-h-11/);
  });
});
