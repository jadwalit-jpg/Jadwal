import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

// ─── Build-time env guard ────────────────────────────────────────────────────
// NEXT_PUBLIC_* vars are baked into the bundle at build time, not runtime.
// If missing in a production build, every API call silently hits localhost.
if (!process.env.NEXT_PUBLIC_API_URL) {
  throw new Error('[FATAL] NEXT_PUBLIC_API_URL must be set. Add it to .env.local or .env');
}

export const API_BASE = process.env.NEXT_PUBLIC_API_URL;

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

// ─── Refresh token interceptor ────────────────────────────────────────────
// On 401, try to refresh the access token once. If refresh fails, give up.

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value?: unknown) => void;
  reject: (reason?: unknown) => void;
  config: InternalAxiosRequestConfig;
}> = [];

function processQueue(error: AxiosError | null) {
  failedQueue.forEach(({ resolve, reject, config }) => {
    if (error) {
      reject(error);
    } else {
      resolve(api(config));
    }
  });
  failedQueue = [];
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // 429: enrich error message
    if (error.response?.status === 429) {
      const data = error.response.data as Record<string, unknown>;
      const retryAfter = typeof data?.retryAfterSeconds === 'number' ? data.retryAfterSeconds : 60;
      data.message = `Too many requests. Please wait ${retryAfter} seconds before trying again.`;
      return Promise.reject(error);
    }

    // 401: try refresh (but not for auth endpoints themselves)
    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/login') &&
      !originalRequest.url?.includes('/auth/refresh') &&
      !originalRequest.url?.includes('/auth/register')
    ) {
      if (isRefreshing) {
        // Queue this request until the refresh completes
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject, config: originalRequest });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        await api.post('/auth/refresh');
        processQueue(null);
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError as AxiosError);
        // Session is dead — notify auth context to clear state
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('auth:session-expired'));
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

export default api;
