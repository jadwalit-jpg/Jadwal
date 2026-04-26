'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, Loader2, ShieldCheck, X, ArrowLeft, ChevronDown } from 'lucide-react';
import api from '@/lib/api';
import { getApiError } from '@/lib/api-error';
import { useToast } from '@/components/toast';

/* ─── Country codes ──────────────────────────────────────────── */
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

/* ─── Props ──────────────────────────────────────────────────── */

interface PhoneVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onVerified: () => void;
  initialPhone?: string;
  detectedCountryIso?: string;
  allowSkip?: boolean;
}

export function PhoneVerificationModal({ isOpen, onClose, onVerified, initialPhone, detectedCountryIso, allowSkip }: PhoneVerificationModalProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [selectedCountry, setSelectedCountry] = useState(() => getDefaultCountry(detectedCountryIso));
  const [localNumber, setLocalNumber] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);
  const [fullPhone, setFullPhone] = useState('');
  const { toast } = useToast();
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Reset when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep('phone');
      setSelectedCountry(getDefaultCountry(detectedCountryIso));
      setOtp(['', '', '', '', '', '']);
      setError('');
      setCooldown(0);
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

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowDropdown(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showDropdown]);

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const handleSendOtp = useCallback(async () => {
    setError('');
    const cleaned = localNumber.replace(/[\s\-()]/g, '');
    if (!/^[0-9]{4,14}$/.test(cleaned)) {
      setError(t('phone.validNumber'));
      return;
    }
    const normalized = `${selectedCountry.code}${cleaned}`;
    if (!/^\+[0-9]{7,15}$/.test(normalized)) {
      setError(t('phone.tooShortOrLong'));
      return;
    }
    setSending(true);
    try {
      await api.post('/auth/phone/send-otp', { phone: normalized });
      setFullPhone(normalized);
      setStep('otp');
      setCooldown(60);
      setOtp(['', '', '', '', '', '']);
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    } catch (err) {
      setError(getApiError(err, 'Failed to send verification code'));
    } finally {
      setSending(false);
    }
  }, [localNumber, selectedCountry]);

  const handleVerify = useCallback(async (code: string) => {
    if (code.length !== 6) return;
    setError('');
    setVerifying(true);
    try {
      await api.post('/auth/phone/verify-otp', { code });
      toast('Phone verified successfully!', 'success');
      onVerified();
    } catch (err) {
      setError(getApiError(err, 'Invalid verification code'));
      setOtp(['', '', '', '', '', '']);
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    } finally {
      setVerifying(false);
    }
  }, [onVerified, toast]);

  const handleOtpChange = (index: number, value: string) => {
    if (!/^[0-9]?$/.test(value)) return;
    const next = [...otp];
    next[index] = value;
    setOtp(next);
    if (value && index < 5) otpRefs.current[index + 1]?.focus();
    const full = next.join('');
    if (full.length === 6) handleVerify(full);
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) otpRefs.current[index - 1]?.focus();
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      setOtp(pasted.split(''));
      otpRefs.current[5]?.focus();
      handleVerify(pasted);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    setError('');
    setSending(true);
    try {
      await api.post('/auth/phone/send-otp', { phone: fullPhone });
      setCooldown(60);
      setOtp(['', '', '', '', '', '']);
      toast('New code sent', 'success');
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    } catch (err) {
      setError(getApiError(err, 'Failed to resend code'));
    } finally {
      setSending(false);
    }
  };

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
              {step === 'otp' && (
                <button type="button" onClick={() => setStep('phone')} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 transition cursor-pointer">
                  <ArrowLeft className="h-4 w-4 text-gray-500" />
                </button>
              )}
              <div className="p-2 rounded-xl bg-blue-100 dark:bg-blue-900/30">
                {step === 'phone' ? <Phone className="h-5 w-5 text-blue-600 dark:text-blue-400" /> : <ShieldCheck className="h-5 w-5 text-blue-600 dark:text-blue-400" />}
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {step === 'phone' ? t('phone.addPhone') : t('phone.enterCode')}
                </h3>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  {step === 'phone' ? t('phone.verifyToBook') : `${t('phone.codeSentTo')} ${fullPhone.slice(0, 5)}***${fullPhone.slice(-3)}`}
                </p>
              </div>
            </div>
            {(allowSkip || step === 'phone') && (
              <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 transition cursor-pointer">
                <X className="h-5 w-5 text-gray-400" />
              </button>
            )}
          </div>

          <div className="px-6 pb-6 pt-4">
            {error && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-sm text-red-700 dark:text-red-400">
                {error}
              </div>
            )}

            {step === 'phone' ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">{t('phone.phoneNumber')}</label>
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
                    onKeyDown={e => { if (e.key === 'Enter') handleSendOtp(); }}
                    placeholder="12345678"
                    maxLength={14}
                    className="flex-1 px-4 py-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                    autoFocus
                  />
                </div>
                <p className="text-xs text-gray-400 dark:text-slate-500 mt-1.5">{t('phone.withoutCountryCode')}</p>
                <button
                  type="button"
                  onClick={handleSendOtp}
                  disabled={sending || !localNumber.trim()}
                  className="w-full mt-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {sending ? t('auth.sending') : t('phone.sendCode')}
                </button>
                {allowSkip && (
                  <button type="button" onClick={onClose} className="w-full mt-2 py-2.5 text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300 transition-colors cursor-pointer">
                    {t('phone.skipForNow')}
                  </button>
                )}
              </div>
            ) : (
              <div>
                <div className="flex justify-center gap-2.5 mb-6">
                  {otp.map((digit, i) => (
                    <input
                      key={i}
                      ref={el => { otpRefs.current[i] = el; }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={e => handleOtpChange(i, e.target.value)}
                      onKeyDown={e => handleOtpKeyDown(i, e)}
                      onPaste={i === 0 ? handleOtpPaste : undefined}
                      className="w-12 h-14 text-center text-xl font-bold bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                    />
                  ))}
                </div>
                {verifying && (
                  <div className="flex items-center justify-center gap-2 text-sm text-blue-600 dark:text-blue-400 mb-4">
                    <Loader2 className="h-4 w-4 animate-spin" /> {t('phone.verifying')}
                  </div>
                )}
                <div className="text-center">
                  <p className="text-sm text-gray-500 dark:text-slate-400">
                    {`${t('phone.didntReceive')} `}
                    {cooldown > 0 ? (
                      <span className="text-gray-400">{t('phone.resendIn')} {cooldown}s</span>
                    ) : (
                      <button type="button" onClick={handleResend} disabled={sending} className="text-blue-600 dark:text-blue-400 font-medium hover:underline cursor-pointer">{t('phone.resend')}</button>
                    )}
                  </p>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
