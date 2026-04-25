/**
 * Integration — notification dispatch + push subscription persistence.
 *
 * Covered items:
 *   #41 Notification dispatch — notifyAdmins fans out only to non-deactivated
 *       admins; sendToMany writes N rows; mark-read / unread-count / clearAll
 *   #42 Push-subscription register + unregister (via WebPushService)
 */

import { getTestContext, seedReference } from './_setup';
import { NotificationService } from '../../src/common/services/notification.service';
import { WebPushService } from '../../src/common/services/web-push.service';
import * as crypto from 'crypto';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const webpush = require('web-push');

const ctx = getTestContext();

// Generate real VAPID keys ONCE per test file so WebPushService constructs
// without "must be URL safe Base 64" validation failures. We never actually
// send a push — sendNotification is not exercised in this file.
const { publicKey: VAPID_PUBLIC, privateKey: VAPID_PRIVATE } = webpush.generateVAPIDKeys();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function makeNotification() {
  const prismaSvc = { client: ctx.prisma } as any;
  const webPushStub = { sendToUser: jest.fn().mockResolvedValue(undefined) } as any;
  return new NotificationService(prismaSvc, webPushStub);
}

function makeWebPush() {
  const prismaSvc = { client: ctx.prisma } as any;
  return new WebPushService(
    {
      get: (k: string, fallback?: string) => {
        const c: Record<string, string> = {
          VAPID_PUBLIC_KEY: VAPID_PUBLIC,
          VAPID_PRIVATE_KEY: VAPID_PRIVATE,
          VAPID_SUBJECT: 'mailto:support@jadwal.com',
        };
        return c[k] ?? fallback;
      },
    } as any,
    prismaSvc,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// NotificationService — send / read / clear round-trip
// ═══════════════════════════════════════════════════════════════════════════

describe('NotificationService basic CRUD against real DB', () => {
  test('send() creates a row; getNotifications + getUnreadCount reflect it', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeNotification();

    await svc.send({
      userId: seed.customer.id,
      type: 'BOOKING_CONFIRMED',
      title: 'Your booking is confirmed',
      message: 'JDWL-ABC starts in 2 days',
      link: '/bookings/abc',
    });

    const list = await svc.getNotifications(seed.customer.id);
    expect(list.data).toHaveLength(1);
    expect(list.total).toBe(1);
    expect(list.unreadCount).toBe(1);
    expect(list.data[0].title).toBe('Your booking is confirmed');
  });

  test('unsafe link (absolute URL) is sanitized to null — no XSS-via-notification', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeNotification();
    await svc.send({
      userId: seed.customer.id, type: 'SYSTEM',
      title: 't', message: 'm',
      link: 'https://evil.com/steal',
    });
    const n = await ctx.prisma.notification.findFirstOrThrow();
    expect(n.link).toBeNull();
  });

  test('protocol-like link (//evil, javascript:) → sanitized to null', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeNotification();
    await svc.send({
      userId: seed.customer.id, type: 'SYSTEM',
      title: 't', message: 'm', link: '//evil.com',
    });
    const row1 = await ctx.prisma.notification.findFirstOrThrow();
    expect(row1.link).toBeNull();

    await svc.send({
      userId: seed.customer.id, type: 'SYSTEM',
      title: 't', message: 'm', link: 'javascript:alert(1)' as any,
    });
    const all = await ctx.prisma.notification.findMany({ orderBy: { createdAt: 'asc' } });
    expect(all[1].link).toBeNull();
  });

  test('markAsRead flips a single row; other unread rows unchanged', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeNotification();
    await svc.send({ userId: seed.customer.id, type: 'SYSTEM', title: 'a', message: 'a' });
    await svc.send({ userId: seed.customer.id, type: 'SYSTEM', title: 'b', message: 'b' });

    const list = await svc.getNotifications(seed.customer.id);
    const firstId = list.data[0].id;

    await svc.markAsRead(seed.customer.id, firstId);

    const after = await svc.getNotifications(seed.customer.id);
    expect(after.unreadCount).toBe(1);
    const readRow = after.data.find((r: any) => r.id === firstId)!;
    expect(readRow.read).toBe(true);
  });

  test('markAsRead refuses to mark another user\'s notification (scoped by userId in updateMany)', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeNotification();
    const other = await ctx.prisma.user.create({
      data: {
        fullName: 'Other', email: `o-${crypto.randomUUID().slice(0, 6)}@t.com`,
        password: '$2b$10$dummy', role: 'CUSTOMER', emailVerified: true,
      },
    });
    await svc.send({ userId: other.id, type: 'SYSTEM', title: 'x', message: 'y' });
    const foreignNotif = await ctx.prisma.notification.findFirstOrThrow();

    // Attempt to mark as the wrong user — no-op because the update is scoped
    await svc.markAsRead(seed.customer.id, foreignNotif.id);

    const row = await ctx.prisma.notification.findUniqueOrThrow({ where: { id: foreignNotif.id } });
    expect(row.read).toBe(false);
  });

  test('markAllAsRead flips every unread row for the user in one shot', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeNotification();
    for (let i = 0; i < 5; i++) {
      await svc.send({ userId: seed.customer.id, type: 'SYSTEM', title: `t${i}`, message: 'm' });
    }
    await svc.markAllAsRead(seed.customer.id);
    expect(await svc.getUnreadCount(seed.customer.id)).toBe(0);
  });

  test('clearAll deletes every row for the user', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeNotification();
    for (let i = 0; i < 3; i++) {
      await svc.send({ userId: seed.customer.id, type: 'SYSTEM', title: 't', message: 'm' });
    }
    const res = await svc.clearAll(seed.customer.id);
    expect(res.deleted).toBe(3);
    expect(await svc.getUnreadCount(seed.customer.id)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// notifyAdmins / sendToMany
// ═══════════════════════════════════════════════════════════════════════════

describe('NotificationService.notifyAdmins + sendToMany', () => {
  test('notifyAdmins writes one notification per active admin; skips deactivated admins', async () => {
    await seedReference(ctx.prisma);
    const svc = makeNotification();

    const admin1 = await ctx.prisma.user.create({
      data: {
        fullName: 'A1', email: `a1-${crypto.randomUUID().slice(0, 6)}@t.com`,
        password: '$2b$10$dummy', role: 'ADMIN', emailVerified: true,
      },
    });
    const admin2 = await ctx.prisma.user.create({
      data: {
        fullName: 'A2', email: `a2-${crypto.randomUUID().slice(0, 6)}@t.com`,
        password: '$2b$10$dummy', role: 'ADMIN', emailVerified: true,
      },
    });
    // Deactivated admin — must NOT receive the notification
    await ctx.prisma.user.create({
      data: {
        fullName: 'A3', email: `a3-${crypto.randomUUID().slice(0, 6)}@t.com`,
        password: '$2b$10$dummy', role: 'ADMIN', emailVerified: true,
        isDeactivated: true,
      },
    });

    await svc.notifyAdmins({
      type: 'PAYOUT_REQUESTED',
      title: 'Payout Request',
      message: 'Vendor needs payout',
      link: '/admin/payouts',
    });

    const rows = await ctx.prisma.notification.findMany({
      where: { type: 'PAYOUT_REQUESTED' },
    });
    expect(rows).toHaveLength(2);
    const uids = rows.map(r => r.userId).sort();
    expect(uids).toEqual([admin1.id, admin2.id].sort());
  });

  test('notifyAdmins with no admins → silent no-op', async () => {
    await seedReference(ctx.prisma);
    // seed ONLY has vendor + customer, no admin
    const svc = makeNotification();
    await svc.notifyAdmins({
      type: 'SYSTEM', title: 'x', message: 'y',
    });
    expect(await ctx.prisma.notification.count()).toBe(0);
  });

  test('sendToMany with empty list → no-op (no empty batch writes)', async () => {
    await seedReference(ctx.prisma);
    const svc = makeNotification();
    await svc.sendToMany({
      userIds: [],
      type: 'SYSTEM', title: 'x', message: 'y',
    });
    expect(await ctx.prisma.notification.count()).toBe(0);
  });

  test('sendToMany creates N rows with identical payload', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeNotification();
    const u2 = await ctx.prisma.user.create({
      data: {
        fullName: 'U2', email: `u2-${crypto.randomUUID().slice(0, 6)}@t.com`,
        password: '$2b$10$dummy', role: 'CUSTOMER', emailVerified: true,
      },
    });
    await svc.sendToMany({
      userIds: [seed.customer.id, u2.id, seed.vendorUser.id],
      type: 'SYSTEM', title: 'Maintenance', message: 'Scheduled tonight',
    });
    const rows = await ctx.prisma.notification.findMany();
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map(r => r.title))).toEqual(new Set(['Maintenance']));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Push subscription register/unregister (DB-level)
// ═══════════════════════════════════════════════════════════════════════════

describe('WebPushService subscribe/unsubscribe — real DB', () => {
  test('subscribe writes a PushSubscription row; unsubscribe deletes it', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeWebPush();

    const endpoint = `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`;
    await svc.subscribe(seed.customer.id, {
      endpoint,
      keys: { p256dh: 'pkey', auth: 'akey' },
    });
    expect(await ctx.prisma.pushSubscription.count({ where: { userId: seed.customer.id } })).toBe(1);

    await svc.unsubscribe(seed.customer.id, endpoint);
    expect(await ctx.prisma.pushSubscription.count({ where: { userId: seed.customer.id } })).toBe(0);
  });

  test('same endpoint re-subscribed → upsert (no duplicate rows)', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeWebPush();
    const endpoint = `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`;

    await svc.subscribe(seed.customer.id, {
      endpoint, keys: { p256dh: 'pkey1', auth: 'akey1' },
    });
    await svc.subscribe(seed.customer.id, {
      endpoint, keys: { p256dh: 'pkey2', auth: 'akey2' },
    });

    const rows = await ctx.prisma.pushSubscription.findMany({ where: { userId: seed.customer.id } });
    expect(rows).toHaveLength(1);
    // Updated keys took effect
    expect(rows[0].p256dh).toBe('pkey2');
  });

  test('at 5-subscription cap, oldest is evicted when a new one is added', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeWebPush();

    for (let i = 0; i < 5; i++) {
      await svc.subscribe(seed.customer.id, {
        endpoint: `https://fcm.googleapis.com/fcm/send/sub-${i}`,
        keys: { p256dh: `p${i}`, auth: `a${i}` },
      });
      // Small delay to differentiate createdAt
      await new Promise(r => setTimeout(r, 5));
    }
    expect(await ctx.prisma.pushSubscription.count({ where: { userId: seed.customer.id } }))
      .toBe(5);

    // 6th subscription triggers eviction of oldest (sub-0)
    await svc.subscribe(seed.customer.id, {
      endpoint: `https://fcm.googleapis.com/fcm/send/sub-5`,
      keys: { p256dh: 'p5', auth: 'a5' },
    });
    expect(await ctx.prisma.pushSubscription.count({ where: { userId: seed.customer.id } }))
      .toBe(5);
    const byEndpoint = await ctx.prisma.pushSubscription.findFirst({
      where: { userId: seed.customer.id, endpoint: `https://fcm.googleapis.com/fcm/send/sub-0` },
    });
    expect(byEndpoint).toBeNull(); // oldest evicted
  });
});
