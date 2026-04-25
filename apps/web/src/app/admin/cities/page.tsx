'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { getApiError } from '@/lib/utils';
import { sanitize } from '@/lib/validation';
import { useToast } from '@/components/toast';
import AdminLayout from '../_components/admin-layout';
import {
  Plus,
  Pencil,
  Trash2,
  X,
  AlertTriangle,
  Search,
  Globe,
  MapPin,
  Store,
  CheckCircle,
  EyeOff,
} from 'lucide-react';
import CustomSelect from '@/components/custom-select';

const inputCls =
  'w-full px-4 py-2.5 bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-slate-800 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all';
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5';

function TableSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-14 bg-gray-100 dark:bg-slate-800/60 rounded-xl animate-pulse" />
      ))}
    </div>
  );
}

// ─── Countries Tab ──────────────────────────────────────────
function CountriesTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCountry, setEditingCountry] = useState<any>(null);
  const [statusVal, setStatusVal] = useState('ACTIVE');
  const [timezoneVal, setTimezoneVal] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  // GCC + Jordan timezones — grouped, with UTC offset for clarity
  const timezoneOptions = [
    { value: '', label: 'Select timezone...' },
    { value: 'Asia/Qatar', label: 'Asia/Qatar (UTC+3) — Qatar' },
    { value: 'Asia/Riyadh', label: 'Asia/Riyadh (UTC+3) — Saudi Arabia' },
    { value: 'Asia/Dubai', label: 'Asia/Dubai (UTC+4) — UAE' },
    { value: 'Asia/Bahrain', label: 'Asia/Bahrain (UTC+3) — Bahrain' },
    { value: 'Asia/Kuwait', label: 'Asia/Kuwait (UTC+3) — Kuwait' },
    { value: 'Asia/Muscat', label: 'Asia/Muscat (UTC+4) — Oman' },
    { value: 'Asia/Amman', label: 'Asia/Amman (UTC+3) — Jordan' },
  ];

  const { data: countries = [], isLoading } = useQuery({
    queryKey: ['admin', 'settings', 'countries'],
    queryFn: () => api.get('/admin/settings/countries').then((r) => r.data),
  });

  const saveMutation = useMutation({
    mutationFn: async ({ id, ...dto }: any) => {
      if (id) await api.patch(`/admin/settings/countries/${id}`, dto);
      else await api.post('/admin/settings/countries', dto);
    },
    onSuccess: (_data: any, variables: any) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'countries'] });
      setModalOpen(false);
      toast(variables.id ? 'Country updated' : 'Country created');
    },
    onError: (err) => {
      toast(getApiError(err, 'Failed to save country'), 'error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/settings/countries/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'countries'] });
      setDeleteConfirm(null);
      toast('Country deleted');
    },
    onError: (err) => {
      toast(getApiError(err, 'Failed to delete country'), 'error');
    },
  });

  function openAddModal() {
    setEditingCountry(null);
    setStatusVal('ACTIVE');
    setTimezoneVal('');
    setModalOpen(true);
  }

  function openEditModal(country: any) {
    setEditingCountry(country);
    setStatusVal(country.status);
    setTimezoneVal(country.defaultTimezone ?? '');
    setModalOpen(true);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload: any = {
      nameEn: sanitize(fd.get('nameEn') as string),
      nameAr: sanitize(fd.get('nameAr') as string),
      currencyCode: sanitize(fd.get('currencyCode') as string),
      defaultTimezone: timezoneVal,
      status: statusVal,
    };
    if (!editingCountry) payload.isoCode = sanitize(fd.get('isoCode') as string);
    const vat = fd.get('vatPercentage') as string;
    if (vat) payload.vatPercentage = Number(vat);
    // Service fee is the flat amount added to every booking on checkout.
    // Empty → send 0 so the backend stores an explicit value, not null.
    const serviceFeeRaw = fd.get('serviceFeeFixed') as string;
    payload.serviceFeeFixed = serviceFeeRaw ? Number(serviceFeeRaw) : 0;
    if (editingCountry) payload.id = editingCountry.id;
    saveMutation.mutate(payload);
  }

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">All Countries</h2>
        <button
          type="button"
          onClick={openAddModal}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-all shadow-sm cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Add Country
        </button>
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : (
        <div className="rounded-2xl border border-gray-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-800">
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Country</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">ISO</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Currency</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">VAT %</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Service Fee</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Stats</th>
                  <th className="text-end px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800/60">
                {countries.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-gray-400 dark:text-slate-500">No countries yet. Add one above.</td>
                  </tr>
                )}
                {countries.map((country: any) => (
                  <tr key={country.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4">
                      <p className="font-medium text-gray-900 dark:text-white">{country.nameEn}</p>
                      <p className="text-xs text-gray-400 dark:text-slate-500" dir="rtl">{country.nameAr}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-mono text-xs text-gray-500 dark:text-slate-400 bg-gray-100 dark:bg-slate-800 px-2 py-0.5 rounded-md">{country.isoCode}</span>
                    </td>
                    <td className="px-6 py-4 text-gray-600 dark:text-slate-300">{country.currencyCode}</td>
                    <td className="px-6 py-4 text-gray-600 dark:text-slate-300">{country.vatPercentage}%</td>
                    <td className="px-6 py-4 text-gray-600 dark:text-slate-300 tabular-nums">
                      {Number(country.serviceFeeFixed ?? 0).toFixed(2)} {country.currencyCode}
                    </td>
                    <td className="px-6 py-4">
                      {country.status === 'ACTIVE' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                          <CheckCircle className="h-3 w-3" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium bg-gray-500/10 text-gray-500 dark:text-slate-400">
                          <EyeOff className="h-3 w-3" /> Hidden
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-500 dark:text-slate-400">
                      {country._count?.cities ?? 0} cities · {country._count?.vendors ?? 0} vendors
                    </td>
                    <td className="px-6 py-4 text-end">
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" onClick={() => openEditModal(country)} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-500/10 transition-all cursor-pointer" title="Edit">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => setDeleteConfirm({ id: country.id, name: country.nameEn })} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-500/10 transition-all cursor-pointer" title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Country Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl border border-gray-200 dark:border-slate-800">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {editingCountry ? 'Edit Country' : 'Add Country'}
              </h3>
              <button type="button" onClick={() => setModalOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors cursor-pointer">
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className={labelCls}>Name English <span className="text-red-500">*</span></label>
                <input name="nameEn" defaultValue={editingCountry?.nameEn ?? ''} required placeholder="e.g. Qatar" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Name Arabic <span className="text-red-500">*</span></label>
                <input name="nameAr" defaultValue={editingCountry?.nameAr ?? ''} required dir="rtl" placeholder="مثال: قطر" className={inputCls} />
              </div>
              {!editingCountry && (
                <div>
                  <label className={labelCls}>ISO Code <span className="text-red-500">*</span></label>
                  <input name="isoCode" required placeholder="e.g. QA" maxLength={3} className={`${inputCls} font-mono uppercase`} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Currency Code <span className="text-red-500">*</span></label>
                  <input name="currencyCode" defaultValue={editingCountry?.currencyCode ?? ''} required placeholder="e.g. QAR" className={`${inputCls} font-mono`} />
                </div>
                <div>
                  <label className={labelCls}>VAT %</label>
                  <input name="vatPercentage" type="number" step="0.01" min="0" max="100" defaultValue={editingCountry?.vatPercentage ?? ''} placeholder="e.g. 5" className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>
                  Service Fee <span className="text-xs font-normal text-gray-400 dark:text-slate-500 ms-1">(flat per booking, in this country&apos;s currency)</span>
                </label>
                <input
                  name="serviceFeeFixed"
                  type="number"
                  step="0.01"
                  min="0"
                  max="10000"
                  defaultValue={editingCountry?.serviceFeeFixed ?? ''}
                  placeholder="e.g. 5"
                  className={inputCls}
                />
                <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">
                  Added on top of the activity price at checkout. Jadwal&apos;s revenue; invisible to the vendor.
                </p>
              </div>
              <div>
                <label className={labelCls}>Default Timezone</label>
                <CustomSelect
                  options={timezoneOptions}
                  value={timezoneVal}
                  onChange={setTimezoneVal}
                  placeholder="Select timezone..."
                />
              </div>
              <div>
                <label className={labelCls}>Status</label>
                <CustomSelect
                  options={[
                    { value: 'ACTIVE', label: 'Active' },
                    { value: 'HIDDEN', label: 'Hidden' },
                  ]}
                  value={statusVal}
                  onChange={(val) => setStatusVal(val)}
                />
              </div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors cursor-pointer">Cancel</button>
                <button type="submit" disabled={saveMutation.isPending} className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all disabled:opacity-50 cursor-pointer">
                  {saveMutation.isPending ? 'Saving...' : editingCountry ? 'Save Changes' : 'Create Country'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 border border-gray-200 dark:border-slate-700">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-red-100 dark:bg-red-500/20">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Delete Country</h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-slate-400 mb-6">
              Delete <span className="font-semibold text-gray-900 dark:text-white">{deleteConfirm.name}</span>? This will also remove all its cities.
            </p>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm font-medium rounded-xl bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700 transition-all cursor-pointer">Cancel</button>
              <button type="button" onClick={() => deleteMutation.mutate(deleteConfirm.id)} disabled={deleteMutation.isPending} className="px-4 py-2 text-sm font-medium rounded-xl bg-red-600 hover:bg-red-700 text-white transition-all disabled:opacity-50 cursor-pointer">
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Cities Tab ─────────────────────────────────────────────
function CitiesTab() {
  const [search, setSearch] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCity, setEditingCity] = useState<any>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [countryId, setCountryId] = useState('');

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: cities = [], isLoading } = useQuery({
    queryKey: ['admin', 'cities'],
    queryFn: () => api.get('/admin/settings/cities').then((r) => r.data),
  });

  const { data: countries = [] } = useQuery({
    queryKey: ['admin', 'settings', 'countries'],
    queryFn: () => api.get('/admin/settings/countries').then((r) => r.data),
  });

  const filteredCities = cities.filter((c: any) => {
    const matchSearch = !search || c.nameEn.toLowerCase().includes(search.toLowerCase()) || c.nameAr.includes(search);
    const matchCountry = !countryFilter || c.country?.id === countryFilter;
    return matchSearch && matchCountry;
  });

  function openAddModal() {
    setEditingCity(null);
    setNameEn('');
    setNameAr('');
    setCountryId('');
    setModalOpen(true);
  }

  function openEditModal(city: any) {
    setEditingCity(city);
    setNameEn(city.nameEn);
    setNameAr(city.nameAr);
    setCountryId(city.country?.id ?? '');
    setModalOpen(true);
  }

  const createCityMutation = useMutation({
    mutationFn: (payload: any) => api.post('/admin/settings/cities', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'cities'] });
      setModalOpen(false);
      toast('City created');
    },
    onError: (err) => { toast(getApiError(err, 'Failed to create city'), 'error'); },
  });

  const updateCityMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => api.patch(`/admin/settings/cities/${id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'cities'] });
      setModalOpen(false);
      toast('City updated');
    },
    onError: (err) => { toast(getApiError(err, 'Failed to update city'), 'error'); },
  });

  const deleteCityMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/settings/cities/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'cities'] });
      setDeleteConfirm(null);
      toast('City deleted');
    },
    onError: (err) => { toast(getApiError(err, 'Failed to delete city'), 'error'); },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editingCity) {
      updateCityMutation.mutate({ id: editingCity.id, payload: { nameEn: sanitize(nameEn), nameAr: sanitize(nameAr) } });
    } else {
      createCityMutation.mutate({ nameEn: sanitize(nameEn), nameAr: sanitize(nameAr), countryId });
    }
  }

  const isSaving = createCityMutation.isPending || updateCityMutation.isPending;

  return (
    <>
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-5">
        <div className="relative flex-1 w-full sm:max-w-sm">
          <Search className="absolute inset-s-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-slate-500" />
          <input
            type="text"
            placeholder="Search cities..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full ps-10 pe-4 py-2.5 bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-slate-800 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
          />
        </div>
        <CustomSelect
          options={countries.map((co: any) => ({ value: co.id, label: co.nameEn }))}
          value={countryFilter}
          onChange={(val) => setCountryFilter(val)}
          placeholder="All Countries"
        />
        <div className="sm:ms-auto">
          <button type="button" onClick={openAddModal} className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-all shadow-sm cursor-pointer">
            <Plus className="h-4 w-4" />
            Add City
          </button>
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : (
        <div className="rounded-2xl border border-gray-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-800">
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">City Name (EN)</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">City Name (AR)</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Country</th>
                  <th className="text-start px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Activities</th>
                  <th className="text-end px-6 py-4 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800/60">
                {filteredCities.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-gray-400 dark:text-slate-500">
                      {search || countryFilter ? 'No cities match your filters.' : 'No cities yet. Add one above.'}
                    </td>
                  </tr>
                )}
                {filteredCities.map((city: any) => (
                  <tr key={city.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4 font-medium text-gray-900 dark:text-white">{city.nameEn}</td>
                    <td className="px-6 py-4 text-gray-700 dark:text-slate-300" dir="rtl">{city.nameAr}</td>
                    <td className="px-6 py-4">
                      <span className="text-xs font-medium px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                        {city.country?.nameEn ?? '—'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600 dark:text-slate-300 text-xs">{city._count?.activities ?? 0}</td>
                    <td className="px-6 py-4 text-end">
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" onClick={() => openEditModal(city)} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-500/10 transition-all cursor-pointer" title="Edit">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => setDeleteConfirm({ id: city.id, name: city.nameEn })} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-500/10 transition-all cursor-pointer" title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* City Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl border border-gray-200 dark:border-slate-800">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {editingCity ? 'Edit City' : 'Add City'}
              </h3>
              <button type="button" onClick={() => setModalOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors cursor-pointer">
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className={labelCls}>City Name English <span className="text-red-500">*</span></label>
                <input type="text" value={nameEn} onChange={(e) => setNameEn(e.target.value)} required placeholder="e.g. Doha" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>City Name Arabic <span className="text-red-500">*</span></label>
                <input type="text" value={nameAr} onChange={(e) => setNameAr(e.target.value)} required dir="rtl" placeholder="مثال: الدوحة" className={inputCls} />
              </div>
              {!editingCity && (
                <div>
                  <label className={labelCls}>Country <span className="text-red-500">*</span></label>
                  <CustomSelect
                    options={countries.map((co: any) => ({ value: co.id, label: co.nameEn }))}
                    value={countryId}
                    onChange={(val) => setCountryId(val)}
                    placeholder="Select a country..."
                  />
                </div>
              )}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors cursor-pointer">Cancel</button>
                <button type="submit" disabled={isSaving} className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all disabled:opacity-50 cursor-pointer">
                  {isSaving ? 'Saving...' : editingCity ? 'Save Changes' : 'Create City'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 border border-gray-200 dark:border-slate-700">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-red-100 dark:bg-red-500/20">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Delete City</h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-slate-400 mb-6">
              Delete <span className="font-semibold text-gray-900 dark:text-white">{deleteConfirm.name}</span>? This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm font-medium rounded-xl bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700 transition-all cursor-pointer">Cancel</button>
              <button type="button" onClick={() => deleteCityMutation.mutate(deleteConfirm.id)} disabled={deleteCityMutation.isPending} className="px-4 py-2 text-sm font-medium rounded-xl bg-red-600 hover:bg-red-700 text-white transition-all disabled:opacity-50 cursor-pointer">
                {deleteCityMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Main Page ──────────────────────────────────────────────
export default function AdminCountriesCitiesPage() {
  const [activeTab, setActiveTab] = useState<'countries' | 'cities'>('countries');

  const tabs = [
    { key: 'countries' as const, label: 'Countries', icon: Globe },
    { key: 'cities' as const, label: 'Cities', icon: MapPin },
  ];

  return (
    <AdminLayout title="Countries & Cities" subtitle="Manage supported countries and their cities">
      {/* Tab Switcher */}
      <div className="flex gap-1 p-1 bg-gray-100 dark:bg-slate-800/60 rounded-xl mb-8 w-fit">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
              activeTab === key
                ? 'bg-white dark:bg-slate-900 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'countries' ? <CountriesTab /> : <CitiesTab />}
    </AdminLayout>
  );
}
