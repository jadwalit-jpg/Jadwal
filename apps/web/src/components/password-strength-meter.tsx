'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { evaluatePassword, type PasswordStrength } from '@/lib/password-strength';

// Segment colour by score (0..4). Same hue family the rest of the app uses.
const SEGMENT_COLOR = [
  'bg-red-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-lime-500',
  'bg-emerald-500',
] as const;

const STRENGTH_KEYS = ['veryWeak', 'weak', 'fair', 'good', 'strong'] as const;
const STRENGTH_FALLBACK = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'] as const;

interface Props {
  /** Current password value (controlled). */
  password: string;
  /** Same identity fields the server penalises on (email, full name, phone). */
  identityParts?: Array<string | undefined | null>;
  /** Fired after each (debounced) evaluation with whether the server would accept it. */
  onResult?: (ok: boolean) => void;
}

/**
 * Live password strength meter. Lazy-loads zxcvbn and evaluates with the SAME
 * rules as the server (see lib/password-strength), so what reads "Strong" here
 * is exactly what the API accepts. Purely informational — the form's submit
 * handler runs the authoritative check.
 */
export default function PasswordStrengthMeter({ password, identityParts = [], onResult }: Props) {
  const { t } = useTranslation();
  const [strength, setStrength] = useState<PasswordStrength | null>(null);

  // Keep the latest onResult without making it an effect dependency (avoids
  // re-running the evaluation when the parent re-renders with a new closure).
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const identityKey = identityParts.filter(Boolean).join('|');

  useEffect(() => {
    if (!password) {
      setStrength(null);
      onResultRef.current?.(false);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      evaluatePassword(password, identityParts)
        .then((res) => {
          if (cancelled) return;
          setStrength(res);
          onResultRef.current?.(res.ok);
        })
        .catch(() => {
          // zxcvbn failed to load — don't block the user; the server still gates.
          if (!cancelled) onResultRef.current?.(true);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
    // identityKey is the stable projection of identityParts; onResult via ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password, identityKey]);

  if (!password || !strength) return null;

  const label = t(`auth.passwordStrength.${STRENGTH_KEYS[strength.score]}`, {
    defaultValue: STRENGTH_FALLBACK[strength.score],
  });
  const tip = strength.warning || strength.suggestions[0] || '';

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i <= strength.score ? SEGMENT_COLOR[strength.score] : 'bg-gray-200 dark:bg-slate-700'
            }`}
          />
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span
          className={`text-xs font-medium ${
            strength.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-slate-400'
          }`}
        >
          {label}
        </span>
        {!strength.ok && (
          <span className="text-xs text-gray-400 dark:text-slate-500">
            {t('auth.passwordStrength.minHint', { defaultValue: 'Use a stronger password' })}
          </span>
        )}
      </div>
      {!strength.ok && tip && <p className="text-xs text-amber-600 dark:text-amber-400">{tip}</p>}
    </div>
  );
}
