import api from '@/lib/api';

const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_KEY || '';

/**
 * Convert VAPID public key from base64url to Uint8Array (required by browser Push API).
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Check if push notifications are supported and what the permission state is.
 */
export function getPushState(): 'unsupported' | 'granted' | 'denied' | 'default' {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  if (!VAPID_KEY) return 'unsupported';
  return Notification.permission;
}

/**
 * Register service worker + subscribe to push notifications.
 * Only call on explicit user action (button click).
 *
 * Returns true if subscribed, false if denied/failed.
 */
export async function subscribeToPush(): Promise<boolean> {
  if (getPushState() === 'unsupported') return false;

  try {
    // Register service worker
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });

    // Request notification permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return false;

    // Subscribe to push
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true, // Required by Chrome — all pushes must show a notification
      applicationServerKey: urlBase64ToUint8Array(VAPID_KEY) as unknown as ArrayBuffer,
    });

    // Send subscription to backend
    const sub = subscription.toJSON();
    await api.post('/push/subscribe', {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.keys?.p256dh,
        auth: sub.keys?.auth,
      },
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * Unsubscribe from push notifications.
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return true;

    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return true;

    // Unsubscribe from browser
    await subscription.unsubscribe();

    // Tell backend to remove subscription
    await api.delete('/push/unsubscribe', {
      data: { endpoint: subscription.endpoint },
    });

    return true;
  } catch {
    return false;
  }
}
