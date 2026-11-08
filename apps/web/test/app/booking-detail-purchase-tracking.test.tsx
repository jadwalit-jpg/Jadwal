/**
 * /bookings/[id] — purchase measurement must never fire for a cancelled booking.
 *
 * The page sends GA4 `purchase`, Clarity `purchase_success` and the Meta Pixel
 * `Purchase` only when the booking is CONFIRMED. An admin cancel (or any
 * cancel) leaves the booking CANCELLED, and the customer may well open the
 * page afterwards; none of the three events may fire then. The CONFIRMED case
 * is kept as the positive control, so the test would catch a regression in
 * either direction.
 */
import { render, screen } from '@testing-library/react';

const BOOKING_ID = 'b0a3c6ab-7c0e-4a51-9e26-3c0d6f3c1f11';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: string | { defaultValue?: string }) => (typeof opts === 'string' ? opts : opts?.defaultValue ?? key),
    i18n: { language: 'en' },
  }),
  // @/lib/i18n registers this plugin at import time.
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
// Boots the real i18next instance at import time; the page only needs the message helper.
jest.mock('@/lib/api-error', () => ({ getApiError: (_e: unknown, fallback: string) => fallback }));
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: BOOKING_ID }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), refresh: jest.fn() }),
  usePathname: () => `/bookings/${BOOKING_ID}`,
  useSearchParams: () => new URLSearchParams(),
}));
const useQueryMock = jest.fn();
jest.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useQueryClient: () => ({ invalidateQueries: jest.fn().mockResolvedValue(undefined) }),
}));
jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn().mockResolvedValue({ data: {} }), post: jest.fn().mockResolvedValue({ data: {} }), delete: jest.fn() },
}));
const fbTrack = jest.fn();
jest.mock('@/lib/fb-pixel', () => ({ fbTrack: (...a: unknown[]) => fbTrack(...a), FB_PIXEL_ID: 'test' }));
jest.mock('@/lib/gtag', () => ({ GA4_MEASUREMENT_ID: 'G-TEST', GOOGLE_ADS_ID: 'AW-TEST', googleAdsConversion: jest.fn() }));
jest.mock('@/lib/localize', () => ({
  localized: (obj: Record<string, unknown> | null | undefined, field: string) => (obj?.[`${field}En`] as string | undefined) ?? '',
}));
jest.mock('@/components/navbar', () => ({ __esModule: true, default: () => <nav data-testid="navbar" /> }));
jest.mock('@/components/footer', () => ({ __esModule: true, default: () => <footer data-testid="footer" /> }));
jest.mock('@/components/booking-email-otp-modal', () => ({ BookingEmailOtpModal: () => null }));
jest.mock('@/components/toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));

import BookingDetailPage from '../../src/app/bookings/[id]/page';

function booking(status: 'CONFIRMED' | 'CANCELLED', extra: Record<string, unknown> = {}) {
  return {
    id: BOOKING_ID,
    ref: 'JDWL-TRK01',
    status,
    activityId: 'act-1',
    startDatetime: '2026-12-20T14:00:00.000Z',
    endDatetime: '2026-12-21T11:00:00.000Z',
    guests: 2,
    totalPrice: '500',
    serviceFee: '5',
    currencyCode: 'QAR',
    couponDiscount: '0',
    pointsRedeemed: 0,
    pointsDiscount: '0',
    reservedUntil: null,
    emailOtpVerifiedAt: '2026-12-01T10:00:00.000Z',
    createdAt: '2026-12-01T10:00:00.000Z',
    cancelledAt: status === 'CANCELLED' ? '2026-12-02T09:00:00.000Z' : null,
    cancelledBy: status === 'CANCELLED' ? 'ADMIN' : null,
    refundDecisionAt: status === 'CANCELLED' ? '2026-12-02T09:00:00.000Z' : null,
    refundDecisionActor: status === 'CANCELLED' ? 'ADMIN' : null,
    refundDecisionNote: null,
    selectedExtras: null,
    activity: {
      titleEn: 'Overnight Desert Safari', titleAr: 'سفاري', slug: 'overnight-desert-safari-qatar',
      bookingType: 'DAILY', checkInTime: '14:00', checkOutTime: '11:00',
      locationAddress: 'Sealine, Qatar', coverImage: null,
      country: { currencyCode: 'QAR', nameEn: 'Qatar' },
    },
    vendor: { businessNameEn: 'Desert Co', slug: 'desert-co' },
    payment: {
      id: 'pay-1', amount: '505', method: 'CARD', paidAt: '2026-12-01T10:05:00.000Z',
      status: status === 'CANCELLED' ? 'REFUNDED' : 'SUCCESS',
      refundAmount: status === 'CANCELLED' ? '505' : null, refundedAt: status === 'CANCELLED' ? '2026-12-02T09:00:00.000Z' : null,
    },
    ...extra,
  };
}

function renderWith(status: 'CONFIRMED' | 'CANCELLED') {
  useQueryMock.mockImplementation((opts: { queryKey?: unknown[] }) => {
    const key = Array.isArray(opts?.queryKey) ? opts.queryKey[0] : undefined;
    if (key === 'booking') return { data: booking(status), isLoading: false, isError: false };
    return { data: undefined, isLoading: false, isError: false };
  });
  return render(<BookingDetailPage />);
}

// The page reads window.gtag / window.clarity, installed by the tag loaders.
const tags = window as unknown as { gtag?: jest.Mock; clarity?: jest.Mock };

describe('/bookings/[id] purchase tracking', () => {
  let gtag: jest.Mock;
  let clarity: jest.Mock;

  beforeEach(() => {
    sessionStorage.clear();
    fbTrack.mockClear();
    gtag = jest.fn();
    clarity = jest.fn();
    tags.gtag = gtag;
    tags.clarity = clarity;
  });
  afterEach(() => {
    delete tags.gtag;
    delete tags.clarity;
  });

  it('a cancelled booking never fires GA4 purchase, Clarity purchase_success or Meta Purchase', () => {
    renderWith('CANCELLED');
    expect(screen.getByText('Overnight Desert Safari')).toBeInTheDocument();
    expect(gtag).not.toHaveBeenCalledWith('event', 'purchase', expect.anything());
    expect(gtag.mock.calls.filter(([, name]) => name === 'purchase')).toHaveLength(0);
    expect(clarity).not.toHaveBeenCalled();
    expect(fbTrack).not.toHaveBeenCalled();
    // Nothing was marked as "already sent" either, so a later confirmed view is not suppressed by mistake.
    expect(sessionStorage.getItem(`ga_purchase_${BOOKING_ID}`)).toBeNull();
    expect(sessionStorage.getItem(`clarity_purchase_${BOOKING_ID}`)).toBeNull();
    expect(sessionStorage.getItem(`fb_purchase_${BOOKING_ID}`)).toBeNull();
  });

  it('positive control: a confirmed booking fires all three once', () => {
    renderWith('CONFIRMED');
    expect(gtag).toHaveBeenCalledWith('event', 'purchase', expect.objectContaining({
      send_to: 'G-TEST', transaction_id: BOOKING_ID, value: 505, currency: 'QAR',
    }));
    expect(gtag.mock.calls.filter(([, name]) => name === 'purchase')).toHaveLength(1);
    expect(clarity).toHaveBeenCalledWith('event', 'purchase_success');
    expect(clarity).toHaveBeenCalledTimes(1);
    expect(fbTrack).toHaveBeenCalledWith('Purchase', { currency: 'QAR', value: 505 });
    expect(fbTrack).toHaveBeenCalledTimes(1);
  });
});
