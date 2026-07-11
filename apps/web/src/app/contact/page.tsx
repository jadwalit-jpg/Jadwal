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
            {/* WhatsApp — the SAME support number as the floating chat button
                (whatsapp-float.tsx). Inline brand SVG since Lucide ships no
                WhatsApp glyph. external target=_blank + noopener guards tabnabbing. */}
            <ContactCard
              href={`https://wa.me/97477499399?text=${encodeURIComponent(t('contactPage.whatsappGreeting'))}`}
              external
              icon={
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-[#25D366]">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
                </svg>
              }
              iconBg="bg-[#25D366]/10"
              label={t('contactPage.whatsappLabel')}
              value="+974 7749 9399"
            />
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
