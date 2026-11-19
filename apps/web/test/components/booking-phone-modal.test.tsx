/**
 * Phone pop-up: the server's answer to the booking request is shown under the
 * field, and when that answer is "you already have a booking for this slot"
 * the pop-up offers a way out: a button-styled link to that booking (or to My
 * bookings). Nothing else about the pop-up changes.
 */
import { render, screen } from '@testing-library/react';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key), i18n: { language: 'en' } }),
}));
jest.mock('@/lib/track', () => ({ trackEvent: jest.fn() }));

import { BookingPhoneModal } from '../../src/components/booking-phone-modal';

const base = { isOpen: true, onClose: jest.fn(), onSubmit: jest.fn() };

describe('BookingPhoneModal', () => {
  it('shows the server error under the field with no action by default', () => {
    render(<BookingPhoneModal {...base} submitError="Failed to create booking" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to create booking');
    expect(screen.queryByTestId('phone-submit-error-action')).not.toBeInTheDocument();
  });

  it('shows the action link to the existing booking when the parent provides one', () => {
    render(
      <BookingPhoneModal
        {...base}
        submitError="You already have an unfinished booking for this time. Open it to pay for it instead of booking again."
        submitErrorAction={{ label: 'Open that booking', href: '/bookings/b-123' }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/unfinished booking for this time/);
    const link = screen.getByTestId('phone-submit-error-action');
    expect(link).toHaveAttribute('href', '/bookings/b-123');
    expect(link).toHaveTextContent('Open that booking');
    expect(link.className).toMatch(/min-h-11/); // 44px tap target
  });

  it('falls back to My bookings when the booking id is not known', () => {
    render(<BookingPhoneModal {...base} submitError="dup" submitErrorAction={{ label: 'Open my bookings', href: '/bookings' }} />);
    expect(screen.getByTestId('phone-submit-error-action')).toHaveAttribute('href', '/bookings');
  });

  it('never shows the action without an error', () => {
    render(<BookingPhoneModal {...base} submitErrorAction={{ label: 'Open that booking', href: '/bookings/b-1' }} />);
    expect(screen.queryByTestId('phone-submit-error-action')).not.toBeInTheDocument();
  });
});
