/**
 * Consent state for the analytics/marketing tags.
 *
 * The property that matters most here is subtle and legal rather than
 * functional. Consent on this site is OPT-OUT: `allowed` is
 * `consent !== 'declined'`. So "re-open the banner" must NOT be implemented as
 * "reset the stored decision to null" — for a visitor who had DECLINED that
 * would flip them back into the tracked default for as long as the banner sat
 * open, meaning the act of withdrawing consent would start the very processing
 * it is meant to stop. These tests pin that the stored decision stays in force
 * until a NEW one is made.
 */
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CookieConsentProvider, useCookieConsent } from '@/context/cookie-consent';

const STORAGE_KEY = 'jadwal_cookie_consent';

function Probe() {
  const { consent, hydrated, bannerOpen, accept, decline, reopen } = useCookieConsent();
  return (
    <div>
      <span data-testid="consent">{String(consent)}</span>
      <span data-testid="hydrated">{String(hydrated)}</span>
      <span data-testid="banner">{String(bannerOpen)}</span>
      <button onClick={accept}>accept</button>
      <button onClick={decline}>decline</button>
      <button onClick={reopen}>reopen</button>
    </div>
  );
}

function setup() {
  return render(
    <CookieConsentProvider>
      <Probe />
    </CookieConsentProvider>,
  );
}

const consentValue = () => screen.getByTestId('consent').textContent;
const bannerValue = () => screen.getByTestId('banner').textContent;

beforeEach(() => {
  localStorage.clear();
});

describe('CookieConsentProvider — first visit', () => {
  test('undecided visitor sees the banner', () => {
    setup();

    expect(consentValue()).toBe('null');
    expect(bannerValue()).toBe('true');
  });

  test('a stored decision is honoured and the banner stays shut', () => {
    localStorage.setItem(STORAGE_KEY, 'declined');
    setup();

    expect(consentValue()).toBe('declined');
    expect(bannerValue()).toBe('false');
  });

  test.each([['accept', 'accepted'], ['decline', 'declined']])(
    '%s persists the choice and closes the banner',
    async (button, expected) => {
      const user = userEvent.setup();
      setup();

      await user.click(screen.getByText(button));

      expect(consentValue()).toBe(expected);
      expect(bannerValue()).toBe('false');
      expect(localStorage.getItem(STORAGE_KEY)).toBe(expected);
    },
  );
});

describe('CookieConsentProvider — withdrawing consent (PDPPL Article 4)', () => {
  test('re-opening does NOT revert a declined visitor to the tracked default', () => {
    // The whole point. Under opt-out, `consent === null` means TRACKED, so
    // clearing the decision to re-open the banner would silently re-enable the
    // tags for someone who had switched them off.
    localStorage.setItem(STORAGE_KEY, 'declined');
    setup();

    act(() => {
      screen.getByText('reopen').click();
    });

    expect(bannerValue()).toBe('true'); // banner is back
    expect(consentValue()).toBe('declined'); // ...but still opted out
    expect(localStorage.getItem(STORAGE_KEY)).toBe('declined');
  });

  test('an accepted visitor can re-open and switch to declined', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEY, 'accepted');
    setup();
    expect(bannerValue()).toBe('false');

    await user.click(screen.getByText('reopen'));
    expect(bannerValue()).toBe('true');

    await user.click(screen.getByText('decline'));

    expect(consentValue()).toBe('declined');
    expect(bannerValue()).toBe('false');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('declined');
  });

  test('a declined visitor can re-open and switch back to accepted', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEY, 'declined');
    setup();

    await user.click(screen.getByText('reopen'));
    await user.click(screen.getByText('accept'));

    expect(consentValue()).toBe('accepted');
    expect(bannerValue()).toBe('false');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('accepted');
  });

  test('re-opening twice without deciding leaves the decision untouched', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEY, 'declined');
    setup();

    await user.click(screen.getByText('reopen'));
    await user.click(screen.getByText('reopen'));

    expect(consentValue()).toBe('declined');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('declined');
  });
});

describe('CookieConsentProvider — storage unavailable', () => {
  test('a blocked localStorage does not break consent for the session', async () => {
    // Private mode / blocked storage. The decision must still apply in-memory,
    // otherwise a visitor who declines keeps being tracked for that session.
    const user = userEvent.setup();
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    try {
      setup();
      await user.click(screen.getByText('decline'));

      expect(consentValue()).toBe('declined');
      expect(bannerValue()).toBe('false');
    } finally {
      setItem.mockRestore();
    }
  });
});
