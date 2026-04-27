/**
 * Client-side helper to extract a human-readable error message from any
 * thrown value (typically an axios error). Lives in its own file because
 * it imports `react-i18next`-bound `i18n.ts` — which calls
 * React.createContext at module-eval time and therefore cannot be
 * imported into a Server Component import graph.
 *
 * Use `cn` and other RSC-safe helpers from `lib/utils.ts` instead.
 *
 * Security posture / behaviour: see the original block comment in
 * lib/utils.ts (kept inline below for traceability).
 */
import axios from 'axios';
import i18n from '@/lib/i18n';

/**
 * Defensive whitelist: only `UPPER_SNAKE.UPPER_SNAKE` lookups are allowed
 * under `errors.*`. Stops a compromised or malformed response from
 * navigating into a different translation namespace (e.g. leaking
 * `brand` or `auth.confirmPassword` into a toast).
 */
const ERROR_CODE_SHAPE = /^[A-Z][A-Z0-9_]*(?:\.[A-Z][A-Z0-9_]*){0,3}$/;

const I18N_RESERVED_KEYS = new Set([
  'lng', 'lngs', 'ns', 'fallbackLng', 'defaultValue', 'replace',
  'count', 'context', 'returnObjects', 'returnDetails', 'returnedObjectHandler',
  'joinArrays', 'postProcess', 'interpolation', 'nsSeparator', 'keySeparator',
  'pluralSeparator', 'contextSeparator', 'skipInterpolation', 't', 'i18n',
]);

function sanitizeI18nParams(
  raw: unknown,
): Record<string, string | number> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/.test(k)) continue;
    if (I18N_RESERVED_KEYS.has(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = v;
    } else if (typeof v === 'string') {
      out[k] = v.length > 200 ? v.slice(0, 200) : v;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function getApiError(err: unknown, fallback = 'Something went wrong'): string {
  const MAX_LEN = 500;
  const trim = (s: string) => (s.length > MAX_LEN ? `${s.slice(0, MAX_LEN)}…` : s);
  if (axios.isAxiosError(err)) {
    const errorCode: unknown = err.response?.data?.errorCode;
    if (typeof errorCode === 'string' && ERROR_CODE_SHAPE.test(errorCode)) {
      const safeParams = sanitizeI18nParams(err.response?.data?.params);
      const translated = i18n.t(`errors.${errorCode}`, {
        defaultValue: '',
        ...(safeParams || {}),
      });
      if (typeof translated === 'string' && translated.length > 0) return trim(translated);
    }
    const msg: unknown = err.response?.data?.message;
    if (typeof msg === 'string' && msg.length > 0) return trim(msg);
    if (Array.isArray(msg) && typeof msg[0] === 'string') return trim(msg[0]);
  }
  // Intentionally no Error.message fall-through — only trusted
  // backend-supplied strings (response.data.message / errorCode)
  // surface in the UI. A leak from raw `err.message` would expose
  // axios stack frames, network internals, or chained-cause text
  // that may include URLs, IPs, or tokens. Keep the guard tight.
  return fallback;
}
