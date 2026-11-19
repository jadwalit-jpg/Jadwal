/**
 * "You already have a booking for this time slot" (409 from POST /bookings).
 *
 * The server's duplicate guard refuses a second booking while the customer
 * still holds an active one for the same slot: a CONFIRMED booking, or a
 * PENDING one whose 15-minute hold has not expired (an abandoned checkout).
 * The pop-up used to show only that sentence, so the customer kept tapping
 * "Confirm & Pay" and got blocked each time. The response carries no booking
 * id, and the API is left unchanged, so the booking is found from the
 * customer's own list (GET /bookings/my) and the pop-up links straight to it;
 * when nothing matches, it links to My bookings.
 */

export interface MyBookingRow {
  id: string;
  activityId: string;
  status: string;
  /** ISO datetime as the API returns it (local wall-clock tagged UTC). */
  startDatetime: string;
}

/** The duplicate-guard 409, told apart from the other 409s (slot full, slot busy) by its message. */
export function isExistingBookingConflict(status: number, message: unknown): boolean {
  if (status !== 409) return false;
  const text = Array.isArray(message) ? message.join(' ') : String(message ?? '');
  return /already have a booking for this time/i.test(text);
}

/**
 * The booking the guard is talking about: the customer's most recent active
 * booking for this listing, preferring one that starts on the chosen date.
 * `bookings` is the list as the API orders it (newest first).
 */
export function findExistingBookingForSlot(
  bookings: readonly MyBookingRow[],
  activityId: string | undefined,
  chosenDate?: string | null,
): string | null {
  if (!activityId) return null;
  const active = bookings.filter((b) => b.activityId === activityId && (b.status === 'PENDING' || b.status === 'CONFIRMED'));
  if (active.length === 0) return null;
  if (chosenDate) {
    const sameDay = active.find((b) => typeof b.startDatetime === 'string' && b.startDatetime.slice(0, 10) === chosenDate);
    if (sameDay) return sameDay.id;
  }
  return active[0].id;
}

/** Where the pop-up's button goes: the booking itself, or My bookings when it was not found. */
export function existingBookingHref(bookingId: string | null): string {
  return bookingId ? `/bookings/${bookingId}` : '/bookings';
}
