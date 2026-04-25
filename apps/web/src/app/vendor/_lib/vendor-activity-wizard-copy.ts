/**
 * Central i18n keys + helpers for vendor activity create/edit wizards.
 * Keeps ~1000-line pages readable; all keys live under vendor.activities.wizard.*
 */
import type { TFunction } from 'i18next';

export const ACTIVITY_WIZARD_ERR = {
  titleEnRequired: 'vendor.activities.wizard.errors.titleEnRequired',
  titleEnMin: 'vendor.activities.wizard.errors.titleEnMin',
  titleEnMax: 'vendor.activities.wizard.errors.titleEnMax',
  titleArRequired: 'vendor.activities.wizard.errors.titleArRequired',
  titleArMin: 'vendor.activities.wizard.errors.titleArMin',
  titleArMax: 'vendor.activities.wizard.errors.titleArMax',
  slugRequired: 'vendor.activities.wizard.errors.slugRequired',
  slugFormat: 'vendor.activities.wizard.errors.slugFormat',
  slugMin: 'vendor.activities.wizard.errors.slugMin',
  categoryRequired: 'vendor.activities.wizard.errors.categoryRequired',
  descriptionEnRequired: 'vendor.activities.wizard.errors.descriptionEnRequired',
  descriptionEnMin: 'vendor.activities.wizard.errors.descriptionEnMin',
  descriptionEnMax: 'vendor.activities.wizard.errors.descriptionEnMax',
  descriptionArRequired: 'vendor.activities.wizard.errors.descriptionArRequired',
  descriptionArMin: 'vendor.activities.wizard.errors.descriptionArMin',
  descriptionArMax: 'vendor.activities.wizard.errors.descriptionArMax',
  durationMin: 'vendor.activities.wizard.errors.durationMin',
  durationMax: 'vendor.activities.wizard.errors.durationMax',
  startTimeRequired: 'vendor.activities.wizard.errors.startTimeRequired',
  endTimeRequired: 'vendor.activities.wizard.errors.endTimeRequired',
  endAfterStart: 'vendor.activities.wizard.errors.endAfterStart',
  checkInRequired: 'vendor.activities.wizard.errors.checkInRequired',
  checkOutRequired: 'vendor.activities.wizard.errors.checkOutRequired',
  priceRequired: 'vendor.activities.wizard.errors.priceRequired',
  priceTooHigh: 'vendor.activities.wizard.errors.priceTooHigh',
  capacityRequired: 'vendor.activities.wizard.errors.capacityRequired',
  capacityTooHigh: 'vendor.activities.wizard.errors.capacityTooHigh',
  cityRequired: 'vendor.activities.wizard.errors.cityRequired',
  locationRequired: 'vendor.activities.wizard.errors.locationRequired',
  locationShort: 'vendor.activities.wizard.errors.locationShort',
  mapPinRequired: 'vendor.activities.wizard.errors.mapPinRequired',
  coverRequired: 'vendor.activities.wizard.errors.coverRequired',
  galleryMin: 'vendor.activities.wizard.errors.galleryMin',
  cancellationRequired: 'vendor.activities.wizard.errors.cancellationRequired',
} as const;

export function wizardSteps(t: TFunction) {
  return [
    { id: 1, label: t('vendor.activities.wizard.steps.basicInfo') },
    { id: 2, label: t('vendor.activities.wizard.steps.details') },
    { id: 3, label: t('vendor.activities.wizard.steps.pricing') },
    { id: 4, label: t('vendor.activities.wizard.steps.location') },
    { id: 5, label: t('vendor.activities.wizard.steps.media') },
    { id: 6, label: t('vendor.activities.wizard.steps.policies') },
  ];
}

export function daysOfWeek(t: TFunction) {
  return ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map((value) => ({
    value,
    label: t(`vendor.activities.wizard.days.${value}`),
  }));
}
