/**
 * The guard must swallow exactly ONE error ("Java object is gone", from the
 * Android Facebook in-app browser) and nothing else — a guard that is too
 * broad would hide real bugs from Clarity's error panel.
 */

import { installInAppBrowserGuard, isJavaObjectGoneError } from '@/lib/in-app-browser-guard';

/** A fresh window-like EventTarget with a throwing postMessage stub. */
function fakeWindow(thrower: () => void) {
  const target = new EventTarget() as unknown as Window & Record<string, unknown>;
  (target as unknown as { postMessage: () => void }).postMessage = thrower;
  return target;
}

describe('isJavaObjectGoneError', () => {
  it('matches the Facebook bridge error in any shape', () => {
    expect(isJavaObjectGoneError(new Error('Error invoking postMessage: Java object is gone'))).toBe(true);
    expect(isJavaObjectGoneError('Uncaught Error: Java object is gone')).toBe(true);
  });

  it('does not match anything else', () => {
    expect(isJavaObjectGoneError(new Error('Network Error'))).toBe(false);
    expect(isJavaObjectGoneError(undefined)).toBe(false);
    expect(isJavaObjectGoneError({ message: 42 })).toBe(false);
  });
});

describe('installInAppBrowserGuard', () => {
  it('makes postMessage return quietly for the bridge error', () => {
    const w = fakeWindow(() => {
      throw new Error('Error invoking postMessage: Java object is gone');
    });
    installInAppBrowserGuard(w);
    expect(() => w.postMessage('hi', '*')).not.toThrow();
  });

  it('re-throws every other postMessage error untouched', () => {
    const w = fakeWindow(() => {
      throw new TypeError('DataCloneError');
    });
    installInAppBrowserGuard(w);
    expect(() => w.postMessage('hi', '*')).toThrow('DataCloneError');
  });

  it('stops the bridge error event before later listeners (e.g. analytics) see it', () => {
    const w = fakeWindow(() => undefined);
    installInAppBrowserGuard(w);
    const later = jest.fn();
    w.addEventListener('error', later);

    const ev = new ErrorEvent('error', { message: 'Java object is gone', cancelable: true });
    w.dispatchEvent(ev);
    expect(later).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(true);

    const other = new ErrorEvent('error', { message: 'ReferenceError: x is not defined', cancelable: true });
    w.dispatchEvent(other);
    expect(later).toHaveBeenCalledTimes(1);
    expect(other.defaultPrevented).toBe(false);
  });

  it('is idempotent', () => {
    const w = fakeWindow(() => undefined);
    installInAppBrowserGuard(w);
    const once = w.postMessage;
    installInAppBrowserGuard(w);
    expect(w.postMessage).toBe(once);
  });
});
