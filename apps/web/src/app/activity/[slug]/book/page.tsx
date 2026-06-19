'use client';

import { LocaleLink as Link } from '@/components/locale-link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Award,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Gift,
  MapPin,
  User,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '@/lib/api';
import { getApiError } from '@/lib/api-error';
import { cn } from '@/lib/utils';
import { sanitizeObject } from '@/lib/validation';
import { localized } from '@/lib/localize';
import { useAuth } from '@/context/auth-context';
import { useGeo } from '@/context/geo-context';
import { useToast } from '@/components/toast';
import { BookingPhoneModal } from '@/components/booking-phone-modal';
import Navbar from '@/components/navbar';
import Footer from '@/components/footer';
import { BookActivityPageSkeleton } from '@/components/ui/skeletons';
import BookingCalendar, { type CalendarDay } from '@/components/booking-calendar';
import { HourRangePicker } from '@/components/hour-range-picker';
import { Button, Stepper } from '@/components/ui';

/* ─── Types ───────────────────────────────────────────────── */

interface ActivityBookingData {
  id: string;
  titleEn: string;
  titleAr: string;
  slug: string;
  pricePerPerson: number;
  capacity: number | null;
  hasUnits: boolean;
  unitCount: number;
  unitCapacity: number;
  coverImage: string | null;
  gallery: string[];
  bookingType: string;
  pricingModel: string;
  durationValue: number | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  activeDays: string[];
  extraServices: { name: string; nameAr?: string; price: number; perPerson?: boolean }[] | null;
  cancellationPolicy: string | null;
  category: { nameEn: string } | null;
  country: { nameEn: string; currencyCode: string; serviceFeeFixed?: number } | null;
  vendor: { businessNameEn: string; slug: string } | null;
}

interface CalendarResponse {
  activityId: string;
  month: string;
  bookingType: string;
  pricingModel: string;
  checkInTime: string;
  checkOutTime: string;
  durationValue: number | null;
  currencyCode: string;
  activeDays: string[];
  hasUnits: boolean;
  units?: { id: string; nameEn: string; nameAr: string; capacity: number }[];
  days: CalendarDay[];
}

interface HourlySlot {
  slotStart: string;
  slotEnd: string;
  isPast?: boolean;
  isBlocked?: boolean;
  capacity?: number | null;
  booked?: number;
  available?: number;
  totalAvailable?: number;
  units?: {
    unitNumber: number;
    capacity: number;
    booked: number;
    available: number;
  }[];
}

interface HourlyResponse {
  date: string;
  bookingType: string;
  slots: HourlySlot[];
}

/* ─── Helpers ─────────────────────────────────────────────── */

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getNextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

function shiftMonth(month: string, dir: -1 | 1): string {
  const [y, m] = month.split('-').map(Number);
  if (dir === 1) return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

function countNights(checkIn: string, checkOut: string): number {
  const a = new Date(checkIn + 'T00:00:00Z');
  const b = new Date(checkOut + 'T00:00:00Z');
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr: string, locale: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime12h(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** Get 3-letter day code from YYYY-MM-DD (matches backend DAYS format) */
const DAY_CODES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
function getDayName(dateStr: string): string {
  return DAY_CODES[new Date(dateStr + 'T00:00:00Z').getUTCDay()];
}

function getTodayStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/* ─── Component ───────────────────────────────────────────── */

export default function BookActivityPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { country: geoCountry } = useGeo();
  const { toast } = useToast();
  const { t, i18n } = useTranslation();
  // Arabic with Latin numerals — date names localise, numbers stay Western to
  // match the calendar cells. Passed to formatDate (the selected-date summary).
  const fmtLocale = i18n.language?.toLowerCase().startsWith('ar') ? 'ar-u-nu-latn' : 'en-US';
  const queryClient = useQueryClient();
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  // Per-booking phone the customer enters via the modal. Distinct from
  // `user.phone` (account-level) — customer may use a different number
  // for this specific booking. Submitted as `bookingPhone` in the
  // create-booking payload; backend DTO @IsNotEmpty enforces it.
  const [bookingPhone, setBookingPhone] = useState('');

  // Shared state
  const [calendarMonth, setCalendarMonth] = useState(getCurrentMonth());
  const initialGuests = Math.max(1, parseInt(searchParams.get('guests') || '1', 10) || 1);
  const [guests, setGuests] = useState(initialGuests);

  // Daily state
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkOut, setCheckOut] = useState<string | null>(null);

  // Hourly state — the customer picks a continuous range on an hour strip.
  // `selectedSlot` is the start tick (HH:00), `selectedSlotEnd` is the end.
  // A legacy single-slot booking is simply start + durationValue hours.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [selectedSlotEnd, setSelectedSlotEnd] = useState<string | null>(null);
  // Kept in sync with the backend's BOOKING_MAX_SLOT_UNITS env cap. A desynced
  // client still falls under the server's authoritative cap at POST time.
  const MAX_SLOT_UNITS_CLIENT = 24;

  // Extra services (paid add-ons) — key: name, value: quantity (per-booking = 1 when selected, per-person = 1..guests)
  const [selectedExtras, setSelectedExtras] = useState<Map<string, number>>(new Map());

  // Vendor coupon (manual code entry)
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; discount: number; discountType: string; discountValue: number } | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState('');

  // Platform voucher (claimed from /offers)
  const [selectedVoucher, setSelectedVoucher] = useState<{ claimId: string; couponId: string; discount: number; discountType: string; discountValue: number; maxDiscount: number | null } | null>(null);

  // Loyalty points redemption
  const [usePoints, setUsePoints] = useState(false);
  const [redeemPoints, setRedeemPoints] = useState(0);

  // ─── Restore form state after login-redirect round-trip ──
  // The handleSubmit path below saves state to sessionStorage right before
  // bouncing to /login. When the user returns authenticated, hydrate the
  // form so they don't have to re-enter dates/guests/coupon. Key is
  // slug-scoped so two tabs booking different activities don't collide.
  // sessionStorage (not localStorage) is tab-scoped — stale state can't
  // leak across tabs or survive browser close.
  const FORM_STATE_KEY = `book:${slug}:formState`;
  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? sessionStorage.getItem(FORM_STATE_KEY) : null;
      if (!raw) return;
      const s = JSON.parse(raw) as {
        guests?: number;
        checkIn?: string | null;
        checkOut?: string | null;
        selectedDate?: string | null;
        selectedSlot?: string | null;
        selectedSlotEnd?: string | null;
        selectedExtras?: [string, number][];
        couponInput?: string;
      };
      if (typeof s.guests === 'number' && s.guests > 0) setGuests(s.guests);
      if (typeof s.checkIn !== 'undefined') setCheckIn(s.checkIn ?? null);
      if (typeof s.checkOut !== 'undefined') setCheckOut(s.checkOut ?? null);
      if (typeof s.selectedDate !== 'undefined') setSelectedDate(s.selectedDate ?? null);
      if (typeof s.selectedSlot !== 'undefined') setSelectedSlot(s.selectedSlot ?? null);
      if (typeof s.selectedSlotEnd !== 'undefined') setSelectedSlotEnd(s.selectedSlotEnd ?? null);
      if (Array.isArray(s.selectedExtras)) setSelectedExtras(new Map(s.selectedExtras));
      if (typeof s.couponInput === 'string') setCouponInput(s.couponInput);
    } catch {
      // Malformed payload — ignore, user just re-enters. No need to alarm.
    } finally {
      try { sessionStorage.removeItem(FORM_STATE_KEY); } catch { /* private mode */ }
    }
    // Run once on mount for this slug. Intentionally narrow dep list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // ─── Fetch activity detail ───────────────────────────────
  const { data: activity, isLoading: activityLoading } = useQuery<ActivityBookingData>({
    queryKey: ['booking-activity', slug],
    queryFn: () => api.get(`/catalog/activities/${slug}`).then(r => r.data),
    staleTime: 5 * 60 * 1000,
    enabled: !!slug,
  });

  // Fetch customer's claimed vouchers
  const { data: myVouchers = [] } = useQuery<{ claimId: string; couponId: string; discountType: string; discountValue: number; maxDiscount: number | null; minOrderAmount: number | null; expiresAt: string }[]>({
    queryKey: ['my-vouchers'],
    queryFn: () => api.get('/offers/my-vouchers').then(r => r.data),
    enabled: !!user,
    staleTime: 60_000,
  });

  // Fetch loyalty points + config
  const { data: loyaltyData } = useQuery<{ loyaltyPoints: number; pointsPerQar: number; qarPerPoint: number; minRedemption: number }>({
    queryKey: ['user-points-checkout'],
    queryFn: () => api.get('/users/points').then(r => r.data),
    enabled: !!user,
    staleTime: 60_000,
  });

  const isHourly = activity?.bookingType === 'HOURLY';
  const isDaily = activity?.bookingType === 'DAILY';

  // ─── Daily: calendar availability ────────────────────────
  const rightMonth = getNextMonth(calendarMonth);

  const { data: calLeft, isLoading: calLeftLoading } = useQuery<CalendarResponse>({
    queryKey: ['calendar', activity?.id, calendarMonth],
    queryFn: () => api.get(`/availability/calendar/${activity!.id}?month=${calendarMonth}`).then(r => r.data),
    staleTime: 60 * 1000,
    enabled: !!activity?.id && isDaily,
  });

  const { data: calRight, isLoading: calRightLoading } = useQuery<CalendarResponse>({
    queryKey: ['calendar', activity?.id, rightMonth],
    queryFn: () => api.get(`/availability/calendar/${activity!.id}?month=${rightMonth}`).then(r => r.data),
    staleTime: 60 * 1000,
    enabled: !!activity?.id && isDaily,
  });

  const calendarLoading = calLeftLoading || calRightLoading;

  // ─── Hourly: calendar + slot availability ────────────────
  const { data: hourlyCalLeft, isLoading: hCalLeftLoading } = useQuery<CalendarResponse>({
    queryKey: ['hourly-cal', activity?.id, calendarMonth],
    queryFn: () => api.get(`/availability/calendar/${activity!.id}?month=${calendarMonth}`).then(r => r.data),
    staleTime: 60 * 1000,
    enabled: !!activity?.id && isHourly,
  });

  const { data: hourlyCalRight, isLoading: hCalRightLoading } = useQuery<CalendarResponse>({
    queryKey: ['hourly-cal', activity?.id, rightMonth],
    queryFn: () => api.get(`/availability/calendar/${activity!.id}?month=${rightMonth}`).then(r => r.data),
    staleTime: 60 * 1000,
    enabled: !!activity?.id && isHourly,
  });

  const hourlyCalendarLoading = hCalLeftLoading || hCalRightLoading;

  // Fetch time slots for the selected date
  const { data: hourlySlots, isLoading: slotsLoading } = useQuery<HourlyResponse>({
    queryKey: ['hourly-slots', activity?.id, selectedDate],
    queryFn: () => api.get(`/availability/hourly/${activity!.id}?date=${selectedDate}`).then(r => r.data),
    staleTime: 30 * 1000,
    enabled: !!activity?.id && isHourly && !!selectedDate,
  });

  // ─── Daily: date selection ───────────────────────────────
  // DAILY durationValue = MINIMUM nights (null/0 = flexible day-by-day booking).
  const minNights = activity?.durationValue ?? null;

  // Checkout date for check-in + minNights — the minimum stay, pre-selected on pick.
  const minCheckout = useCallback(
    (cinStr: string): string => {
      const cin = new Date(cinStr + 'T00:00:00Z');
      cin.setUTCDate(cin.getUTCDate() + (minNights ?? 1));
      return cin.toISOString().split('T')[0];
    },
    [minNights],
  );

  const handleDailyDateSelect = useCallback(
    (date: string) => {
      if (minNights && minNights > 0) {
        // Minimum-stay model: the first pick (or a pick on/before the current
        // check-in) sets check-in and INSTANTLY pre-selects the minimum stay;
        // a pick AFTER check-in extends the stay; a too-short pick snaps back to
        // the minimum. The customer can extend but never drop below the minimum.
        if (!checkIn || date <= checkIn) {
          setCheckIn(date);
          setCheckOut(minCheckout(date));
          return;
        }
        const cin = new Date(checkIn + 'T00:00:00Z');
        const clicked = new Date(date + 'T00:00:00Z');
        const nights = Math.round((clicked.getTime() - cin.getTime()) / 86400000);
        setCheckOut(nights < minNights ? minCheckout(checkIn) : date);
        return;
      }
      // Flexible (no minimum) — standard range picker.
      if (!checkIn || checkOut) {
        setCheckIn(date);
        setCheckOut(null);
      } else if (date <= checkIn) {
        setCheckIn(date);
        setCheckOut(null);
      } else {
        setCheckOut(date);
      }
    },
    [checkIn, checkOut, minNights, minCheckout],
  );

  // ─── Hourly: date selection ──────────────────────────────
  const handleHourlyDateSelect = useCallback(
    (date: string) => {
      // Check if this day is valid (active day + not past + not fully booked)
      if (!activity) return;
      const today = getTodayStr();
      if (date < today) return;
      const dayCode = getDayName(date);
      if (activity.activeDays.length > 0 && !activity.activeDays.some(
        (ad: string) => ad.toUpperCase() === dayCode || ad.toUpperCase().startsWith(dayCode),
      )) return;
      setSelectedDate(date);
      setSelectedSlot(null); // Reset slot on date change
      setSelectedSlotEnd(null);
    },
    [activity],
  );

  // ─── Month navigation ───────────────────────────────────
  const handleMonthChange = useCallback((dir: -1 | 1) => {
    setCalendarMonth((m) => shiftMonth(m, dir));
  }, []);

  // ─── Pricing ─────────────────────────────────────────────
  const currency = activity?.country?.currencyCode ?? 'QAR';
  const price = Number(activity?.pricePerPerson ?? 0);

  // Per-date prices from the loaded calendar months — these already include any
  // special-price overrides (the calendar endpoint applies them). Lets the
  // preview match the server's per-date charge instead of always using the base.
  const priceByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const cal of [calLeft, calRight, hourlyCalLeft, hourlyCalRight]) {
      for (const d of cal?.days ?? []) {
        if (typeof d.price === 'number') m.set(d.date, d.price);
      }
    }
    return m;
  }, [calLeft, calRight, hourlyCalLeft, hourlyCalRight]);

  // Effective per-unit price for the selected date (special override or base).
  // HOURLY books a single date via `selectedDate`; DAILY uses `checkIn` (the
  // total sums each night below). Keying off the wrong one made HOURLY
  // special-price dates fall back to the base price in the preview.
  const priceLookupDate = isHourly ? selectedDate : checkIn;
  const effectivePrice = (priceLookupDate ? priceByDate.get(priceLookupDate) : undefined) ?? price;

  const nights = checkIn && checkOut ? countNights(checkIn, checkOut) : 0;
  const isPerUnit = activity?.pricingModel === 'PER_UNIT';

  const paidExtras = useMemo(() =>
    activity?.extraServices?.filter(s => s.price > 0) ?? [],
    [activity?.extraServices],
  );

  const extrasTotal = useMemo(() => {
    let sum = 0;
    for (const svc of paidExtras) {
      const qty = selectedExtras.get(svc.name);
      if (qty && qty > 0) {
        sum += svc.price * qty;
      }
    }
    return sum;
  }, [paidExtras, selectedExtras]);

  // Total hours the customer is booking. Defaults to the activity's baseline
  // `durationValue` when no end time has been picked (single-slot booking).
  // Capped at durationValue × MAX_SLOT_UNITS_CLIENT so the server's DoS
  // bound doesn't reject a picked range later.
  const slotHours = useMemo(() => {
    const baseline = activity?.durationValue ?? 0;
    if (!selectedSlot || !selectedSlotEnd || baseline <= 0) return baseline;
    const startH = parseInt(selectedSlot.split(':')[0], 10);
    const endH = parseInt(selectedSlotEnd.split(':')[0], 10);
    const hours = endH - startH;
    const maxHours = MAX_SLOT_UNITS_CLIENT * baseline;
    return Math.max(baseline, Math.min(hours, maxHours));
  }, [selectedSlot, selectedSlotEnd, activity?.durationValue]);

  const bookingCost = useMemo(() => {
    let base: number;
    if (isHourly) {
      // Pro-rata hourly pricing — the backend computes the authoritative
      // total as `priceCents × hoursBooked / durationValue` (× guests for
      // PER_PERSON). We mirror that here so the UI preview matches the
      // charge the server records. A tampered slotHours can't get the user
      // a discount because the server re-derives from the datetimes.
      const durHours = activity?.durationValue ?? 1;
      const hours = Math.max(durHours, slotHours);
      const pricePerHour = durHours > 0 ? effectivePrice / durHours : effectivePrice;
      base = isPerUnit ? pricePerHour * hours : pricePerHour * guests * hours;
    } else {
      // DAILY: sum each night's price (special override or base) so the preview
      // matches the server, which prices each night by its own date.
      if (checkIn && checkOut && nights > 0) {
        const start = new Date(`${checkIn}T00:00:00Z`).getTime();
        base = 0;
        for (let i = 0; i < nights; i++) {
          const ds = new Date(start + i * 86400000).toISOString().slice(0, 10);
          base += priceByDate.get(ds) ?? price;
        }
      } else {
        base = effectivePrice * Math.max(1, nights);
      }
    }
    return base + extrasTotal;
  }, [isHourly, isPerUnit, effectivePrice, guests, nights, slotHours, extrasTotal, activity?.durationValue, checkIn, checkOut, price, priceByDate]);

  // Per-night prices for the DAILY breakdown label — so a stay mixing special and
  // normal nights is shown explicitly (e.g. "2000 + 300") instead of a misleading
  // flat "rate × N nights". The total above already sums these.
  const dailyNightPrices = useMemo(() => {
    if (isHourly || !checkIn || !checkOut || nights <= 0) return [] as number[];
    const start = new Date(`${checkIn}T00:00:00Z`).getTime();
    return Array.from({ length: nights }, (_, i) => {
      const ds = new Date(start + i * 86400000).toISOString().slice(0, 10);
      return priceByDate.get(ds) ?? price;
    });
  }, [isHourly, checkIn, checkOut, nights, priceByDate, price]);
  const dailyMixedNightly = useMemo(() => new Set(dailyNightPrices).size > 1, [dailyNightPrices]);

  // ─── Loyalty points calculations ────────────────────────
  // Service fee is platform revenue, normally added on top of bookingCost.
  // When the customer redeems enough Wanasa points to fully cover the
  // activity price (post-coupon), the platform waives this fee as a
  // loyalty incentive — the backend mirrors this rule when creating the
  // booking. Partial redemptions keep the fee intact.
  const serviceFee = Number(activity?.country?.serviceFeeFixed ?? 0);
  const couponPart = appliedCoupon?.discount ?? selectedVoucher?.discount ?? 0;
  // What the customer would owe for the event itself (post-coupon). This
  // is the ceiling we cap Wanasa redemption against — anything beyond
  // this would land on the (soon-to-be-waived) fee anyway.
  const activityPayable = Math.max(0, bookingCost - couponPart);
  // Wanasa is now all-or-nothing: either the customer has enough points to
  // fully cover the activity (→ book with points, fee waived) or they
  // don't (→ the option is disabled with a clear "not enough" message).
  // No slider, no partial redemption from the UI.
  const qarPerPoint = loyaltyData?.qarPerPoint ?? 0.01;
  const requiredPoints = activityPayable > 0 && qarPerPoint > 0
    ? Math.ceil(activityPayable / qarPerPoint)
    : 0;
  const minRedemption = loyaltyData?.minRedemption ?? 1;
  // Show the Wanasa block only when redemption is configured AND the
  // required points are above the minimum (tiny bookings that need fewer
  // points than the floor shouldn't show this option at all).
  const canRedeemPoints = !!(
    loyaltyData && loyaltyData.qarPerPoint > 0 &&
    requiredPoints > 0 && requiredPoints >= minRedemption
  );
  const hasEnoughPoints = !!(loyaltyData && loyaltyData.loyaltyPoints >= requiredPoints);

  const pointsDiscount = useMemo(() => {
    if (!usePoints || !loyaltyData || redeemPoints <= 0) return 0;
    // Matches backend cap: points never discount more than the activity price.
    return Math.min(redeemPoints * qarPerPoint, activityPayable);
  }, [usePoints, loyaltyData, redeemPoints, qarPerPoint, activityPayable]);

  // When redemption fully covers the activity, platform waives the service
  // fee. This flag drives both the breakdown display (fee line hidden) and
  // the total computation.
  const serviceFeeWaived = usePoints && pointsDiscount >= activityPayable && pointsDiscount > 0;
  const effectiveServiceFee = serviceFeeWaived ? 0 : serviceFee;
  const grossPayable = bookingCost + effectiveServiceFee;

  // Cash still owed after coupon + points. 0 means "fully paid with points"
  // — the CTA and summary treat this specially to signal no PAY2M step.
  const cashDue = useMemo(() => {
    const gross = Math.max(0, grossPayable - couponPart - pointsDiscount);
    // Round to 2dp to match backend cents arithmetic
    return Math.round(gross * 100) / 100;
  }, [grossPayable, couponPart, pointsDiscount]);
  const isPointsOnly = usePoints && cashDue === 0 && pointsDiscount > 0;

  // Binary Wanasa mode: toggle ON → redeem exactly the points needed to
  // cover the activity price; toggle OFF → clear. No slider, no partial.
  // Also defensively clears the selection if the user toggles ON without
  // enough balance (the button guards against this, but if requiredPoints
  // shifts afterwards — e.g. guest count bumps the price — we bail out
  // cleanly rather than submit an insufficient amount).
  useEffect(() => {
    if (!usePoints) {
      if (redeemPoints !== 0) setRedeemPoints(0);
      return;
    }
    if (!hasEnoughPoints) {
      if (usePoints) setUsePoints(false);
      if (redeemPoints !== 0) setRedeemPoints(0);
      return;
    }
    if (redeemPoints !== requiredPoints) {
      setRedeemPoints(requiredPoints);
    }
  }, [usePoints, hasEnoughPoints, requiredPoints, redeemPoints]);

  // ─── Max guests ──────────────────────────────────────────
  // When the activity has units, cap at unitCapacity (one booking = one unit)
  const perUnitCap = activity?.hasUnits && activity.unitCapacity > 0
    ? activity.unitCapacity
    : null;

  // Helper — availability of a single hourly slot object (handles both unit and
  // flat activities, returns null when unknown).
  const slotAvailOf = useCallback((slot: HourlySlot | undefined): number | null => {
    if (!slot) return null;
    if (typeof slot.available === 'number' && slot.available !== Infinity) return slot.available;
    if (typeof slot.totalAvailable === 'number') return slot.totalAvailable;
    return null;
  }, []);

  // Peak-concurrent capacity across the current range = min(available) across
  // the covered non-overlapping slots. Mirrors the server's
  // maxConcurrentInWindow sweep on a tiled range.
  const maxGuests = useMemo(() => {
    if (isHourly && selectedSlot && hourlySlots && activity?.durationValue) {
      const duration = activity.durationValue;
      const startH = parseInt(selectedSlot.split(':')[0], 10);
      const endHour = selectedSlotEnd
        ? parseInt(selectedSlotEnd.split(':')[0], 10)
        : startH + duration;
      let minAvail: number | null = null;
      for (let h = startH; h < endHour; h += duration) {
        const hh = `${String(h).padStart(2, '0')}:00`;
        const slot = hourlySlots.slots.find((s) => s.slotStart === hh);
        const a = slotAvailOf(slot);
        if (a === null) continue;
        minAvail = minAvail === null ? a : Math.min(minAvail, a);
      }
      if (minAvail !== null) {
        return perUnitCap ? Math.min(perUnitCap, minAvail) : minAvail;
      }
    }
    if (perUnitCap) return perUnitCap;
    if (activity?.capacity) return activity.capacity;
    return 99;
  }, [activity, isHourly, selectedSlot, selectedSlotEnd, hourlySlots, perUnitCap, slotAvailOf]);

  // Clamp guests when maxGuests shrinks (e.g. switching slot or activity with units)
  useEffect(() => {
    setGuests(g => Math.min(g, maxGuests) || 1);
  }, [maxGuests]);

  // Clamp per-person extra quantities when guests decrease
  useEffect(() => {
    setSelectedExtras(prev => {
      let changed = false;
      const next = new Map(prev);
      for (const [name, qty] of next) {
        const svc = paidExtras.find(s => s.name === name);
        if (svc?.perPerson && qty > guests) {
          next.set(name, guests);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [guests, paidExtras]);

  // ─── Can submit ──────────────────────────────────────────
  const canSubmit = useMemo(() => {
    if (!activity || guests < 1) return false;
    if (isHourly) return !!selectedDate && !!selectedSlot;
    return !!checkIn && !!checkOut;
  }, [activity, guests, isHourly, selectedDate, selectedSlot, checkIn, checkOut]);

  // ─── Coupon validation ──────────────────────────────────
  const handleApplyCoupon = async () => {
    if (!couponInput.trim() || !activity) return;
    setCouponLoading(true);
    setCouponError('');
    try {
      const { data } = await api.get('/bookings/validate-coupon', {
        params: { code: couponInput.trim(), activityId: activity.id, amount: bookingCost },
      });
      setAppliedCoupon({ code: data.code, discount: data.discount, discountType: data.discountType, discountValue: data.discountValue });
      toast(t('activity.toast.couponApplied', { amount: data.discount.toFixed(2) }), 'success');
    } catch (err) {
      setAppliedCoupon(null);
      setCouponError(getApiError(err, 'Invalid coupon'));
    } finally {
      setCouponLoading(false);
    }
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponInput('');
    setCouponError('');
  };

  // Generated once per form session. Stable across retries (double-click, network
  // hiccup). The backend returns the existing booking if this key was already used.
  const idempotencyKey = useRef(crypto.randomUUID()).current;

  // ─── Submit booking ──────────────────────────────────────
  const bookMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post('/bookings', payload).then(r => r.data),
    onSuccess: (data) => {
      const bookingId = data?.booking?.id;
      // Invalidate every cached view that now has stale data so the user
      // sees the fresh state immediately after navigating away. Without
      // this the infinite-query list at /bookings serves the 30s-stale
      // cache and the new booking appears missing until a manual refresh.
      //
      // refetchType: 'all' forces TanStack to refetch INACTIVE queries too
      // — the /bookings list is unmounted right now, so the default
      // ('active') would only flag it stale and wait for mount. We want
      // the request in-flight the moment the user lands on /bookings.
      queryClient.invalidateQueries({ queryKey: ['my-bookings'], refetchType: 'all' });
      // Loyalty balance changed (points redeemed + earn preview). Both
      // keys exist across the app; invalidate both to be safe.
      queryClient.invalidateQueries({ queryKey: ['user-points-checkout'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['loyalty'], refetchType: 'all' });
      // Availability: seat consumed. Refreshes calendar heat map + slot
      // list so the next customer (or a back-navigation to same activity)
      // doesn't see the now-unavailable slot as free.
      queryClient.invalidateQueries({ queryKey: ['hourly-slots'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['hourly-cal'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['calendar'], refetchType: 'all' });
      router.push(`/bookings/${bookingId}`);
    },
    onError: (err) => {
      toast(getApiError(err, 'Failed to create booking'), 'error');
    },
  });

  const handleSubmit = () => {
    if (!user) {
      // Save everything the user has picked so the redirect round-trip
      // doesn't force them to re-enter it. useEffect above hydrates from
      // the same key on mount and clears it. sessionStorage is tab-scoped,
      // so stale state can't leak across tabs or survive the browser.
      try {
        sessionStorage.setItem(
          FORM_STATE_KEY,
          JSON.stringify({
            guests,
            checkIn,
            checkOut,
            selectedDate,
            selectedSlot,
            selectedSlotEnd,
            selectedExtras: Array.from(selectedExtras.entries()),
            couponInput,
          }),
        );
      } catch {
        // Private mode / quota — degrade gracefully (user re-enters).
      }
      router.push(`/login?callbackUrl=/activity/${slug}/book`);
      return;
    }
    // Gate: customer must supply a per-booking phone before we hit the
    // backend. The modal collects + normalises to E.164, writes into the
    // `bookingPhone` state, AND directly invokes submitWithPhone() — so the
    // customer doesn't have to click "Continue to Pay" a second time after
    // the modal closes (a setState batch would have left `bookingPhone`
    // empty for the rest of this tick anyway).
    if (!bookingPhone) {
      setShowPhoneModal(true);
      return;
    }
    submitWithPhone(bookingPhone);
  };

  // Phone-arg-passed submit. Called from handleSubmit() once bookingPhone
  // is already in state, AND directly from the modal's onSubmit so the
  // freshly-entered phone is used immediately (no second click).
  const submitWithPhone = (phone: string) => {
    if (!activity || !canSubmit) return;

    // Build extras array: repeat name by quantity for per-person, or send once for per-booking
    const extrasArr: string[] = [];
    for (const [name, qty] of selectedExtras) {
      if (qty > 0) extrasArr.push(name);
    }
    const extras = extrasArr.length > 0 ? extrasArr : undefined;
    // Send quantities separately so backend knows how many of each
    const extrasQty: Record<string, number> = {};
    for (const [name, qty] of selectedExtras) {
      if (qty > 0) extrasQty[name] = qty;
    }

    if (isHourly) {
      bookMutation.mutate(sanitizeObject({
        activityId: activity.id,
        checkInDate: selectedDate,
        slotTime: selectedSlot,
        // Only send slotEndTime when the customer picked a range longer than
        // the activity's baseline duration — keeps the legacy single-slot
        // request shape for backward compatibility.
        ...(selectedSlotEnd && slotHours > (activity.durationValue ?? 0)
          ? { slotEndTime: selectedSlotEnd }
          : {}),
        guests,
        bookingPhone: phone,
        selectedExtras: extras,
        selectedExtrasQty: Object.keys(extrasQty).length > 0 ? extrasQty : undefined,
        couponCode: appliedCoupon?.code || undefined,
        voucherId: selectedVoucher?.claimId || undefined,
        redeemPoints: usePoints && redeemPoints > 0 ? redeemPoints : undefined,
        idempotencyKey,
      }));
    } else {
      bookMutation.mutate(sanitizeObject({
        activityId: activity.id,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        guests,
        bookingPhone: phone,
        selectedExtras: extras,
        selectedExtrasQty: Object.keys(extrasQty).length > 0 ? extrasQty : undefined,
        couponCode: appliedCoupon?.code || undefined,
        voucherId: selectedVoucher?.claimId || undefined,
        redeemPoints: usePoints && redeemPoints > 0 ? redeemPoints : undefined,
        idempotencyKey,
      }));
    }
  };

  // ─── Loading state ──────────────────────────────────────
  // Shape skeleton composed with Navbar — same component the route-level
  // loading.tsx renders, so the cold-navigation flash flows continuously
  // into this state with no spinner-to-skeleton jump.
  if (activityLoading) {
    return (
      <div className="min-h-screen bg-jadwal-bg font-outfit">
        <Navbar variant="solid" />
        <BookActivityPageSkeleton />
      </div>
    );
  }

  if (!activity) {
    return (
      <div className="min-h-screen bg-jadwal-bg font-outfit">
        <Navbar variant="solid" />
        <div className="pt-24 max-w-6xl mx-auto px-4 sm:px-6 text-center py-20">
          <p className="text-jadwal-text-muted">{t('activity.notFound')}</p>
          <Link
            href="/explore"
            className="text-jadwal-primary hover:underline text-sm mt-2 inline-block"
          >
            {t('activity.backToExplore')}
          </Link>
        </div>
      </div>
    );
  }

  const coverSrc = activity.coverImage || activity.gallery?.[0];

  return (
    <div className="min-h-screen bg-jadwal-bg font-outfit text-jadwal-text">
      <Navbar variant="solid" />

      <div className="pt-24 max-w-6xl mx-auto px-4 sm:px-6 pb-16">
        {/* Back link + title */}
        <Link
          href={`/activity/${slug}`}
          className="inline-flex items-center gap-1.5 text-sm text-jadwal-text-muted hover:text-jadwal-primary transition-colors mb-2.5"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          <span className="truncate max-w-[40ch]">
            {localized(activity, 'title')}
          </span>
        </Link>
        <h1 className="font-display text-[22px] md:text-[30px] font-semibold tracking-[-0.8px] text-jadwal-text leading-[1.2] m-0">
          {t('booking.confirmAndPay')}
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 md:gap-8 mt-6 md:mt-8">
          {/* ─── Left Column — Booking Form ──────────────── */}
          <div className="lg:col-span-3 space-y-5">
            {/* Booking Type Badge */}
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-jadwal-surface-raised border border-jadwal-border-subtle text-jadwal-text text-sm font-medium shadow-jadwal">
                {isHourly ? (
                  <>
                    <Clock className="h-3.5 w-3.5 text-jadwal-primary" aria-hidden="true" />
                    {activity.durationValue
                      ? `${activity.durationValue}h ${t('home.perUnit')}`
                      : t('activity.hourlyBooking')}
                    <span className="text-jadwal-text-faint">·</span>
                    <span className="tabular-nums">
                      {currency} {effectivePrice.toFixed(0)} /{' '}
                      {isPerUnit ? t('activity.unit') : t('activity.person')}
                    </span>
                  </>
                ) : (
                  <>
                    <Calendar className="h-3.5 w-3.5 text-jadwal-primary" aria-hidden="true" />
                    {minNights
                      ? `${t('activity.minStay', 'Min')} ${minNights} ${minNights > 1 ? t('activity.nights') : t('activity.night')}`
                      : t('activity.dailyBooking')}
                    <span className="text-jadwal-text-faint">·</span>
                    <span className="tabular-nums">
                      {currency} {effectivePrice.toFixed(0)} /{' '}
                      {t('activity.night')}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* ─── HOURLY FLOW ──────────────────────────────── */}
            {isHourly && (
              <>
                {/* Step 1: Select Date */}
                <div>
                  <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-3">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-sky-600 text-white text-xs font-bold me-2">1</span>
                    {t('booking.selectDate')}
                  </h2>
                  <BookingCalendar
                    month={calendarMonth}
                    daysLeft={hourlyCalLeft?.days ?? []}
                    daysRight={hourlyCalRight?.days ?? []}
                    onMonthChange={handleMonthChange}
                    checkIn={selectedDate}
                    checkOut={null}
                    onDateSelect={handleHourlyDateSelect}
                    currency={currency}
                    showPrices={false}
                    isLoading={hourlyCalendarLoading}
                  />
                  {selectedDate && (
                    <p className="mt-3 text-sm text-gray-600 dark:text-slate-300">
                      <span className="text-gray-400 dark:text-slate-500">{t('booking.date')}: </span>
                      <span className="font-medium">{formatDate(selectedDate, fmtLocale)}</span>
                    </p>
                  )}
                </div>

                {/* Step 2: Select Time Slot */}
                <AnimatePresence>
                  {selectedDate && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.3 }}
                    >
                      <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-3">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-sky-600 text-white text-xs font-bold me-2">2</span>
                        {t('booking.selectTime')}
                      </h2>

                      {slotsLoading ? (
                        <div className="p-6 rounded-2xl border border-gray-200/80 dark:border-slate-800/60 bg-white dark:bg-slate-900/50">
                          <div className="flex gap-2 overflow-hidden">
                            {Array.from({ length: 10 }).map((_, i) => (
                              <div key={i} className="h-14 w-16 shrink-0 bg-gray-100 dark:bg-slate-800/60 rounded-xl animate-pulse" />
                            ))}
                          </div>
                        </div>
                      ) : hourlySlots && hourlySlots.slots.filter((s: any) => !s.isPast).length > 0 && activity.checkInTime && activity.checkOutTime && activity.durationValue ? (
                        <div className="p-4 sm:p-6 rounded-2xl border border-gray-200/80 dark:border-slate-800/60 bg-white dark:bg-slate-900/50">
                          <HourRangePicker
                            slots={hourlySlots.slots}
                            checkInTime={activity.checkInTime}
                            checkOutTime={activity.checkOutTime}
                            durationValue={activity.durationValue}
                            guests={guests}
                            maxSlotUnits={MAX_SLOT_UNITS_CLIENT}
                            start={selectedSlot}
                            end={selectedSlotEnd}
                            onChange={(s, e) => {
                              setSelectedSlot(s);
                              setSelectedSlotEnd(e);
                            }}
                            formatTime={formatTime12h}
                            labels={{
                              // i18n interpolation: {{hours}} and {{closing}} are
                              // filled at render time with the activity's actual
                              // durationValue and closing time. Translators only
                              // edit the surrounding sentence.
                              selectStart: t('booking.selectStartTime', {
                                hours: activity.durationValue,
                                defaultValue: 'Tap an hour to start — the next {{hours}}h are auto-selected',
                              }),
                              clear: t('booking.clear', { defaultValue: 'Clear' }),
                              hint: t('booking.hourRangeHint', {
                                hours: activity.durationValue,
                                closing: formatTime12h(activity.checkOutTime),
                                defaultValue: 'Minimum {{hours}}h. Tap a later hour to extend. Closing: {{closing}}.',
                              }),
                              blocked: t('booking.slotBlocked', { defaultValue: 'blocked by host' }),
                              blockedLegend: t('booking.slotBlockedLegend', {
                                defaultValue: 'Times marked with a lock are blocked by the host.',
                              }),
                            }}
                          />
                        </div>
                      ) : (
                        <div className="p-8 rounded-2xl border border-gray-200/80 dark:border-slate-800/60 bg-white dark:bg-slate-900/50 text-center">
                          <Clock className="h-8 w-8 text-gray-300 dark:text-slate-600 mx-auto mb-3" />
                          <p className="text-sm text-gray-500 dark:text-slate-400">{t('booking.noSlotsAvailable')}</p>
                          <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">{t('booking.tryDifferentDate')}</p>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}

            {/* ─── DAILY FLOW ───────────────────────────────── */}
            {isDaily && (
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-3">
                  {t('booking.checkInCheckOut')}
                </h2>
                <BookingCalendar
                  month={calendarMonth}
                  daysLeft={calLeft?.days ?? []}
                  daysRight={calRight?.days ?? []}
                  onMonthChange={handleMonthChange}
                  checkIn={checkIn}
                  checkOut={checkOut}
                  onDateSelect={handleDailyDateSelect}
                  currency={currency}
                  showPrices={false}
                  minNights={minNights}
                  isLoading={calendarLoading}
                />
                {(checkIn || checkOut) && (
                  <div className="mt-3 flex items-center gap-4 text-sm text-gray-600 dark:text-slate-300">
                    {checkIn && (
                      <span>
                        <span className="text-gray-400 dark:text-slate-500">{t('booking.checkIn')}: </span>
                        <span className="font-medium">{formatDate(checkIn, fmtLocale)}</span>
                      </span>
                    )}
                    {checkOut && (
                      <span>
                        <span className="text-gray-400 dark:text-slate-500">{t('booking.checkOut')}: </span>
                        <span className="font-medium">{formatDate(checkOut, fmtLocale)}</span>
                      </span>
                    )}
                    {nights > 0 && (
                      <span className="text-sky-600 dark:text-sky-400 font-medium">
                        {nights} {nights > 1 ? t('activity.nights') : t('activity.night')}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ─── Guests ─────────────────────────────────── */}
            <div>
              <h2 className="text-base font-semibold text-jadwal-text mb-3 flex items-center">
                {isHourly && selectedSlot ? (
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-jadwal-primary text-jadwal-on-primary text-xs font-bold me-2">
                    3
                  </span>
                ) : null}
                <span>
                  {isHourly
                    ? t('activity.tickets', { defaultValue: 'Tickets' })
                    : t('activity.guests')}
                </span>
              </h2>
              <div className="rounded-xl border border-jadwal-border-subtle bg-jadwal-surface p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <User
                    className="h-4 w-4 text-jadwal-primary"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-sm font-medium text-jadwal-text">
                      {isHourly
                        ? t('activity.tickets', { defaultValue: 'Tickets' })
                        : t('activity.guests')}
                    </p>
                  </div>
                </div>
                <Stepper
                  value={guests}
                  min={1}
                  max={maxGuests}
                  onChange={setGuests}
                  ariaLabel={t('activity.guests')}
                />
              </div>
              {guests >= maxGuests && maxGuests < 99 ? (
                <p className="mt-2 text-xs text-jadwal-warning leading-relaxed">
                  {t('activity.guests')}: {maxGuests} max.
                </p>
              ) : null}
            </div>
          </div>

          {/* ─── Right Column — Summary Card (Sticky) ────── */}
          <div className="lg:col-span-2">
            <div className="sticky top-24">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="p-5 md:p-6 rounded-[20px] border border-jadwal-border-subtle bg-jadwal-surface shadow-jadwal-lg"
              >
                {/* Activity Summary */}
                <div className="flex items-start gap-3 mb-6 pb-5 border-b border-gray-100 dark:border-slate-800/60">
                  {coverSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={coverSrc}
                      alt={localized(activity, 'title')}
                      width={64}
                      height={64}
                      loading="lazy"
                      decoding="async"
                      className="w-16 h-16 rounded-xl object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-xl bg-gray-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                      <MapPin className="h-6 w-6 text-gray-300 dark:text-slate-600" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 dark:text-white text-sm leading-tight truncate">
                      {localized(activity, 'title')}
                    </p>
                    {activity.category && (
                      <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5 truncate">
                        {localized(activity.category, 'name')}
                      </p>
                    )}
                    {activity.vendor && (
                      <p className="text-xs text-sky-600 dark:text-sky-400 mt-0.5 truncate">
                        {localized(activity.vendor, 'businessName')}
                      </p>
                    )}
                  </div>
                </div>

                {/* Booking Summary */}
                {(isHourly ? (selectedDate && selectedSlot) : (checkIn && checkOut)) && (
                  <div className="mb-5 pb-4 border-b border-gray-100 dark:border-slate-800/60 space-y-2 text-sm">
                    {isHourly ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500 dark:text-slate-400">{t('booking.date')}</span>
                          <span className="text-gray-900 dark:text-white font-medium">{formatDate(selectedDate!, fmtLocale)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500 dark:text-slate-400">{t('booking.time')}</span>
                          <span className="text-gray-900 dark:text-white font-medium">
                            {formatTime12h(selectedSlot!)}
                            {selectedSlotEnd && slotHours > (activity.durationValue ?? 0) ? (
                              <>
                                {' — '}
                                {formatTime12h(selectedSlotEnd)}
                              </>
                            ) : null}
                            {activity.durationValue && (
                              <span className="text-gray-400 dark:text-slate-500 font-normal ms-1">
                                ({slotHours}h)
                              </span>
                            )}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500 dark:text-slate-400">{t('booking.checkIn')}</span>
                          <span className="text-gray-900 dark:text-white font-medium">{formatDate(checkIn!, fmtLocale)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500 dark:text-slate-400">{t('booking.checkOut')}</span>
                          <span className="text-gray-900 dark:text-white font-medium">{formatDate(checkOut!, fmtLocale)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500 dark:text-slate-400">{t('activity.duration')}</span>
                          <span className="text-sky-600 dark:text-sky-400 font-medium">{nights} {nights > 1 ? t('activity.nights') : t('activity.night')}</span>
                        </div>
                      </>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500 dark:text-slate-400">{t('booking.guests')}</span>
                      <span className="text-gray-900 dark:text-white font-medium">{guests}</span>
                    </div>
                  </div>
                )}

                {/* Optional Add-ons */}
                {paidExtras.length > 0 && (
                  <div className="mb-5 pb-4 border-b border-gray-100 dark:border-slate-800/60">
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-3">{t('activity.optionalAddons')}</h3>
                    <div className="space-y-2">
                      {paidExtras.map((svc) => {
                        const qty = selectedExtras.get(svc.name) ?? 0;
                        const isActive = qty > 0;

                        if (svc.perPerson) {
                          // Per-person extra: quantity selector (0 to guests)
                          return (
                            <div
                              key={svc.name}
                              className={`flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all ${
                                isActive
                                  ? 'border-sky-400 bg-sky-50 dark:bg-sky-900/10 dark:border-sky-700'
                                  : 'border-gray-200 dark:border-slate-800'
                              }`}
                            >
                              <div className="flex flex-col">
                                <span className="text-sm text-gray-700 dark:text-slate-300">{localized(svc, 'name')}</span>
                                <span className="text-[10px] text-gray-400 dark:text-slate-500">{t('activity.each')} · {svc.price} {currency}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                {isActive && (
                                  <span className="text-xs font-medium text-gray-500 dark:text-slate-400">
                                    +{(svc.price * qty).toFixed(0)} {currency}
                                  </span>
                                )}
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedExtras(prev => {
                                      const next = new Map(prev);
                                      if (qty <= 1) next.delete(svc.name);
                                      else next.set(svc.name, qty - 1);
                                      return next;
                                    })}
                                    disabled={qty === 0}
                                    className="w-7 h-7 rounded-lg border border-gray-200 dark:border-slate-700 flex items-center justify-center text-gray-500 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-30 cursor-pointer text-sm"
                                  >
                                    -
                                  </button>
                                  <span className="w-6 text-center text-sm font-semibold text-gray-900 dark:text-white">{qty}</span>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedExtras(prev => {
                                      const next = new Map(prev);
                                      next.set(svc.name, Math.min(guests, qty + 1));
                                      return next;
                                    })}
                                    disabled={qty >= guests}
                                    className="w-7 h-7 rounded-lg border border-gray-200 dark:border-slate-700 flex items-center justify-center text-gray-500 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-30 cursor-pointer text-sm"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        }

                        // Per-booking extra: simple checkbox
                        return (
                          <label
                            key={svc.name}
                            className={`flex items-center justify-between px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${
                              isActive
                                ? 'border-sky-400 bg-sky-50 dark:bg-sky-900/10 dark:border-sky-700'
                                : 'border-gray-200 dark:border-slate-800 hover:border-gray-300 dark:hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center gap-2.5">
                              <input
                                type="checkbox"
                                checked={isActive}
                                onChange={() => {
                                  setSelectedExtras(prev => {
                                    const next = new Map(prev);
                                    if (isActive) next.delete(svc.name);
                                    else next.set(svc.name, 1);
                                    return next;
                                  });
                                }}
                                className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-sky-600 focus:ring-sky-500"
                              />
                              <span className="text-sm text-gray-700 dark:text-slate-300">{svc.name}</span>
                            </div>
                            <span className="text-sm font-semibold text-gray-900 dark:text-white">
                              +{svc.price} {currency}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Price Breakdown */}
                <h3 className="font-semibold text-gray-900 dark:text-white mb-3">{t('booking.priceBreakdown')}</h3>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500 dark:text-slate-400">{t('booking.basePrice')}</span>
                    <span className="text-gray-900 dark:text-white font-medium">
                      {currency} {(bookingCost - extrasTotal) > 0 ? (bookingCost - extrasTotal).toFixed(0) : '—'}
                    </span>
                  </div>
                  {(bookingCost - extrasTotal) > 0 && (
                    <p className="text-xs text-gray-400 dark:text-slate-500 -mt-1 ps-0">
                      {isHourly
                        ? isPerUnit
                          ? `${effectivePrice.toFixed(0)} / ${t('activity.unit')}`
                          : `${effectivePrice.toFixed(0)} × ${guests} ${guests > 1 ? t('activity.tickets') : t('activity.tickets')}`
                        : dailyMixedNightly
                          ? (dailyNightPrices.length <= 6
                              ? dailyNightPrices.map((p) => p.toFixed(0)).join(' + ')
                              : `${nights} ${nights > 1 ? t('activity.nights') : t('activity.night')}`)
                          : `${effectivePrice.toFixed(0)} × ${nights} ${nights > 1 ? t('activity.nights') : t('activity.night')}`
                      }
                    </p>
                  )}
                  {extrasTotal > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500 dark:text-slate-400">{t('booking.extras')}</span>
                      <span className="text-gray-900 dark:text-white font-medium">+{currency} {extrasTotal.toFixed(0)}</span>
                    </div>
                  )}
                  {/* Coupon discount */}
                  {appliedCoupon && (
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-1.5">
                        <span className="text-emerald-600 dark:text-emerald-400">{t('booking.couponCode')} ({appliedCoupon.code})</span>
                        <button type="button" onClick={handleRemoveCoupon} className="text-xs text-gray-400 hover:text-red-500 transition-colors">{t('booking.remove')}</button>
                      </div>
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">-{currency} {appliedCoupon.discount.toFixed(0)}</span>
                    </div>
                  )}
                  {/* Voucher discount */}
                  {selectedVoucher && (
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-1.5">
                        <span className="text-purple-600 dark:text-purple-400">{t('booking.useVoucher')}</span>
                        <button type="button" onClick={() => setSelectedVoucher(null)} className="text-xs text-gray-400 hover:text-red-500 transition-colors">{t('booking.remove')}</button>
                      </div>
                      <span className="text-purple-600 dark:text-purple-400 font-medium">-{currency} {selectedVoucher.discount.toFixed(0)}</span>
                    </div>
                  )}
                </div>

                {/* Vendor coupon code input — only show when logged in and no voucher selected */}
                {!appliedCoupon && !selectedVoucher && user && (
                  <div className="mt-3">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={couponInput}
                        onChange={(e) => { setCouponInput(e.target.value.toUpperCase()); setCouponError(''); }}
                        placeholder={t('booking.couponCode')}
                        maxLength={50}
                        className="flex-1 px-3 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 outline-none focus:border-blue-500 uppercase"
                      />
                      <button
                        type="button"
                        onClick={handleApplyCoupon}
                        disabled={!couponInput.trim() || couponLoading}
                        className="px-4 py-2 bg-gray-900 dark:bg-slate-700 hover:bg-gray-800 dark:hover:bg-slate-600 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-40 cursor-pointer"
                      >
                        {couponLoading ? '...' : t('booking.apply')}
                      </button>
                    </div>
                    {couponError && <p className="text-xs text-red-500 mt-1">{couponError}</p>}
                  </div>
                )}

                {/* Platform voucher toggle — show if customer has claimed vouchers and no vendor coupon applied */}
                {user && myVouchers.length > 0 && !appliedCoupon && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">{t('booking.useVoucher')}</p>
                    {myVouchers.map((v) => {
                      const isSelected = selectedVoucher?.claimId === v.claimId;
                      const label = v.discountType === 'PERCENTAGE'
                        ? `${v.discountValue}% off${v.maxDiscount ? ` (max ${v.maxDiscount})` : ''}`
                        : `${v.discountValue} QAR off`;
                      const tooLow = v.minOrderAmount ? bookingCost < v.minOrderAmount : false;

                      // Calculate voucher discount for preview
                      let vDiscount = 0;
                      if (v.discountType === 'PERCENTAGE') {
                        vDiscount = bookingCost * v.discountValue / 100;
                        if (v.maxDiscount) vDiscount = Math.min(vDiscount, v.maxDiscount);
                      } else {
                        vDiscount = Math.min(v.discountValue, bookingCost);
                      }
                      vDiscount = Math.round(vDiscount * 100) / 100;

                      return (
                        <button
                          key={v.claimId}
                          type="button"
                          disabled={tooLow}
                          onClick={() => {
                            if (isSelected) {
                              setSelectedVoucher(null);
                            } else {
                              setSelectedVoucher({ claimId: v.claimId, couponId: v.couponId, discount: vDiscount, discountType: v.discountType, discountValue: v.discountValue, maxDiscount: v.maxDiscount });
                              setCouponInput('');
                              setCouponError('');
                            }
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border-2 text-sm transition-all cursor-pointer ${
                            isSelected
                              ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
                              : tooLow
                                ? 'border-gray-100 dark:border-slate-800 opacity-50 cursor-not-allowed'
                                : 'border-gray-200 dark:border-slate-700 hover:border-purple-300 dark:hover:border-purple-700'
                          }`}
                        >
                          <span className={`font-medium ${isSelected ? 'text-purple-700 dark:text-purple-300' : 'text-gray-700 dark:text-slate-300'}`}>
                            {label}
                          </span>
                          <span className={`text-xs ${isSelected ? 'text-purple-600 dark:text-purple-400 font-semibold' : 'text-gray-400 dark:text-slate-500'}`}>
                            {isSelected ? `-${vDiscount.toFixed(0)} QAR` : tooLow ? `Min. ${v.minOrderAmount}` : t('booking.apply')}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Loyalty Points Redemption — binary (toggle only, no
                    slider). Enough points → toggle enabled, flip to ON uses
                    exactly requiredPoints to cover the activity and waives
                    the fee. Not enough → toggle locked with a clear
                    "you have X, need Y" message. */}
                {user && canRedeemPoints && bookingCost > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-100 dark:border-slate-800/60">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <Award className="h-4 w-4 text-amber-500 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-700 dark:text-slate-300">
                            {t('loyalty.usePoints', { defaultValue: 'Pay with Wanasa points' })}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                            {hasEnoughPoints
                              ? t('loyalty.needsPoints', {
                                  defaultValue: 'Needs {{n}} points · service fee waived',
                                  n: requiredPoints.toLocaleString(),
                                })
                              : t('loyalty.notEnoughPoints', {
                                  defaultValue: 'You have {{have}} · need {{need}}',
                                  have: (loyaltyData?.loyaltyPoints ?? 0).toLocaleString(),
                                  need: requiredPoints.toLocaleString(),
                                })}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={usePoints}
                        aria-disabled={!hasEnoughPoints}
                        disabled={!hasEnoughPoints}
                        onClick={() => hasEnoughPoints && setUsePoints(!usePoints)}
                        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ${
                          !hasEnoughPoints
                            ? 'bg-gray-200 dark:bg-slate-700 cursor-not-allowed opacity-60'
                            : usePoints
                              ? 'bg-amber-500 cursor-pointer'
                              : 'bg-gray-200 dark:bg-slate-700 cursor-pointer'
                        }`}
                      >
                        <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                          usePoints ? 'translate-x-5' : 'translate-x-0'
                        }`} />
                      </button>
                    </div>
                  </div>
                )}

                {/* Points discount line in breakdown */}
                {usePoints && pointsDiscount > 0 && (
                  <div className="flex items-center justify-between text-sm mt-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-amber-600 dark:text-amber-400">{t('loyalty.pointsDiscount')}</span>
                      <button type="button" onClick={() => { setUsePoints(false); setRedeemPoints(0); }} className="text-xs text-gray-400 hover:text-red-500 transition-colors">{t('booking.remove')}</button>
                    </div>
                    <span className="text-amber-600 dark:text-amber-400 font-medium">-{currency} {pointsDiscount.toFixed(0)}</span>
                  </div>
                )}

                {/* Service fee line — hidden when the customer redeems
                    enough Wanasa points to fully cover the activity price.
                    The platform waives the fee as a loyalty incentive, so
                    showing "QAR 5" alongside "Waived" would be misleading.
                    The waived-fee state renders a purple note instead. */}
                {serviceFee > 0 && !serviceFeeWaived && (
                  <div className="flex items-center justify-between text-sm mt-2">
                    <span className="text-gray-500 dark:text-slate-400">
                      {t('booking.serviceFee', { defaultValue: 'Service fee' })}
                    </span>
                    <span className="text-gray-900 dark:text-white font-medium">
                      {currency} {serviceFee.toFixed(0)}
                    </span>
                  </div>
                )}
                {serviceFeeWaived && serviceFee > 0 && (
                  <div className="flex items-center justify-between text-sm mt-2">
                    <span className="inline-flex items-center gap-1.5 text-purple-600 dark:text-purple-400">
                      {t('booking.serviceFee', { defaultValue: 'Service fee' })}
                    </span>
                    <span className="text-purple-600 dark:text-purple-400 font-medium">
                      {t('booking.feeWaived', { defaultValue: 'Waived with Wanasa' })}
                    </span>
                  </div>
                )}

                {/* Total */}
                <div className="mt-4 pt-4 border-t border-jadwal-border-subtle flex items-baseline justify-between">
                  <span className="font-semibold text-jadwal-text">
                    {t('booking.total')}
                  </span>
                  <span className="font-display text-2xl font-bold tracking-[-0.5px] text-jadwal-text tabular-nums">
                    {bookingCost > 0
                      ? isPointsOnly
                        ? t('booking.paidWithPoints', { defaultValue: 'Paid with points' })
                        : `${currency} ${cashDue.toFixed(0)}`
                      : '—'}
                  </span>
                </div>

                {/* Earn-on-complete preview */}
                {user &&
                loyaltyData &&
                loyaltyData.pointsPerQar > 0 &&
                bookingCost > 0 ? (
                  <div className="mt-3 flex items-center gap-1.5 text-[11px] text-jadwal-accent-text justify-end">
                    <Gift
                      className="h-3 w-3 text-jadwal-accent"
                      aria-hidden="true"
                    />
                    <span>
                      {t('booking.earnOnComplete', {
                        defaultValue:
                          "You'll earn {{n}} points when this completes",
                        n: Math.floor(
                          // Mirror the backend earn basis EXACTLY (bookings.service):
                          // points = floor(afterCouponPrice * pointsPerQar), where
                          // afterCouponPrice = gross - coupon/voucher. The points/cash
                          // split does NOT reduce what's earned — the customer earns on
                          // the full service value either way. Rate is pointsPerQar; the
                          // old code divided by qarPerPoint (a ~100x over-count).
                          Math.max(
                            0,
                            bookingCost -
                              (appliedCoupon?.discount ?? 0) -
                              (selectedVoucher?.discount ?? 0),
                          ) * loyaltyData.pointsPerQar,
                        ),
                      })}
                    </span>
                  </div>
                ) : null}

                {/* Submit — login gate is here, not before */}
                {user?.role === 'ADMIN' || user?.role === 'VENDOR' ? (
                  <div className="mt-5 py-3 px-4 bg-jadwal-surface-muted rounded-xl text-center">
                    <p className="text-sm text-jadwal-text-muted">
                      {user?.role === 'ADMIN'
                        ? t('activity.adminsCannotBook')
                        : t('activity.vendorsCannotBook')}
                    </p>
                  </div>
                ) : (
                  <Button
                    full
                    size="lg"
                    className="mt-5"
                    onClick={handleSubmit}
                    disabled={!canSubmit || bookMutation.isPending}
                    loading={bookMutation.isPending}
                    iconEnd={
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    }
                  >
                    {!user
                      ? t('booking.loginToBook')
                      : isPointsOnly
                        ? t('booking.confirmWithPoints', { defaultValue: 'Confirm booking with Wanasa points' })
                        : t('booking.confirmAndPay')}
                  </Button>
                )}

                <p className="text-[11px] text-jadwal-text-muted text-center mt-3">
                  {t('booking.termsNote', {
                    defaultValue: 'By confirming you agree to our Terms',
                  })}
                </p>
              </motion.div>
            </div>
          </div>
        </div>
      </div>

      <Footer />

      <BookingPhoneModal
        isOpen={showPhoneModal}
        onClose={() => setShowPhoneModal(false)}
        onSubmit={(phone) => {
          // Persist the phone for any subsequent retry/edit AND submit the
          // booking immediately with the freshly-entered value. We can't
          // rely on bookingPhone state here — React batches setState, so
          // a follow-up handleSubmit() in the same tick would still see ''.
          setBookingPhone(phone);
          setShowPhoneModal(false);
          submitWithPhone(phone);
        }}
        initialPhone={user?.phone || ''}
        detectedCountryIso={geoCountry?.isoCode}
      />
    </div>
  );
}
