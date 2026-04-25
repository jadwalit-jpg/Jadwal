'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Mail, Phone, MapPin, Shield, Users, Globe } from 'lucide-react';
import api from '@/lib/api';
import Navbar from '@/components/navbar';
import Footer from '@/components/footer';

interface PlatformInfo {
  platformName: string;
  supportEmail: string | null;
  supportPhone: string | null;
  aboutText: string | null;
}

export default function AboutPage() {
  const { t } = useTranslation();
  const { data: platform, isLoading } = useQuery<PlatformInfo>({
    queryKey: ['platform-info'],
    queryFn: () => api.get('/catalog/platform-info').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const name = platform?.platformName ?? 'Jadwal';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 flex flex-col">
      <Navbar variant="solid" />

      <main className="flex-1 pt-24 pb-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">

          {/* Hero */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-12"
          >
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-4">
              {t('about.title')} {name}
            </h1>
            <p className="text-lg text-gray-500 dark:text-slate-400 max-w-xl mx-auto leading-relaxed">
              {isLoading ? (
                <span className="inline-block h-5 w-64 bg-gray-100 dark:bg-slate-800 rounded animate-pulse" />
              ) : (
                platform?.aboutText ?? t('about.fallbackDesc')
              )}
            </p>
          </motion.div>

          {/* Values */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-12"
          >
            {[
              { icon: Globe, title: t('about.gccWide'), desc: t('about.gccWideDesc') },
              { icon: Shield, title: t('about.securePayments'), desc: t('about.securePaymentsDesc') },
              { icon: Users, title: t('about.vettedVendors'), desc: t('about.vettedVendorsDesc') },
            ].map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="p-6 rounded-2xl bg-white dark:bg-slate-900/60 border border-gray-200/80 dark:border-slate-800/60 text-center"
              >
                <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-blue-500/10 flex items-center justify-center">
                  <Icon className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                </div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">{title}</h3>
                <p className="text-xs text-gray-500 dark:text-slate-400 leading-relaxed">{desc}</p>
              </div>
            ))}
          </motion.div>

          {/* Contact Info */}
          {(platform?.supportEmail || platform?.supportPhone) && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="rounded-2xl bg-white dark:bg-slate-900/60 border border-gray-200/80 dark:border-slate-800/60 p-8"
            >
              <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-6 text-center">{t('about.getInTouch')}</h2>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-8">
                {platform.supportEmail && (
                  <a
                    href={`mailto:${platform.supportEmail}`}
                    className="flex items-center gap-3 text-sm text-gray-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                  >
                    <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                      <Mail className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    {platform.supportEmail}
                  </a>
                )}
                {platform.supportPhone && (
                  <a
                    href={`tel:${platform.supportPhone.replace(/\s/g, '')}`}
                    className="flex items-center gap-3 text-sm text-gray-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                  >
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
                      <Phone className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    {platform.supportPhone}
                  </a>
                )}
              </div>
            </motion.div>
          )}

        </div>
      </main>

      <Footer />
    </div>
  );
}
