'use client';

/**
 * Five tappable stars (44px targets) for the review ask: the pop-up and the
 * /review/<ref> page. Rating only, no comment field (product decision).
 */
import { useState } from 'react';
import { Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export function ReviewStars({
  value,
  onChange,
  disabled = false,
  idPrefix = 'review-star',
}: {
  value: number;
  onChange: (rating: number) => void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const { t } = useTranslation();
  const [hover, setHover] = useState(0);
  return (
    <div role="radiogroup" aria-label={t('reviewAsk.ratingLabel', { defaultValue: 'Your rating' })} className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={value === i}
          aria-label={t('reviewAsk.stars', { count: i, defaultValue: '{{count}} stars' })}
          data-testid={`${idPrefix}-${i}`}
          disabled={disabled}
          onClick={() => onChange(i)}
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(0)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl transition-transform hover:scale-110 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-jadwal-primary/40"
        >
          <Star
            aria-hidden="true"
            className={cn('h-8 w-8 transition-colors', (hover || value) >= i ? 'fill-jadwal-accent text-jadwal-accent' : 'text-jadwal-text-faint')}
          />
        </button>
      ))}
    </div>
  );
}
