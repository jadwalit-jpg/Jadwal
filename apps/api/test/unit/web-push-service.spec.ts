/**
 * WebPushService unit tests.
 *
 *   - Construction: VAPID missing in prod → throws; missing in dev → disabled (no-op)
 *   - subscribe: validates https endpoint + keys, enforces max 5 per user,
 *     evicts oldest when at cap, upserts by endpoint
 *   - sendToUser: builds SAFE payload (strips non-relative url, no PII);
 *     410/404 marks subscription stale and deletes it; other errors log-only
 *   - unsubscribe: deletes the endpoint row for that user
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const webpush = require('web-push') as { setVapidDetails: jest.Mock; sendNotification: jest.Mock };

import { WebPushService } from '../../src/common/services/web-push.service';
import { BadRequestException } from '@nestjs/common';

function makeConfig(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    VAPID_PUBLIC_KEY: 'BKagOny0KF_2pCJQ3m...fake',
    VAPID_PRIVATE_KEY: 'UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc',
    VAPID_SUBJECT: 'mailto:support@jadwal.com',
  };
  const merged = { ...defaults, ...overrides };
  return {
    get: (k: string, fallback?: string) => merged[k] ?? fallback,
  };
}

function makePrismaMock() {
  return {
    client: {
      pushSubscription: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
        upsert: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    },
  };
}

describe('WebPushService — construction', () => {
  const ORIG = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = ORIG; webpush.setVapidDetails.mockClear(); });

  test('keys configured → setVapidDetails called with subject + both keys', () => {
    new WebPushService(makeConfig() as any, makePrismaMock() as any);
    expect(webpush.setVapidDetails).toHaveBeenCalledWith(
      'mailto:support@jadwal.com',
      expect.any(String),
      expect.any(String),
    );
  });

  test('missing keys in dev → disabled, no throw', () => {
    expect(() =>
      new WebPushService(
        makeConfig({ VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '' }) as any,
        makePrismaMock() as any,
      ),
    ).not.toThrow();
    expect(webpush.setVapidDetails).not.toHaveBeenCalled();
  });

  test('missing keys in production → throws (fail-fast)', () => {
    process.env.NODE_ENV = 'production';
    expect(() =>
      new WebPushService(
        makeConfig({ VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '' }) as any,
        makePrismaMock() as any,
      ),
    ).toThrow(/FATAL.*VAPID/);
  });
});

describe('WebPushService.subscribe', () => {
  test('non-HTTPS endpoint → BadRequest', async () => {
    const prisma = makePrismaMock();
    const svc = new WebPushService(makeConfig() as any, prisma as any);
    await expect(svc.subscribe('u1', {
      endpoint: 'http://insecure.example/sub',
      keys: { p256dh: 'a', auth: 'b' },
    })).rejects.toThrow(BadRequestException);
  });

  test('missing keys → BadRequest', async () => {
    const prisma = makePrismaMock();
    const svc = new WebPushService(makeConfig() as any, prisma as any);
    await expect(svc.subscribe('u1', {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: '', auth: 'b' },
    })).rejects.toThrow(BadRequestException);
  });

  test('disabled (no VAPID) → returns {subscribed:false, reason}', async () => {
    const prisma = makePrismaMock();
    const svc = new WebPushService(
      makeConfig({ VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '' }) as any,
      prisma as any,
    );
    const res = await svc.subscribe('u1', {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: 'a', auth: 'b' },
    });
    expect(res).toEqual({ subscribed: false, reason: expect.any(String) });
    expect(prisma.client.pushSubscription.upsert).not.toHaveBeenCalled();
  });

  test('happy path upserts by endpoint', async () => {
    const prisma = makePrismaMock();
    const svc = new WebPushService(makeConfig() as any, prisma as any);
    const res = await svc.subscribe('u1', {
      endpoint: 'https://fcm.googleapis.com/fcm/send/xyz',
      keys: { p256dh: 'pk', auth: 'ak' },
    });
    expect(res).toEqual({ subscribed: true });
    expect(prisma.client.pushSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { endpoint: 'https://fcm.googleapis.com/fcm/send/xyz' },
        create: expect.objectContaining({
          userId: 'u1', endpoint: 'https://fcm.googleapis.com/fcm/send/xyz',
          p256dh: 'pk', auth: 'ak',
        }),
        update: expect.objectContaining({ p256dh: 'pk', auth: 'ak', userId: 'u1' }),
      }),
    );
  });

  test('at 5-subscription cap → deletes oldest before upserting', async () => {
    const prisma = makePrismaMock();
    prisma.client.pushSubscription.count.mockResolvedValueOnce(5);
    prisma.client.pushSubscription.findFirst.mockResolvedValueOnce({ id: 'oldest-sub' });
    const svc = new WebPushService(makeConfig() as any, prisma as any);
    await svc.subscribe('u1', {
      endpoint: 'https://fcm.googleapis.com/fcm/send/xyz',
      keys: { p256dh: 'pk', auth: 'ak' },
    });
    expect(prisma.client.pushSubscription.delete).toHaveBeenCalledWith({ where: { id: 'oldest-sub' } });
    expect(prisma.client.pushSubscription.upsert).toHaveBeenCalled();
  });
});

describe('WebPushService.unsubscribe', () => {
  test('deletes subscription rows matching (userId, endpoint)', async () => {
    const prisma = makePrismaMock();
    const svc = new WebPushService(makeConfig() as any, prisma as any);
    await svc.unsubscribe('u1', 'https://fcm.googleapis.com/fcm/send/abc');
    expect(prisma.client.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', endpoint: 'https://fcm.googleapis.com/fcm/send/abc' },
    });
  });
});

describe('WebPushService.sendToUser', () => {
  beforeEach(() => webpush.sendNotification.mockReset());

  test('disabled (no VAPID) → early return without DB read', async () => {
    const prisma = makePrismaMock();
    const svc = new WebPushService(
      makeConfig({ VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '' }) as any,
      prisma as any,
    );
    await svc.sendToUser('u1', { title: 'Hi', body: 'Hello' });
    expect(prisma.client.pushSubscription.findMany).not.toHaveBeenCalled();
  });

  test('no subs for user → no-op, no sendNotification call', async () => {
    const prisma = makePrismaMock();
    prisma.client.pushSubscription.findMany.mockResolvedValueOnce([]);
    const svc = new WebPushService(makeConfig() as any, prisma as any);
    await svc.sendToUser('u1', { title: 'Hi', body: 'Hello' });
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  test('sends SAFE payload: strips absolute URL; keeps relative one; adds icons', async () => {
    const prisma = makePrismaMock();
    prisma.client.pushSubscription.findMany.mockResolvedValueOnce([
      { id: 's1', endpoint: 'https://ep1', p256dh: 'p', auth: 'a' },
    ]);
    webpush.sendNotification.mockResolvedValueOnce({});

    const svc = new WebPushService(makeConfig() as any, prisma as any);
    await svc.sendToUser('u1', {
      title: 'New booking',
      body: 'JDWL-ABC confirmed',
      url: 'https://evil.com/steal', // absolute — should be stripped
    });

    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    const [sub, payloadStr, opts] = webpush.sendNotification.mock.calls[0];
    expect(sub).toEqual({ endpoint: 'https://ep1', keys: { p256dh: 'p', auth: 'a' } });
    expect(opts.TTL).toBe(3600);
    const payload = JSON.parse(payloadStr);
    expect(payload.title).toBe('New booking');
    expect(payload.body).toBe('JDWL-ABC confirmed');
    expect(payload.url).toBeUndefined(); // absolute URL stripped
    expect(payload.icon).toBeDefined();
  });

  test('relative URL is preserved in payload', async () => {
    const prisma = makePrismaMock();
    prisma.client.pushSubscription.findMany.mockResolvedValueOnce([
      { id: 's1', endpoint: 'https://ep1', p256dh: 'p', auth: 'a' },
    ]);
    webpush.sendNotification.mockResolvedValueOnce({});
    const svc = new WebPushService(makeConfig() as any, prisma as any);
    await svc.sendToUser('u1', { title: 'x', body: 'y', url: '/bookings/123' });
    const payload = JSON.parse(webpush.sendNotification.mock.calls[0][1]);
    expect(payload.url).toBe('/bookings/123');
  });

  test('410 Gone → subscription deleted (stale cleanup)', async () => {
    const prisma = makePrismaMock();
    prisma.client.pushSubscription.findMany.mockResolvedValueOnce([
      { id: 'stale-1', endpoint: 'https://ep1', p256dh: 'p', auth: 'a' },
      { id: 'fresh-1', endpoint: 'https://ep2', p256dh: 'p', auth: 'a' },
    ]);
    const stale = Object.assign(new Error('Gone'), { statusCode: 410 });
    webpush.sendNotification.mockRejectedValueOnce(stale);
    webpush.sendNotification.mockResolvedValueOnce({});

    const svc = new WebPushService(makeConfig() as any, prisma as any);
    await svc.sendToUser('u1', { title: 'x', body: 'y' });

    expect(prisma.client.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['stale-1'] } },
    });
  });

  test('404 Not Found → subscription deleted (stale cleanup)', async () => {
    const prisma = makePrismaMock();
    prisma.client.pushSubscription.findMany.mockResolvedValueOnce([
      { id: 'dead-1', endpoint: 'https://ep1', p256dh: 'p', auth: 'a' },
    ]);
    const notFound = Object.assign(new Error('NF'), { statusCode: 404 });
    webpush.sendNotification.mockRejectedValueOnce(notFound);

    const svc = new WebPushService(makeConfig() as any, prisma as any);
    await svc.sendToUser('u1', { title: 'x', body: 'y' });

    expect(prisma.client.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['dead-1'] } },
    });
  });

  test('500 transient error → subscription NOT deleted (retryable)', async () => {
    const prisma = makePrismaMock();
    prisma.client.pushSubscription.findMany.mockResolvedValueOnce([
      { id: 'transient', endpoint: 'https://ep1', p256dh: 'p', auth: 'a' },
    ]);
    const transient = Object.assign(new Error('WRONGPASS'), { statusCode: 500 });
    webpush.sendNotification.mockRejectedValueOnce(transient);

    const svc = new WebPushService(makeConfig() as any, prisma as any);
    await svc.sendToUser('u1', { title: 'x', body: 'y' });

    expect(prisma.client.pushSubscription.deleteMany).not.toHaveBeenCalled();
  });
});
