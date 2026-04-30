'use client';

import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ScrollText } from 'lucide-react';
import Navbar from '@/components/navbar';
import Footer from '@/components/footer';

const LAST_UPDATED = '2026-04-30';

export default function TermsPage() {
  const { t } = useTranslation();

  const sections = [
    { key: 'acceptance', paragraphs: ['terms.acceptance.p1'] },
    { key: 'platform', paragraphs: ['terms.platform.p1'] },
    { key: 'accounts', paragraphs: ['terms.accounts.p1', 'terms.accounts.p2'] },
    { key: 'bookings', paragraphs: ['terms.bookings.p1', 'terms.bookings.p2'] },
    { key: 'cancellation', paragraphs: ['terms.cancellation.p1', 'terms.cancellation.p2'] },
    { key: 'vendorResp', paragraphs: ['terms.vendorResp.p1'] },
    { key: 'prohibited', paragraphs: ['terms.prohibited.p1'] },
    { key: 'ip', paragraphs: ['terms.ip.p1'] },
    { key: 'liability', paragraphs: ['terms.liability.p1'] },
    { key: 'law', paragraphs: ['terms.law.p1'] },
    { key: 'loyalty', paragraphs: ['terms.loyalty.p1', 'terms.loyalty.p2'] },
    { key: 'changes', paragraphs: ['terms.changes.p1'] },
    { key: 'contact', paragraphs: ['terms.contact.p1'] },
  ] as const;

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
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-sky-100 dark:bg-sky-500/10 flex items-center justify-center">
              <ScrollText className="h-7 w-7 text-sky-600 dark:text-sky-400" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">
              {t('terms.title')}
            </h1>
            <p className="text-sm text-gray-400 dark:text-slate-500 mt-2">
              {t('terms.lastUpdated')}: {LAST_UPDATED}
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="rounded-2xl bg-white dark:bg-slate-900/60 border border-gray-100 dark:border-slate-800 p-6 sm:p-10 space-y-8 text-sm leading-relaxed text-gray-600 dark:text-slate-400"
          >
            {sections.map((s) => (
              <Section key={s.key} title={t(`terms.${s.key}.title`)}>
                {s.paragraphs.map((pKey) => (
                  <p key={pKey}>{t(pKey)}</p>
                ))}
              </Section>
            ))}
          </motion.div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-base font-bold text-gray-900 dark:text-white mb-3">{title}</h2>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
