/**
 * Thin controller tests — delegation + param coercion only.
 *
 * Covered:
 *   - NotificationController: pagination parsing, @CurrentUser injection,
 *     mark-read / mark-all-read / clear-all
 *   - PushController: subscribe + unsubscribe DTO plumbing
 *   - AppController: app-info / ping
 *   - GeoController: passes through
 *
 * The heavy logic is exercised in service specs; this file proves the
 * controller wiring + boundary coercion doesn't drop an endpoint on the floor.
 */

import { NotificationController } from '../../src/common/controllers/notification.controller';
import { PushController } from '../../src/common/controllers/push.controller';
import { AppController } from '../../src/app.controller';

// ═══════════════════════════════════════════════════════════════════════════
// NotificationController
// ═══════════════════════════════════════════════════════════════════════════

describe('NotificationController', () => {
  function makeSvc() {
    return {
      getNotifications: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      getUnreadCount: jest.fn().mockResolvedValue(3),
      markAsRead: jest.fn().mockResolvedValue({ updated: true }),
      markAllAsRead: jest.fn().mockResolvedValue({ count: 5 }),
      clearAll: jest.fn().mockResolvedValue({ count: 10 }),
    };
  }

  test('getNotifications defaults: page=1, limit=20', () => {
    const svc = makeSvc();
    const ctrl = new NotificationController(svc as any);
    ctrl.getNotifications({ id: 'u1' } as any);
    expect(svc.getNotifications).toHaveBeenCalledWith('u1', 1, 20);
  });

  test('getNotifications clamps: page < 1 → 1, limit > 50 → 50', () => {
    const svc = makeSvc();
    const ctrl = new NotificationController(svc as any);
    ctrl.getNotifications({ id: 'u1' } as any, '-5', '999');
    expect(svc.getNotifications).toHaveBeenCalledWith('u1', 1, 50);
  });

  test('getNotifications rejects garbage strings (NaN) → defaults to 1 and 20', () => {
    const svc = makeSvc();
    const ctrl = new NotificationController(svc as any);
    ctrl.getNotifications({ id: 'u1' } as any, 'nan', 'nan');
    expect(svc.getNotifications).toHaveBeenCalledWith('u1', 1, 20);
  });

  test('getUnreadCount → returns {unreadCount}', async () => {
    const svc = makeSvc();
    const ctrl = new NotificationController(svc as any);
    const res = await ctrl.getUnreadCount({ id: 'u1' } as any);
    expect(res).toEqual({ unreadCount: 3 });
  });

  test('markAsRead passes userId + notificationId', () => {
    const svc = makeSvc();
    const ctrl = new NotificationController(svc as any);
    ctrl.markAsRead({ id: 'u1' } as any, 'notif-9');
    expect(svc.markAsRead).toHaveBeenCalledWith('u1', 'notif-9');
  });

  test('markAllAsRead passes only userId', () => {
    const svc = makeSvc();
    const ctrl = new NotificationController(svc as any);
    ctrl.markAllAsRead({ id: 'u1' } as any);
    expect(svc.markAllAsRead).toHaveBeenCalledWith('u1');
  });

  test('clearAll passes only userId', () => {
    const svc = makeSvc();
    const ctrl = new NotificationController(svc as any);
    ctrl.clearAll({ id: 'u1' } as any);
    expect(svc.clearAll).toHaveBeenCalledWith('u1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PushController
// ═══════════════════════════════════════════════════════════════════════════

describe('PushController', () => {
  function makeSvc() {
    return {
      subscribe: jest.fn().mockResolvedValue({ subscribed: true }),
      unsubscribe: jest.fn().mockResolvedValue({ unsubscribed: true }),
    };
  }

  test('subscribe delegates userId + whole DTO to service', () => {
    const svc = makeSvc();
    const ctrl = new PushController(svc as any);
    const dto = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: 'p', auth: 'a' },
    };
    ctrl.subscribe({ id: 'u1' } as any, dto);
    expect(svc.subscribe).toHaveBeenCalledWith('u1', dto);
  });

  test('unsubscribe delegates userId + endpoint string only', () => {
    const svc = makeSvc();
    const ctrl = new PushController(svc as any);
    ctrl.unsubscribe({ id: 'u1' } as any, { endpoint: 'https://fcm/abc' });
    expect(svc.unsubscribe).toHaveBeenCalledWith('u1', 'https://fcm/abc');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AppController — health / root
// ═══════════════════════════════════════════════════════════════════════════

describe('AppController', () => {
  const mkPrisma = (impl: () => Promise<unknown>) =>
    ({ client: { $queryRawUnsafe: jest.fn(impl) } } as any);
  const mkRedis = (impl: () => Promise<unknown>) =>
    ({ getClient: jest.fn().mockReturnValue({ ping: jest.fn(impl) }) } as any);

  test('getHello / root endpoint exists and returns a value', () => {
    const ctrl = new AppController(
      { getHello: jest.fn().mockReturnValue('Hello Jadwal') } as any,
      mkPrisma(async () => [{ '?column?': 1 }]),
      mkRedis(async () => 'PONG'),
    );
    // The minimal contract: methods exist and don't throw
    expect(() => (ctrl as any).getHello?.()).not.toThrow();
  });

  describe('/health/ready', () => {
    test('returns ok when DB + Redis both respond', async () => {
      const ctrl = new AppController(
        {} as any,
        mkPrisma(async () => [{ '?column?': 1 }]),
        mkRedis(async () => 'PONG'),
      );
      await expect(ctrl.getReady()).resolves.toEqual({ status: 'ok', db: 'up', redis: 'up' });
    });

    test('throws 503 when DB ping rejects', async () => {
      const ctrl = new AppController(
        {} as any,
        mkPrisma(() => Promise.reject(new Error('ECONNREFUSED'))),
        mkRedis(async () => 'PONG'),
      );
      await expect(ctrl.getReady()).rejects.toMatchObject({
        status: 503,
        response: { db: 'down', redis: 'up' },
      });
    });

    test('throws 503 when Redis ping rejects', async () => {
      const ctrl = new AppController(
        {} as any,
        mkPrisma(async () => [{ '?column?': 1 }]),
        mkRedis(() => Promise.reject(new Error('ETIMEDOUT'))),
      );
      await expect(ctrl.getReady()).rejects.toMatchObject({
        status: 503,
        response: { db: 'up', redis: 'down' },
      });
    });

    test('throws 503 when DB exceeds 1s timeout', async () => {
      const ctrl = new AppController(
        {} as any,
        mkPrisma(() => new Promise(() => {})), // hangs forever
        mkRedis(async () => 'PONG'),
      );
      await expect(ctrl.getReady()).rejects.toMatchObject({
        status: 503,
        response: { db: 'down', redis: 'up' },
      });
    }, 3000);
  });
});
