/**
 * Instagram glyph.
 *
 * lucide-react v1 removed every brand/social icon (Instagram, Facebook,
 * Twitter, Linkedin, Youtube) for trademark reasons, so it can no longer be
 * imported from the package. We still link to our Instagram profile from the
 * footer and the contact page, so the glyph is re-declared here.
 *
 * The path data is copied VERBATIM from lucide-react 0.477.0
 * (dist/esm/icons/instagram.js) and rendered through Lucide's own
 * `createLucideIcon` factory, so stroke width, linecap, viewBox and the
 * `size`/`className`/`color` props behave exactly as before — this is a
 * pixel-identical swap, not a redraw. lucide-react is ISC licensed.
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
