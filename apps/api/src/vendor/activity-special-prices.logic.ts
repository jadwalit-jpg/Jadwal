import { BadRequestException } from '@nestjs/common';
import { isValidDate } from '../bookings/bookings.service';
import type { CreateSpecialPriceDto } from './dto/create-special-price.dto';

// How far ahead a special price may be set (matches the booking horizon used by
// the date pickers). Past dates are rejected — they can't be booked anyway.
export const SPECIAL_PRICE_MAX_ADVANCE_MONTHS = 12;
const MAX_PRICE = 1_000_000;

export interface SpecialPriceActivity {
  id: string;
  vendorId: string;
}

/** Midnight-UTC Date for a YYYY-MM-DD string (the @db.Date column is date-only). */
export function specialPriceDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/**
 * Core "set a per-date special price" logic, shared by the vendor and admin
 * flows so validation can never drift. Idempotent per date: setting a price on
 * a date that already has an active override UPDATES it (the calendar UX is
 * "set the price for this day"), otherwise it creates one. The partial unique
 * index (activityId, date) WHERE deletedAt IS NULL is the DB backstop.
 *
 * The CALLER must resolve + authorise `activity` (vendor → own activities;
 * admin → any) and bust the availability cache afterwards.
 */
export async function createSpecialPriceCore(
  db: any,
  activity: SpecialPriceActivity,
  dto: CreateSpecialPriceDto,
): Promise<{ id: string; date: Date; price: unknown; createdAt: Date; created?: boolean; updated?: boolean }> {
  // Calendar-date sanity beyond the DTO regex (rejects 2026-02-30 etc.).
  if (!isValidDate(dto.date)) throw new BadRequestException('Invalid date');

  const today = new Date().toISOString().slice(0, 10);
  if (dto.date < today) {
    throw new BadRequestException('Cannot set a special price for a past date');
  }

  const maxAhead = new Date();
  maxAhead.setMonth(maxAhead.getMonth() + SPECIAL_PRICE_MAX_ADVANCE_MONTHS);
  if (dto.date > maxAhead.toISOString().slice(0, 10)) {
    throw new BadRequestException(`Cannot set a special price more than ${SPECIAL_PRICE_MAX_ADVANCE_MONTHS} months ahead`);
  }

  // Defence-in-depth on price (the DTO already validated; never trust one layer).
  if (!(dto.price > 0) || dto.price > MAX_PRICE) {
    throw new BadRequestException('Invalid price');
  }

  const date = specialPriceDate(dto.date);
  const existing = await db.activitySpecialPrice.findFirst({
    where: { activityId: activity.id, date, deletedAt: null },
    select: { id: true },
  });

  if (existing) {
    const updated = await db.activitySpecialPrice.update({
      where: { id: existing.id },
      data: { price: dto.price },
      select: { id: true, date: true, price: true, createdAt: true },
    });
    return { ...updated, updated: true };
  }

  const created = await db.activitySpecialPrice.create({
    data: { activityId: activity.id, vendorId: activity.vendorId, date, price: dto.price },
    select: { id: true, date: true, price: true, createdAt: true },
  });
  return { ...created, created: true };
}
