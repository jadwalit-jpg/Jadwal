'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { sanitize } from '@/lib/validation';
import { useToast } from '@/components/toast';
import AdminLayout from '../_components/admin-layout';
import { Building2, Percent } from 'lucide-react';

interface PlatformSettings {
  id: string;
  defaultCommissionPct: string;
  platformName: string;
  supportEmail: string | null;
  supportPhone: string | null;
  aboutText: string | null;
  updatedAt: string;
}

const inputCls = 'w-full px-4 py-2.5 bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-slate-800 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all';
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5';

export default function AdminSettingsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: platformSettings } = useQuery<PlatformSettings>({
    queryKey: ['admin', 'settings', 'platform'],
    queryFn: async () => { const { data } = await api.get('/admin/settings/platform'); return data; },
  });

  const platformInfoMutation = useMutation({
    mutationFn: async (dto: any) => { await api.patch('/admin/settings/platform', dto); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'platform'] });
      toast('Platform settings saved successfully');
    },
    onError: () => { toast('Failed to save platform settings', 'error'); },
  });

  const commissionMutation = useMutation({
    mutationFn: async (pct: number) => { await api.patch('/admin/settings/platform', { defaultCommissionPct: pct }); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'platform'] });
      toast('Commission settings saved successfully');
    },
    onError: () => { toast('Failed to save commission settings', 'error'); },
  });

  return (
    <AdminLayout title="Settings" subtitle="Manage platform information and commission settings">
      <div className="space-y-10">

        {/* Platform Info */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="h-5 w-5 text-indigo-500" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Platform Info</h3>
          </div>
          <div className="rounded-2xl border border-gray-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/50 p-6">
            <form key={`platform-${platformSettings?.updatedAt}`} onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              platformInfoMutation.mutate({
                platformName: sanitize(fd.get('platformName') as string),
                supportEmail: fd.get('supportEmail') ? sanitize(fd.get('supportEmail') as string) : null,
                supportPhone: fd.get('supportPhone') ? sanitize(fd.get('supportPhone') as string) : null,
                aboutText: fd.get('aboutText') ? sanitize(fd.get('aboutText') as string) : null,
              });
            }} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Platform Name</label>
                <input name="platformName" defaultValue={platformSettings?.platformName ?? 'Jadwal'} required className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Support Email</label>
                <input name="supportEmail" type="email" defaultValue={platformSettings?.supportEmail ?? ''} placeholder="Jadwalqtr@gmail.com" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Support Phone</label>
                <input name="supportPhone" defaultValue={platformSettings?.supportPhone ?? ''} placeholder="+974 xxxx xxxx" className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>About Text</label>
                <textarea name="aboutText" rows={3} defaultValue={platformSettings?.aboutText ?? ''} placeholder="Brief description of the platform..." className={inputCls} />
              </div>
              <div className="sm:col-span-2 flex justify-end">
                <button type="submit" disabled={platformInfoMutation.isPending} className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-all disabled:opacity-50 cursor-pointer">
                  {platformInfoMutation.isPending ? 'Saving...' : 'Save Platform Info'}
                </button>
              </div>
            </form>
          </div>
        </section>

        {/* Commission */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Percent className="h-5 w-5 text-emerald-500" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Commission</h3>
          </div>
          <div className="rounded-2xl border border-gray-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/50 p-6">
            <form key={`commission-${platformSettings?.defaultCommissionPct}`} onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              commissionMutation.mutate(Number(fd.get('pct')));
            }} className="flex items-end gap-4">
              <div className="flex-1 max-w-xs">
                <label className={labelCls}>Default Commission %</label>
                <input name="pct" type="number" step="0.01" min="0" max="100" defaultValue={platformSettings?.defaultCommissionPct ?? '10'} className={inputCls} />
              </div>
              <button type="submit" disabled={commissionMutation.isPending} className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-all disabled:opacity-50 cursor-pointer">
                {commissionMutation.isPending ? 'Saving...' : 'Save'}
              </button>
            </form>
          </div>
        </section>

      </div>
    </AdminLayout>
  );
}
