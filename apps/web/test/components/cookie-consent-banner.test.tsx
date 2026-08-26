/**
 * The cookie banner is how consent is captured at all, and it had no test when
 * its <AnimatePresence> wrapper was replaced with a CSS transition (2026-08-26,
 * to get framer-motion out of the root layout's critical chunk group).
 *
 * The failure this guards against is silent and expensive: if the mount logic
 * is wrong the banner simply never appears, nobody is ever asked, `consent`
 * stays null forever, and the only visible symptom is analytics quietly
 * behaving as if every visitor was undecided. So these tests assert the banner
 * RENDERS and that its two buttons still reach the consent context — not that
 * it animates.
 */
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const accept = jest.fn();
const decline = jest.fn();
let mockConsent: 'accepted' | 'declined' | null = null;
let mockHydrated = true;

jest.mock('@/context/cookie-consent', () => ({
  useCookieConsent: () => ({
    consent: mockConsent,
    hydrated: mockHydrated,
    accept,
    decline,
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import CookieConsentBanner from '@/components/cookie-consent-banner';

beforeEach(() => {
  accept.mockClear();
  decline.mockClear();
  mockConsent = null;
  mockHydrated = true;
});

describe('CookieConsentBanner — visibility', () => {
  test('renders once hydrated with no stored choice', () => {
    render(<CookieConsentBanner />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('cookies.message')).toBeInTheDocument();
  });

  test('renders nothing before the stored choice has been read', () => {
    // Showing the banner to someone who already accepted would be a bug the
    // `hydrated` flag exists to prevent.
    mockHydrated = false;
    render(<CookieConsentBanner />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test.each([['accepted'], ['declined']] as const)(
    'renders nothing when the visitor already chose %s',
    (choice) => {
      mockConsent = choice;
      render(<CookieConsentBanner />);

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    },
  );
});

describe('CookieConsentBanner — the consent buttons still work', () => {
  test('Accept calls accept() and not decline()', async () => {
    const user = userEvent.setup();
    render(<CookieConsentBanner />);

    await user.click(screen.getByRole('button', { name: 'cookies.accept' }));

    expect(accept).toHaveBeenCalledTimes(1);
    expect(decline).not.toHaveBeenCalled();
  });

  test('Decline calls decline() and not accept()', async () => {
    const user = userEvent.setup();
    render(<CookieConsentBanner />);

    await user.click(screen.getByRole('button', { name: 'cookies.decline' }));

    expect(decline).toHaveBeenCalledTimes(1);
    expect(accept).not.toHaveBeenCalled();
  });
});

describe('CookieConsentBanner — the exit transition', () => {
  test('stays in the DOM while fading out, then leaves', () => {
    // This is exactly what <AnimatePresence> used to provide. Without it the
    // banner would disappear instantly and the slide-down would never be seen.
    jest.useFakeTimers();
    try {
      const { rerender } = render(<CookieConsentBanner />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      mockConsent = 'accepted';
      act(() => {
        rerender(<CookieConsentBanner />);
      });
      expect(screen.getByRole('dialog')).toBeInTheDocument(); // still exiting

      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });
});
