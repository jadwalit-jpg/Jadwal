/**
 * Paid add-ons ("extras") on a listing, as the customer picks them.
 *
 * Three kinds, decided by the listing's add-on settings:
 *   • whole group  — perPerson + wholeGroup: one switch; charged for EVERY
 *                    guest in the booking, following the guest count.
 *   • per person   — perPerson only: a quantity 1..guests.
 *   • per booking  — flat: on or off, quantity 1.
 *
 * The server prices the booking again from the same rules (and, for a
 * whole-group add-on, always uses the booking's guest count whatever the
 * browser sent). This module keeps the browser's preview and payload in step
 * with that. Add-ons are charged once per booking, not per night.
 *
 * Shared by the booking page and the listing page; the listing page hands its
 * choice to the booking page through sessionStorage (`bookingPrefillKey`),
 * the same key the booking page already restores on mount.
 */

export interface ExtraService {
  name: string;
  nameAr?: string;
  price: number;
  perPerson?: boolean;
  wholeGroup?: boolean;
}

export type ExtraMode = 'wholeGroup' | 'perPerson' | 'perBooking';

export function extraMode(svc: ExtraService): ExtraMode {
  if (svc.perPerson && svc.wholeGroup) return 'wholeGroup';
  if (svc.perPerson) return 'perPerson';
  return 'perBooking';
}

/** Only priced add-ons are selectable; price 0 entries are inclusions. */
export function paidExtrasOf(extras: readonly ExtraService[] | null | undefined): ExtraService[] {
  return (extras ?? []).filter((s) => Number(s.price) > 0);
}

/**
 * The selection as the rules allow it for `guests` guests: a whole-group
 * add-on is `guests`, a per-person one is clamped to 1..guests, a per-booking
 * one is 1; names the listing no longer offers, and zero quantities, drop out.
 * Returns the SAME map instance when nothing changes, so React state is left alone.
 */
export function normalizeSelection(
  extras: readonly ExtraService[],
  selected: ReadonlyMap<string, number>,
  guests: number,
): Map<string, number> {
  const g = Math.max(1, Math.floor(guests) || 1);
  const next = new Map<string, number>();
  for (const svc of paidExtrasOf(extras)) {
    const qty = selected.get(svc.name);
    if (!qty || qty <= 0) continue;
    const mode = extraMode(svc);
    next.set(svc.name, mode === 'wholeGroup' ? g : mode === 'perPerson' ? Math.min(Math.max(1, Math.floor(qty)), g) : 1);
  }
  if (next.size === selected.size && [...next].every(([k, v]) => selected.get(k) === v)) {
    return selected as Map<string, number>;
  }
  return next;
}

export interface ExtraLine {
  svc: ExtraService;
  mode: ExtraMode;
  unitPrice: number;
  qty: number;
  total: number;
}

/** One line per chosen add-on (what the price breakdown shows) and their sum. */
export function extrasBreakdown(
  extras: readonly ExtraService[],
  selected: ReadonlyMap<string, number>,
  guests: number,
): { lines: ExtraLine[]; total: number } {
  const normalized = normalizeSelection(extras, selected, guests);
  const lines: ExtraLine[] = [];
  let totalCents = 0;
  for (const svc of paidExtrasOf(extras)) {
    const qty = normalized.get(svc.name);
    if (!qty) continue;
    const unitPrice = Number(svc.price);
    const cents = Math.round(unitPrice * qty * 100);
    totalCents += cents;
    lines.push({ svc, mode: extraMode(svc), unitPrice, qty, total: cents / 100 });
  }
  return { lines, total: totalCents / 100 };
}

/** The booking request's add-on fields: names once each, quantities by name. */
export function selectionToPayload(selected: ReadonlyMap<string, number>): {
  selectedExtras?: string[];
  selectedExtrasQty?: Record<string, number>;
} {
  const names: string[] = [];
  const qty: Record<string, number> = {};
  for (const [name, q] of selected) {
    if (q > 0) { names.push(name); qty[name] = q; }
  }
  return names.length ? { selectedExtras: names, selectedExtrasQty: qty } : {};
}

/** The sessionStorage key the booking page restores on mount (slug-scoped, tab-scoped). */
export const bookingPrefillKey = (slug: string) => `book:${slug}:formState`;

/** The listing page's hand-over to the booking page: guests and the chosen add-ons. */
export function saveBookingPrefill(slug: string, prefill: { guests: number; selectedExtras: ReadonlyMap<string, number> }): void {
  try {
    const existing = sessionStorage.getItem(bookingPrefillKey(slug));
    const base = existing ? (JSON.parse(existing) as Record<string, unknown>) : {};
    sessionStorage.setItem(
      bookingPrefillKey(slug),
      JSON.stringify({ ...base, guests: prefill.guests, selectedExtras: Array.from(prefill.selectedExtras.entries()) }),
    );
  } catch {
    // Private mode or storage full: the customer picks the add-on again on the booking page.
  }
}
