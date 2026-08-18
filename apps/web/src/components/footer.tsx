'use client';

import { LocaleLink as Link } from '@/components/locale-link';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Mail, Phone, Instagram, MapPin } from 'lucide-react';
import api from '@/lib/api';

interface PlatformInfo {
  platformName: string;
  supportEmail: string | null;
  supportPhone: string | null;
  aboutText: string | null;
}

function smoothScrollTo(targetY: number, duration = 1200) {
  const startY = window.scrollY;
  const diff = targetY - startY;
  let startTime: number | null = null;

  function easeInOutCubic(t: number) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function step(timestamp: number) {
    if (!startTime) startTime = timestamp;
    const elapsed = timestamp - startTime;
    const progress = Math.min(elapsed / duration, 1);
    window.scrollTo(0, startY + diff * easeInOutCubic(progress));
    if (progress < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

export default function Footer() {
  const { t, i18n } = useTranslation();
  const isAr = (i18n.language || '').toLowerCase().startsWith('ar');
  const { data: platform } = useQuery<PlatformInfo>({
    queryKey: ['platform-info'],
    queryFn: () => api.get('/catalog/platform-info').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });

  // Brand wordmark + copyright use the fixed brand name (not the editable
  // platform setting), so the logo is consistent with the navbar everywhere.
  const name = t('footer.legalEntity');

  return (
    <footer className="border-t border-gray-100 dark:border-slate-800/60 bg-white dark:bg-slate-950">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-1">
              <span className="text-xl font-bold text-gray-900 dark:text-white">{name}</span>
              {/* Arabic accent only in non-Arabic locales — avoids "الجدول جدول". */}
              {!isAr && <span className="text-xl font-bold text-blue-600">{t('brandAr')}</span>}
            </Link>
            <p className="mt-3 text-sm text-gray-500 dark:text-slate-400 leading-relaxed">
              {t('footer.tagline')}
            </p>
          </div>

          {/* Explore */}
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">{t('footer.explore')}</h2>
            <ul className="space-y-2.5">
              <li><Link href="/explore" className="text-sm text-gray-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{t('footer.allActivities')}</Link></li>
              <li>
                <button
                  onClick={() => {
                    const el = document.getElementById('featured');
                    if (el) {
                      const top = el.getBoundingClientRect().top + window.scrollY - 96;
                      smoothScrollTo(top);
                    } else {
                      window.location.href = '/#featured';
                    }
                  }}
                  className="text-sm text-gray-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
                >
                  {t('footer.featured')}
                </button>
              </li>
              <li>
                <button
                  onClick={() => {
                    const el = document.getElementById('trending');
                    if (el) {
                      const top = el.getBoundingClientRect().top + window.scrollY - 96;
                      smoothScrollTo(top);
                    } else {
                      window.location.href = '/#trending';
                    }
                  }}
                  className="text-sm text-gray-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
                >
                  {t('footer.trending')}
                </button>
              </li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">{t('footer.company')}</h2>
            <ul className="space-y-2.5">
              <li><Link href="/about" className="text-sm text-gray-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{t('footer.about')}</Link></li>
              <li><Link href="/contact" className="text-sm text-gray-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{t('footer.contactUs')}</Link></li>
              <li><Link href="/register/vendor" className="text-sm text-gray-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{t('footer.becomeVendor')}</Link></li>
              <li><Link href="/terms" className="text-sm text-gray-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{t('footer.terms')}</Link></li>
              <li><Link href="/privacy" className="text-sm text-gray-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{t('footer.privacy')}</Link></li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">{t('footer.contact')}</h2>
            <ul className="space-y-2.5">
              {platform?.supportEmail && (
                <li>
                  <a href={`mailto:${platform.supportEmail}`} className="flex items-center gap-2 text-sm text-gray-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                    <Mail className="h-3.5 w-3.5 shrink-0" />
                    {platform.supportEmail}
                  </a>
                </li>
              )}
              <li>
                {/* target=_blank with rel=noopener noreferrer to prevent
                    reverse-tabnabbing (the Instagram tab can't access
                    window.opener and re-navigate this site). */}
                <a
                  href="https://www.instagram.com/jadwal.qtr/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-gray-500 dark:text-slate-400 hover:text-pink-600 dark:hover:text-pink-400 transition-colors"
                >
                  <Instagram className="h-3.5 w-3.5 shrink-0" />
                  @jadwal.qtr
                </a>
              </li>
              {platform?.supportPhone && (
                <li>
                  <a href={`tel:${platform.supportPhone.replace(/\s/g, '')}`} className="flex items-center gap-2 text-sm text-gray-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                    <Phone className="h-3.5 w-3.5 shrink-0" />
                    {platform.supportPhone}
                  </a>
                </li>
              )}
              <li className="flex items-start gap-2 text-sm text-gray-500 dark:text-slate-400 leading-relaxed">
                <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{t('footer.address')}</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-gray-100 dark:border-slate-800/60 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-gray-500 dark:text-slate-400">&copy; {new Date().getFullYear()} {name}. {t('footer.rights')}</p>
        </div>
      </div>
    </footer>
  );
}
