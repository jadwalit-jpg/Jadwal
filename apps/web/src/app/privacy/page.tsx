'use client';

import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';
import Navbar from '@/components/navbar';
import Footer from '@/components/footer';

const LAST_UPDATED = '2026-06-28';

type SectionDef =
  | { key: string; paragraphs: string[] }
  | { key: string; paragraphs: string[]; bulletsKey: string }
  | { key: string; intro: string; bulletsKey: string; paragraphs?: string[] }
  | { key: string; labeledItems: Array<{ labelKey: string; textKey: string }>; paragraphs?: string[]; bulletsKey?: string };

export default function PrivacyPage() {
  const { t } = useTranslation();

  const sections = [
    { key: 'collect', labeledItems: [
      { labelKey: 'privacy.collect.account.label', textKey: 'privacy.collect.account.text' },
      { labelKey: 'privacy.collect.booking.label', textKey: 'privacy.collect.booking.text' },
      { labelKey: 'privacy.collect.device.label', textKey: 'privacy.collect.device.text' },
      { labelKey: 'privacy.collect.session.label', textKey: 'privacy.collect.session.text' },
      { labelKey: 'privacy.collect.vendor.label', textKey: 'privacy.collect.vendor.text' },
      { labelKey: 'privacy.collect.loyalty.label', textKey: 'privacy.collect.loyalty.text' },
      { labelKey: 'privacy.collect.push.label', textKey: 'privacy.collect.push.text' },
    ]},
    { key: 'use', intro: 'privacy.use.intro', bulletsKey: 'privacy.use.items' },
    { key: 'payment', paragraphs: ['privacy.payment.p1'] },
    { key: 'sharing', labeledItems: [
      { labelKey: 'privacy.sharing.vendors.label', textKey: 'privacy.sharing.vendors.text' },
      { labelKey: 'privacy.sharing.gateway.label', textKey: 'privacy.sharing.gateway.text' },
      { labelKey: 'privacy.sharing.processors.label', textKey: 'privacy.sharing.processors.text' },
      { labelKey: 'privacy.sharing.legal.label', textKey: 'privacy.sharing.legal.text' },
    ], paragraphs: ['privacy.sharing.neverSell'] },
    { key: 'security', intro: 'privacy.security.intro', bulletsKey: 'privacy.security.items', paragraphs: ['privacy.security.breach'] },
    { key: 'retention', paragraphs: ['privacy.retention.p1'] },
    { key: 'cookies', paragraphs: ['privacy.cookies.p1'] },
    { key: 'rights', intro: 'privacy.rights.intro', bulletsKey: 'privacy.rights.items', paragraphs: ['privacy.rights.contact'] },
    { key: 'children', paragraphs: ['privacy.children.p1'] },
    { key: 'intlTransfer', paragraphs: ['privacy.intlTransfer.p1'] },
    { key: 'changes', paragraphs: ['privacy.changes.p1'] },
    { key: 'contact', paragraphs: ['privacy.contact.p1'] },
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
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center">
              <ShieldCheck className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">
              {t('privacy.title')}
            </h1>
            <p className="text-sm text-gray-400 dark:text-slate-500 mt-2">
              {t('privacy.lastUpdated')}: {LAST_UPDATED}
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="rounded-2xl bg-white dark:bg-slate-900/60 border border-gray-100 dark:border-slate-800 p-6 sm:p-10 space-y-8 text-sm leading-relaxed text-gray-600 dark:text-slate-400"
          >
            {sections.map((s, idx) => (
              <Section key={s.key} title={t(`privacy.${s.key}.title`)}>
                {'labeledItems' in s && s.labeledItems?.map((item) => (
                  <p key={item.labelKey}>
                    <strong className="text-gray-800 dark:text-slate-200">{t(item.labelKey)}</strong>{' '}
                    {t(item.textKey)}
                  </p>
                ))}
                {'intro' in s && s.intro && <p>{t(s.intro)}</p>}
                {'bulletsKey' in s && s.bulletsKey && (
                  <ul className="list-disc ps-5 space-y-1">
                    {(t(s.bulletsKey, { returnObjects: true }) as string[]).map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                )}
                {'paragraphs' in s && s.paragraphs?.map((pKey) => (
                  <p key={pKey}>{t(pKey)}</p>
                ))}
                {idx === sections.length - 1 /* contact */ && null}
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
