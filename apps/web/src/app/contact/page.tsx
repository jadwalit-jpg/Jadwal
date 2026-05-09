'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Mail, Phone, Instagram, MapPin } from 'lucide-react';
import api from '@/lib/api';
import Navbar from '@/components/navbar';
import Footer from '@/components/footer';

interface PlatformInfo {
  platformName: string;
  supportEmail: string | null;
  supportPhone: string | null;
}

/**
 * Static contact page — no form by design. Customers reach support via
 * email / phone / Instagram (the channels we already operate). Form
 * submissions would route to a Slack/DB/email triage flow that doesn't
 * exist yet and would silently swallow messages.
 *
 * supportEmail + supportPhone are pulled from the platform_settings DB
 * row via /catalog/platform-info (same query as /about + footer). If
 * either is null the corresponding card just hides — same defensive
 * pattern as everywhere else this data is rendered.
 *
 * The Instagram handle is hardcoded since it doesn't change with the
 * platform-info edit flow and matches what footer.tsx already renders.
 */
export default function ContactPage() {
  const { t } = useTranslation();
  const { data: platform } = useQuery<PlatformInfo>({
    queryKey: ['platform-info'],
    queryFn: () => api.get('/catalog/platform-info').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 flex flex-col">
      <Navbar variant="solid" />

      <main className="flex-1 pt-24 pb-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-10"
          >
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-blue-100 dark:bg-blue-500/10 flex items-center justify-center">
              <Mail className="h-7 w-7 text-blue-600 dark:text-blue-400" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">
              {t('contactPage.title')}
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-3 max-w-lg mx-auto leading-relaxed">
              {t('contactPage.subtitle')}
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-1 sm:grid-cols-2 gap-4"
          >
            {platform?.supportEmail && (
              <ContactCard
                href={`mailto:${platform.supportEmail}`}
                icon={<Mail className="h-5 w-5 text-blue-600 dark:text-blue-400" />}
                iconBg="bg-blue-500/10"
                label={t('contactPage.emailLabel')}
                value={platform.supportEmail}
              />
            )}
            {platform?.supportPhone && (
              <ContactCard
                href={`tel:${platform.supportPhone.replace(/\s/g, '')}`}
                icon={<Phone className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />}
                iconBg="bg-emerald-500/10"
                label={t('contactPage.phoneLabel')}
                value={platform.supportPhone}
              />
            )}
            {/* Instagram is fixed — same handle as the footer link.
                target=_blank + rel=noopener noreferrer protects against
                reverse-tabnabbing. */}
            <ContactCard
              href="https://www.instagram.com/jadwal.qtr/"
              external
              icon={<Instagram className="h-5 w-5 text-pink-600 dark:text-pink-400" />}
              iconBg="bg-pink-500/10"
              label={t('contactPage.instagramLabel')}
              value="@jadwal.qtr"
            />
            {/* Static address — matches the address rendered in the
                footer + Privacy Policy + Terms. Not a clickable link
                because it goes to no useful resource. */}
            <div className="rounded-2xl bg-white dark:bg-slate-900/60 border border-gray-200/80 dark:border-slate-800/60 p-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
                <MapPin className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-500 dark:text-slate-400">
                  {t('contactPage.addressLabel')}
                </p>
                <p className="text-sm text-gray-900 dark:text-white mt-0.5 leading-snug">
                  {t('contactPage.addressValue')}
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

function ContactCard({
  href,
  icon,
  iconBg,
  label,
  value,
  external,
}: {
  href: string;
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: string;
  external?: boolean;
}) {
  const externalProps = external ? { target: '_blank', rel: 'noopener noreferrer' } : {};
  return (
    <a
      href={href}
      {...externalProps}
      className="rounded-2xl bg-white dark:bg-slate-900/60 border border-gray-200/80 dark:border-slate-800/60 p-5 flex items-center gap-4 hover:border-blue-300 dark:hover:border-blue-700/60 transition-colors"
    >
      <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center shrink-0`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-gray-500 dark:text-slate-400">{label}</p>
        <p className="text-sm text-gray-900 dark:text-white mt-0.5 truncate">{value}</p>
      </div>
    </a>
  );
}
