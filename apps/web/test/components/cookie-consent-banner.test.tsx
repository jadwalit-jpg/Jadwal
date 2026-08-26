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
const reopen = jest.fn();
let mockConsent: 'accepted' | 'declined' | null = null;
let mockHydrated = true;
let mockReopened = false;

jest.mock('@/context/cookie-consent', () => ({
  useCookieConsent: () => ({
    consent: mockConsent,
    hydrated: mockHydrated,
    accept,
    decline,
    reopen,
    // Mirrors the provider's own derivation so these tests exercise the real
    // rule rather than a convenient shortcut.
    bannerOpen: mockHydrated && (mockConsent === null || mockReopened),
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import CookieConsentBanner from '@/components/cookie-consent-banner';

beforeEach(() => {
  accept.mockClear();
  decline.mockClear();
  reopen.mockClear();
  mockConsent = null;
  mockHydrated = true;
  mockReopened = false;
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

  test.each([['accepted'], ['declined']] as const)(
    'comes back when re-opened after choosing %s',
    (choice) => {
      // The PDPPL right to withdraw consent, which the Privacy Policy promises.
      // The banner never reappears on its own, so re-opening it from the footer
      // is the only mechanism there is for changing a past decision.
      mockConsent = choice;
      mockReopened = true;
      render(<CookieConsentBanner />);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
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
  test('does not capture clicks while it is fading out', () => {
    // Found by review on #607. `opacity-0` hides an element but does NOT stop it
    // receiving pointer events, and useMountTransition deliberately keeps the
    // node mounted for the whole exit duration. Without pointer-events-none the
    // invisible overlay swallows clicks aimed at the page beneath it.
    //
    // It is worst on terms-accept-modal, whose backdrop is `fixed inset-0` and
    // therefore blanks the ENTIRE page for 200 ms after closing. This banner is
    // `fixed bottom-4 inset-x-4 max-w-3xl`, so it blocks a wide strip for 300 ms.
    // Reduced-motion users get no visual cue at all that anything is happening.
    jest.useFakeTimers();
    try {
      const { rerender } = render(<CookieConsentBanner />);
      expect(screen.getByRole('dialog').className).not.toContain('pointer-events-none');

      mockConsent = 'accepted';
      act(() => {
        rerender(<CookieConsentBanner />);
      });

      // Still mounted (the exit transition is running) but must be click-through.
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog.className).toContain('pointer-events-none');
    } finally {
      jest.useRealTimers();
    }
  });

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
