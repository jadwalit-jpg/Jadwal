'use client';

import { useTranslation } from 'react-i18next';
import { RouteSpinner } from '@/components/ui/route-spinner';

/**
 * Route-level loader for every /vendor/[slug]/* page. Shown only during the
 * React Server Component transition before the page bundle is ready.
 */
export default function Loading() {
  const { t } = useTranslation();
  return <RouteSpinner label={t('vendor.loading.portal')} />;
}
