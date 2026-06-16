'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import api from '@/lib/api';
import { type Block, buildDisplay, formatBlock } from '@/lib/activity-blocks';

/**
 * Read-only summary of an activity's availability blocks, shown in the expanded
 * row on the activities list. Fetches on mount (so it only loads when a row is
 * expanded) and shares the query cache key with the edit-page manager, so edits
 * there stay in sync here. Recurring days collapse into one "Every <weekday>"
 * row; manage them on the activity's edit page.
 */
export default function ActivityBlocksSummary({ activityId }: { activityId: string }) {
  const { t } = useTranslation();

  const { data: blocks = [], isLoading } = useQuery<Block[]>({
    queryKey: ['vendor-activity-blocks', activityId],
    queryFn: () => api.get(`/vendor/activities/${activityId}/blocks`).then((r) => r.data),
  });

  if (isLoading) return <div className="h-4 w-40 jadwal-skeleton rounded" />;

  const items = buildDisplay(blocks);
  if (items.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-slate-400 text-start">
        {t('vendor.activities.list.noBlocks', 'No blocked dates')}
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {items.map((it) => (
        <div
          key={it.kind === 'single' ? it.block.id : it.key}
          className="flex items-start gap-2 text-sm text-gray-600 dark:text-slate-300"
        >
          <Lock className="h-3.5 w-3.5 text-gray-400 dark:text-slate-500 mt-0.5 shrink-0" />
          <span className="text-start">
            {it.kind === 'single'
              ? formatBlock(it.block)
              : `${t('vendor.activities.wizard.blocked.every', 'Every')} ${it.weekday} · ${it.first} → ${it.last} (${it.count})`}
          </span>
        </div>
      ))}
    </div>
  );
}
