/**
 * SesEventsController unit tests.
 *
 * Auth model: this controller does NOT cryptographically verify SNS
 * signatures (see controller for full rationale). Auth substitutes are:
 *   1. Cloudflare WAF AWS-IP allowlist on the path (configured outside
 *      this codebase — runbook entry only)
 *   2. TopicArn pinning (tested here)
 *   3. Content-shape validation (tested here)
 *
 * Tests cover:
 *   - Missing message-type header → 403
 *   - Wrong/unknown TopicArn → 403 (the primary in-code auth gate)
 *   - Permanent bounce → suppression upserted (notificationType + eventType)
 *   - Transient bounce → ignored (do NOT suppress legit recipients on
 *     temporary failures like greylisting / mailbox full)
 *   - Complaint → suppressed unconditionally
 *   - SubscriptionConfirmation → SubscribeURL reconstructed safely + fetched
 *   - SSRF defence — attacker-controlled SubscribeURL host is discarded
 */

import { ForbiddenException } from '@nestjs/common';

// global fetch mock for SubscribeURL
const fetchMock = jest.fn().mockResolvedValue(undefined);
(global as any).fetch = fetchMock;

import { SesEventsController } from '../../src/email/ses-events.controller';

const KNOWN_BOUNCES_ARN = 'arn:aws:sns:eu-central-1:1:jadwal-ses-bounces';
const KNOWN_COMPLAINTS_ARN = 'arn:aws:sns:eu-central-1:1:jadwal-ses-complaints';

function makeSut() {
  const config = {
    get: (k: string) => {
      if (k === 'SNS_TOPIC_ARN_BOUNCES') return KNOWN_BOUNCES_ARN;
      if (k === 'SNS_TOPIC_ARN_COMPLAINTS') return KNOWN_COMPLAINTS_ARN;
      return undefined;
    },
  };
  const suppressions = {
    suppress: jest.fn().mockResolvedValue(undefined),
    isSuppressed: jest.fn(),
    unsuppress: jest.fn(),
  };
  const sut = new SesEventsController(config as any, suppressions as any);
  return { sut, suppressions };
}

function makeBounceMessage(emailAddress: string, bounceType: 'Permanent' | 'Transient' = 'Permanent') {
  return {
    Type: 'Notification',
    MessageId: 'msg-1',
    TopicArn: KNOWN_BOUNCES_ARN,
    Timestamp: '2026-05-03T10:00:00Z',
    SignatureVersion: '1',
    Signature: 'sig',
    SigningCertURL: 'https://sns.../cert.pem',
    Message: JSON.stringify({
      notificationType: 'Bounce',
      bounce: {
        bounceType,
        bounceSubType: 'General',
        bouncedRecipients: [{ emailAddress, status: '5.0.0', diagnosticCode: 'mx hard-fail' }],
        timestamp: '2026-05-03T10:00:00Z',
      },
    }),
  };
}

function makeComplaintMessage(emailAddress: string) {
  return {
    Type: 'Notification',
    MessageId: 'msg-2',
    TopicArn: KNOWN_COMPLAINTS_ARN,
    Timestamp: '2026-05-03T10:00:00Z',
    SignatureVersion: '1',
    Signature: 'sig',
    SigningCertURL: 'https://sns.../cert.pem',
    Message: JSON.stringify({
      notificationType: 'Complaint',
      complaint: {
        complainedRecipients: [{ emailAddress }],
        complaintFeedbackType: 'abuse',
        timestamp: '2026-05-03T10:00:00Z',
      },
    }),
  };
}

describe('SesEventsController.handle — auth gates', () => {
  test('missing message-type header → 403', async () => {
    const { sut } = makeSut();
    await expect(sut.handle(undefined, makeBounceMessage('x@b.com') as any)).rejects.toThrow(ForbiddenException);
  });

  test('unknown TopicArn → 403 (the primary in-code auth gate)', async () => {
    const { sut, suppressions } = makeSut();
    const msg = makeBounceMessage('x@b.com');
    msg.TopicArn = 'arn:aws:sns:eu-central-1:1:wrong-topic';
    await expect(sut.handle('Notification', msg as any)).rejects.toThrow(ForbiddenException);
    expect(suppressions.suppress).not.toHaveBeenCalled();
  });

  test('null body → 403', async () => {
    const { sut, suppressions } = makeSut();
    await expect(sut.handle('Notification', null as any)).rejects.toThrow(ForbiddenException);
    expect(suppressions.suppress).not.toHaveBeenCalled();
  });
});

describe('SesEventsController.handle — bounce + complaint processing', () => {
  test('permanent bounce → suppress() called once with bounce reason', async () => {
    const { sut, suppressions } = makeSut();
    await sut.handle('Notification', makeBounceMessage('hard@bounced.com', 'Permanent') as any);
    expect(suppressions.suppress).toHaveBeenCalledTimes(1);
    const [email, reason, sub] = suppressions.suppress.mock.calls[0];
    expect(email).toBe('hard@bounced.com');
    expect(reason).toBe('bounce');
    expect(sub).toMatch(/^Permanent\//);
  });

  test('transient bounce → suppression NOT called (mailbox full / greylisting auto-recovers)', async () => {
    const { sut, suppressions } = makeSut();
    await sut.handle('Notification', makeBounceMessage('soft@bounced.com', 'Transient') as any);
    expect(suppressions.suppress).not.toHaveBeenCalled();
  });

  test('complaint → suppress() with reason=complaint regardless of feedbackType', async () => {
    const { sut, suppressions } = makeSut();
    await sut.handle('Notification', makeComplaintMessage('marked@spam.com') as any);
    expect(suppressions.suppress).toHaveBeenCalledTimes(1);
    expect(suppressions.suppress.mock.calls[0][1]).toBe('complaint');
  });

  test('eventType=Bounce (configuration-set events format) → suppressed same as notificationType', async () => {
    // SES configuration-set events use `eventType` instead of the legacy
    // `notificationType` key. Controller accepts both.
    const { sut, suppressions } = makeSut();
    const msg = {
      Type: 'Notification',
      MessageId: 'msg-event',
      TopicArn: KNOWN_BOUNCES_ARN,
      Timestamp: '2026-05-04T05:31:14.164Z',
      SignatureVersion: '1',
      Signature: 'sig',
      SigningCertURL: 'https://sns.../cert.pem',
      Subject: 'Amazon SES Email Event Notification',
      Message: JSON.stringify({
        eventType: 'Bounce',
        bounce: {
          bounceType: 'Permanent',
          bounceSubType: 'General',
          bouncedRecipients: [{ emailAddress: 'event@bounced.com' }],
          timestamp: '2026-05-04T05:31:13.885Z',
        },
      }),
    } as any;
    await sut.handle('Notification', msg);
    expect(suppressions.suppress).toHaveBeenCalledTimes(1);
    expect(suppressions.suppress.mock.calls[0][0]).toBe('event@bounced.com');
    expect(suppressions.suppress.mock.calls[0][1]).toBe('bounce');
  });

  test('multiple bounced recipients in one message → all suppressed', async () => {
    const { sut, suppressions } = makeSut();
    const msg = makeBounceMessage('a@b.com');
    const inner = JSON.parse(msg.Message);
    inner.bounce.bouncedRecipients = [
      { emailAddress: 'a@b.com' },
      { emailAddress: 'b@c.com' },
      { emailAddress: 'c@d.com' },
    ];
    msg.Message = JSON.stringify(inner);
    await sut.handle('Notification', msg as any);
    expect(suppressions.suppress).toHaveBeenCalledTimes(3);
  });

  test('malformed Message JSON → returns ok without suppression (don\'t loop SNS retries)', async () => {
    const { sut, suppressions } = makeSut();
    const msg: any = makeBounceMessage('a@b.com');
    msg.Message = 'not-json';
    const result = await sut.handle('Notification', msg);
    expect(result).toEqual({ ok: true });
    expect(suppressions.suppress).not.toHaveBeenCalled();
  });
});

describe('SesEventsController.handle — subscription handshake', () => {
  test('SubscriptionConfirmation → reconstructs URL from validated parts and fetches', async () => {
    const { sut } = makeSut();
    fetchMock.mockClear();
    const realToken = 'a'.repeat(150); // realistic SNS token shape
    const msg = {
      Type: 'SubscriptionConfirmation',
      MessageId: 'msg-3',
      TopicArn: KNOWN_BOUNCES_ARN,
      Timestamp: '2026-05-03T10:00:00Z',
      SignatureVersion: '1',
      Signature: 'sig',
      SigningCertURL: 'https://sns.eu-central-1.amazonaws.com/cert.pem',
      SubscribeURL: `https://sns.eu-central-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${encodeURIComponent(KNOWN_BOUNCES_ARN)}&Token=${realToken}`,
      Message: 'You have chosen to subscribe...',
    };
    const result = await sut.handle('SubscriptionConfirmation', msg as any);
    // The fetched URL is RECONSTRUCTED — host/path/action are hardcoded,
    // only TopicArn (validated above) and Token (regex-validated) flow in.
    const fetched = fetchMock.mock.calls[0][0] as string;
    expect(fetched).toMatch(/^https:\/\/sns\.eu-central-1\.amazonaws\.com\/\?Action=ConfirmSubscription&TopicArn=.*&Token=/);
    expect(fetched).toContain(realToken);
    expect(result).toEqual({ ok: true });
  });

  test('SubscriptionConfirmation without SubscribeURL → 403', async () => {
    const { sut } = makeSut();
    const msg = {
      Type: 'SubscriptionConfirmation',
      MessageId: 'msg-3',
      TopicArn: KNOWN_BOUNCES_ARN,
      Timestamp: '2026-05-03T10:00:00Z',
      SignatureVersion: '1',
      Signature: 'sig',
      SigningCertURL: 'https://sns.../cert.pem',
      Message: 'You have chosen to subscribe...',
    } as any;
    await expect(sut.handle('SubscriptionConfirmation', msg)).rejects.toThrow(ForbiddenException);
  });

  // ── URL reconstruction: malformed/missing Token + bad scheme rejected ─
  test.each([
    ['https://sns.eu-central-1.amazonaws.com/?Action=ConfirmSubscription', 'no Token query'],
    ['http://sns.eu-central-1.amazonaws.com/?Token=' + 'a'.repeat(150), 'http (not https)'],
    ['file:///etc/passwd?Token=' + 'a'.repeat(150), 'file:// scheme'],
    ['not a url', 'unparseable URL'],
    [`https://attacker.example/?Token=${'a'.repeat(2049)}`, 'Token too long'],
    [`https://attacker.example/?Token=`, 'empty Token'],
  ])('SubscribeURL %p (%s) → 403, fetch never called', async (subscribeUrl) => {
    fetchMock.mockClear();
    const { sut } = makeSut();
    const msg = {
      Type: 'SubscriptionConfirmation',
      MessageId: 'msg-ssrf',
      TopicArn: KNOWN_BOUNCES_ARN,
      Timestamp: '2026-05-03T10:00:00Z',
      SignatureVersion: '1',
      Signature: 'sig',
      SigningCertURL: 'https://sns.eu-central-1.amazonaws.com/cert.pem',
      SubscribeURL: subscribeUrl,
      Message: 'You have chosen to subscribe...',
    } as any;
    await expect(sut.handle('SubscriptionConfirmation', msg)).rejects.toThrow(ForbiddenException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ── Critical: even when SubscribeURL host is attacker-controlled, the
  // ── reconstructed fetch goes to the legitimate AWS SNS host derived
  // ── from the validated TopicArn, NEVER to the attacker.
  test('attacker host with valid Token → fetch hits AWS SNS, not attacker', async () => {
    fetchMock.mockClear();
    const { sut } = makeSut();
    const realToken = 'b'.repeat(150);
    const msg = {
      Type: 'SubscriptionConfirmation',
      MessageId: 'msg-attacker',
      TopicArn: KNOWN_BOUNCES_ARN,
      Timestamp: '2026-05-03T10:00:00Z',
      SignatureVersion: '1',
      Signature: 'sig',
      SigningCertURL: 'https://sns.eu-central-1.amazonaws.com/cert.pem',
      SubscribeURL: `https://attacker.example/?Token=${realToken}`,
      Message: 'You have chosen to subscribe...',
    } as any;
    const result = await sut.handle('SubscriptionConfirmation', msg);
    const fetched = fetchMock.mock.calls[0]?.[0] as string;
    expect(fetched).toMatch(/^https:\/\/sns\.eu-central-1\.amazonaws\.com\//);
    expect(fetched).not.toContain('attacker.example');
    expect(fetched).toContain(realToken);
    expect(result).toEqual({ ok: true });
  });

  test('IMDS host with valid-shape Token → fetch still goes to AWS SNS, not 169.254.169.254', async () => {
    fetchMock.mockClear();
    const { sut } = makeSut();
    const realToken = 'c'.repeat(150);
    const msg = {
      Type: 'SubscriptionConfirmation',
      MessageId: 'msg-imds',
      TopicArn: KNOWN_BOUNCES_ARN,
      Timestamp: '2026-05-03T10:00:00Z',
      SignatureVersion: '1',
      Signature: 'sig',
      SigningCertURL: 'https://sns.eu-central-1.amazonaws.com/cert.pem',
      SubscribeURL: `https://169.254.169.254/?Token=${realToken}`,
      Message: 'You have chosen to subscribe...',
    } as any;
    await sut.handle('SubscriptionConfirmation', msg);
    const fetched = fetchMock.mock.calls[0]?.[0] as string;
    expect(fetched).toMatch(/^https:\/\/sns\.eu-central-1\.amazonaws\.com\//);
    expect(fetched).not.toContain('169.254.169.254');
  });
});
