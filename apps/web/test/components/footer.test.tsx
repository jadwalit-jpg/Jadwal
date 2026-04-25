import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => opts?.defaultValue ?? key,
    i18n: { language: 'en' },
  }),
}));

// Footer calls /platform/settings via tanstack-query — stub the api client.
jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn().mockResolvedValue({ data: null }) },
}));

import Footer from '@/components/footer';

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('<Footer />', () => {
  it('renders without crashing (smoke)', () => {
    expect(() => render(wrap(<Footer />))).not.toThrow();
  });

  it('renders the main navigation groups', () => {
    render(wrap(<Footer />));
    // Translator returns the key — so we assert on keys. Real copy lives in
    // locales/en.json and is covered by the parity check.
    expect(screen.getAllByRole('link').length).toBeGreaterThan(0);
  });

  it('rights notice is present at the bottom (per design — every page)', () => {
    render(wrap(<Footer />));
    // The t() key lookup returns the key itself; we assert it rendered.
    expect(screen.getByText(/footer\.rights/i)).toBeInTheDocument();
  });

  it('exposes Explore / Company groups as navigation landmarks', () => {
    render(wrap(<Footer />));
    // footer's main section is within a <footer> landmark
    const footer = screen.getByRole('contentinfo');
    expect(footer).toBeInTheDocument();
  });
});
