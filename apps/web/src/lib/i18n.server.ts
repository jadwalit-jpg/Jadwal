/**
 * Server-side translation lookup — for Server Components that only render
 * translated copy (no interactivity), so they don't need `react-i18next`
 * (which pulls `createContext` and forces `'use client'`).
 *
 * Imports the same locale JSON the client i18n uses (`@/locales/{en,ar}.json` —
 * nested shape, e.g. `home.heroTitle1`). Handles only the simple `t(key)` /
 * `t(key, { defaultValue })` case — no pluralisation / interpolation (the
 * static hero copy doesn't need it). Resolution order: the requested locale →
 * EN → `defaultValue` → the key itself, mirroring react-i18next's
 * `fallbackLng: 'en'`.
 *
 * NOTE: this module is server-only. The JSON it imports is also bundled by the
 * client `lib/i18n.ts`, so there's no extra browser download — the copy here
 * lives in the (un-shipped) server bundle.
 */
import en from '@/locales/en.json';
import ar from '@/locales/ar.json';
import type { Lang } from './lang-cookie';

const RESOURCES: Record<Lang, unknown> = { en, ar };

function deepGet(obj: unknown, path: string): string | undefined {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === 'string' ? cur : undefined;
}

export type ServerT = (key: string, opts?: { defaultValue?: string }) => string;

/** Returns a `t(key, opts?)` bound to `lang` (with EN fallback). */
export function getServerT(lang: Lang): ServerT {
  return (key, opts) =>
    deepGet(RESOURCES[lang], key) ??
    (lang !== 'en' ? deepGet(en, key) : undefined) ??
    opts?.defaultValue ??
    key;
}
