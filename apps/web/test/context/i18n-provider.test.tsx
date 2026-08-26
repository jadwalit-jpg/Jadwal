/**
 * The language switch has one non-obvious requirement that no amount of manual
 * clicking reliably catches, because the page LOOKS translated when it isn't.
 *
 * `/ar/x` is not a distinct route. The middleware REWRITES it to `/x` with an
 * `x-lang: ar` header, so both languages resolve to the same underlying route —
 * and Next's client Router Cache keys on that underlying route, not the visible
 * URL. So a bare `router.push('/ar/blog')` from `/blog` is served the CACHED
 * English payload.
 *
 * The reason it fools you: every client component reads the i18next singleton,
 * so the navbar, footer and `<html lang/dir>` all flip to Arabic instantly.
 * Only SERVER-rendered copy stays English — guide titles, landing-page prose,
 * category names. It reads as a partial translation rather than a cache bug,
 * and a manual reload "fixes" it because that bypasses the Router Cache.
 *
 * `router.refresh()` is what invalidates that cache. These tests assert it is
 * called, so removing it fails here instead of silently shipping English text
 * under an Arabic URL.
 */
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = jest.fn();
const refresh = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}));

// The real i18next singleton boots resources and fires listeners; for these
// tests we only care which router calls happen for a given target language.
let currentLang = 'en';
jest.mock('@/lib/i18n', () => ({
  __esModule: true,
  default: {
    get language() {
      return currentLang;
    },
    changeLanguage: (lng: string) => {
      currentLang = lng;
      return Promise.resolve();
    },
    cloneInstance: () => ({ language: currentLang }),
  },
  isLang: (v: unknown) => v === 'en' || v === 'ar',
  readLangClient: () => 'en',
}));

jest.mock('react-i18next', () => ({
  I18nextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { I18nProvider, useLangSwitch } from '@/context/i18n-provider';

/** Minimal consumer that drives the switch the way the navbar button does. */
function Switcher({ to }: { to: 'en' | 'ar' }) {
  const { switchLanguage } = useLangSwitch();
  return (
    <button type="button" onClick={() => switchLanguage(to)}>
      switch
    </button>
  );
}

function setPath(pathname: string) {
  window.history.replaceState({}, '', pathname);
}

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  currentLang = 'en';
});

describe('language switch on a PUBLIC route (has an /ar twin)', () => {
  it('navigates to the /ar twin AND invalidates the Router Cache', async () => {
    // Without the refresh, this push is served the cached English payload and
    // the visitor sees English guide titles under an Arabic URL.
    setPath('/blog');
    const user = userEvent.setup();
    render(
      <I18nProvider initialLang="en">
        <Switcher to="ar" />
      </I18nProvider>,
    );

    await act(async () => {
      await user.click(screen.getByRole('button'));
    });

    expect(push).toHaveBeenCalledWith('/ar/blog');
    expect(refresh).toHaveBeenCalled();
  });

  it('does the same switching back to English', async () => {
    // The stale-cache bug is symmetric — /ar/blog -> /blog hits the cached
    // Arabic payload just as readily.
    setPath('/ar/blog');
    currentLang = 'ar';
    const user = userEvent.setup();
    render(
      <I18nProvider initialLang="ar">
        <Switcher to="en" />
      </I18nProvider>,
    );

    await act(async () => {
      await user.click(screen.getByRole('button'));
    });

    expect(push).toHaveBeenCalledWith('/blog');
    expect(refresh).toHaveBeenCalled();
  });

  it('preserves the query string and hash across the switch', async () => {
    // /explore carries countryId and filters; dropping them on a language
    // switch silently resets the visitor's search.
    setPath('/explore?countryId=abc&page=2#results');
    const user = userEvent.setup();
    render(
      <I18nProvider initialLang="en">
        <Switcher to="ar" />
      </I18nProvider>,
    );

    await act(async () => {
      await user.click(screen.getByRole('button'));
    });

    expect(push).toHaveBeenCalledWith('/ar/explore?countryId=abc&page=2#results');
  });

  it('deep guide URLs keep their full path under the /ar prefix', async () => {
    setPath('/blog/best-water-activities-in-doha');
    const user = userEvent.setup();
    render(
      <I18nProvider initialLang="en">
        <Switcher to="ar" />
      </I18nProvider>,
    );

    await act(async () => {
      await user.click(screen.getByRole('button'));
    });

    expect(push).toHaveBeenCalledWith('/ar/blog/best-water-activities-in-doha');
  });
});

describe('language switch on a NON-public route (no /ar twin)', () => {
  it('refreshes in place instead of navigating', async () => {
    // /account has no Arabic twin — pushing /ar/account would 404 or bounce.
    // Language there stays cookie-driven, so a refresh is the whole mechanism.
    setPath('/account');
    const user = userEvent.setup();
    render(
      <I18nProvider initialLang="en">
        <Switcher to="ar" />
      </I18nProvider>,
    );

    await act(async () => {
      await user.click(screen.getByRole('button'));
    });

    expect(push).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });
});

describe('language switch that is a no-op', () => {
  it('does nothing when the requested language is already active', async () => {
    // Guards against a redundant navigation + full RSC refetch on every click
    // of the already-selected language.
    setPath('/blog');
    const user = userEvent.setup();
    render(
      <I18nProvider initialLang="en">
        <Switcher to="en" />
      </I18nProvider>,
    );

    await act(async () => {
      await user.click(screen.getByRole('button'));
    });

    expect(push).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
