/**
 * Single source of truth for the support WhatsApp number and the wa.me link
 * format. Server-safe (no React imports) so both client islands (the floating
 * button, the Red Sea page) and server-rendered pages (the SEO landing pages)
 * build identical links.
 *
 * +974 7749 9399 with spaces stripped, no leading plus — wa.me expects digits
 * only (E.164 minus the +).
 */
export const WHATSAPP_NUMBER = '97477499399';

/** `https://wa.me/<number>?text=<url-encoded pre-filled message>` */
export function whatsappHref(text: string): string {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}
