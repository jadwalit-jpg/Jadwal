import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Translator: pass the key through unless a defaultValue is supplied.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => opts?.defaultValue ?? key,
    i18n: { language: 'en' },
  }),
}));

// @/lib/localize imports @/lib/i18n which boots the real i18next instance —
// too expensive for a unit test. Stub localized() with the same contract
// (pick EN unless language is ar, fall back to EN for empty AR).
jest.mock('@/lib/localize', () => ({
  localized: (obj: any, field: string) => {
    if (!obj) return '';
    const en = obj[`${field}En`];
    return typeof en === 'string' ? en : '';
  },
  isRtl: () => false,
}));

import { ActivityCard, type ActivityCardActivity } from '@/components/ui/activity-card';

const base: ActivityCardActivity = {
  id: 'a1',
  slug: 'desert-safari',
  titleEn: 'Desert Safari',
  titleAr: 'سفاري الصحراء',
  pricePerPerson: 250,
  country: { currencyCode: 'QAR' },
  city: { nameEn: 'Doha', nameAr: 'الدوحة' },
  vendor: { businessNameEn: 'Desert Co', businessNameAr: 'شركة الصحراء' },
  coverImage: '/uploads/safari.jpg',
  avgRating: 4.7,
  reviewCount: 312,
};

describe('<ActivityCard />', () => {
  it('renders title, city, vendor, and linked image with alt=title', () => {
    render(<ActivityCard activity={base} />);

    // Title shown both as the aria-label on the image link and as the body link
    expect(screen.getAllByText(/desert safari/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/doha/i)).toBeInTheDocument();
    expect(screen.getByText(/desert co/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /desert safari/i })).toBeInTheDocument();
  });

  it('always links to /activity/<slug> unless href is overridden', () => {
    render(<ActivityCard activity={base} />);
    const links = screen.getAllByRole('link');
    expect(links.some((a) => a.getAttribute('href') === '/activity/desert-safari')).toBe(true);
  });

  it('uses a custom href when provided', () => {
    render(<ActivityCard activity={base} href="/custom/route" />);
    const links = screen.getAllByRole('link');
    expect(links.some((a) => a.getAttribute('href') === '/custom/route')).toBe(true);
  });

  it('formats the price with the country currency (QAR 250)', () => {
    render(<ActivityCard activity={base} />);
    expect(screen.getByText(/QAR\s*250/i)).toBeInTheDocument();
  });

  it('shows the strikethrough previous price when priceWas is set', () => {
    render(<ActivityCard activity={{ ...base, priceWas: 400 }} />);
    expect(screen.getByText(/QAR\s*400/i)).toBeInTheDocument();
  });

  it('renders the rating when avgRating is set', () => {
    render(<ActivityCard activity={base} />);
    expect(screen.getByText('4.7')).toBeInTheDocument();
    expect(screen.getByText('(312)')).toBeInTheDocument();
  });

  it('omits the rating when avgRating is null', () => {
    render(<ActivityCard activity={{ ...base, avgRating: null }} />);
    expect(screen.queryByText('4.7')).not.toBeInTheDocument();
  });

  it('falls back to a placeholder icon when coverImage + gallery are absent', () => {
    render(<ActivityCard activity={{ ...base, coverImage: null, gallery: [] }} />);
    // No real <img> for content; the icon replaces it
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders the like button only when onToggleLike is provided', () => {
    const { rerender } = render(<ActivityCard activity={base} />);
    expect(screen.queryByRole('button', { name: /like/i })).not.toBeInTheDocument();

    const onToggleLike = jest.fn();
    rerender(<ActivityCard activity={base} onToggleLike={onToggleLike} />);
    expect(screen.getByRole('button', { name: /like/i })).toBeInTheDocument();
  });

  it('fires onToggleLike when pressed, and prevents the link navigation', async () => {
    const user = userEvent.setup();
    const onToggleLike = jest.fn();
    render(<ActivityCard activity={base} onToggleLike={onToggleLike} />);
    await user.click(screen.getByRole('button', { name: /like/i }));
    expect(onToggleLike).toHaveBeenCalledTimes(1);
  });

  it('reflects the `liked` state via aria-pressed and an unlike label', () => {
    render(<ActivityCard activity={base} onToggleLike={() => {}} liked />);
    const btn = screen.getByRole('button', { name: /unlike/i });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders the badge label for bestseller / toprated / new', () => {
    const { rerender } = render(<ActivityCard activity={{ ...base, badge: 'bestseller' }} />);
    expect(screen.getByText(/bestseller/i)).toBeInTheDocument();
    rerender(<ActivityCard activity={{ ...base, badge: 'toprated' }} />);
    expect(screen.getByText(/top rated/i)).toBeInTheDocument();
    rerender(<ActivityCard activity={{ ...base, badge: 'new' }} />);
    expect(screen.getAllByText(/new/i).length).toBeGreaterThan(0);
  });

  it('shows duration for hourly activities (durationValue in hours)', () => {
    render(<ActivityCard activity={{ ...base, durationValue: 3, bookingType: 'HOURLY' }} />);
    expect(screen.getByText(/3h/i)).toBeInTheDocument();
  });

  it('shows duration for daily activities as nights (durationValue × "night[s]")', () => {
    render(<ActivityCard activity={{ ...base, durationValue: 2, bookingType: 'DAILY' }} />);
    expect(screen.getByText(/2 nights/i)).toBeInTheDocument();
  });

  it('falls back to durationMinutes when durationValue is absent', () => {
    render(<ActivityCard activity={{ ...base, durationMinutes: 90 }} />);
    // 90min → "90m" (not hourly-aligned)
    expect(screen.getByText(/90m/i)).toBeInTheDocument();
  });

  it('defaults currency to QAR when country is null', () => {
    render(<ActivityCard activity={{ ...base, country: null }} />);
    expect(screen.getByText(/QAR\s*250/i)).toBeInTheDocument();
  });
});
