/**
 * Decide whether an admin activity update should carry a `slug` at all.
 *
 * Five activities are live with slugs the old generator produced badly (a stray
 * leading or trailing hyphen), and the tightened SLUG_PATTERN now rejects that
 * shape. The admin form loads the existing slug into its state, so sending it
 * back unchanged would 400 the whole update — meaning an admin could not edit
 * the PRICE of one of those activities without also renaming its URL, a
 * link-breaking change forced by a completely unrelated edit.
 *
 * Omitting the field when it has not changed leaves the stored slug untouched
 * server-side and keeps the validator meaningful for the case it is actually
 * for: a deliberate rename, which an admin does knowingly and which the form
 * warns about.
 */
export function slugPatch(current: string, original: string): { slug?: string } {
  return current !== original ? { slug: current } : {};
}
