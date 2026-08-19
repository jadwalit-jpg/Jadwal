/**
 * Instagram glyph.
 *
 * lucide-react v1 removed every brand/social icon (Instagram, Facebook,
 * Twitter, Linkedin, Youtube) — see Lucide's BRAND_LOGOS_STATEMENT — so it can
 * no longer be imported from the package. We still link to our own Instagram
 * profile from the footer and the contact page, so the glyph is re-declared
 * here.
 *
 * The path data below is copied VERBATIM from lucide-react 0.477.0
 * (dist/esm/icons/instagram.js) and rendered through Lucide's own
 * `createLucideIcon` factory, so stroke width, linecap, viewBox and the
 * `size`/`className`/`color` props behave exactly as before — a pixel-identical
 * swap, not a redraw.
 *
 * ── Attribution ───────────────────────────────────────────────────────────
 * The ISC licence requires the copyright and permission notice to appear in
 * all copies of the covered work, so it is reproduced in full here rather
 * than merely referenced:
 *
 *   ISC License
 *
 *   Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as
 *   part of Feather (MIT). All other copyright (c) for Lucide are held by
 *   Lucide Contributors 2022.
 *
 *   Permission to use, copy, modify, and/or distribute this software for any
 *   purpose with or without fee is hereby granted, provided that the above
 *   copyright notice and this permission notice appear in all copies.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 *   WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 *   MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 *   ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 *   WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 *   ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 *   OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 *
 * The Instagram name and marks are trademarks of Meta. This glyph is used
 * solely to label a link to Jadwal's own Instagram profile (@jadwal.qtr) —
 * nominative use to identify the destination platform, not as branding for
 * Jadwal. That usage is unchanged from what already shipped via lucide-react
 * 0.477.0; this file only preserves it across the v1 upgrade.
 *
 * Import it exactly like the old icon:
 *   import { Instagram } from '@/components/icons/instagram';
 */
import { createLucideIcon } from 'lucide-react';

export const Instagram = createLucideIcon('Instagram', [
  ['rect', { width: '20', height: '20', x: '2', y: '2', rx: '5', ry: '5', key: '2e1cvw' }],
  ['path', { d: 'M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z', key: '9exkf1' }],
  ['line', { x1: '17.5', x2: '17.51', y1: '6.5', y2: '6.5', key: 'r4j83e' }],
]);
