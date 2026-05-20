'use client';

import React, { useState, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/context/auth-context';
import { useRouter, useParams } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import api from '@/lib/api';
import { localized } from '@/lib/localize';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ACTIVITY_WIZARD_ERR, wizardSteps, daysOfWeek } from '../../../_lib/vendor-activity-wizard-copy';
import { getApiError } from '@/lib/api-error';
import { sanitize, sanitizeObject } from '@/lib/validation';
import { VendorSidebar } from '../../../_components/vendor-sidebar';
import { Check, Loader2, X, BookmarkIcon, AlertCircle, ImagePlus } from 'lucide-react';
import { useToast } from '@/components/toast';
import CustomSelect from '@/components/custom-select';
import { ACCEPTED_IMAGE_TYPES, MAX_COVER_SIZE, MAX_IMAGE_DIM } from '@/lib/image-constants';

// Heavy widgets (leaflet, canvas, custom) — only mount when their wizard
// step is opened. Cuts the initial JS chunk for the wizard route.
const LocationPicker = dynamic(
  () => import('@/components/location-picker').then((m) => m.LocationPicker),
  { ssr: false, loading: () => <div className="h-[400px] w-full jadwal-skeleton rounded-xl" /> },
);
const ImageUploader = dynamic(() => import('@/components/image-uploader'), {
  ssr: false,
  loading: () => <div className="h-32 w-full jadwal-skeleton rounded-xl" />,
});
const TimePicker = dynamic(() => import('@/components/time-picker'), {
  ssr: false,
  loading: () => <div className="h-12 w-full jadwal-skeleton rounded-xl" />,
});

async function compressCoverImage(file: File): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.webp'), { type: 'image/webp' }));
        },
        'image/webp',
        0.82,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

function CoverImageUploader({
  value,
  onChange,
  error,
  t,
}: {
  value: string;
  onChange: (url: string) => void;
  error?: string;
  t: TFunction;
}) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string>(value || '');
  const [uploadError, setUploadError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setUploadError(t('vendor.activities.wizard.cover.invalidType'));
      return;
    }
    if (file.size > MAX_COVER_SIZE) {
      setUploadError(t('vendor.activities.wizard.cover.tooLarge'));
      return;
    }
    setUploadError('');
    setUploading(true);
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);

    try {
      const compressed = await compressCoverImage(file);
      const formData = new FormData();
      formData.append('file', compressed);
      const res = await api.post('/vendor/upload-image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const finalUrl: string = res.data.url;
      setPreview(finalUrl);
      onChange(finalUrl);
    } catch {
      setUploadError(t('vendor.activities.wizard.cover.uploadFailed'));
      setPreview('');
      onChange('');
    } finally {
      setUploading(false);
    }
  }, [onChange, t]);

  const handleRemove = () => {
    if (preview.startsWith('blob:')) URL.revokeObjectURL(preview);
    setPreview('');
    onChange('');
    setUploadError('');
  };

  return (
    <div className="space-y-3">
      {!preview ? (
        <div
          onClick={() => inputRef.current?.click()}
          onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
          onDragOver={(e) => e.preventDefault()}
          className={`cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-200 p-8 flex flex-col items-center justify-center gap-3 text-center select-none
            ${error || uploadError
              ? 'border-red-400 dark:border-red-500 bg-red-50/5'
              : 'border-gray-200 dark:border-slate-700 hover:border-teal-400 dark:hover:border-teal-500 hover:bg-teal-50/5 dark:hover:bg-teal-900/5'
            }`}
        >
          <div className="p-3 rounded-full bg-gray-100 dark:bg-slate-800">
            <ImagePlus className="h-8 w-8 text-gray-400 dark:text-slate-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-slate-300">{t('vendor.activities.wizard.cover.dropTitle')}</p>
            <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">{t('vendor.activities.wizard.cover.dropHint')}</p>
          </div>
        </div>
      ) : (
        <div className="relative group rounded-2xl overflow-hidden border border-gray-200 dark:border-slate-700 bg-gray-100 dark:bg-slate-800 aspect-video max-w-md">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt={t('vendor.activities.wizard.cover.previewAlt')}
            className={`w-full h-full object-cover transition-opacity ${uploading ? 'opacity-40' : 'opacity-100'}`}
          />
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
              <Loader2 className="h-8 w-8 text-white animate-spin" />
            </div>
          )}
          {!uploading && (
            <>
              <button
                type="button"
                onClick={handleRemove}
                className="absolute top-2 inset-e-2 p-1.5 bg-black/60 hover:bg-black/80 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="absolute bottom-2 inset-e-2 px-3 py-1.5 bg-black/60 hover:bg-black/80 text-white text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
              >
                {t('vendor.activities.wizard.cover.replace')}
              </button>
            </>
          )}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(',')}
        className="hidden"
        onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); e.target.value = ''; }}
      />
      {(error || uploadError) && (
        <p className="flex items-center gap-1.5 text-xs text-red-500">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {uploadError || error}
        </p>
      )}
    </div>
  );
}

export default function CreateActivityPage() {
  const { t } = useTranslation();
  const STEPS = wizardSteps(t);
  const DAYS_OF_WEEK = daysOfWeek(t);
  const bookingTypeOptions = useMemo(
    () => [
      { value: 'HOURLY' as const, label: t('vendor.activities.wizard.ui.bookingHourlyLabel'), desc: t('vendor.activities.wizard.ui.bookingHourlyDesc') },
      { value: 'DAILY' as const, label: t('vendor.activities.wizard.ui.bookingDailyLabel'), desc: t('vendor.activities.wizard.ui.bookingDailyDesc') },
    ],
    [t],
  );
  const pricingModelOptions = useMemo(
    () =>
      [
        {
          value: 'PER_PERSON' as const,
          label: t('vendor.activities.wizard.ui.pmPerPersonLabel'),
          desc: t('vendor.activities.wizard.ui.pmPerPersonDesc'),
          example: t('vendor.activities.wizard.ui.pmPerPersonExample'),
        },
        {
          value: 'PER_UNIT' as const,
          label: t('vendor.activities.wizard.ui.pmPerUnitLabel'),
          desc: t('vendor.activities.wizard.ui.pmPerUnitDesc'),
          example: t('vendor.activities.wizard.ui.pmPerUnitExample'),
        },
      ] as const,
    [t],
  );
  const cancellationOptions = useMemo(
    () =>
      [
        {
          value: 'FREE_CANCELLATION',
          label: t('vendor.activities.wizard.ui.policyFreeCancel'),
          desc: t('vendor.activities.wizard.ui.policyFreeCancelDesc'),
        },
        {
          value: 'PARTIAL_REFUND',
          label: t('vendor.activities.wizard.ui.policyPartial'),
          desc: t('vendor.activities.wizard.ui.policyPartialDesc'),
        },
        {
          value: 'NON_REFUNDABLE',
          label: t('vendor.activities.wizard.ui.policyNonRef'),
          desc: t('vendor.activities.wizard.ui.policyNonRefDesc'),
        },
      ] as const,
    [t],
  );
  const { user } = useAuth();
  const router = useRouter();
  const { slug } = useParams() as { slug: string };
  const { toast } = useToast();

  const [currentStep, setCurrentStep] = useState(1);

  const [form, setForm] = useState({
    titleEn: '',
    titleAr: '',
    slug: '',
    descriptionEn: '',
    descriptionAr: '',
    categoryId: '',
    subCategoryId: '',
    pricePerPerson: '',
    durationValue: '',      // hours (HOURLY); DAILY is always flexible
    pricingModel: 'PER_PERSON' as 'PER_PERSON' | 'PER_UNIT',
    capacity: '',
    locationLat: '',
    locationLng: '',
    locationAddress: '',
    cityId: '',
    bookingType: 'HOURLY' as 'HOURLY' | 'DAILY',
    cancellationPolicy: '',
    checkInTime: '',
    checkOutTime: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [coverImage, setCoverImage] = useState<string>('');
  const [gallery, setGallery] = useState<string[]>([]);
  const [extraServices, setExtraServices] = useState<{ name: string; nameAr?: string; price: number; perPerson: boolean }[]>([]);
  const [extraName, setExtraName] = useState('');
  const [extraNameAr, setExtraNameAr] = useState('');
  const [extraPrice, setExtraPrice] = useState('');
  const [extraPerPerson, setExtraPerPerson] = useState(false);
  const [activeDays, setActiveDays] = useState<string[]>([]);

  // Units
  const [hasUnits, setHasUnits] = useState(false);
  const [unitCount, setUnitCount] = useState('');
  const [unitCapacity, setUnitCapacity] = useState('');

  const { data: categories } = useQuery({
    queryKey: [user?.id, 'public-categories'],
    queryFn: () => api.get('/catalog/categories').then(r => r.data),
  });

  // Filter cities by vendor's country — vendor can only create activities in their registered country
  const vendorCountryId = user?.vendor?.countryId;
  const { data: cities } = useQuery({
    queryKey: [vendorCountryId, 'vendor-cities'],
    queryFn: () => api.get(`/catalog/cities/${vendorCountryId}`).then(r => r.data),
    staleTime: 10 * 60 * 1000,
    enabled: !!vendorCountryId,
  });

  const selectedCategory = categories?.find((c: any) => c.id === form.categoryId);
  const subCategories = selectedCategory?.children ?? [];

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/vendor/activities', data),
    onSuccess: () => {
      toast(t('vendor.activities.wizard.toast.createSuccess'), 'success');
      router.push(`/vendor/${slug}/activities`);
    },
    onError: (err) => {
      toast(getApiError(err, t('vendor.activities.wizard.toast.createFailed')), 'error');
    },
  });

  const validateStep = (step: number): boolean => {
    const errs: Record<string, string> = {};
    if (step === 1) {
      if (!form.titleEn.trim()) errs.titleEn = t(ACTIVITY_WIZARD_ERR.titleEnRequired);
      else if (form.titleEn.trim().length < 5) errs.titleEn = t(ACTIVITY_WIZARD_ERR.titleEnMin);
      else if (form.titleEn.trim().length > 150) errs.titleEn = t(ACTIVITY_WIZARD_ERR.titleEnMax);
      if (!form.titleAr.trim()) errs.titleAr = t(ACTIVITY_WIZARD_ERR.titleArRequired);
      else if (form.titleAr.trim().length < 5) errs.titleAr = t(ACTIVITY_WIZARD_ERR.titleArMin);
      else if (form.titleAr.trim().length > 150) errs.titleAr = t(ACTIVITY_WIZARD_ERR.titleArMax);
      if (!form.slug.trim()) errs.slug = t(ACTIVITY_WIZARD_ERR.slugRequired);
      else if (!/^[a-z0-9-]+$/.test(form.slug)) errs.slug = t(ACTIVITY_WIZARD_ERR.slugFormat);
      else if (form.slug.length < 3) errs.slug = t(ACTIVITY_WIZARD_ERR.slugMin);
      if (!form.categoryId) errs.categoryId = t(ACTIVITY_WIZARD_ERR.categoryRequired);
      if (!form.descriptionEn.trim()) errs.descriptionEn = t(ACTIVITY_WIZARD_ERR.descriptionEnRequired);
      else if (form.descriptionEn.trim().length < 50) errs.descriptionEn = t(ACTIVITY_WIZARD_ERR.descriptionEnMin);
      else if (form.descriptionEn.trim().length > 2000) errs.descriptionEn = t(ACTIVITY_WIZARD_ERR.descriptionEnMax);
      if (!form.descriptionAr.trim()) errs.descriptionAr = t(ACTIVITY_WIZARD_ERR.descriptionArRequired);
      else if (form.descriptionAr.trim().length < 50) errs.descriptionAr = t(ACTIVITY_WIZARD_ERR.descriptionArMin);
      else if (form.descriptionAr.trim().length > 2000) errs.descriptionAr = t(ACTIVITY_WIZARD_ERR.descriptionArMax);
    }
    if (step === 2) {
      if (form.bookingType === 'HOURLY') {
        if (!form.durationValue || Number(form.durationValue) < 1) errs.durationValue = t(ACTIVITY_WIZARD_ERR.durationMin);
        else if (Number(form.durationValue) > 24) errs.durationValue = t(ACTIVITY_WIZARD_ERR.durationMax);
        if (!form.checkInTime) errs.checkInTime = t(ACTIVITY_WIZARD_ERR.startTimeRequired);
        if (!form.checkOutTime) errs.checkOutTime = t(ACTIVITY_WIZARD_ERR.endTimeRequired);
        if (form.checkInTime && form.checkOutTime && form.checkInTime >= form.checkOutTime)
          errs.checkOutTime = t(ACTIVITY_WIZARD_ERR.endAfterStart);
      } else {
        if (!form.checkInTime) errs.checkInTime = t(ACTIVITY_WIZARD_ERR.checkInRequired);
        if (!form.checkOutTime) errs.checkOutTime = t(ACTIVITY_WIZARD_ERR.checkOutRequired);
      }
    }
    if (step === 3) {
      if (!form.pricePerPerson || Number(form.pricePerPerson) <= 0) errs.pricePerPerson = t(ACTIVITY_WIZARD_ERR.priceRequired);
      else if (Number(form.pricePerPerson) > 100000) errs.pricePerPerson = t(ACTIVITY_WIZARD_ERR.priceTooHigh);
      if (!hasUnits) {
        if (!form.capacity || Number(form.capacity) <= 0) {
          errs.capacity = t(ACTIVITY_WIZARD_ERR.capacityRequired);
        } else if (Number(form.capacity) > 10000) {
          errs.capacity = t(ACTIVITY_WIZARD_ERR.capacityTooHigh);
        }
      }
    }
    if (step === 4) {
      if (!form.cityId) errs.cityId = t(ACTIVITY_WIZARD_ERR.cityRequired);
      if (!form.locationAddress.trim()) errs.locationAddress = t(ACTIVITY_WIZARD_ERR.locationRequired);
      else if (form.locationAddress.trim().length < 3) errs.locationAddress = t(ACTIVITY_WIZARD_ERR.locationShort);
      if (!form.locationLat || !form.locationLng) errs.locationLat = t(ACTIVITY_WIZARD_ERR.mapPinRequired);
    }
    if (step === 5) {
      if (!coverImage) errs.coverImage = t(ACTIVITY_WIZARD_ERR.coverRequired);
      if (gallery.length < 2) errs.gallery = t(ACTIVITY_WIZARD_ERR.galleryMin);
    }
    if (step === 6) {
      if (!form.cancellationPolicy) errs.cancellationPolicy = t(ACTIVITY_WIZARD_ERR.cancellationRequired);
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleNext = () => {
    if (!validateStep(currentStep)) return;
    setCurrentStep(s => s + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleStepClick = (targetStep: number) => {
    if (targetStep === currentStep) return;
    if (targetStep < currentStep) {
      setCurrentStep(targetStep);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    for (let s = currentStep; s < targetStep; s++) {
      if (!validateStep(s)) {
        setCurrentStep(s);
        return;
      }
    }
    setCurrentStep(targetStep);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBack = () => {
    setCurrentStep(s => s - 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = () => {
    // Auto-calculate capacity from units if hasUnits
    const totalCapacity = hasUnits && Number(unitCount) > 0
      ? Number(unitCount) * (Number(unitCapacity) || 1)
      : (form.capacity ? Number(form.capacity) : undefined);

    const payload = sanitizeObject({
      titleEn: sanitize(form.titleEn),
      titleAr: sanitize(form.titleAr),
      slug: sanitize(form.slug),
      descriptionEn: sanitize(form.descriptionEn),
      descriptionAr: sanitize(form.descriptionAr),
      categoryId: form.categoryId,
      subCategoryId: form.subCategoryId || undefined,
      pricePerPerson: Number(form.pricePerPerson),
      durationValue: form.bookingType === 'HOURLY'
        ? (Number(form.durationValue) || undefined)
        : undefined,
      pricingModel: form.bookingType === 'DAILY' ? 'PER_UNIT' : form.pricingModel,
      capacity: totalCapacity,
      locationLat: Number(form.locationLat),
      locationLng: Number(form.locationLng),
      locationAddress: sanitize(form.locationAddress),
      cityId: form.cityId,
      bookingType: form.bookingType,
      cancellationPolicy: form.cancellationPolicy || undefined,
      checkInTime: form.checkInTime || undefined,
      checkOutTime: form.checkOutTime || undefined,
      hasUnits,
      unitCount: hasUnits ? Number(unitCount) || 0 : 0,
      unitCapacity: hasUnits ? Number(unitCapacity) || 1 : 1,
      coverImage: coverImage || undefined,
      gallery,
      extraServices: extraServices.length > 0 ? extraServices : undefined,
      activeDays,
    });
    createMutation.mutate(payload);
  };

  const updateField = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  };

  const handleTitleEnChange = (val: string) => {
    updateField('titleEn', val);
    if (!form.slug || form.slug === slugify(form.titleEn)) {
      updateField('slug', slugify(val));
    }
  };

  const addExtraService = () => {
    const name = extraName.trim();
    if (!name) return;
    const price = Number(extraPrice) || 0;
    if (extraServices.some(s => s.name === name)) return;
    // Arabic name is optional. Stored alongside `name` (the stable English
    // identifier used by booking-time matching) so customers in Arabic see
    // the translated label without breaking selectedExtras references.
    const nameAr = extraNameAr.trim() ? sanitize(extraNameAr.trim()) : undefined;
    setExtraServices(prev => [...prev, {
      name: sanitize(name),
      ...(nameAr ? { nameAr } : {}),
      price,
      perPerson: price > 0 ? extraPerPerson : false,
    }]);
    setExtraName('');
    setExtraNameAr('');
    setExtraPrice('');
    setExtraPerPerson(false);
  };
  const removeExtraService = (i: number) => setExtraServices(prev => prev.filter((_, idx) => idx !== i));
  const toggleDay = (value: string) =>
    setActiveDays(prev => prev.includes(value) ? prev.filter(d => d !== value) : [...prev, value]);

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-slate-950 font-outfit">
      <VendorSidebar />

      <main className="md:ms-64 min-h-screen overflow-x-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between px-10 py-6 border-b border-stone-200 dark:border-slate-800 bg-stone-50 dark:bg-slate-950">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('vendor.activities.wizard.ui.createTitle')}</h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">{t('vendor.activities.wizard.ui.createSubtitle')}</p>
          </div>
          <button
            type="button"
            onClick={() => router.back()}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 dark:text-slate-300 border border-gray-300 dark:border-slate-700 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
          >
            <BookmarkIcon className="h-4 w-4" />
            {t('vendor.activities.wizard.ui.saveDraft')}
          </button>
        </div>

        <div className="px-10 py-8 w-full">
          {/* Step Indicator */}
          <div className="flex items-center mb-10">
            {STEPS.map((step, idx) => (
              <React.Fragment key={step.id}>
                <button
                  type="button"
                  onClick={() => handleStepClick(step.id)}
                  className="flex flex-col items-center gap-1.5 cursor-pointer group"
                >
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-all group-hover:scale-110 ${
                      currentStep > step.id
                        ? 'bg-[#1d4f35] border-[#1d4f35] text-white'
                        : currentStep === step.id
                        ? 'bg-white dark:bg-slate-900 border-[#1d4f35] text-[#1d4f35]'
                        : 'bg-white dark:bg-slate-900 border-gray-300 dark:border-slate-600 text-gray-400 dark:text-slate-500'
                    }`}
                  >
                    {currentStep > step.id ? <Check className="h-4 w-4" strokeWidth={2.5} /> : step.id}
                  </div>
                  <span className={`text-[11px] font-medium whitespace-nowrap ${
                    currentStep === step.id ? 'text-[#1d4f35]' : 'text-gray-400 dark:text-slate-500'
                  }`}>
                    {step.label}
                  </span>
                </button>
                {idx < STEPS.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-1 mb-5 transition-colors ${
                    currentStep > step.id ? 'bg-[#1d4f35]' : 'bg-gray-200 dark:bg-slate-700'
                  }`} />
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Step 1 — Basic Info */}
          {currentStep === 1 && (
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-8">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">{t('vendor.activities.wizard.ui.sectionBasicInfo')}</h2>
              <div className="grid grid-cols-2 gap-5">
                <FieldGroup label={t('vendor.activities.wizard.ui.fieldTitleEn')} required error={errors.titleEn}>
                  <input
                    data-testid="activity-field-titleEn"
                    value={form.titleEn}
                    onChange={e => handleTitleEnChange(e.target.value)}
                    className={inputCls(!!errors.titleEn)}
                    placeholder={t('vendor.activities.wizard.ui.placeholderTitleEn')}
                  />
                </FieldGroup>
                <FieldGroup label={t('vendor.activities.wizard.ui.fieldTitleAr')} required error={errors.titleAr}>
                  <input
                    data-testid="activity-field-titleAr"
                    value={form.titleAr}
                    onChange={e => updateField('titleAr', e.target.value)}
                    className={inputCls(!!errors.titleAr)}
                    placeholder={t('vendor.activities.wizard.ui.placeholderTitleAr')}
                    dir="rtl"
                  />
                </FieldGroup>
                <FieldGroup label={t('vendor.activities.wizard.ui.fieldCategory')} required error={errors.categoryId}>
                  <CustomSelect
                    options={categories?.map((c: any) => ({ value: c.id, label: localized(c, 'name') })) ?? []}
                    value={form.categoryId}
                    onChange={val => { updateField('categoryId', val); updateField('subCategoryId', ''); }}
                    placeholder={t('vendor.activities.wizard.ui.phSelectCategory')}
                  />
                </FieldGroup>
                <FieldGroup label={t('vendor.activities.wizard.ui.fieldSubCategory')} error={errors.subCategoryId}>
                  <CustomSelect
                    options={subCategories.map((s: any) => ({ value: s.id, label: localized(s, 'name') }))}
                    value={form.subCategoryId}
                    onChange={val => updateField('subCategoryId', val)}
                    placeholder={form.categoryId ? t('vendor.activities.wizard.ui.phSelectSubOptional') : t('vendor.activities.wizard.ui.phSelectCategoryFirst')}
                    disabled={!form.categoryId || subCategories.length === 0}
                  />
                </FieldGroup>
                <FieldGroup label={t('vendor.activities.wizard.ui.fieldUrlSlug')} required error={errors.slug} className="col-span-2">
                  <input
                    value={form.slug}
                    readOnly
                    tabIndex={-1}
                    className={`${inputCls(!!errors.slug)} bg-gray-100 dark:bg-slate-800/80 cursor-not-allowed text-gray-500 dark:text-slate-400`}
                    placeholder={t('vendor.activities.wizard.ui.phSlugAuto')}
                  />
                </FieldGroup>
              </div>
              <div className="grid grid-cols-2 gap-5 mt-5">
                <FieldGroup label={t('vendor.activities.wizard.ui.fieldDescriptionEn')} required error={errors.descriptionEn}>
                  <textarea
                    value={form.descriptionEn}
                    onChange={e => updateField('descriptionEn', e.target.value)}
                    className={`${inputCls(!!errors.descriptionEn)} min-h-[120px] resize-none`}
                    placeholder={t('vendor.activities.wizard.ui.placeholderDescriptionEn')}
                  />
                  <p className={`text-xs mt-1 text-end ${form.descriptionEn.length < 50 ? 'text-amber-500' : 'text-gray-400'}`}>
                    {t('vendor.activities.wizard.ui.charCount', { current: form.descriptionEn.length })}
                    {form.descriptionEn.length < 50 ? ` ${t('vendor.activities.wizard.ui.minCharsHint')}` : ''}
                  </p>
                </FieldGroup>
                <FieldGroup label={t('vendor.activities.wizard.ui.fieldDescriptionAr')} required error={errors.descriptionAr}>
                  <textarea
                    value={form.descriptionAr}
                    onChange={e => updateField('descriptionAr', e.target.value)}
                    className={`${inputCls(!!errors.descriptionAr)} min-h-[120px] resize-none`}
                    placeholder={t('vendor.activities.wizard.ui.placeholderDescriptionAr')}
                    dir="rtl"
                  />
                  <p className={`text-xs mt-1 text-end ${form.descriptionAr.length < 50 ? 'text-amber-500' : 'text-gray-400'}`}>
                    {t('vendor.activities.wizard.ui.charCount', { current: form.descriptionAr.length })}
                    {form.descriptionAr.length < 50 ? ` ${t('vendor.activities.wizard.ui.minCharsHint')}` : ''}
                  </p>
                </FieldGroup>
              </div>
            </div>
          )}

          {/* Step 2 — Details */}
          {currentStep === 2 && (
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-8">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">{t('vendor.activities.wizard.ui.sectionActivityDetails')}</h2>

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-3">{t('vendor.activities.wizard.ui.bookingTypeLabel')} <span className="text-red-500">*</span></label>
                <div className="grid grid-cols-2 gap-3">
                  {bookingTypeOptions.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => updateField('bookingType', opt.value)}
                      className={`flex items-center gap-3 p-4 rounded-xl border-2 text-start transition-all ${
                        form.bookingType === opt.value
                          ? 'border-[#1d4f35] bg-[#1d4f35]/5'
                          : 'border-gray-200 dark:border-slate-700 hover:border-gray-300'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        form.bookingType === opt.value ? 'border-[#1d4f35]' : 'border-gray-300'
                      }`}>
                        {form.bookingType === opt.value && (
                          <div className="w-2.5 h-2.5 rounded-full bg-[#1d4f35]" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">{opt.label}</p>
                        <p className="text-xs text-gray-400 dark:text-slate-500">{opt.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Duration — context-aware */}
              {form.bookingType === 'HOURLY' ? (
                <div className="grid grid-cols-2 gap-5 mb-6">
                  <FieldGroup label={t('vendor.activities.wizard.ui.fieldDurationHours')} required error={errors.durationValue}>
                    <input type="number" min="1" max="24" value={form.durationValue}
                      onChange={e => updateField('durationValue', e.target.value)}
                      className={inputCls(!!errors.durationValue)} placeholder={t('vendor.activities.wizard.ui.phDurationExample')} />
                  </FieldGroup>
                  <div />
                  <FieldGroup label={t('vendor.activities.wizard.ui.fieldStartTime')} required error={errors.checkInTime}>
                    <TimePicker
                      value={form.checkInTime}
                      onChange={val => updateField('checkInTime', val)}
                      hasError={!!errors.checkInTime}
                      placeholder={t('vendor.activities.wizard.ui.phSelectStartTime')}
                    />
                  </FieldGroup>
                  <FieldGroup label={t('vendor.activities.wizard.ui.fieldEndTime')} required error={errors.checkOutTime}>
                    <TimePicker
                      value={form.checkOutTime}
                      onChange={val => updateField('checkOutTime', val)}
                      hasError={!!errors.checkOutTime}
                      placeholder={t('vendor.activities.wizard.ui.phSelectEndTime')}
                    />
                  </FieldGroup>
                </div>
              ) : (
                <div className="mb-6 space-y-5">
                  <div className="p-4 rounded-xl bg-teal-50/50 dark:bg-teal-900/10 border border-teal-200/60 dark:border-teal-800/30">
                    <p className="text-sm text-teal-800 dark:text-teal-300 font-medium">{t('vendor.activities.wizard.ui.hotelBookingTitle')}</p>
                    <p className="text-xs text-teal-600 dark:text-teal-400 mt-1">{t('vendor.activities.wizard.ui.hotelBookingDesc')}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-5">
                    <FieldGroup label={t('vendor.activities.wizard.ui.fieldCheckInTime')} required error={errors.checkInTime}
                      hint={t('vendor.activities.wizard.ui.hintCheckInTime')}>
                      <TimePicker
                        value={form.checkInTime}
                        onChange={val => updateField('checkInTime', val)}
                        hasError={!!errors.checkInTime}
                        placeholder={t('vendor.activities.wizard.ui.phSelectCheckInTime')}
                      />
                    </FieldGroup>
                    <FieldGroup label={t('vendor.activities.wizard.ui.fieldCheckOutTime')} required error={errors.checkOutTime}
                      hint={t('vendor.activities.wizard.ui.hintCheckOutTime')}>
                      <TimePicker
                        value={form.checkOutTime}
                        onChange={val => updateField('checkOutTime', val)}
                        hasError={!!errors.checkOutTime}
                        placeholder={t('vendor.activities.wizard.ui.phSelectCheckOutTime')}
                      />
                    </FieldGroup>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                  {t('vendor.activities.wizard.ui.activeDays')}
                  {form.bookingType === 'DAILY' && <span className="text-xs text-gray-400 ms-1">{t('vendor.activities.wizard.ui.activeDaysDailyHint')}</span>}
                </label>
                <p className="text-xs text-gray-400 dark:text-slate-500 mb-3">{t('vendor.activities.wizard.ui.leaveEmptyAnyDay')}</p>
                <div className="flex flex-wrap gap-2">
                  {DAYS_OF_WEEK.map(({ label, value }) => {
                    const active = activeDays.includes(value);
                    return (
                      <button key={value} type="button" onClick={() => toggleDay(value)}
                        className={`px-4 py-2 rounded-full text-sm font-medium border transition-all ${
                          active ? 'bg-[#1d4f35] border-[#1d4f35] text-white'
                            : 'bg-stone-100 dark:bg-slate-800 border-stone-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:border-[#1d4f35]/40'}`}
                      >{label}</button>
                    );
                  })}
                </div>
                <p className="text-sm text-gray-400 dark:text-slate-500 mt-2">
                  {activeDays.length === 0 ? t('vendor.activities.wizard.ui.anyDay') : activeDays.join(', ')}
                </p>
              </div>

              {/* Units */}
              <div className="mt-8 pt-6 border-t border-gray-200 dark:border-slate-800">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">{t('vendor.activities.wizard.ui.unitsTitle')}</h3>
                  <button
                    type="button"
                    onClick={() => { setHasUnits(v => !v); if (hasUnits) { setUnitCount(''); setUnitCapacity(''); } }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${hasUnits ? 'bg-[#1d4f35]' : 'bg-gray-300 dark:bg-slate-600'}`}
                  >
                    <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${hasUnits ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
                <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
                  {t('vendor.activities.wizard.ui.unitsDescription')}
                </p>

                {hasUnits && (
                  <div className="grid grid-cols-2 gap-5">
                    <FieldGroup label={t('vendor.activities.wizard.ui.fieldNumberOfUnits')} required error={errors.unitCount} hint={t('vendor.activities.wizard.ui.hintNumberOfUnits')}>
                      <input
                        type="number"
                        min="1"
                        max="500"
                        value={unitCount}
                        onChange={e => setUnitCount(e.target.value)}
                        className={inputCls(!!errors.unitCount)}
                        placeholder={t('vendor.activities.wizard.ui.phNumberOfUnits')}
                      />
                    </FieldGroup>
                    <FieldGroup label={t('vendor.activities.wizard.ui.fieldCapacityPerUnit')} required error={errors.unitCapacity} hint={t('vendor.activities.wizard.ui.hintCapacityPerUnit')}>
                      <input
                        type="number"
                        min="1"
                        value={unitCapacity}
                        onChange={e => setUnitCapacity(e.target.value)}
                        className={inputCls(!!errors.unitCapacity)}
                        placeholder={t('vendor.activities.wizard.ui.phCapacityPerUnit')}
                      />
                    </FieldGroup>
                    {Number(unitCount) > 0 && Number(unitCapacity) > 0 && (
                      <div className="col-span-2 p-3 bg-[#1d4f35]/5 dark:bg-[#1d4f35]/10 rounded-xl border border-[#1d4f35]/20">
                        <p className="text-sm text-[#1d4f35] dark:text-emerald-400 font-medium">
                          {t('vendor.activities.wizard.ui.totalCapacitySummary', {
                            total: Number(unitCount) * Number(unitCapacity),
                            count: Number(unitCount),
                          })}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 3 — Pricing */}
          {currentStep === 3 && (
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-8">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">{t('vendor.activities.wizard.ui.sectionPricing')}</h2>
              <div className="grid grid-cols-3 gap-8">
                <div className="col-span-2 space-y-5">
                  <div className="grid grid-cols-2 gap-5">
                    <FieldGroup
                      label={
                        form.bookingType === 'DAILY'
                          ? t('vendor.activities.wizard.ui.pricePerUnitNight')
                          : form.pricingModel === 'PER_UNIT'
                            ? t('vendor.activities.wizard.ui.pricePerUnit')
                            : t('vendor.activities.wizard.ui.pricePerPerson')
                      }
                      required error={errors.pricePerPerson}
                    >
                      <input type="number" min="0" data-testid="activity-field-pricePerPerson" value={form.pricePerPerson}
                        onChange={e => updateField('pricePerPerson', e.target.value)}
                        className={inputCls(!!errors.pricePerPerson)} placeholder={t('vendor.activities.wizard.ui.phPriceExample')} />
                    </FieldGroup>
                    {!hasUnits && (
                      <FieldGroup label={t('vendor.activities.wizard.ui.fieldTotalCapacityGuests')} required error={errors.capacity} hint={t('vendor.activities.wizard.ui.hintTotalCapacityGuests')}>
                        <input type="number" min="1" data-testid="activity-field-capacity" value={form.capacity}
                          onChange={e => updateField('capacity', e.target.value)}
                          className={inputCls(!!errors.capacity)} placeholder={t('vendor.activities.wizard.ui.phCapacityGuests')} />
                      </FieldGroup>
                    )}
                  </div>

                  {form.bookingType === 'HOURLY' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-3">
                        {t('vendor.activities.wizard.ui.pricingModelLabel')} <span className="text-red-500">*</span>
                      </label>
                      <div className="space-y-3">
                        {pricingModelOptions.map(opt => (
                          <button key={opt.value} type="button"
                            onClick={() => setForm(f => ({ ...f, pricingModel: opt.value }))}
                            className={`w-full flex items-start gap-3 p-3 rounded-xl border-2 text-start transition-all ${form.pricingModel === opt.value ? 'border-[#1d4f35] bg-[#1d4f35]/5' : 'border-gray-200 dark:border-slate-700 hover:border-gray-300'}`}
                          >
                            <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${form.pricingModel === opt.value ? 'border-[#1d4f35]' : 'border-gray-300'}`}>
                              {form.pricingModel === opt.value && <div className="w-2 h-2 rounded-full bg-[#1d4f35]" />}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-gray-900 dark:text-white">{opt.label}</p>
                              <p className="text-xs text-gray-400 dark:text-slate-500">{opt.desc}</p>
                              <p className="text-xs text-gray-500 dark:text-slate-400 mt-1 italic">{opt.example}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {hasUnits && (
                    <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
                      <p className="text-xs text-blue-700 dark:text-blue-400 flex items-center gap-1.5">
                        <span className="w-4 h-4 rounded-full border border-blue-500 flex items-center justify-center shrink-0 text-[10px] font-bold">i</span>
                        {t('vendor.activities.wizard.ui.unitsCapacityAutoHint', { unitCount, unitCapacity })}
                      </p>
                    </div>
                  )}
                </div>
                <div className="bg-stone-50 dark:bg-slate-800/60 rounded-xl p-5 border border-stone-200 dark:border-slate-700">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-slate-300 mb-4">
                    <BookmarkIcon className="h-4 w-4" /> {t('vendor.activities.wizard.ui.pricingPreview')}
                  </p>
                  <div className="space-y-3 text-xs">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                        {form.bookingType === 'DAILY'
                          ? t('vendor.activities.wizard.ui.previewTagDaily')
                          : form.pricingModel === 'PER_UNIT' ? t('vendor.activities.wizard.ui.previewTagFlat') : t('vendor.activities.wizard.ui.previewTagPerson')}
                      </p>
                      <div className="flex justify-between text-gray-600 dark:text-slate-400">
                        <span>
                          {form.bookingType === 'DAILY'
                            ? t('vendor.activities.wizard.ui.previewPerUnitNight')
                            : form.pricingModel === 'PER_UNIT' ? t('vendor.activities.wizard.ui.previewPerUnit') : t('vendor.activities.wizard.ui.previewPerPerson')}
                        </span>
                        <span className="font-medium text-gray-900 dark:text-white">
                          {form.pricePerPerson ? `QAR ${form.pricePerPerson}` : '—'}
                        </span>
                      </div>
                    </div>
                    <div className="border-t border-stone-200 dark:border-slate-700 pt-3 space-y-1">
                      <div className="flex justify-between text-gray-600 dark:text-slate-400">
                        <span>{t('vendor.activities.wizard.ui.previewCapacity')}</span>
                        <span className="font-medium text-gray-900 dark:text-white">
                          {hasUnits && Number(unitCount) > 0
                            ? t('vendor.activities.wizard.ui.previewUnitsFmt', {
                              total: Number(unitCount) * (Number(unitCapacity) || 1),
                              n: Number(unitCount),
                            })
                            : form.capacity || '\u2014'}
                        </span>
                      </div>
                      {form.bookingType === 'DAILY' && (
                        <div className="flex justify-between text-gray-600 dark:text-slate-400">
                          <span>{t('vendor.activities.wizard.ui.previewDuration')}</span>
                          <span className="font-medium text-gray-900 dark:text-white text-end">
                            {t('vendor.activities.wizard.ui.previewFlexible')}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 4 — Location */}
          {currentStep === 4 && (
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-8">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">{t('vendor.activities.wizard.ui.sectionLocation')}</h2>
              <div className="grid grid-cols-2 gap-5 mb-5">
                <FieldGroup label={t('vendor.activities.wizard.ui.fieldLocationName')} required error={errors.locationAddress}>
                  <input
                    value={form.locationAddress}
                    onChange={e => updateField('locationAddress', e.target.value)}
                    className={inputCls(!!errors.locationAddress)}
                    placeholder={t('vendor.activities.wizard.ui.phLocationExample')}
                  />
                </FieldGroup>
                <FieldGroup label={t('vendor.activities.wizard.ui.fieldCity')} required error={errors.cityId}>
                  <CustomSelect
                    options={cities?.map((c: any) => ({ value: c.id, label: localized(c, 'name') })) ?? []}
                    value={form.cityId}
                    onChange={val => updateField('cityId', val)}
                    placeholder={t('vendor.activities.wizard.ui.phSelectCity')}
                  />
                </FieldGroup>
              </div>
              <FieldGroup label={t('vendor.activities.wizard.ui.fieldMapLocationOptional')} error={errors.locationLat}>
                <LocationPicker
                  value={{
                    address: form.locationAddress,
                    lat: Number(form.locationLat) || 0,
                    lng: Number(form.locationLng) || 0,
                  }}
                  onChange={({ address, lat, lng }) => {
                    updateField('locationAddress', address);
                    updateField('locationLat', lat ? String(lat) : '');
                    updateField('locationLng', lng ? String(lng) : '');
                  }}
                  placeholder={t('vendor.activities.wizard.ui.phMapSearch')}
                />
              </FieldGroup>
            </div>
          )}

          {/* Step 5 — Media */}
          {currentStep === 5 && (
            <div className="space-y-6">
              {/* Cover Image */}
              <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-8">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{t('vendor.activities.wizard.ui.sectionCoverImage')}</h2>
                <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
                  {t('vendor.activities.wizard.ui.coverImageHelp')}
                </p>
                <CoverImageUploader value={coverImage} onChange={setCoverImage} error={errors.coverImage} t={t} />
              </div>

              {/* Gallery */}
              <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-8">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{t('vendor.activities.wizard.ui.sectionGallery')}</h2>
                <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
                  {t('vendor.activities.wizard.ui.galleryHelp')}
                </p>
                <div className="mb-2">
                  <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
                    {t('vendor.activities.wizard.ui.galleryUploaded', { current: gallery.length })}
                  </p>
                  <ImageUploader
                    value={gallery}
                    onChange={setGallery}
                    error={errors.gallery}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 6 — Policies */}
          {currentStep === 6 && (
            <div className="space-y-5">
              {/* Inclusions & Add-ons */}
              <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-8">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">{t('vendor.activities.wizard.ui.sectionInclusions')}</h2>
                <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
                  {t('vendor.activities.wizard.ui.inclusionsHelp')}
                </p>
                <div className="flex flex-wrap items-end gap-2 mb-3">
                  <div className="flex-1 min-w-[180px]">
                    <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">{t('vendor.activities.wizard.ui.labelItemName')}</label>
                    <input
                      type="text"
                      value={extraName}
                      onChange={e => setExtraName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addExtraService(); } }}
                      className={inputCls(false)}
                      placeholder={t('vendor.activities.wizard.ui.phExtraName')}
                      maxLength={200}
                    />
                  </div>
                  <div className="flex-1 min-w-[180px]">
                    <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">{t('vendor.activities.wizard.ui.labelItemNameAr')}</label>
                    <input
                      type="text"
                      value={extraNameAr}
                      onChange={e => setExtraNameAr(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addExtraService(); } }}
                      className={inputCls(false)}
                      placeholder={t('vendor.activities.wizard.ui.phExtraNameAr')}
                      maxLength={200}
                      dir="rtl"
                    />
                  </div>
                  <div className="w-28">
                    <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">{t('vendor.activities.wizard.ui.labelExtraPrice')}</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={extraPrice}
                      onChange={e => setExtraPrice(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addExtraService(); } }}
                      className={inputCls(false)}
                      placeholder="0"
                    />
                  </div>
                  {(Number(extraPrice) || 0) > 0 && (
                    <div className="flex items-center gap-3 pb-0.5">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="radio" name="extraPricing" checked={!extraPerPerson} onChange={() => setExtraPerPerson(false)} className="w-3.5 h-3.5 text-blue-600 border-gray-300 dark:border-slate-600 focus:ring-blue-500" />
                        <span className="text-xs text-gray-600 dark:text-slate-400 whitespace-nowrap">{t('vendor.activities.wizard.ui.perBooking')}</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="radio" name="extraPricing" checked={extraPerPerson} onChange={() => setExtraPerPerson(true)} className="w-3.5 h-3.5 text-blue-600 border-gray-300 dark:border-slate-600 focus:ring-blue-500" />
                        <span className="text-xs text-gray-600 dark:text-slate-400 whitespace-nowrap">{t('vendor.activities.wizard.ui.perPersonRadio')}</span>
                      </label>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={addExtraService}
                    className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors cursor-pointer"
                  >
                    {t('vendor.activities.wizard.ui.add')}
                  </button>
                </div>
                {extraServices.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-slate-500 italic">{t('vendor.activities.wizard.ui.noExtrasYet')}</p>
                ) : (
                  <div className="space-y-2">
                    {extraServices.map((svc, i) => (
                      <div
                        key={i}
                        data-testid={`activity-extra-service-row-${i}`}
                        className={`flex items-center justify-between px-4 py-2.5 rounded-xl border text-sm ${
                          svc.price === 0
                            ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800/30 text-emerald-700 dark:text-emerald-400'
                            : 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800/30 text-blue-700 dark:text-blue-400'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${svc.price === 0 ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-blue-500/20 text-blue-600 dark:text-blue-400'}`}>
                            {svc.price === 0 ? t('vendor.activities.wizard.ui.tagIncluded') : svc.perPerson ? t('vendor.activities.wizard.ui.tagAddonPerPerson') : t('vendor.activities.wizard.ui.tagAddonPerBooking')}
                          </span>
                          <span className="font-medium truncate">{svc.name}</span>
                          {svc.nameAr ? (
                            <span dir="rtl" className="text-xs opacity-70 truncate">· {svc.nameAr}</span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-3">
                          {svc.price > 0 && (
                            <span className="font-semibold">
                              {svc.perPerson
                                ? t('vendor.activities.wizard.ui.pricePlusQarPerson', { price: svc.price })
                                : t('vendor.activities.wizard.ui.pricePlusQar', { price: svc.price })}
                            </span>
                          )}
                          <button type="button" onClick={() => removeExtraService(i)} className="text-gray-400 hover:text-red-500 transition-colors cursor-pointer">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Cancellation Policy */}
              <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-8">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">{t('vendor.activities.wizard.ui.sectionCancellation')} <span className="text-red-500">*</span></h2>
                {errors.cancellationPolicy && (
                  <p className="text-xs text-red-500 mb-3">{errors.cancellationPolicy}</p>
                )}
                <div className="space-y-3 mt-4">
                  {cancellationOptions.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => updateField('cancellationPolicy', opt.value)}
                      className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 text-start transition-all ${
                        form.cancellationPolicy === opt.value
                          ? 'border-[#1d4f35] bg-[#1d4f35]/5'
                          : 'border-gray-200 dark:border-slate-700 hover:border-gray-300'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        form.cancellationPolicy === opt.value ? 'border-[#1d4f35]' : 'border-gray-300'
                      }`}>
                        {form.cancellationPolicy === opt.value && (
                          <div className="w-2.5 h-2.5 rounded-full bg-[#1d4f35]" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">{opt.label}</p>
                        <p className="text-xs text-gray-400 dark:text-slate-500">{opt.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Navigation — full-width bottom bar */}
        <div className="px-10 py-5 border-t border-stone-200 dark:border-slate-800 bg-stone-50 dark:bg-slate-950 flex items-center justify-between w-full">
          {currentStep > 1 ? (
            <button
              type="button"
              onClick={handleBack}
              className="flex items-center gap-2 px-6 py-3 text-sm font-medium text-gray-600 dark:text-slate-400 border border-gray-300 dark:border-slate-700 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
            >
              {t('vendor.activities.wizard.ui.navBack')}
            </button>
          ) : (
            <div />
          )}

          {currentStep < STEPS.length ? (
            <button
              type="button"
              onClick={handleNext}
              className="flex items-center gap-2 px-8 py-3 text-sm font-semibold text-white bg-[#1d4f35] hover:bg-[#164030] rounded-xl transition-colors shadow-sm"
            >
              {t('vendor.activities.wizard.ui.navNext')}
            </button>
          ) : (
            <button
              type="button"
              data-testid="activity-submit"
              onClick={handleSubmit}
              disabled={createMutation.isPending}
              className="flex items-center gap-2 px-8 py-3 text-sm font-semibold text-white bg-[#1d4f35] hover:bg-[#164030] rounded-xl transition-colors shadow-sm disabled:opacity-50"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('vendor.activities.wizard.ui.submitActivity')}
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────

const inputCls = (hasError: boolean) =>
  `w-full px-4 py-3 bg-white dark:bg-slate-800 border rounded-xl text-sm focus:outline-none focus:ring-2 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 transition-colors ${
    hasError
      ? 'border-red-400 focus:ring-red-400/20'
      : 'border-gray-200 dark:border-slate-700 focus:ring-[#1d4f35]/20 focus:border-[#1d4f35]/50'
  }`;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

function FieldGroup({
  label, required, error, hint, className = '', children,
}: {
  label: string; required?: boolean; error?: string; hint?: string; className?: string; children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">{hint}</p>}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}
