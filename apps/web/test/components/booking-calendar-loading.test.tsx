/**
 * BookingCalendar while availability is loading must occupy EXACTLY the same
 * shape as the loaded calendar. The old compact skeleton was ~350px against
 * ~800px loaded on a phone, so every booking page took a 0.267 layout shift
 * when the data arrived (item 8). Height is driven by the number of h-14 day
 * rows, so these tests compare the cell structure, not pixels (jsdom has none).
 */

import React from 'react';
import { render } from '@testing-library/react';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, def?: unknown) =>
      typeof def === 'string' ? def : ((def as { defaultValue?: string })?.defaultValue ?? key),
    i18n: { language: 'en' },
  }),
}));

import BookingCalendar, { type CalendarDay } from '@/components/booking-calendar';

function monthDays(month: string): CalendarDay[] {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => ({
    date: `${month}-${String(i + 1).padStart(2, '0')}`,
    dayOfWeek: 'MON',
    price: 1200,
    isActiveDay: true,
    isPast: false,
    capacity: 1,
    booked: 0,
    available: 1,
    isFullyBooked: false,
  }));
}

function renderCal(isLoading: boolean) {
  const month = '2026-11';
  return render(
    <BookingCalendar
      month={month}
      daysLeft={isLoading ? [] : monthDays(month)}
      daysRight={isLoading ? [] : monthDays('2026-12')}
      onMonthChange={() => {}}
      checkIn={null}
      checkOut={null}
      onDateSelect={() => {}}
      currency="QAR"
      isLoading={isLoading}
    />,
  );
}

describe('BookingCalendar loading state keeps the loaded shape', () => {
  it('renders the same number of h-14 day rows/cells as the loaded calendar', () => {
    const loading = renderCal(true).container;
    const loadingCells = loading.querySelectorAll('.h-14').length;
    const loaded = renderCal(false).container;
    const loadedCells = loaded.querySelectorAll('.h-14').length;
    expect(loadingCells).toBeGreaterThan(0);
    expect(loadingCells).toBe(loadedCells);
  });

  it('keeps the frame (two month titles, nav, legend) while loading, marked busy', () => {
    const { container } = renderCal(true);
    expect(container.querySelectorAll('h3')).toHaveLength(2);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelectorAll('.animate-pulse').length).toBe(30 + 31); // Nov + Dec day slots
  });

  it('shows no pulse placeholders once loaded', () => {
    const { container } = renderCal(false);
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0);
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });
});
