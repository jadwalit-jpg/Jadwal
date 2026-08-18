'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, X, ChevronDown } from 'lucide-react';
import { validatePhone } from '@/lib/validation';

/* ─── Country codes ────────────────────────────────────────────
 *
 * Same list used by the old (OTP-based) phone-verification modal.
 * The country code prefix gets concatenated to the local number to
 * produce an E.164 string (`+97455123456`) which is what the booking
 * payload + backend DTO expect.
 */
const COUNTRY_CODES = [
  { code: '+974', iso: 'QA', name: 'Qatar', flag: '🇶🇦' },
  { code: '+966', iso: 'SA', name: 'Saudi Arabia', flag: '🇸🇦' },
  { code: '+971', iso: 'AE', name: 'UAE', flag: '🇦🇪' },
  { code: '+973', iso: 'BH', name: 'Bahrain', flag: '🇧🇭' },
  { code: '+968', iso: 'OM', name: 'Oman', flag: '🇴🇲' },
  { code: '+965', iso: 'KW', name: 'Kuwait', flag: '🇰🇼' },
  { code: '+962', iso: 'JO', name: 'Jordan', flag: '🇯🇴' },
  { code: '+20', iso: 'EG', name: 'Egypt', flag: '🇪🇬' },
  { code: '+44', iso: 'GB', name: 'UK', flag: '🇬🇧' },
  { code: '+1', iso: 'US', name: 'USA', flag: '🇺🇸' },
  { code: '+91', iso: 'IN', name: 'India', flag: '🇮🇳' },
  { code: '+92', iso: 'PK', name: 'Pakistan', flag: '🇵🇰' },
  { code: '+63', iso: 'PH', name: 'Philippines', flag: '🇵🇭' },
  { code: '+880', iso: 'BD', name: 'Bangladesh', flag: '🇧🇩' },
  { code: '+94', iso: 'LK', name: 'Sri Lanka', flag: '🇱🇰' },
  { code: '+977', iso: 'NP', name: 'Nepal', flag: '🇳🇵' },
];

function getDefaultCountry(isoCode?: string) {
  if (isoCode) {
    const match = COUNTRY_CODES.find(c => c.iso === isoCode.toUpperCase());
    if (match) return match;
  }
  return COUNTRY_CODES[0];
}

/* ─── Props ────────────────────────────────────────────────────
 *
 * `onSubmit` receives the normalized E.164 phone string. No SMS
 * gets sent — this modal is now a pure data-collection step that
 * stores the phone in the booking payload. The backend's create-
 * booking DTO does the canonical regex validation; this modal
 * does the same check client-side as a UX hint.
 */
interface BookingPhoneModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (normalizedPhone: string) => void;
  initialPhone?: string;
  detectedCountryIso?: string;
  /** When true, the customer can dismiss without submitting (e.g. profile-edit context). */
  allowSkip?: boolean;
}

export function BookingPhoneModal({
  isOpen,
  onClose,
  onSubmit,
  initialPhone,
  detectedCountryIso,
  allowSkip,
}: BookingPhoneModalProps) {
  const { t } = useTranslation();
  const [selectedCountry, setSelectedCountry] = useState(() => getDefaultCountry(detectedCountryIso));
  const [localNumber, setLocalNumber] = useState('');
  const [error, setError] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Reset state when modal opens. Pre-fill from `initialPhone` (typically
  // User.phone) so repeat customers don't re-type. The `+CC` prefix is
  // matched against the COUNTRY_CODES list and the rest goes into
  // localNumber — so the UI shows the right flag automatically.
  useEffect(() => {
    if (isOpen) {
      setSelectedCountry(getDefaultCountry(detectedCountryIso));
      setError('');
      setShowDropdown(false);
      if (initialPhone && initialPhone.startsWith('+')) {
        const match = COUNTRY_CODES.find(c => initialPhone.startsWith(c.code));
        if (match) {
          setSelectedCountry(match);
          setLocalNumber(initialPhone.slice(match.code.length));
          return;
        }
      }
      setLocalNumber('');
    }
  }, [isOpen, initialPhone, detectedCountryIso]);

  // Close dropdown on outside click.
  useEffect(() => {
    if (!showDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowDropdown(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showDropdown]);

  const handleSubmit = useCallback(() => {
    setError('');
    const cleaned = localNumber.replace(/[\s\-()]/g, '');
    if (!/^[0-9]+$/.test(cleaned)) {
      setError(t('phone.validNumber'));
      return;
    }
    const normalized = `${selectedCountry.code}${cleaned}`;
    // Authoritative shape + length check via the shared validator. For GCC
    // countries it enforces the EXACT national digit count (e.g. Qatar = 8),
    // so a too-short local number like "1234" is rejected even though the
    // country-code prefix would push the total past the generic 7-digit floor.
    // Falls back to the generic E.164 rule (^\+?[0-9]{7,15}$) for non-GCC
    // countries, matching the backend DTO. UX hint only; the DTO is the authority.
    const result = validatePhone(normalized, selectedCountry.iso);
    if (!result.valid) {
      setError(t('phone.tooShortOrLong'));
      return;
    }
    onSubmit(normalized);
  }, [localNumber, selectedCountry, onSubmit, t]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-800 w-full max-w-md mx-4 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-6 pb-2">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-blue-100 dark:bg-blue-900/30">
                <Phone className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {t('phone.addPhone')}
                </h3>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  {t('phone.verifyToBook')}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 transition cursor-pointer"
              aria-label="Close"
            >
              <X className="h-5 w-5 text-gray-400" />
            </button>
          </div>

          <div className="px-6 pb-6 pt-4">
            {error && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-sm text-red-700 dark:text-red-400">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                {t('phone.phoneNumber')}
              </label>
              <div className="flex gap-2">
                <div className="relative" ref={dropdownRef}>
                  <button
                    type="button"
                    onClick={() => setShowDropdown(v => !v)}
                    className="flex items-center gap-1.5 px-3 py-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-900 dark:text-white hover:border-blue-400 transition-all cursor-pointer min-w-[110px]"
                  >
                    <span className="text-base">{selectedCountry.flag}</span>
                    <span className="font-medium">{selectedCountry.code}</span>
                    <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform ms-auto ${showDropdown ? 'rotate-180' : ''}`} />
                  </button>
                  {showDropdown && (
                    <div className="absolute top-full mt-1 inset-s-0 w-64 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-xl z-10 max-h-60 overflow-y-auto">
                      {COUNTRY_CODES.map(c => (
                        <button
                          key={c.iso}
                          type="button"
                          onClick={() => { setSelectedCountry(c); setShowDropdown(false); }}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm text-start hover:bg-gray-50 dark:hover:bg-slate-800 transition cursor-pointer ${
                            c.iso === selectedCountry.iso ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400' : 'text-gray-700 dark:text-slate-300'
                          }`}
                        >
                          <span className="text-base">{c.flag}</span>
                          <span className="font-medium">{c.name}</span>
                          <span className="text-gray-400 dark:text-slate-500 ms-auto">{c.code}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <input
                  type="tel"
                  value={localNumber}
                  onChange={e => setLocalNumber(e.target.value.replace(/[^0-9]/g, ''))}
                  onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
                  placeholder="12345678"
                  maxLength={14}
                  className="flex-1 px-4 py-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                  autoFocus
                />
              </div>
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-1.5">{t('phone.withoutCountryCode')}</p>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!localNumber.trim()}
                className="w-full mt-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
              >
                {t('phone.saveAndContinue')}
              </button>
              {allowSkip && (
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full mt-2 py-2.5 text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300 transition-colors cursor-pointer"
                >
                  {t('phone.skipForNow')}
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
