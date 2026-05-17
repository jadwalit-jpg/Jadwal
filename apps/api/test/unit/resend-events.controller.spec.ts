/**
 * ResendEventsController unit tests.
 *
 * The Resend bounce/complaint webhook (introduced 2026-05-17, replacing the
 * retired SES → SNS feedback loop). Covers:
 *   - Fail-closed when RESEND_WEBHOOK_SECRET is unset
 *   - Reject when the body is not a raw Buffer (bypassed the raw parser)
 *   - Reject on a failed Svix signature verification
 *   - email.bounced (Permanent / Undetermined) → suppress
 *   - email.bounced (Transient) → NOT suppressed (may clear on retry)
 *   - email.complained → suppress
 *   - email.delivery_delayed / unhandled types → ack, no suppression
 *   - multi-recipient `to` arrays → suppress each
 */

import { ForbiddenException } from '@nestjs/common';

// Mock the Svix SDK before importing the controller.
jest.mock('svix', () => {
  const verify = jest.fn();
  const Webhook = jest.fn().mockImplementation(() => ({ verify }));
  return { Webhook, __verify: verify };
});
const svixMock = require('svix') as any;

import { ResendEventsController } from '../../src/email/resend-events.controller';

function makeConfig(secret: string | undefined = 'whsec_testsecret') {
  return {
    get: (k: string, fallback?: string) =>
      k === 'RESEND_WEBHOOK_SECRET' ? (secret ?? fallback) : fallback,
  };
}

function makeSuppressions() {
  return {
    suppress: jest.fn().mockResolvedValue(undefined),
    isSuppressed: jest.fn().mockResolvedValue(false),
    unsuppress: jest.fn().mockResolvedValue(true),
  };
}

function build(secret: string | undefined = 'whsec_testsecret') {
  const suppressions = makeSuppressions();
  const ctrl = new ResendEventsController(makeConfig(secret) as any, suppressions as any);
  return { ctrl, suppressions };
}

/** A request whose body is the raw Buffer express.raw() would produce. */
function reqFor(event: unknown) {
  return { body: Buffer.from(JSON.stringify(event)) } as any;
}

const HEADERS = ['svix-id-123', '1700000000', 'v1,sig'] as const;

beforeEach(() => {
  svixMock.Webhook.mockClear();
  svixMock.__verify.mockReset();
});

describe('ResendEventsController — auth gates', () => {
  test('no RESEND_WEBHOOK_SECRET → fail-closed (ForbiddenException)', async () => {
    const { ctrl } = build('');
    await expect(ctrl.handle(reqFor({ type: 'email.bounced' }), ...HEADERS)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  test('body is not a raw Buffer → ForbiddenException', async () => {
    const { ctrl } = build();
    const req = { body: { type: 'email.bounced' } } as any; // parsed object, not Buffer
    await expect(ctrl.handle(req, ...HEADERS)).rejects.toBeInstanceOf(ForbiddenException);
  });

  test('failed Svix verification → ForbiddenException, no suppression', async () => {
    const { ctrl, suppressions } = build();
    svixMock.__verify.mockImplementation(() => {
      const e = new Error('signature mismatch');
      e.name = 'WebhookVerificationError';
      throw e;
    });
    await expect(
      ctrl.handle(reqFor({ type: 'email.complained' }), ...HEADERS),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(suppressions.suppress).not.toHaveBeenCalled();
  });
});

describe('ResendEventsController — event dispatch', () => {
  test('email.bounced (Permanent) → suppress with reason=bounce', async () => {
    const { ctrl, suppressions } = build();
    const event = {
      type: 'email.bounced',
      data: {
        to: ['bad@example.com'],
        bounce: { type: 'Permanent', subType: 'General', message: 'mailbox does not exist' },
      },
    };
    svixMock.__verify.mockReturnValue(event);
    const res = await ctrl.handle(reqFor(event), ...HEADERS);
    expect(res).toEqual({ ok: true });
    expect(suppressions.suppress).toHaveBeenCalledWith(
      'bad@example.com',
      'bounce',
      'Permanent/General',
      'mailbox does not exist',
    );
  });

  test('email.bounced (Transient) → NOT suppressed', async () => {
    const { ctrl, suppressions } = build();
    const event = {
      type: 'email.bounced',
      data: { to: ['busy@example.com'], bounce: { type: 'Transient', subType: 'MailboxFull' } },
    };
    svixMock.__verify.mockReturnValue(event);
    await ctrl.handle(reqFor(event), ...HEADERS);
    expect(suppressions.suppress).not.toHaveBeenCalled();
  });

  test('email.bounced with no bounce.type → suppressed (hard failure assumed)', async () => {
    const { ctrl, suppressions } = build();
    const event = { type: 'email.bounced', data: { to: ['x@example.com'] } };
    svixMock.__verify.mockReturnValue(event);
    await ctrl.handle(reqFor(event), ...HEADERS);
    expect(suppressions.suppress).toHaveBeenCalledWith('x@example.com', 'bounce', 'Unknown/', undefined);
  });

  test('email.complained → suppress with reason=complaint', async () => {
    const { ctrl, suppressions } = build();
    const event = { type: 'email.complained', data: { to: ['spammed@example.com'] } };
    svixMock.__verify.mockReturnValue(event);
    await ctrl.handle(reqFor(event), ...HEADERS);
    expect(suppressions.suppress).toHaveBeenCalledWith('spammed@example.com', 'complaint');
  });

  test('multi-recipient `to` array → suppress each address', async () => {
    const { ctrl, suppressions } = build();
    const event = {
      type: 'email.complained',
      data: { to: ['a@example.com', 'b@example.com'] },
    };
    svixMock.__verify.mockReturnValue(event);
    await ctrl.handle(reqFor(event), ...HEADERS);
    expect(suppressions.suppress).toHaveBeenCalledTimes(2);
    expect(suppressions.suppress).toHaveBeenCalledWith('a@example.com', 'complaint');
    expect(suppressions.suppress).toHaveBeenCalledWith('b@example.com', 'complaint');
  });

  test('string (non-array) `to` is normalised', async () => {
    const { ctrl, suppressions } = build();
    const event = { type: 'email.complained', data: { to: 'single@example.com' } };
    svixMock.__verify.mockReturnValue(event);
    await ctrl.handle(reqFor(event), ...HEADERS);
    expect(suppressions.suppress).toHaveBeenCalledWith('single@example.com', 'complaint');
  });

  test('email.delivery_delayed → ack, no suppression', async () => {
    const { ctrl, suppressions } = build();
    const event = { type: 'email.delivery_delayed', data: { to: ['slow@example.com'] } };
    svixMock.__verify.mockReturnValue(event);
    const res = await ctrl.handle(reqFor(event), ...HEADERS);
    expect(res).toEqual({ ok: true });
    expect(suppressions.suppress).not.toHaveBeenCalled();
  });

  test('unhandled type (email.delivered) → ack, no suppression', async () => {
    const { ctrl, suppressions } = build();
    const event = { type: 'email.delivered', data: { to: ['ok@example.com'] } };
    svixMock.__verify.mockReturnValue(event);
    const res = await ctrl.handle(reqFor(event), ...HEADERS);
    expect(res).toEqual({ ok: true });
    expect(suppressions.suppress).not.toHaveBeenCalled();
  });
});
