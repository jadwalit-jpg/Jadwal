/**
 * Current Terms of Service / Privacy Policy version.
 *
 * Stored on `User.termsAcceptedVersion` when a user accepts. Bump this string
 * whenever the Terms or Privacy Policy change MATERIALLY — every user whose
 * stored version is older (or null) is then re-prompted by the post-login
 * consent gate before they can transact again.
 *
 * Date-based so it's self-documenting. Keep in sync with the version shown /
 * dated in the Terms + Privacy pages.
 */
export const TERMS_VERSION = '2026-06-23';

/** True when the user's stored acceptance matches the current TERMS_VERSION. */
export function hasAcceptedCurrentTerms(
  user: { termsAcceptedAt: Date | null; termsAcceptedVersion: string | null } | null | undefined,
): boolean {
  return !!user?.termsAcceptedAt && user.termsAcceptedVersion === TERMS_VERSION;
}
