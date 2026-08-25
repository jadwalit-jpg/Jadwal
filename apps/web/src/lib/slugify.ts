/**
 * The one slug generator for the whole web app.
 *
 * Slug fields are READ-ONLY in every form — admin activities, vendor
 * activities, admin categories. The value is derived from the English title, so
 * whatever this function returns is what becomes a permanent public URL. There
 * is no manual correction step.
 *
 * WHY THIS EXISTS. Two near-identical copies of this logic were in the codebase
 * and both ended with:
 *
 *     .replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60)
 *
 * which never strips a leading or trailing hyphen. A title with a stray space —
 * easy to leave when pasting — produced a broken slug, and five reached
 * production and the sitemap:
 *
 *     "Catamaran "                              -> catamaran-
 *     "Ghatha Resort "                          -> ghatha-resort-
 *     " Public Al Safliya Island Water Sports " -> -public-al-safliya-island-water-sports-
 *
 * The API now rejects those (see api common/validators/slug-pattern.ts), which
 * stops them reaching the database — but on its own that turns a silent bug into
 * a DEAD END: the vendor sees "invalid slug" on a field they cannot edit, with
 * no hint that the real fix is a trailing space in the title. Trimming here is
 * what makes the generated value always satisfy the API.
 *
 * Keep this in step with SLUG_PATTERN in the API. Anything this returns must
 * pass /^[a-z0-9]+(?:-[a-z0-9]+)*$/ (or be empty, which the forms treat as
 * "title not filled in yet").
 */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      // Drop anything that is not a letter, digit, whitespace or hyphen.
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      // Truncate BEFORE trimming hyphens: slicing can land mid-word and leave a
      // trailing hyphen, so the trim has to come after or it reintroduces the
      // exact bug this function exists to prevent.
      .slice(0, 60)
      .replace(/^-+/, '')
      .replace(/-+$/, '')
  );
}
