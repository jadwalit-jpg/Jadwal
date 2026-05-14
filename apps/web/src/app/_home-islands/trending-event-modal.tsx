/**
 * Modal that shows the full details of a Trending Now event when the user
 * clicks "Read more" on a card whose description is too long to fit in the
 * 2-line clamp on the card itself.
 *
 * Built on the native <dialog> element so we get for free:
 *   - Escape-to-close
 *   - Focus trap (browser handles tabbing within the dialog while it's open)
 *   - Body-scroll lock when opened with showModal()
 *   - role="dialog" + aria-modal="true" semantics without us re-implementing them
 *
 * Backdrop click closes the modal. The close X button is the keyboard target
 * that receives initial focus (browser default for showModal()).
 *
 * No Framer Motion: the homepage chunk explicitly drops framer-motion (see
 * home-below-fold.tsx docstring lines 9-15) — adding it back here would undo
 * that perf work. Native open/close is instant; acceptable trade-off for a
 * detail modal that opens on user click.
 *
 * Mounted permanently in the parent; opens via the `event` prop (null = closed).
 */

'use client';

import Image from 'next/image';
import { useEffect, useRef } from 'react';
import { Calendar, X } from 'lucide-react';
import { localized } from '@/lib/localize';

interface TrendingEvent {
  id: string;
  titleEn: string;
  titleAr: string;
  description: string | null;
  image: string | null;
  eventDate: string | null;
  countryId: string | null;
}

interface TrendingEventModalProps {
  event: TrendingEvent | null;
  onClose: () => void;
  isRtl: boolean;
  closeLabel: string;
}

export function TrendingEventModal({ event, onClose, isRtl, closeLabel }: TrendingEventModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Drive the <dialog>'s open state from the `event` prop. showModal() also
  // engages body-scroll lock + the ::backdrop pseudo + focus management.
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (event && !dlg.open) {
      dlg.showModal();
    } else if (!event && dlg.open) {
      dlg.close();
    }
  }, [event]);

  // <dialog> fires `close` when Escape is pressed (or .close() is called) —
  // sync state back up so the parent's `event` prop matches reality and a
  // subsequent re-open works.
  const handleClose = () => {
    onClose();
  };

  // Backdrop click: when the user clicks outside the inner card, the click
  // target is the <dialog> itself (the backdrop sits on the dialog element).
  // Clicks on the inner content bubble up from .modal-content and are ignored.
  const handleDialogClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={handleClose}
      onClick={handleDialogClick}
      className="
        bg-transparent p-0 m-auto
        max-w-[640px] w-[calc(100vw-2rem)]
        max-h-[calc(100vh-2rem)]
        backdrop:bg-black/70 backdrop:backdrop-blur-sm
      "
      aria-labelledby={event ? `trending-modal-title-${event.id}` : undefined}
    >
      {/* Inner card — only rendered when an event is selected. Avoids the
          aria-labelledby reference dangling when the dialog is closed. */}
      {event ? (
        <div
          className="
            relative flex flex-col overflow-hidden rounded-[20px]
            border border-jadwal-border-subtle bg-jadwal-surface
            text-jadwal-text shadow-jadwal-lg
            max-h-[calc(100vh-2rem)]
          "
          dir={isRtl ? 'rtl' : 'ltr'}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="
              absolute top-3 end-3 z-10
              inline-flex items-center justify-center
              h-9 w-9 rounded-full
              bg-jadwal-bg/80 backdrop-blur-sm
              text-jadwal-text hover:bg-jadwal-bg
              border border-jadwal-border-subtle
              transition-colors
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jadwal-accent
            "
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>

          {event.image ? (
            <div className="relative h-[220px] sm:h-[280px] w-full shrink-0 overflow-hidden">
              <Image
                src={event.image}
                alt={localized(event, 'title')}
                fill
                sizes="(max-width: 640px) calc(100vw - 2rem), 640px"
                priority={false}
                unoptimized={process.env.NODE_ENV !== 'production'}
                className="object-cover"
              />
            </div>
          ) : null}

          <div className="p-5 sm:p-6 overflow-y-auto">
            <h2
              id={`trending-modal-title-${event.id}`}
              className="font-display text-[20px] sm:text-[24px] font-semibold tracking-[-0.4px] text-jadwal-text text-balance mb-3"
            >
              {localized(event, 'title')}
            </h2>

            {event.eventDate ? (
              <div
                className="flex items-center gap-1.5 text-[13px] text-jadwal-text-faint mb-4"
                suppressHydrationWarning
              >
                <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                {new Date(event.eventDate).toLocaleDateString(
                  isRtl ? 'ar-EG' : 'en-US',
                  { month: 'short', day: 'numeric', year: 'numeric' },
                )}
              </div>
            ) : null}

            {event.description ? (
              <p className="text-[14px] sm:text-[15px] text-jadwal-text-muted leading-relaxed whitespace-pre-line">
                {event.description}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
