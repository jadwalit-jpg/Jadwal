'use client';

/**
 * Customer booking page: the payment reached PAY2M but the site has not been
 * able to confirm it with the bank yet. Tells the customer the money was
 * received, that confirmation is on its way, and not to pay again — with a
 * WhatsApp link prefilled with the booking reference. Rendered in place of the
 * "Awaiting payment" banner, which hides the Pay and Cancel buttons.
 */
import { useTranslation } from 'react-i18next';
import { Clock, MessageCircle } from 'lucide-react';
import { whatsappHref } from '@/lib/whatsapp';

export function BankConfirmingBanner({ bookingRef }: { bookingRef: string }) {
  const { t } = useTranslation();
  const message = t('booking.bankConfirmingWhatsapp', {
    ref: bookingRef,
    defaultValue: 'Hello, my booking {{ref}} shows the payment as pending although I paid. Could you check it?',
  });
  return (
    <div
      data-testid="bank-confirming-banner"
      role="status"
      className="rounded-2xl p-4 bg-sky-500/10 border border-sky-500/25 flex items-start gap-3"
    >
      <Clock className="w-5 h-5 text-jadwal-primary shrink-0 mt-0.5" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-jadwal-primary">
          {t('booking.bankConfirmingTitle', { defaultValue: 'Payment received' })}
        </p>
        <p className="text-xs text-jadwal-primary/80 mt-0.5">
          {t('booking.bankConfirmingDesc', {
            defaultValue:
              'PAY2M received your payment and we are confirming it with your bank. This usually takes a few minutes; we will email you as soon as it is confirmed. Please do not pay again.',
          })}
        </p>
        <a
          href={whatsappHref(message)}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="bank-confirming-whatsapp"
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#25D366] px-4 text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          {t('booking.contactWhatsapp', { defaultValue: 'Chat with us on WhatsApp' })}
        </a>
      </div>
    </div>
  );
}
